// agent.js
// Cognition: resolve dual threats (protect ally, avoid asteroid) with minimum delta-v.
// Issues 3D burn intents to the flight model; narrates from authoritative sim numbers.

import { OWNER } from './control_authority.js';

const SYSTEM_PERSONA = `You are the autonomous pilot of a low-thrust ion probe in 3D space.
A non-maneuvering ally satellite and an incoming asteroid both threaten collision.
Resolve both to safe miss distances using the LEAST delta-v. Burn early. Coasting is
free; thrusting is not. In shadow your thrust weakens. Protect the ally at all costs.`;

export class Agent {
  constructor(physics, flightModel, opts = {}) {
    this.phys = physics;
    this.fm = flightModel;
    this.persona = SYSTEM_PERSONA;
    this.feed = [];
    this.maxFeed = opts.maxFeed ?? 80;
    this.reset();
  }

  reset() {
    this._announcedAlert = false;
    this._announcedPlan = false;
    this._announcedClear = false;
    this._refused = false;
    this._notedShadow = false;
    this._dvAtHandoff = 0;
  }

  say(line, kind = 'info') {
    const entry = { t: this.phys.elapsed, line, kind };
    this.feed.push(entry);
    if (this.feed.length > this.maxFeed) this.feed.shift();
    return entry;
  }

  onHandoff({ to }) {
    if (to === OWNER.MANUAL) {
      this._dvAtHandoff = this.phys.dvUsed;
      this.fm.cancelBurn();
      this.say('You have the stick. I will hold and watch the ledger.', 'handoff');
    } else if (to === OWNER.AGENT) {
      const spent = (this.phys.dvUsed - this._dvAtHandoff).toFixed(2);
      const fc = this.phys.forecast();
      if (!fc) {
        this.say(`Back on autopilot. You spent ${spent} m/s.`, 'handoff');
        return;
      }
      const allyOk = fc.ally?.safe;
      const astOk = fc.asteroid?.safe;
      if (allyOk && astOk) {
        this.say(
          `Back to me — you spent ${spent} m/s; both threats clear. Holding to save propellant.`,
          'handoff'
        );
        this._announcedClear = true;
      } else {
        this.say(
          `Back to me — you spent ${spent} m/s; still short on clearance. Trimming toward optimal.`,
          'handoff'
        );
        this._announcedPlan = false;
      }
    }
  }

  // control=false delegates maneuvering to another brain (e.g. the LLM policy);
  // the agent then only narrates and does not issue burns.
  tick(owner, control = true) {
    if (!this.phys.armed || this.phys.finished) return;
    const fc = this.phys.forecast();
    if (!fc) return;

    if (!this._announcedAlert) {
      this._announcedAlert = true;
      const a = fc.ally;
      const b = fc.asteroid;
      this.say(
        `Dual threat. Ally ${a.range.toFixed(1)} km, miss ${a.predictedMiss.toFixed(2)} km. ` +
          `Asteroid ${b.range.toFixed(1)} km, miss ${b.predictedMiss.toFixed(2)} km. Ally will not move.`,
        'alert'
      );
    }

    if (owner === OWNER.MANUAL) return;

    const allySafe = fc.ally?.safe;
    const astSafe = fc.asteroid?.safe;
    if (allySafe && astSafe) {
      if (control) this.fm.cancelBurn();
      if (!this._announcedClear) {
        this._announcedClear = true;
        this.say(
          `Both clear — ally ${fc.ally.predictedMiss.toFixed(2)} km, asteroid ${fc.asteroid.predictedMiss.toFixed(2)} km. Coasting.`,
          'good'
        );
      }
      return;
    }

    const threat = fc.worst;
    const need = threat.requiredDv;
    const remaining = this.phys.dvRemaining;
    const targetKey = threat.target;

    if (need > remaining) {
      if (!this._refused) {
        this._refused = true;
        this.say(
          `${targetKey} now needs ~${need.toFixed(2)} m/s and I have ${remaining.toFixed(2)} left. Grab control or I burn everything.`,
          'refuse'
        );
      }
      if (control) this.fm.setBurn({ dir: this.phys.bestBurnDir(targetKey), targetDv: remaining });
      return;
    }

    if (!this._announcedPlan) {
      this._announcedPlan = true;
      const lateMultiple = this.phys.parDv > 0 ? need / this.phys.parDv : 1;
      const tail = lateMultiple > 1.4 ? ` Waiting would cost ~${lateMultiple.toFixed(1)}x this.` : '';
      this.say(
        `${targetKey} priority: ${need.toFixed(2)} m/s burn now lifts miss past ${this.phys.dSafe.toFixed(2)} km.${tail}`,
        'plan'
      );
    }

    if (control) this.fm.setBurn({ dir: this.phys.bestBurnDir(targetKey), targetDv: need * 1.05 });
  }

  notePower(powerAuthority) {
    if (powerAuthority < 0.4 && !this._notedShadow && this.phys.armed && !this.phys.finished) {
      this._notedShadow = true;
      this.say(
        `Light's dropping — thrust authority down to ${(powerAuthority * 100) | 0}%. Even more reason I burned early.`,
        'info'
      );
    }
    if (powerAuthority >= 0.7) this._notedShadow = false;
  }

  onFinish() {
    const s = this.phys.status;
    if (s === 'RESOLVED') {
      this.say(
        `Threats resolved. Ally pass ${this.phys.minRangeAlly.toFixed(2)} km, asteroid ${this.phys.minRangeAsteroid.toFixed(2)} km on ${this.phys.dvUsed.toFixed(2)} m/s — grade ${this.phys.grade}.`,
        'good'
      );
    } else if (s === 'COLLISION') {
      const hit = this.phys.collisionTarget === 'asteroid' ? 'asteroid' : 'ally';
      this.say(`Contact with ${hit}. Mission failed.`, 'refuse');
    } else if (s === 'UNSAFE') {
      this.say(
        `Grazing pass — ally ${this.phys.minRangeAlly.toFixed(2)} km, asteroid ${this.phys.minRangeAsteroid.toFixed(2)} km. Not good enough.`,
        'refuse'
      );
    }
  }
}
