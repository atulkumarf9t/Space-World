"""Gymnasium adapter + registration (optional). Importing this module is safe without
gymnasium installed; `register()` is a no-op in that case.

    import gymnasium as gym
    import drift_env.gym_env  # registers ids on import (if gymnasium present)
    env = gym.make("Drift-v0")
    env = gym.make("DriftInstruct-Protect-v0")   # instruction-conditioned (A1)
"""

from .env import DriftEnv, OBS_DIM
from .scenarios import generate_scenario
from . import instructions as _instr

try:
    import gymnasium as _gym
    from gymnasium import spaces as _spaces
    import numpy as _np
    _HAS_GYM = True
except Exception:
    _HAS_GYM = False


if _HAS_GYM:
    class DriftGymEnv(_gym.Env):
        """Gymnasium wrapper over the headless DriftEnv. Action = normalized Δv in [0,1]
        (or a 3-vector if full_direction). Observation = 7-d normalized feature vector."""
        metadata = {"render_modes": []}

        def __init__(self, instruction_id=None, reward="shaped", full_direction=False, max_steps=80):
            base_fn = generate_scenario
            if instruction_id:
                base_fn = lambda s, i=instruction_id: _instr.apply(i, generate_scenario(s))
            self._env = DriftEnv(
                scenario_fn=base_fn, reward=reward, full_direction=full_direction,
                max_steps=max_steps,
                instruction=(_instr.INSTRUCTIONS[instruction_id]["text"] if instruction_id else None),
            )
            dim = 3 if full_direction else 1
            self.observation_space = _spaces.Box(-1.0, 10.0, shape=(OBS_DIM,), dtype=_np.float32)
            self.action_space = _spaces.Box(-1.0 if full_direction else 0.0, 1.0, shape=(dim,), dtype=_np.float32)

        def reset(self, *, seed=None, options=None):
            super().reset(seed=seed)
            obs, info = self._env.reset(seed=seed)
            return _np.asarray(obs, dtype=_np.float32), info

        def step(self, action):
            obs, reward, terminated, truncated, info = self._env.step(action)
            return _np.asarray(obs, dtype=_np.float32), float(reward), bool(terminated), bool(truncated), info


def register():
    """Register Drift environments with Gymnasium. No-op if gymnasium is unavailable."""
    if not _HAS_GYM:
        return False
    ids = {
        "Drift-v0": {},
        "DriftInstruct-Protect-v0": {"instruction_id": "protect_ally"},
        "DriftInstruct-Conserve-v0": {"instruction_id": "conserve_fuel"},
    }
    for env_id, kwargs in ids.items():
        try:
            _gym.register(id=env_id, entry_point="drift_env.gym_env:DriftGymEnv", kwargs=kwargs)
        except Exception:
            pass  # already registered
    return True
