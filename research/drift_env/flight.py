"""EP flight model — port of src/flight_model.js (agent path; headless)."""

import math


class FlightModel:
    def __init__(self, physics, thrustAccel=0.0008):
        self.phys = physics
        self.thrustAccel = thrustAccel
        self.powerAuthority = 1.0
        self.activeBurn = None
        self.thrustingNow = False

    def set_power_authority(self, p):
        self.powerAuthority = min(1.0, max(0.15, p))

    def max_rate(self):
        return self.thrustAccel * self.powerAuthority * 1000.0

    def set_burn(self, dir, target_dv):
        mag = math.hypot(dir["x"], dir["y"], dir["z"]) or 1.0
        self.activeBurn = {"dir": {"x": dir["x"] / mag, "y": dir["y"] / mag, "z": dir["z"] / mag},
                           "targetDv": target_dv, "doneDv": 0.0}

    def cancel_burn(self):
        self.activeBurn = None

    def propellant_pct(self):
        return max(0.0, 1.0 - self.phys.dvUsed / self.phys.dvBudget)

    def tick(self, dt, owner="AGENT"):
        self.thrustingNow = False
        if not self.phys.armed or self.phys.finished:
            return
        if self.phys.enforce_budget and self.phys.dvRemaining <= 0:
            return
        a_eff = self.thrustAccel * self.powerAuthority
        dv_tick = a_eff * dt
        if dv_tick <= 0:
            return
        if self.activeBurn:
            self._tick_agent(dv_tick)

    def _tick_agent(self, dv_tick):
        b = self.activeBurn
        remaining_target = (b["targetDv"] - b["doneDv"]) / 1000.0
        if remaining_target <= 0:
            self.activeBurn = None
            return
        step = min(dv_tick, remaining_target)
        vec = {"x": b["dir"]["x"] * step, "y": b["dir"]["y"] * step, "z": b["dir"]["z"] * step}
        applied = self.phys.apply_delta_v(vec, "agent")
        b["doneDv"] += applied
        self.thrustingNow = applied > 0
        if b["doneDv"] >= b["targetDv"] - 1e-6:
            self.activeBurn = None
