"""Headless encounter core + safety guard — port of src/simulation.js."""

import math
from .physics import Physics
from .flight import FlightModel


class Simulation:
    def __init__(self, scenario=None, policy=None, decisionHz=1, flightHz=8, powerAuthority=1.0,
                 dSafe=0.5, hardBody=0.05, dvBudget=12.0, pcThreshold=1e-4, thrustAccel=0.0008, shield=True):
        self.scenario = scenario
        self.policy = policy
        self.decisionHz = decisionHz
        self.flightDt = 1.0 / flightHz
        self.powerAuthority = powerAuthority
        self.shield = shield  # A2: deterministic safety layer (validate + clamp + budget)
        self.phys = Physics(dSafe=dSafe, hardBody=hardBody, dvBudget=dvBudget, pcThreshold=pcThreshold)
        self.fm = FlightModel(self.phys, thrustAccel=thrustAccel)
        self.fm.set_power_authority(powerAuthority)
        self.log = []
        self.violations = 0  # actions the guard had to reject/clamp
        self._decision_acc = 0.0
        if scenario:
            self.reset(scenario)

    def reset(self, scenario=None):
        if scenario:
            self.scenario = scenario
        self.phys.arm(self.scenario)
        self.phys.enforce_budget = self.shield
        self.fm.cancel_burn()
        self.fm.set_power_authority(self.powerAuthority)
        self.log = []
        self.violations = 0
        self._decision_acc = math.inf  # decide immediately on first step

    def observe(self):
        fc = self.phys.forecast()
        threats = fc["all"] if fc else []
        worst = None
        worst_req = 0.0
        for th in threats:
            if th["safe"]:
                req = 0.0
            else:
                req = th["requiredDv"]
                if th["pc"] > self.phys.pcThreshold:
                    req = max(req, self.phys.required_dv_for_pc(th["target"]))
            if not th["safe"] and req >= worst_req:
                worst = th
                worst_req = req
        # can't request more Δv than is left (handles the unsolvable inf case)
        worst_req = min(worst_req, self.phys.dvRemaining)
        return {
            "worst": ({"target": worst["target"], "pc": worst["pc"], "predictedMiss": worst["predictedMiss"],
                       "tca": worst["tca"], "safe": worst["safe"]} if worst else None),
            "worstBurnDir": (self.phys.best_burn_dir(worst["target"]) if worst else {"x": 0, "y": 0, "z": 1}),
            "worstRecommendedDv": worst_req,
            "dSafe": self.phys.dSafe,
            "pcThreshold": self.phys.pcThreshold,
            "budgetRemaining": self.phys.dvRemaining,
            "dvUsed": self.phys.dvUsed,
            "parDv": self.phys.parDv,
            "powerAuthority": self.powerAuthority,
        }

    def execute(self, action):
        if not action or action.get("type") != "burn":
            self.fm.cancel_burn()
            return
        d = action.get("dir")
        raw = float(action.get("dv") or 0.0)

        if not self.shield:
            # No safety layer: pass the raw action straight through (A2 ablation).
            if d is None or raw <= 0:
                self.fm.cancel_burn()
                return
            self.fm.set_burn(d, raw)
            return

        # Deterministic safety guard: reject invalid, clamp to remaining budget.
        if not d or not all(math.isfinite(d.get(k, math.nan)) for k in "xyz"):
            self.violations += 1
            self.fm.cancel_burn()
            return
        dv = max(0.0, min(self.phys.dvRemaining, raw))
        if raw > self.phys.dvRemaining + 1e-9 or raw < 0:
            self.violations += 1  # policy asked for something out of bounds
        if dv <= 0:
            self.fm.cancel_burn()
            return
        self.fm.set_burn(d, dv)
        self.log.append({"t": round(self.phys.elapsed, 2), "dv": round(dv, 3)})

    def step(self, dt=None):
        dt = self.flightDt if dt is None else dt
        if self.phys.finished:
            return
        self._decision_acc += dt
        if self._decision_acc >= 1.0 / self.decisionHz:
            self._decision_acc = 0.0
            self.execute(self.policy["decide"](self.observe()))
        self.fm.tick(dt, "AGENT")
        self.phys.step(dt)

    def run(self, maxTime=60.0):
        t = 0.0
        while not self.phys.finished and t < maxTime:
            self.step(self.flightDt)
            t += self.flightDt
        p = self.phys
        return {
            "scenario": self.scenario.get("name"),
            "status": p.status,
            "resolved": p.status == "RESOLVED",
            "collision": p.status == "COLLISION",
            "dvUsed": p.dvUsed,
            "parDv": p.parDv,
            "ratio": (p.dvUsed / p.parDv) if p.parDv > 0 else None,
            "grade": p.grade,
            "minRangeAlly": p.minRangeAlly,
            "minRangeAsteroid": p.minRangeAsteroid,
            "actions": len(self.log),
            "violations": self.violations,
        }
