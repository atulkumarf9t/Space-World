// conjunction.js
// Deterministic relative-motion conjunction sim.
// This module is AUTHORITATIVE for geometry (miss distance, TCA) and scoring
// (the shared Delta-v ledger and grade). Reactor only ever supplies visuals.
//
// Frame & units:
//   - Relative state is the ALLY as seen FROM the probe:  r = p_ally - p_probe.
//   - Position in km, velocity in km/s, time in s, delta-v stored/displayed in m/s.
//   - The probe burns change ITS OWN velocity, so they SUBTRACT from relVel:
//        probe v += dv   =>   relVel ( = v_ally - v_probe ) -= dv

export const STATUS = {
  CRUISE: 'CRUISE',
  ALERT: 'ALERT',
  RESOLVED: 'RESOLVED',
  UNSAFE: 'UNSAFE',
  COLLISION: 'COLLISION',
};

const V = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y,
  cross: (a, b) => a.x * b.y - a.y * b.x, // scalar z-component in 2D
  mag: (a) => Math.hypot(a.x, a.y),
  norm: (a) => {
    const m = Math.hypot(a.x, a.y) || 1;
    return { x: a.x / m, y: a.y / m };
  },
  perp: (a) => ({ x: -a.y, y: a.x }), // 90 deg CCW
};

// Straight-line forecast helpers (km, km/s). These assume no further thrust.
function missFor(relPos, relVel) {
  const speed = V.mag(relVel);
  if (speed < 1e-9) return V.mag(relPos);
  return Math.abs(V.cross(relPos, relVel)) / speed;
}

function tcaFor(relPos, relVel) {
  const s2 = V.dot(relVel, relVel);
  if (s2 < 1e-12) return Infinity;
  return -V.dot(relPos, relVel) / s2;
}

export class Conjunction {
  constructor(opts = {}) {
    this.dSafe = opts.dSafe ?? 1.0; // km: safe miss distance (the win threshold)
    this.hardBody = opts.hardBody ?? 0.05; // km: combined hard-body radius (collision)
    this.dvBudget = opts.dvBudget ?? 40; // m/s: total maneuver budget
    this.reset();
  }

  reset() {
    this.relPos = { x: 0, y: 0 };
    this.relVel = { x: 0, y: 0 };
    this.status = STATUS.CRUISE;
    this.armed = false;

    this.minRange = Infinity; // closest approach achieved so far (km)
    this.dvAgent = 0; // m/s spent by the agent
    this.dvHuman = 0; // m/s spent by the human pilot
    this.parDv = 0; // m/s: optimal impulsive solution at detection
    this.grade = null; // 'A' | 'B' | 'C' | 'F'
    this.gradeRatio = null; // dvUsed / parDv
    this.elapsed = 0; // s since arming
    this.finished = false;
  }

  // Begin a conjunction. relPos in km, relVel in km/s.
  arm(relPos, relVel) {
    this.relPos = { ...relPos };
    this.relVel = { ...relVel };
    this.armed = true;
    this.finished = false;
    this.status = STATUS.ALERT;
    this.minRange = V.mag(relPos);
    this.elapsed = 0;
    this.parDv = this._solveImpulsiveDv(relPos, relVel, this.dSafe);
  }

  get dvUsed() {
    return this.dvAgent + this.dvHuman;
  }

  get dvRemaining() {
    return Math.max(0, this.dvBudget - this.dvUsed);
  }

  // Apply a probe burn. dvVec is the change to the PROBE's velocity in km/s.
  // source: 'agent' | 'human'. Returns the magnitude actually applied (m/s).
  applyDeltaV(dvVec, source) {
    if (this.finished) return 0;
    let mag_ms = V.mag(dvVec) * 1000; // km/s -> m/s
    if (mag_ms <= 0) return 0;

    // Clamp to remaining budget so the ledger can never exceed the tank.
    const remaining = this.dvRemaining;
    if (mag_ms > remaining) {
      const scale = remaining / mag_ms;
      dvVec = V.scale(dvVec, scale);
      mag_ms = remaining;
    }
    if (mag_ms <= 0) return 0;

    // Probe velocity increases by dvVec -> relative velocity decreases by it.
    this.relVel = V.sub(this.relVel, dvVec);

    if (source === 'human') this.dvHuman += mag_ms;
    else this.dvAgent += mag_ms;

    return mag_ms;
  }

  // Advance the relative geometry by dt seconds.
  step(dt) {
    if (!this.armed || this.finished) return;
    const wasApproaching = V.dot(this.relPos, this.relVel) < 0;

    this.relPos = V.add(this.relPos, V.scale(this.relVel, dt));
    this.elapsed += dt;

    const range = V.mag(this.relPos);
    if (range < this.minRange) this.minRange = range;

    if (range < this.hardBody) {
      this._finish(STATUS.COLLISION);
      return;
    }

    // Encounter is over once we transition from approaching to receding.
    const nowReceding = V.dot(this.relPos, this.relVel) > 0;
    if (wasApproaching && nowReceding) {
      if (this.minRange >= this.dSafe) this._finish(STATUS.RESOLVED);
      else this._finish(STATUS.UNSAFE);
    }
  }

  // Live forecast for the HUD and the agent (assumes no further thrust).
  forecast() {
    if (!this.armed) return null;
    const tca = tcaFor(this.relPos, this.relVel);
    const predictedMiss = missFor(this.relPos, this.relVel);
    const range = V.mag(this.relPos);
    const closingSpeed = -V.dot(this.relPos, V.norm(this.relVel)) >= 0
      ? V.mag(this.relVel)
      : -V.mag(this.relVel); // positive while approaching
    // Cheapest impulsive burn that would fix it from RIGHT NOW.
    const requiredDv = predictedMiss >= this.dSafe
      ? 0
      : this._solveImpulsiveDv(this.relPos, this.relVel, this.dSafe);
    return {
      tca, // s (negative once past closest approach)
      predictedMiss, // km
      range, // km
      closingSpeed, // km/s
      requiredDv, // m/s, impulsive, from current state
      safe: predictedMiss >= this.dSafe,
      bearing: this._bearing(), // {forward, cross} km in camera frame
    };
  }

  // Probe-burn unit vector (km/s direction) that most increases predicted miss
  // for a cross-track maneuver. Returns {x,y} unit vector to feed applyDeltaV.
  bestCrossDir() {
    const perp = V.norm(V.perp(this.relVel));
    const eps = 1e-4;
    const plus = missFor(this.relPos, V.sub(this.relVel, V.scale(perp, eps)));
    const minus = missFor(this.relPos, V.sub(this.relVel, V.scale(perp, -eps)));
    return plus >= minus ? perp : V.scale(perp, -1);
  }

  // Camera frame: looking along the initial closing axis (+x forward).
  _bearing() {
    return { forward: this.relPos.x, cross: this.relPos.y };
  }

  // Smallest impulsive cross-track delta-v (m/s) to reach targetMiss from a state.
  _solveImpulsiveDv(relPos, relVel, targetMiss) {
    if (missFor(relPos, relVel) >= targetMiss) return 0;
    const perp = V.norm(V.perp(relVel));
    // Try both perpendicular signs; take the cheaper that reaches the target.
    const cost = (sign) => {
      let lo = 0;
      let hi = this.dvBudget / 1000; // km/s search ceiling
      // Ensure hi reaches the target; if not, this sign is infeasible.
      const dir = V.scale(perp, sign);
      const missAt = (d) => missFor(relPos, V.sub(relVel, V.scale(dir, d)));
      if (missAt(hi) < targetMiss) return Infinity;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (missAt(mid) >= targetMiss) hi = mid;
        else lo = mid;
      }
      return hi * 1000; // km/s -> m/s
    };
    return Math.min(cost(1), cost(-1));
  }

  _finish(status) {
    this.status = status;
    this.finished = true;
    this._grade();
  }

  _grade() {
    if (this.status === STATUS.COLLISION || this.status === STATUS.UNSAFE) {
      this.grade = 'F';
      this.gradeRatio = this.parDv > 0 ? this.dvUsed / this.parDv : null;
      return;
    }
    const ratio = this.parDv > 0 ? this.dvUsed / this.parDv : 1;
    this.gradeRatio = ratio;
    if (ratio <= 1.2) this.grade = 'A';
    else if (ratio <= 2.0) this.grade = 'B';
    else this.grade = 'C';
  }
}
