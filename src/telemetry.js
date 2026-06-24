// telemetry.js
// Aggregates physics, flight model, control authority, and screen projections.

import { epDerive } from './ep_model.js';

export class Telemetry {
  constructor(physics, flightModel, authority, scene3d) {
    this.phys = physics;
    this.fm = flightModel;
    this.auth = authority;
    this.scene = scene3d;
  }

  snapshot() {
    const p = this.phys;
    const fc = p.forecast();
    let screenAlly = null;
    let screenAsteroid = null;
    let screenExtras = [];
    if (fc && this.scene && p.armed) {
      screenAlly = this.scene.projectWorldPos(p.ally.pos.x, p.ally.pos.y, p.ally.pos.z);
      screenAsteroid = this.scene.projectWorldPos(p.asteroid.pos.x, p.asteroid.pos.y, p.asteroid.pos.z);
      screenExtras = p.extraThreats.map((t, i) => ({
        screen: this.scene.projectWorldPos(t.pos.x, t.pos.y, t.pos.z),
        fc: fc.extras?.[i] ?? null,
      }));
    }
    return {
      status: p.status,
      armed: p.armed,
      finished: p.finished,
      elapsed: p.elapsed,
      dSafe: p.dSafe,
      hardBody: p.hardBody,
      collisionTarget: p.collisionTarget,

      forecast: fc,
      allyForecast: fc?.ally ?? null,
      asteroidForecast: fc?.asteroid ?? null,
      worstThreat: fc?.worst ?? null,
      pcThreshold: p.pcThreshold,
      worstPc: fc ? (fc.all || []).reduce((m, t) => Math.max(m, t?.pc ?? 0), 0) : 0,
      extraThreats: p.extraThreats,
      extraForecasts: fc?.extras ?? [],

      probe: p.probe,
      ally: p.ally,
      asteroid: p.asteroid,

      screenAlly,
      screenAsteroid,
      screenExtras,

      dvBudget: p.dvBudget,
      dvUsed: p.dvUsed,
      dvAgent: p.dvAgent,
      dvHuman: p.dvHuman,
      dvRemaining: p.dvRemaining,
      parDv: p.parDv,

      grade: p.grade,
      gradeRatio: p.gradeRatio,
      minRangeAlly: p.minRangeAlly,
      minRangeAsteroid: p.minRangeAsteroid,

      powerAuthority: this.fm.powerAuthority,
      propellantPct: this.fm.propellantPct(),
      thrusting: this.fm.thrustingNow,
      maxRate: this.fm.maxRate(),

      ep: epDerive({
        powerAuthority: this.fm.powerAuthority,
        thrusting: this.fm.thrustingNow,
        propellantPct: this.fm.propellantPct(),
        gameAccel: this.fm.thrustAccel * 1000,
      }),

      controlOwner: this.auth.owner,
    };
  }
}
