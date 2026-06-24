// multithreat.test.mjs — verifies N-threat support in the engine + autonomy.
// Run: node test/multithreat.test.mjs

import { Physics } from '../src/physics.js';
import { Simulation } from '../src/simulation.js';
import { optimalPolicy, nullPolicy } from '../src/policies.js';
import { MULTI_THREAT_SCENARIO, generateMultiThreat } from '../src/scenarios.js';

let passed = 0, failed = 0;
const ok = (n, c, d = '') => (c ? (passed++, console.log(`  PASS  ${n}`)) : (failed++, console.log(`  FAIL  ${n}  ${d}`)));

console.log('\nmulti-threat engine');
{
  const p = new Physics();
  p.arm(MULTI_THREAT_SCENARIO);
  const fc = p.forecast();
  ok('forecast includes extra threats', fc.extras.length === 2, `got ${fc.extras.length}`);
  ok('all-threats list has 4 entries', fc.all.length === 4, `got ${fc.all.length}`);
  ok('each extra has Pc + uncertainty', fc.extras.every((e) => isFinite(e.pc) && e.uncertainty), '');
  ok('par accounts for worst of all threats', isFinite(p.parDv) && p.parDv >= 0, `${p.parDv}`);
}

console.log('\nautonomy over a debris field');
{
  let optResolved = 0, nullResolved = 0, optCollide = 0, optOver = 0;
  const N = 40;
  for (let s = 0; s < N; s++) {
    const sc = generateMultiThreat(5000 + s, 2);
    const o = new Simulation({ scenario: sc, policy: optimalPolicy() }).run({ maxTime: 80 });
    const z = new Simulation({ scenario: sc, policy: nullPolicy() }).run({ maxTime: 80 });
    if (o.resolved) optResolved++;
    if (z.resolved) nullResolved++;
    if (o.collision) optCollide++;
    if (o.dvUsed > 12 + 1e-6) optOver++;
  }
  console.log(`        optimal resolved ${optResolved}/${N}, null resolved ${nullResolved}/${N}`);
  ok('optimal outperforms doing nothing', optResolved >= nullResolved, `${optResolved} vs ${nullResolved}`);
  ok('optimal never collides', optCollide === 0, `${optCollide}`);
  ok('guard holds budget under multi-threat', optOver === 0, `${optOver}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
