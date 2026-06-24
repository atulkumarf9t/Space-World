// flight_model.js
// EP transfer function: 6-DoF thrust intents or held keys -> metered delta-v impulses,
// gated by power-from-light and the shared propellant/delta-v ledger.

export class FlightModel {
  constructor(physics, opts = {}) {
    this.phys = physics;
    this.thrustAccel = opts.thrustAccel ?? 0.0008; // km/s^2 at full power
    this.powerAuthority = 1.0;
    this.activeBurn = null; // { dir:{x,y,z}, targetDv, doneDv }
    this.thrustingNow = false;
    this.lastControl = { forward: 0, right: 0, up: 0 };
  }

  setPowerAuthority(p) {
    this.powerAuthority = Math.min(1, Math.max(0.15, p));
  }

  maxRate() {
    return this.thrustAccel * this.powerAuthority * 1000;
  }

  setBurn({ dir, targetDv }) {
    const mag = Math.hypot(dir.x, dir.y, dir.z) || 1;
    this.activeBurn = {
      dir: { x: dir.x / mag, y: dir.y / mag, z: dir.z / mag },
      targetDv,
      doneDv: 0,
    };
  }

  cancelBurn() {
    this.activeBurn = null;
  }

  propellantPct() {
    const used = this.phys.dvUsed;
    const budget = this.phys.dvBudget;
    return Math.max(0, 1 - used / budget);
  }

  tick(dt, owner, manualInput) {
    this.thrustingNow = false;
    if (!this.phys.armed || this.phys.finished) return;
    if (this.phys.dvRemaining <= 0) return;

    const aEff = this.thrustAccel * this.powerAuthority;
    const dvTick = aEff * dt;
    if (dvTick <= 0) return;

    if (owner === 'MANUAL' && manualInput) {
      this._tickManual(dvTick, manualInput);
    } else if (this.activeBurn) {
      this._tickAgent(dvTick);
    } else {
      this.lastControl = { forward: 0, right: 0, up: 0 };
    }
  }

  _tickAgent(dvTick) {
    const b = this.activeBurn;
    const remainingTarget = (b.targetDv - b.doneDv) / 1000;
    if (remainingTarget <= 0) {
      this.activeBurn = null;
      return;
    }
    const step = Math.min(dvTick, remainingTarget);
    const vec = { x: b.dir.x * step, y: b.dir.y * step, z: b.dir.z * step };
    const applied = this.phys.applyDeltaV(vec, 'agent');
    b.doneDv += applied;
    this.thrustingNow = applied > 0;
    this.lastControl = this._dirToControl(b.dir);
    if (b.doneDv >= b.targetDv - 1e-6) this.activeBurn = null;
  }

  _tickManual(dvTick, input) {
    const basis = this._bodyBasis();
    let dir = { x: 0, y: 0, z: 0 };
    if (input.forward) {
      dir.x += basis.fwd.x * input.forward;
      dir.y += basis.fwd.y * input.forward;
      dir.z += basis.fwd.z * input.forward;
    }
    if (input.right) {
      dir.x += basis.right.x * input.right;
      dir.y += basis.right.y * input.right;
      dir.z += basis.right.z * input.right;
    }
    if (input.up) {
      dir.x += basis.up.x * input.up;
      dir.y += basis.up.y * input.up;
      dir.z += basis.up.z * input.up;
    }
    const mag = Math.hypot(dir.x, dir.y, dir.z);
    if (mag < 1e-9) {
      this.lastControl = { forward: 0, right: 0, up: 0 };
      return;
    }
    dir = { x: dir.x / mag, y: dir.y / mag, z: dir.z / mag };
    const vec = { x: dir.x * dvTick, y: dir.y * dvTick, z: dir.z * dvTick };
    const applied = this.phys.applyDeltaV(vec, 'human');
    this.thrustingNow = applied > 0;
    this.lastControl = {
      forward: input.forward || 0,
      right: input.right || 0,
      up: input.up || 0,
    };
  }

  _bodyBasis() {
    const fwd = this.phys.probeForward();
    const upRef = { x: 0, y: 1, z: 0 };
    let right = {
      x: upRef.y * fwd.z - upRef.z * fwd.y,
      y: upRef.z * fwd.x - upRef.x * fwd.z,
      z: upRef.x * fwd.y - upRef.y * fwd.x,
    };
    const rm = Math.hypot(right.x, right.y, right.z) || 1;
    right = { x: right.x / rm, y: right.y / rm, z: right.z / rm };
    const up = {
      x: fwd.y * right.z - fwd.z * right.y,
      y: fwd.z * right.x - fwd.x * right.z,
      z: fwd.x * right.y - fwd.y * right.x,
    };
    return { fwd, right, up };
  }

  _dirToControl(dir) {
    const b = this._bodyBasis();
    return {
      forward: Math.round(Math.max(-1, Math.min(1, dir.x * b.fwd.x + dir.y * b.fwd.y + dir.z * b.fwd.z))),
      right: Math.round(Math.max(-1, Math.min(1, dir.x * b.right.x + dir.y * b.right.y + dir.z * b.right.z))),
      up: Math.round(Math.max(-1, Math.min(1, dir.x * b.up.x + dir.y * b.up.y + dir.z * b.up.z))),
    };
  }

  controlForReactor() {
    const c = this.lastControl;
    let movement = 'idle';
    if (c.forward > 0) movement = 'forward';
    else if (c.forward < 0) movement = 'back';
    else if (c.right > 0) movement = 'strafe_right';
    else if (c.right < 0) movement = 'strafe_left';

    let lookHorizontal = 'idle';
    let lookVertical = 'idle';
    if (c.up > 0) lookVertical = 'up';
    else if (c.up < 0) lookVertical = 'down';

    return { movement, lookHorizontal, lookVertical };
  }
}
