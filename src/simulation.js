// simulation.js — headless encounter core (Phase 0/2).
// Wraps Physics + FlightModel + a decision policy with NO DOM/Three/Reactor, so
// it runs identically in the browser and in Node (eval harness, tests, replays).
//
// It also implements the deterministic SAFETY GUARD: every action a policy
// proposes is validated and clamped here before it can touch the flight model.

import { Physics } from './physics.js';
import { FlightModel } from './flight_model.js';

export class Simulation {
  constructor(opts = {}) {
    this.scenario = opts.scenario;
    this.policy = opts.policy;
    this.decisionHz = opts.decisionHz ?? 1;
    this.flightDt = 1 / (opts.flightHz ?? 8);
    this.powerAuthority = opts.powerAuthority ?? 1;

    this.phys = new Physics({
      dSafe: opts.dSafe ?? 0.5,
      hardBody: opts.hardBody ?? 0.05,
      dvBudget: opts.dvBudget ?? 12,
      pcThreshold: opts.pcThreshold ?? 1e-4,
    });
    this.fm = new FlightModel(this.phys, { thrustAccel: opts.thrustAccel ?? 0.0008 });
    this.fm.setPowerAuthority(this.powerAuthority);

    this.log = [];            // action log (explainability)
    this._decisionAcc = 0;
    if (this.scenario) this.reset(this.scenario);
  }

  reset(scenario = this.scenario) {
    this.scenario = scenario;
    this.phys.arm(scenario);
    this.fm.cancelBurn();
    this.fm.setPowerAuthority(this.powerAuthority);
    this.log.length = 0;
    this._decisionAcc = Infinity; // decide immediately on first step
  }

  // Structured observation handed to the policy.
  // A threat is UNSAFE if Pc exceeds threshold OR it breaches the safe ring; the
  // recommended burn must satisfy BOTH (the literal mission + the Pc objective).
  observe() {
    const fc = this.phys.forecast();
    const threats = fc ? (fc.all || [fc.ally, fc.asteroid].filter(Boolean)) : [];
    let worst = null, worstReqDv = 0;
    for (const th of threats) {
      const reqDv = th.safe ? 0 : Math.max(th.requiredDv, th.pc > this.phys.pcThreshold ? this.phys.requiredDvForPc(th.target) : 0);
      if (!th.safe && reqDv >= worstReqDv) { worst = th; worstReqDv = reqDv; }
    }
    return {
      worst: worst && { target: worst.target, pc: worst.pc, predictedMiss: worst.predictedMiss, tca: worst.tca, safe: worst.safe },
      worstBurnDir: worst ? this.phys.bestBurnDir(worst.target) : { x: 0, y: 0, z: 1 },
      worstRecommendedDv: worstReqDv,
      dSafe: this.phys.dSafe,
      pcThreshold: this.phys.pcThreshold,
      budgetRemaining: this.phys.dvRemaining,
      dvUsed: this.phys.dvUsed,
      parDv: this.phys.parDv,
      powerAuthority: this.powerAuthority,
    };
  }

  // Deterministic safety guard: validate + clamp, then commit to the flight model.
  execute(action) {
    if (!action || action.type !== 'burn') { this.fm.cancelBurn(); return; }
    const d = action.dir;
    if (!d || !isFinite(d.x) || !isFinite(d.y) || !isFinite(d.z)) { this.fm.cancelBurn(); return; }
    const mag = Math.hypot(d.x, d.y, d.z);
    if (mag < 1e-9) { this.fm.cancelBurn(); return; }
    const dv = Math.max(0, Math.min(this.phys.dvRemaining, +action.dv || 0));
    if (dv <= 0) { this.fm.cancelBurn(); return; }
    this.fm.setBurn({ dir: d, targetDv: dv });
    this.log.push({ t: +this.phys.elapsed.toFixed(2), dir: { x: +d.x.toFixed(3), y: +d.y.toFixed(3), z: +d.z.toFixed(3) }, dv: +dv.toFixed(3) });
  }

  step(dt = this.flightDt) {
    if (this.phys.finished) return;
    this._decisionAcc += dt;
    if (this._decisionAcc >= 1 / this.decisionHz) {
      this._decisionAcc = 0;
      this.execute(this.policy.decide(this.observe()));
    }
    this.fm.tick(dt, 'AGENT');
    this.phys.step(dt);
  }

  run({ maxTime = 60 } = {}) {
    let t = 0;
    while (!this.phys.finished && t < maxTime) { this.step(this.flightDt); t += this.flightDt; }
    const p = this.phys;
    return {
      scenario: this.scenario.name,
      status: p.status,
      resolved: p.status === 'RESOLVED',
      collision: p.status === 'COLLISION',
      dvUsed: p.dvUsed,
      parDv: p.parDv,
      ratio: p.parDv > 0 ? p.dvUsed / p.parDv : null,
      grade: p.grade,
      minRangeAlly: p.minRangeAlly,
      minRangeAsteroid: p.minRangeAsteroid,
      actions: this.log.length,
    };
  }
}
