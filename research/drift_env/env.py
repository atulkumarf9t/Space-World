"""DriftEnv — a Gymnasium-style decision environment over the headless sim.

Reset/step API matches Gymnasium (reset->(obs,info), step->(obs,reward,terminated,
truncated,info)) but does NOT hard-depend on gymnasium. The env steps at the decision
cadence (default 1 Hz); each step executes one action through the safety guard and
advances the physics by one decision interval.

Observation (float vector, all normalized):
  [worst_pc, worst_miss/10, worst_tca/45, recommended_dv/budget, budget_left/budget,
   dv_used/budget, power_authority]
Action (continuous): a single scalar Δv in [0, budget]; <=eps means coast. The burn
direction is the optimal avoidance direction supplied by the env (set full_direction=True
to instead provide a 3-vector and let the agent choose direction).
"""

import math

try:
    import numpy as np
    def _vec(x): return np.asarray(x, dtype=np.float32)
except Exception:  # numpy optional
    np = None
    def _vec(x): return list(x)

from .simulation import Simulation
from .scenarios import DEFAULT_SCENARIO, generate_scenario
from .reward import REWARDS

OBS_DIM = 7


def encode_obs(o, budget=12.0):
    """Structured observation -> normalized 7-d feature vector (list of floats).
    Shared by the env and any learned policy so training/inference features match."""
    w = o["worst"]
    miss = w["predictedMiss"] if w else 5.0
    tca = w["tca"] if w else 45.0
    # min/max clamps also neutralize inf (tcaFor can return inf at ~0 relative velocity)
    return [
        (w["pc"] if w else 0.0),
        min(max(miss, 0.0), 50.0) / 10.0,
        min(max(tca, 0.0), 120.0) / 45.0,
        min(max(o["worstRecommendedDv"], 0.0), budget) / budget,
        o["budgetRemaining"] / budget,
        o["dvUsed"] / budget,
        o["powerAuthority"],
    ]


class DriftEnv:
    metadata = {"render_modes": []}

    def __init__(self, scenario=None, scenario_fn=None, reward="shaped", reward_kwargs=None,
                 decisionHz=1, flightHz=8, max_steps=80, full_direction=False, instruction=None):
        self.scenario = scenario or DEFAULT_SCENARIO
        self.scenario_fn = scenario_fn      # callable(seed)->scenario, for randomized resets
        self.decisionHz = decisionHz
        self.flightHz = flightHz
        self.substeps = max(1, int(round(flightHz / decisionHz)))
        self.max_steps = max_steps
        self.full_direction = full_direction
        self.instruction = instruction      # natural-language objective (A1 hook); unused by reward here
        self.reward_fn = REWARDS[reward](**(reward_kwargs or {}))
        self.budget = self.scenario.get("dvBudget", 12.0)
        self.sim = None
        self._steps = 0
        # lightweight space descriptors (Gymnasium-compatible if installed)
        self.observation_space = _space(OBS_DIM, low=-1.0, high=10.0)
        self.action_space = _space(3 if full_direction else 1, low=-1.0, high=1.0)

    # Gymnasium API ------------------------------------------------------
    def reset(self, seed=None, options=None):
        sc = self.scenario
        if self.scenario_fn is not None and seed is not None:
            sc = self.scenario_fn(seed)
        self.sim = Simulation(scenario=sc, policy=None, decisionHz=self.decisionHz, flightHz=self.flightHz)
        self.budget = self.sim.phys.dvBudget
        self._steps = 0
        return self._obs(), self._info()

    def step(self, action):
        act = self._to_action(action)
        dv_before = self.sim.phys.dvUsed
        self.sim.execute(act)                       # safety guard
        for _ in range(self.substeps):
            self.sim.fm.tick(self.sim.flightDt, "AGENT")
            self.sim.phys.step(self.sim.flightDt)
            if self.sim.phys.finished:
                break
        self._steps += 1
        dv_step = self.sim.phys.dvUsed - dv_before
        terminated = self.sim.phys.finished
        truncated = (self._steps >= self.max_steps) and not terminated
        reward = self.reward_fn(self.sim, dv_step, terminated)
        return self._obs(), float(reward), bool(terminated), bool(truncated), self._info()

    # internals ----------------------------------------------------------
    def _to_action(self, action):
        if isinstance(action, dict):
            return action
        obs = self.sim.observe()
        if self.full_direction:
            d = {"x": float(action[0]), "y": float(action[1]), "z": float(action[2])}
            mag = math.hypot(d["x"], d["y"], d["z"])
            dv = mag * self.budget
            return {"type": "burn", "dir": d, "dv": dv} if dv > 1e-3 else {"type": "coast"}
        dv = float(action[0] if hasattr(action, "__len__") else action)
        dv = max(0.0, dv) * (self.budget if dv <= 1.0 else 1.0)  # accept normalized [0,1] or raw m/s
        if dv <= 1e-3:
            return {"type": "coast"}
        return {"type": "burn", "dir": obs["worstBurnDir"], "dv": dv}

    def _obs(self):
        return _vec(encode_obs(self.sim.observe(), self.budget))

    def _info(self):
        p = self.sim.phys
        return {
            "par": p.parDv, "dvUsed": p.dvUsed, "status": p.status,
            "regret": (p.dvUsed / p.parDv) if (p.finished and p.parDv > 0) else None,
            "violations": self.sim.violations, "instruction": self.instruction,
        }

    # convenience: roll out a policy dict {decide} to a result
    def run_policy(self, policy, seed=None):
        self.reset(seed=seed)
        done = False
        while not done:
            obs = self.sim.observe()                 # policies consume the structured obs
            act = policy["decide"](obs)
            _, _, term, trunc, _ = self.step(act)
            done = term or trunc
        p = self.sim.phys
        return {
            "scenario": self.sim.scenario.get("name"), "status": p.status,
            "resolved": p.status == "RESOLVED", "collision": p.status == "COLLISION",
            "dvUsed": p.dvUsed, "parDv": p.parDv,
            "ratio": (p.dvUsed / p.parDv) if p.parDv > 0 else None,
            "grade": p.grade, "violations": self.sim.violations,
        }


def _space(dim, low, high):
    try:
        from gymnasium.spaces import Box
        return Box(low=low, high=high, shape=(dim,), dtype="float32")
    except Exception:
        return {"shape": (dim,), "low": low, "high": high}
