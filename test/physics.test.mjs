// physics.test.mjs — golden + Monte-Carlo validation of the conjunction math.
// Run: node test/physics.test.mjs

import { missFor, tcaFor, pcFor, Physics } from '../src/physics.js';
import { Simulation } from '../src/simulation.js';
import { optimalPolicy, nullPolicy } from '../src/policies.js';
import { DEFAULT_SCENARIO } from '../src/scenarios.js';
import { Rng } from '../src/rng.js';

let passed = 0, failed = 0;
function ok(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

console.log('\nconjunction geometry');
{
  const r = { x: 10, y: 2, z: 0 }, v = { x: -1, y: 0, z: 0 };
  ok('tca golden', near(tcaFor(r, v), 10, 1e-9), `got ${tcaFor(r, v)}`);
  ok('miss golden', near(missFor(r, v), 2, 1e-9), `got ${missFor(r, v)}`);
  ok('tca passed -> negative', tcaFor({ x: -5, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }) < 0);
}

console.log('\nprobability of collision');
{
  const v = { x: -1, y: 0, z: 0 };
  const covSmall = [[1e-4, 0, 0], [0, 1e-4, 0], [0, 0, 1e-4]]; // sigma 0.01 km
  // far miss -> ~0
  const pcFar = pcFor({ x: 10, y: 2, z: 0 }, v, covSmall, 0.05);
  ok('far miss -> Pc ~ 0', pcFar < 1e-6, `got ${pcFar}`);

  // direct hit, tiny covariance -> ~1
  const pcHit = pcFor({ x: 10, y: 0, z: 0 }, v, covSmall, 0.05);
  ok('direct hit -> Pc ~ 1', pcHit > 0.99, `got ${pcHit}`);

  // moderate case validated against Monte-Carlo
  const cov = [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]]; // sigma 0.1 km
  const relPos = { x: 10, y: 0.05, z: 0 };
  const hbr = 0.05;
  const analytic = pcFor(relPos, v, cov, hbr, 128);
  const mc = montecarloPc(relPos, v, cov, hbr, 400000, new Rng(42));
  ok('Pc matches Monte-Carlo', near(analytic, mc, 0.01), `analytic ${analytic.toFixed(4)} vs mc ${mc.toFixed(4)}`);
  console.log(`        (analytic=${analytic.toFixed(4)}, mc=${mc.toFixed(4)})`);
}

console.log('\nPhysics forecast + par');
{
  const p = new Physics();
  p.arm(DEFAULT_SCENARIO);
  const fc = p.forecast();
  ok('forecast exposes Pc', typeof fc.asteroid.pc === 'number' && fc.asteroid.pc >= 0);
  ok('par is finite & non-negative', isFinite(p.parDv) && p.parDv >= 0, `par ${p.parDv}`);
  ok('uncertainty ellipse present', !!fc.asteroid.uncertainty && fc.asteroid.uncertainty.s1 > 0);
}

console.log('\nsafety guard');
{
  const sim = new Simulation({ scenario: DEFAULT_SCENARIO, policy: nullPolicy(), dvBudget: 12 });
  sim.execute({ type: 'burn', dir: { x: 1, y: 0, z: 0 }, dv: 9999 }); // over-budget
  sim.fm.tick(10, 'AGENT');
  ok('guard clamps to budget', sim.phys.dvUsed <= 12 + 1e-6, `used ${sim.phys.dvUsed}`);
  sim.execute({ type: 'burn', dir: { x: NaN, y: 0, z: 0 }, dv: 1 }); // invalid
  ok('guard rejects NaN dir', sim.fm.activeBurn === null);
}

console.log('\nautonomy behavior');
{
  const optimal = new Simulation({ scenario: DEFAULT_SCENARIO, policy: optimalPolicy() }).run();
  const doNothing = new Simulation({ scenario: DEFAULT_SCENARIO, policy: nullPolicy() }).run();
  ok('optimal policy does not collide', !optimal.collision, JSON.stringify(optimal));
  console.log(`        optimal: ${optimal.status} dv=${optimal.dvUsed.toFixed(2)} | null: ${doNothing.status}`);
}

function montecarloPc(relPos, relVel, cov3, hbr, n, rng) {
  const tca = tcaFor(relPos, relVel);
  if (tca <= 0) return 0;
  const miss = { x: relPos.x + relVel.x * tca, y: relPos.y + relVel.y * tca, z: relPos.z + relVel.z * tca };
  // basis perpendicular to relVel
  const um = Math.hypot(relVel.x, relVel.y, relVel.z);
  const u = { x: relVel.x / um, y: relVel.y / um, z: relVel.z / um };
  const t = Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const cx = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const nrm = (a) => { const m = Math.hypot(a.x, a.y, a.z); return { x: a.x / m, y: a.y / m, z: a.z / m }; };
  const e1 = nrm(cx(u, t)), e2 = nrm(cx(u, e1));
  // diagonal cov -> independent per-axis std devs
  const sx = Math.sqrt(cov3[0][0]), sy = Math.sqrt(cov3[1][1]), sz = Math.sqrt(cov3[2][2]);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const p = {
      x: miss.x + rng.normal(0, sx),
      y: miss.y + rng.normal(0, sy),
      z: miss.z + rng.normal(0, sz),
    };
    const a = p.x * e1.x + p.y * e1.y + p.z * e1.z;
    const b = p.x * e2.x + p.y * e2.y + p.z * e2.z;
    if (a * a + b * b < hbr * hbr) hits++;
  }
  return hits / n;
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
