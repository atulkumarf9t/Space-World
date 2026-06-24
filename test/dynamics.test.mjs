// dynamics.test.mjs — verifies CW/Hill dynamics reduce to linear at n=0 and
// stay well-behaved at n>0. Run: node test/dynamics.test.mjs

import { cwStep, closestApproachCW } from '../src/dynamics.js';
import { tcaFor, missFor, Physics } from '../src/physics.js';
import { Simulation } from '../src/simulation.js';
import { optimalPolicy } from '../src/policies.js';
import { DEFAULT_SCENARIO } from '../src/scenarios.js';

let passed = 0, failed = 0;
const ok = (n, c, d = '') => (c ? (passed++, console.log(`  PASS  ${n}`)) : (failed++, console.log(`  FAIL  ${n}  ${d}`)));
const near = (a, b, t) => Math.abs(a - b) <= t;

console.log('\nCW reduces to linear at n=0');
{
  const s = { x: 1, y: -2, z: 0.5, vx: 0.1, vy: -0.2, vz: 0.05 };
  const out = cwStep(s, 0, 10);
  ok('cwStep(n=0) = straight line', near(out.x, 1 + 0.1 * 10, 1e-9) && near(out.y, -2 - 0.2 * 10, 1e-9) && near(out.vx, 0.1, 1e-9));

  const rel = { x: 10, y: 2, z: 0, vx: -1, vy: 0, vz: 0 };
  const ca = closestApproachCW(rel, 0, { horizon: 30, coarse: 0.25 });
  ok('closest approach tca ~ analytic', near(ca.tca, tcaFor({ x: 10, y: 2, z: 0 }, { x: -1, y: 0, z: 0 }), 0.3), `${ca.tca}`);
  ok('closest approach miss ~ analytic', near(ca.miss, missFor({ x: 10, y: 2, z: 0 }, { x: -1, y: 0, z: 0 }), 0.05), `${ca.miss}`);
}

console.log('\nPhysics CW mode');
{
  const lin = new Physics({ dynamics: 'linear' }); lin.arm(DEFAULT_SCENARIO);
  const cw0 = new Physics({ dynamics: 'cw', meanMotion: 0 }); cw0.arm(DEFAULT_SCENARIO);
  const fl = lin.forecast().asteroid, fc0 = cw0.forecast().asteroid;
  ok('cw(n=0) forecast matches linear', near(fl.predictedMiss, fc0.predictedMiss, 0.05) && near(fl.tca, fc0.tca, 0.5),
    `lin miss ${fl.predictedMiss.toFixed(3)} tca ${fl.tca.toFixed(2)} | cw ${fc0.predictedMiss.toFixed(3)} tca ${fc0.tca.toFixed(2)}`);

  const cw = new Physics({ dynamics: 'cw', meanMotion: 0.05 }); cw.arm(DEFAULT_SCENARIO);
  const fcw = cw.forecast().asteroid;
  ok('cw(n>0) forecast finite (curved motion)', isFinite(fcw.predictedMiss) && isFinite(fcw.pc), JSON.stringify({ miss: fcw.predictedMiss, pc: fcw.pc }));

  const sim = new Simulation({ scenario: { ...DEFAULT_SCENARIO, dynamics: 'cw', meanMotion: 0.05 }, policy: optimalPolicy() });
  const res = sim.run({ maxTime: 80 });
  ok('agent flies a curved (CW) encounter', !!res.status && res.dvUsed <= 12 + 1e-6, JSON.stringify(res));
  console.log(`        CW sim: ${res.status} dv=${res.dvUsed.toFixed(2)} m/s`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
