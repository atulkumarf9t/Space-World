// scenarios.js — encounter definitions as data (Phase 0).
// A Scenario fully specifies an encounter: body states + position covariances.
// Covariance is a diagonal RIC-ish 3x3 in world XYZ (km^2). The probe's own state
// is treated as well-known (~0), so combined uncertainty is dominated by the threat.

import { Rng } from './rng.js';

export function diagCov(sx, sy, sz) {
  return [
    [sx * sx, 0, 0],
    [0, sy * sy, 0],
    [0, 0, sz * sz],
  ];
}

// The classic hand-authored encounter (matches the original game defaults),
// now with explicit uncertainty.
export const DEFAULT_SCENARIO = {
  name: 'baseline-dual-threat',
  allyPos: { x: 8, y: 0.42, z: 0 },
  allyVel: { x: 0, y: 0, z: 0 },
  asteroidPos: { x: 4, y: -0.35, z: 3 },
  asteroidVel: { x: -0.06, y: 0, z: -0.04 },
  covAlly: diagCov(0.02, 0.02, 0.02),       // well-tracked friendly satellite
  covAsteroid: diagCov(0.08, 0.15, 0.08),   // larger, anisotropic (in-track dominant)
};

// Randomized-but-solvable encounter generator for the eval harness / replay.
// Deterministic in `seed`.
export function generateScenario(seed) {
  const r = new Rng(seed);
  const allySide = r.sign();
  const asteroidSide = r.sign();
  return {
    name: `gen-${seed}`,
    seed,
    allyPos: { x: r.float(6, 9), y: allySide * r.float(0.2, 0.6), z: r.float(-0.6, 0.6) },
    allyVel: { x: r.float(-0.02, 0.02), y: 0, z: r.float(-0.02, 0.02) },
    asteroidPos: { x: r.float(3, 6), y: asteroidSide * r.float(0.2, 0.5), z: r.float(2, 4) },
    asteroidVel: { x: r.float(-0.09, -0.03), y: 0, z: r.float(-0.06, -0.02) },
    covAlly: diagCov(0.02, 0.02, 0.02),
    covAsteroid: diagCov(r.float(0.05, 0.12), r.float(0.1, 0.2), r.float(0.05, 0.12)),
  };
}

export function generateBatch(n, baseSeed = 1000) {
  return Array.from({ length: n }, (_, i) => generateScenario(baseSeed + i));
}

// A harder encounter with two extra debris threats (multi-threat).
export const MULTI_THREAT_SCENARIO = {
  name: 'debris-field',
  allyPos: { x: 8, y: 0.42, z: 0 },
  allyVel: { x: 0, y: 0, z: 0 },
  asteroidPos: { x: 4, y: -0.35, z: 3 },
  asteroidVel: { x: -0.06, y: 0, z: -0.04 },
  covAlly: diagCov(0.02, 0.02, 0.02),
  covAsteroid: diagCov(0.08, 0.15, 0.08),
  extraThreats: [
    { key: 'debris-a', role: 'avoid', pos: { x: 3, y: 0.5, z: -3 }, vel: { x: -0.05, y: -0.01, z: 0.05 }, cov: diagCov(0.06, 0.1, 0.06) },
    { key: 'debris-b', role: 'avoid', pos: { x: 5, y: -0.6, z: -2 }, vel: { x: -0.07, y: 0.015, z: 0.04 }, cov: diagCov(0.07, 0.12, 0.07) },
  ],
};

export function generateMultiThreat(seed, extraCount = 2) {
  const r = new Rng(seed);
  const base = generateScenario(seed);
  base.name = `multi-${seed}`;
  base.extraThreats = Array.from({ length: extraCount }, (_, i) => ({
    key: `debris-${i}`,
    role: 'avoid',
    pos: { x: r.float(2, 6), y: r.sign() * r.float(0.3, 0.7), z: r.float(-4, -1) },
    vel: { x: r.float(-0.08, -0.03), y: r.float(-0.02, 0.02), z: r.float(0.02, 0.06) },
    cov: diagCov(r.float(0.05, 0.1), r.float(0.08, 0.15), r.float(0.05, 0.1)),
  }));
  return base;
}
