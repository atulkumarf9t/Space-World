// tle.js — real orbital-data ingestion (Phase: credibility stretch).
// Propagates two TLEs with SGP4 (satellite.js), finds their close approach, and
// reports the conjunction the same way operations does: TCA, miss distance,
// relative speed. Optionally maps it to a playable Scenario for the sim.
//
// Note: real LEO conjunctions close at ~km/s; the game is tuned for ~0.1 km/s.
// `toScenario({ playable: true })` preserves the *geometry* (miss direction, Pc)
// while scaling the relative speed into the game's range so it stays flyable.

import * as satellite from 'satellite.js';
import { diagCov } from './scenarios.js';

// A couple of public TLEs (epoch-dated; SGP4 still propagates away from epoch).
export const SAMPLE_TLES = {
  iss: {
    name: 'ISS (ZARYA)',
    l1: '1 25544U 98067A   24079.07757601  .00016717  00000+0  30074-3 0  9993',
    l2: '2 25544  51.6396 211.1422 0003463  68.6422 291.5097 15.49814841442435',
  },
  cosmos: {
    name: 'COSMOS 2251 DEB',
    l1: '1 34427U 93036SX  24078.86015028  .00002182  00000+0  86819-2 0  9994',
    l2: '2 34427  74.0382 158.9215 0166571 100.3527 261.5481 14.36044608800353',
  },
};

function stateAt(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || !pv.velocity) return null;
  return {
    pos: { x: pv.position.x, y: pv.position.y, z: pv.position.z }, // km, ECI
    vel: { x: pv.velocity.x, y: pv.velocity.y, z: pv.velocity.z }, // km/s, ECI
  };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mag = (a) => Math.hypot(a.x, a.y, a.z);

// Scan a time window for the minimum range between two objects.
export function findConjunction(tleA, tleB, { start = new Date(), windowMin = 90, stepSec = 5 } = {}) {
  const a = satellite.twoline2satrec(tleA.l1, tleA.l2);
  const b = satellite.twoline2satrec(tleB.l1, tleB.l2);
  let best = null;
  const n = Math.floor((windowMin * 60) / stepSec);
  for (let i = 0; i <= n; i++) {
    const t = new Date(start.getTime() + i * stepSec * 1000);
    const sa = stateAt(a, t), sb = stateAt(b, t);
    if (!sa || !sb) continue;
    const r = mag(sub(sb.pos, sa.pos));
    if (!best || r < best.range) best = { t, range: r, sa, sb };
  }
  if (!best) throw new Error('propagation failed (check TLE epoch)');
  const rRel = sub(best.sb.pos, best.sa.pos);
  const vRel = sub(best.sb.vel, best.sa.vel);
  return {
    timeUTC: best.t.toISOString(),
    missKm: best.range,
    relSpeedKmS: mag(vRel),
    rRel,
    vRel,
    primary: tleA.name,
    secondary: tleB.name,
  };
}

// Map a conjunction report into a sim Scenario. arm() fixes probe.vel=(0.2,0,0),
// so threat.vel = probeVel + relVel reproduces the relative geometry exactly.
export function toScenario(report, { playable = true } = {}) {
  const PROBE_VEL = { x: 0.2, y: 0, z: 0 };
  // place the threat a short lead-time ahead so it approaches on screen
  const leadS = 30;
  const speed = report.relSpeedKmS || 1e-6;
  const scale = playable ? Math.min(1, 0.12 / speed) : 1; // scale closing speed into game range
  const vRel = { x: report.vRel.x * scale, y: report.vRel.y * scale, z: report.vRel.z * scale };
  // start position: miss point minus relVel*lead (so it closes over ~leadS seconds)
  const start = {
    x: report.rRel.x - vRel.x * leadS,
    y: report.rRel.y - vRel.y * leadS,
    z: report.rRel.z - vRel.z * leadS,
  };
  // clamp absurd ranges into the scene
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  const pos = { x: clamp(start.x, 12), y: clamp(start.y, 6), z: clamp(start.z, 12) };
  return {
    name: `real:${report.primary} × ${report.secondary}`,
    real: true,
    report,
    allyPos: { x: 9, y: 0.4, z: -2 },
    allyVel: { x: 0, y: 0, z: 0 },
    asteroidPos: pos,
    asteroidVel: { x: PROBE_VEL.x + vRel.x, y: PROBE_VEL.y + vRel.y, z: PROBE_VEL.z + vRel.z },
    covAlly: diagCov(0.02, 0.02, 0.02),
    covAsteroid: diagCov(0.1, 0.18, 0.1),
  };
}
