// physics.js
// Authoritative 3D Newtonian sim for probe, ally, and asteroid.
// Geometry (TCA, miss distance, collisions) and the shared delta-v ledger live here.
//
// Frame & units:
//   - World frame: +Z forward, +X right, +Y up (matches Three.js scene).
//   - Position km, velocity km/s, time s, delta-v stored/displayed in m/s.
//   - Probe burns change its velocity; relative vel of a target decreases by dv.

import { cwStep, closestApproachCW } from './dynamics.js';

export const STATUS = {
  CRUISE: 'CRUISE',
  ALERT: 'ALERT',
  RESOLVED: 'RESOLVED',
  UNSAFE: 'UNSAFE',
  COLLISION: 'COLLISION',
};

const V = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  mag: (a) => Math.hypot(a.x, a.y, a.z),
  norm: (a) => {
    const m = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / m, y: a.y / m, z: a.z / m };
  },
  clone: (a) => ({ x: a.x, y: a.y, z: a.z }),
};

export function missFor(relPos, relVel) {
  const speed = V.mag(relVel);
  if (speed < 1e-9) return V.mag(relPos);
  return V.mag(V.cross(relPos, relVel)) / speed;
}

export function tcaFor(relPos, relVel) {
  const s2 = V.dot(relVel, relVel);
  if (s2 < 1e-12) return Infinity;
  return -V.dot(relPos, relVel) / s2;
}

function solveImpulsiveDv(relPos, relVel, targetMiss, budgetMs) {
  if (missFor(relPos, relVel) >= targetMiss) return 0;
  const speed = V.mag(relVel);
  if (speed < 1e-9) return budgetMs;

  const perp1 = V.norm(V.cross(relVel, { x: 0, y: 1, z: 0 }));
  let perp2 = V.norm(V.cross(relVel, perp1));
  if (V.mag(perp2) < 1e-9) perp2 = V.norm(V.cross(relVel, { x: 1, y: 0, z: 0 }));

  const dirs = [perp1, V.scale(perp1, -1), perp2, V.scale(perp2, -1)];
  let best = Infinity;
  const hi = budgetMs / 1000;

  for (const dir of dirs) {
    const missAt = (d) => missFor(relPos, V.sub(relVel, V.scale(dir, d)));
    if (missAt(hi) < targetMiss) continue;
    let lo = 0;
    let h = hi;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + h) / 2;
      if (missAt(mid) >= targetMiss) h = mid;
      else lo = mid;
    }
    best = Math.min(best, h * 1000);
  }
  return best;
}

// ---- conjunction uncertainty: B-plane projection + probability of collision ----

function addCov(a, b) {
  return [
    [a[0][0] + b[0][0], a[0][1] + b[0][1], a[0][2] + b[0][2]],
    [a[1][0] + b[1][0], a[1][1] + b[1][1], a[1][2] + b[1][2]],
    [a[2][0] + b[2][0], a[2][1] + b[2][1], a[2][2] + b[2][2]],
  ];
}

// Orthonormal basis of the encounter (B-) plane, perpendicular to relative velocity.
function bplaneBasis(relVel) {
  const u = V.norm(relVel);
  const t = Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const e1 = V.norm(V.cross(u, t));
  const e2 = V.norm(V.cross(u, e1));
  return { u, e1, e2 };
}

// Project a 3x3 covariance onto the 2D plane spanned by e1,e2 -> [[a,b],[b,c]].
function projectCov2(C3, e1, e2) {
  const P = [[e1.x, e1.y, e1.z], [e2.x, e2.y, e2.z]];
  const CPt = [[0, 0], [0, 0], [0, 0]];
  for (let i = 0; i < 3; i++)
    for (let k = 0; k < 2; k++) {
      let s = 0;
      for (let j = 0; j < 3; j++) s += C3[i][j] * P[k][j];
      CPt[i][k] = s;
    }
  const out = [[0, 0], [0, 0]];
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++) {
      let s = 0;
      for (let i = 0; i < 3; i++) s += P[r][i] * CPt[i][c];
      out[r][c] = s;
    }
  return out;
}

// Eigendecomposition of a symmetric 2x2 -> { s1, s2 (std devs), theta }.
function eig2(C2) {
  const a = C2[0][0], b = C2[0][1], c = C2[1][1];
  const tr = a + c, det = a * c - b * b;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const theta = 0.5 * Math.atan2(2 * b, a - c);
  return { s1: Math.sqrt(Math.max(l1, 1e-12)), s2: Math.sqrt(Math.max(l2, 1e-12)), theta };
}

// Short-term (2D B-plane) probability of collision.
// cov3 = combined position covariance of the two bodies; hbr = combined hard-body radius.
export function pcFor(relPos, relVel, cov3, hbr, res = 64) {
  const speed = V.mag(relVel);
  if (speed < 1e-9) return 0;
  const tca = tcaFor(relPos, relVel);
  if (tca <= 0) return 0;
  const miss = {
    x: relPos.x + relVel.x * tca,
    y: relPos.y + relVel.y * tca,
    z: relPos.z + relVel.z * tca,
  };
  const { e1, e2 } = bplaneBasis(relVel);
  const mu = { x: V.dot(miss, e1), y: V.dot(miss, e2) };
  const C2 = projectCov2(cov3, e1, e2);
  C2[0][0] += 1e-10; C2[1][1] += 1e-10;
  const { s1, s2, theta } = eig2(C2);
  // mean in eigenbasis
  const ct = Math.cos(theta), st = Math.sin(theta);
  const mx = ct * mu.x + st * mu.y;
  const my = -st * mu.x + ct * mu.y;
  // degenerate (near-zero) covariance -> deterministic answer
  if (s1 < hbr * 1e-3 && s2 < hbr * 1e-3) return V.mag(miss) < hbr ? 1 : 0;
  // integrate the (diagonal, in eigenbasis) Gaussian over the hard-body disk
  const n = res, step = (2 * hbr) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = -hbr + (i + 0.5) * step;
    for (let j = 0; j < n; j++) {
      const y = -hbr + (j + 0.5) * step;
      if (x * x + y * y > hbr * hbr) continue;
      const dx = (x - mx) / s1, dy = (y - my) / s2;
      sum += Math.exp(-0.5 * (dx * dx + dy * dy));
    }
  }
  return Math.min(1, (sum * step * step) / (2 * Math.PI * s1 * s2));
}

// Minimum impulsive delta-v (m/s) to push Pc below `pcThreshold`.
// Searches burn directions perpendicular to relative velocity; Pc is monotone in
// achieved miss, so a binary search on magnitude per direction is valid.
function solveImpulsiveDvForPc(relPos, relVel, cov3, hbr, pcThreshold, budgetMs, res = 40) {
  if (pcFor(relPos, relVel, cov3, hbr, res) <= pcThreshold) return 0;
  const speed = V.mag(relVel);
  if (speed < 1e-9) return budgetMs;
  const perp1 = V.norm(V.cross(relVel, { x: 0, y: 1, z: 0 }));
  let perp2 = V.norm(V.cross(relVel, perp1));
  if (V.mag(perp2) < 1e-9) perp2 = V.norm(V.cross(relVel, { x: 1, y: 0, z: 0 }));
  const dirs = [perp1, V.scale(perp1, -1), perp2, V.scale(perp2, -1)];
  const hi = budgetMs / 1000;
  let best = Infinity;
  for (const dir of dirs) {
    const pcAt = (d) => pcFor(relPos, V.sub(relVel, V.scale(dir, d)), cov3, hbr, res);
    if (pcAt(hi) > pcThreshold) continue;
    let lo = 0, h = hi;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + h) / 2;
      if (pcAt(mid) <= pcThreshold) h = mid;
      else lo = mid;
    }
    best = Math.min(best, h * 1000);
  }
  return best;
}

export class Physics {
  constructor(opts = {}) {
    this.dSafe = opts.dSafe ?? 0.5;
    this.hardBody = opts.hardBody ?? 0.05;
    this.dvBudget = opts.dvBudget ?? 12;
    this.pcThreshold = opts.pcThreshold ?? 1e-4;
    this.dynamics = opts.dynamics ?? 'linear'; // 'linear' | 'cw'
    this.meanMotion = opts.meanMotion ?? 0.05; // rad/s (CW realism mode)
    this.reset();
  }

  _propagate(body, dt) {
    if (this.dynamics !== 'cw') {
      body.pos = V.add(body.pos, V.scale(body.vel, dt));
      return;
    }
    const s = cwStep(
      { x: body.pos.x, y: body.pos.y, z: body.pos.z, vx: body.vel.x, vy: body.vel.y, vz: body.vel.z },
      this.meanMotion, dt
    );
    body.pos = { x: s.x, y: s.y, z: s.z };
    body.vel = { x: s.vx, y: s.vy, z: s.vz };
  }

  reset() {
    this.probe = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0.2, y: 0, z: 0 } };
    this.ally = { pos: { x: 8, y: 0.42, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
    this.asteroid = { pos: { x: 4, y: -0.35, z: 3 }, vel: { x: -0.06, y: 0, z: -0.04 } };

    this.status = STATUS.CRUISE;
    this.armed = false;
    this.finished = false;
    this.elapsed = 0;

    this.minRangeAlly = Infinity;
    this.minRangeAsteroid = Infinity;
    this.dvAgent = 0;
    this.dvHuman = 0;
    this.parDv = 0;
    this.grade = null;
    this.gradeRatio = null;
    this.collisionTarget = null;

    const Z = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const d = (s) => [[s * s, 0, 0], [0, s * s, 0], [0, 0, s * s]];
    this.cov = { probe: Z, ally: d(0.02), asteroid: d(0.1) };

    // Additional threats beyond the canonical ally + asteroid (multi-threat).
    this.extraThreats = []; // [{ key, role, pos, vel, radius }]
    this.minRange = {};      // per-threat closest approach so far
  }

  // Resolve any threat key (canonical or extra) to its body.
  _lookup(key) {
    if (key === 'ally') return this.ally;
    if (key === 'asteroid') return this.asteroid;
    return this.extraThreats.find((t) => t.key === key) || null;
  }

  // Keys of every active threat the probe must keep clear of.
  _threatKeys() {
    return ['ally', 'asteroid', ...this.extraThreats.map((t) => t.key)];
  }

  arm(scenario = {}) {
    const allyPos = scenario.allyPos ?? { x: 8, y: 0.42, z: 0 };
    const allyVel = scenario.allyVel ?? { x: 0, y: 0, z: 0 };
    const astPos = scenario.asteroidPos ?? { x: 4, y: -0.35, z: 3 };
    const astVel = scenario.asteroidVel ?? { x: -0.06, y: 0, z: -0.04 };

    this.probe = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0.2, y: 0, z: 0 } };
    this.ally = { pos: V.clone(allyPos), vel: V.clone(allyVel) };
    this.asteroid = { pos: V.clone(astPos), vel: V.clone(astVel) };

    if (scenario.covAlly) this.cov.ally = scenario.covAlly;
    if (scenario.covAsteroid) this.cov.asteroid = scenario.covAsteroid;
    if (scenario.dynamics) this.dynamics = scenario.dynamics;
    if (scenario.meanMotion != null) this.meanMotion = scenario.meanMotion;

    // Optional extra threats.
    this.extraThreats = (scenario.extraThreats || []).map((t, i) => {
      const key = t.key || `threat${i + 1}`;
      this.cov[key] = t.cov || [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]];
      return { key, role: t.role || 'avoid', pos: V.clone(t.pos), vel: V.clone(t.vel), radius: t.radius ?? this.hardBody };
    });

    this.armed = true;
    this.finished = false;
    this.status = STATUS.ALERT;
    this.elapsed = 0;
    this.minRange = {};
    for (const k of this._threatKeys()) this.minRange[k] = V.mag(V.sub(this._lookup(k).pos, this.probe.pos));
    this.minRangeAlly = this.minRange.ally;
    this.minRangeAsteroid = this.minRange.asteroid;
    this.collisionTarget = null;

    // "par" = least delta-v to bring the worst threat's Pc below the operational
    // threshold (geometric fallback if a body starts inside the safe ring).
    let par = 0;
    for (const k of this._threatKeys()) {
      const fc = this._forecastPair(k);
      if (!fc) continue;
      let dv = solveImpulsiveDvForPc(fc.relPos, fc.relVel, this._combinedCov(k), this.hardBody, this.pcThreshold, this.dvBudget);
      if (dv === 0 && fc.predictedMiss < this.dSafe) dv = solveImpulsiveDv(fc.relPos, fc.relVel, this.dSafe, this.dvBudget);
      par = Math.max(par, dv);
    }
    this.parDv = par;
  }

  _combinedCov(targetKey) {
    return addCov(this.cov.probe, this.cov[targetKey]);
  }

  get dvUsed() {
    return this.dvAgent + this.dvHuman;
  }

  get dvRemaining() {
    return Math.max(0, this.dvBudget - this.dvUsed);
  }

  applyDeltaV(dvVec, source) {
    if (this.finished) return 0;
    let magMs = V.mag(dvVec) * 1000;
    if (magMs <= 0) return 0;

    const remaining = this.dvRemaining;
    if (magMs > remaining) {
      const scale = remaining / magMs;
      dvVec = V.scale(dvVec, scale);
      magMs = remaining;
    }
    if (magMs <= 0) return 0;

    this.probe.vel = V.add(this.probe.vel, dvVec);
    if (source === 'human') this.dvHuman += magMs;
    else this.dvAgent += magMs;
    return magMs;
  }

  step(dt) {
    if (!this.armed || this.finished) return;

    this._propagate(this.probe, dt);
    this._propagate(this.ally, dt);
    this._propagate(this.asteroid, dt);
    for (const t of this.extraThreats) this._propagate(t, dt);
    this.elapsed += dt;

    // Track closest approach + hard-body collision for every threat.
    for (const k of this._threatKeys()) {
      const body = this._lookup(k);
      const r = V.mag(V.sub(body.pos, this.probe.pos));
      if (r < (this.minRange[k] ?? Infinity)) this.minRange[k] = r;
      if (r < (body.radius ?? this.hardBody)) {
        this.collisionTarget = k;
        this.minRangeAlly = this.minRange.ally;
        this.minRangeAsteroid = this.minRange.asteroid;
        this._finish(STATUS.COLLISION);
        return;
      }
    }
    this.minRangeAlly = this.minRange.ally;
    this.minRangeAsteroid = this.minRange.asteroid;

    // Resolve once every threat has passed closest approach (or on timeout).
    const fcs = this._threatKeys().map((k) => ({ k, fc: this._forecastPair(k) }));
    const allPassed = fcs.every(({ fc }) => fc && fc.tca <= 0);
    if (allPassed || this.elapsed > 45) {
      const allSafe = fcs.every(({ k, fc }) => fc.predictedMiss >= this.dSafe && (this.minRange[k] ?? Infinity) >= this.dSafe);
      this._finish(allSafe ? STATUS.RESOLVED : STATUS.UNSAFE);
    }
  }

  _relPair(targetKey) {
    const target = this._lookup(targetKey);
    return {
      relPos: V.sub(target.pos, this.probe.pos),
      relVel: V.sub(target.vel, this.probe.vel),
    };
  }

  _forecastPair(targetKey) {
    if (!this.armed) return null;
    const { relPos, relVel } = this._relPair(targetKey);
    const cov = this._combinedCov(targetKey);
    let tca, predictedMiss, pcPos, pcVel;
    if (this.dynamics === 'cw') {
      const rel0 = { x: relPos.x, y: relPos.y, z: relPos.z, vx: relVel.x, vy: relVel.y, vz: relVel.z };
      const ca = closestApproachCW(rel0, this.meanMotion);
      tca = ca.tca > 1e-6 ? ca.tca : -1;
      predictedMiss = ca.miss;
      // evaluate Pc just before closest approach so pcFor's internal TCA stays positive
      const s = cwStep(rel0, this.meanMotion, Math.max(0, ca.tca - 0.5));
      pcPos = { x: s.x, y: s.y, z: s.z };
      pcVel = { x: s.vx, y: s.vy, z: s.vz };
    } else {
      tca = tcaFor(relPos, relVel);
      predictedMiss = missFor(relPos, relVel);
      pcPos = relPos; pcVel = relVel;
    }
    const range = V.mag(relPos);
    const speed = V.mag(relVel);
    const closingSpeed = tca > 0 ? speed : -speed;
    const requiredDv =
      predictedMiss >= this.dSafe ? 0 : solveImpulsiveDv(relPos, relVel, this.dSafe, this.dvBudget);
    const pc = pcFor(pcPos, pcVel, cov, this.hardBody);

    return {
      target: targetKey,
      relPos,
      relVel,
      tca,
      predictedMiss,
      range,
      closingSpeed,
      requiredDv,
      pc,
      safe: pc <= this.pcThreshold && predictedMiss >= this.dSafe,
      uncertainty: this._uncertaintyEllipse(targetKey, relVel, tca),
      bearing: this._bearing(relPos),
    };
  }

  // 1-sigma uncertainty footprint in the B-plane, anchored at the threat's
  // predicted position at TCA (for in-scene visualization).
  _uncertaintyEllipse(targetKey, relVel, tca) {
    if (tca <= 0 || V.mag(relVel) < 1e-9) return null;
    const t = this._lookup(targetKey);
    const center = {
      x: t.pos.x + t.vel.x * tca,
      y: t.pos.y + t.vel.y * tca,
      z: t.pos.z + t.vel.z * tca,
    };
    const { e1, e2 } = bplaneBasis(relVel);
    const C2 = projectCov2(this._combinedCov(targetKey), e1, e2);
    const { s1, s2, theta } = eig2(C2);
    // major/minor axis directions in 3D
    const ct = Math.cos(theta), st = Math.sin(theta);
    const a1 = { x: e1.x * ct + e2.x * st, y: e1.y * ct + e2.y * st, z: e1.z * ct + e2.z * st };
    const a2 = { x: -e1.x * st + e2.x * ct, y: -e1.y * st + e2.y * ct, z: -e1.z * st + e2.z * ct };
    return { center, axis1: a1, axis2: a2, s1, s2 };
  }

  forecast() {
    if (!this.armed) return null;
    const ally = this._forecastPair('ally');
    const asteroid = this._forecastPair('asteroid');
    const extras = this.extraThreats.map((t) => this._forecastPair(t.key)).filter(Boolean);
    const all = [ally, asteroid, ...extras].filter(Boolean);
    const sev = (x) => x.requiredDv / Math.max(x.predictedMiss, 0.01);
    const worst = all.reduce((a, b) => (sev(a) >= sev(b) ? a : b));
    return { ally, asteroid, extras, all, worst };
  }

  bestBurnDir(targetKey = 'ally') {
    const fc = this._forecastPair(targetKey);
    if (!fc) return { x: 0, y: 0, z: 1 };
    const { relPos, relVel } = fc;
    const perp1 = V.norm(V.cross(relVel, { x: 0, y: 1, z: 0 }));
    let perp2 = V.norm(V.cross(relVel, perp1));
    if (V.mag(perp2) < 1e-9) perp2 = V.norm(V.cross(relVel, { x: 1, y: 0, z: 0 }));

    const candidates = [perp1, V.scale(perp1, -1), perp2, V.scale(perp2, -1)];
    let best = candidates[0];
    let bestMiss = -1;
    const eps = 1e-4;
    for (const dir of candidates) {
      const m = missFor(relPos, V.sub(relVel, V.scale(dir, eps)));
      if (m > bestMiss) {
        bestMiss = m;
        best = dir;
      }
    }
    return best;
  }

  // Least delta-v (m/s) to bring a single threat's Pc under threshold, now.
  requiredDvForPc(targetKey) {
    const { relPos, relVel } = this._relPair(targetKey);
    return solveImpulsiveDvForPc(relPos, relVel, this._combinedCov(targetKey), this.hardBody, this.pcThreshold, this.dvBudget);
  }

  probeForward() {
    const v = this.probe.vel;
    const m = V.mag(v);
    if (m > 1e-6) return V.norm(v);
    return { x: 1, y: 0, z: 0 };
  }

  _bearing(relPos) {
    const fwd = this.probeForward();
    const right = V.norm(V.cross({ x: 0, y: 1, z: 0 }, fwd));
    const up = V.norm(V.cross(fwd, right));
    return {
      forward: V.dot(relPos, fwd),
      cross: V.dot(relPos, right),
      vertical: V.dot(relPos, up),
      range: V.mag(relPos),
    };
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
