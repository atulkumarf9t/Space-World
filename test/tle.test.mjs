// tle.test.mjs — verifies the SGP4 ingestion pipeline end to end.
// Run: node test/tle.test.mjs

import { SAMPLE_TLES, findConjunction, toScenario } from '../src/tle.js';
import { Physics } from '../src/physics.js';
import { Simulation } from '../src/simulation.js';
import { optimalPolicy } from '../src/policies.js';

let passed = 0, failed = 0;
const ok = (n, c, d = '') => (c ? (passed++, console.log(`  PASS  ${n}`)) : (failed++, console.log(`  FAIL  ${n}  ${d}`)));

console.log('\nTLE / conjunction ingestion');
const start = new Date('2024-03-19T00:00:00Z'); // near the sample TLE epochs
const report = findConjunction(SAMPLE_TLES.iss, SAMPLE_TLES.cosmos, { start, windowMin: 120, stepSec: 10 });
console.log(`        ${report.primary} × ${report.secondary}`);
console.log(`        miss=${report.missKm.toFixed(1)} km  relSpeed=${report.relSpeedKmS.toFixed(2)} km/s  @ ${report.timeUTC}`);

ok('miss distance finite & positive', isFinite(report.missKm) && report.missKm > 0, `${report.missKm}`);
ok('relative speed realistic (1–16 km/s)', report.relSpeedKmS > 1 && report.relSpeedKmS < 16, `${report.relSpeedKmS}`);

const sc = toScenario(report, { playable: true });
ok('scenario is well-formed', !!sc.asteroidPos && !!sc.asteroidVel && !!sc.covAsteroid);

const p = new Physics();
p.arm(sc);
const fc = p.forecast();
ok('physics accepts real scenario', !!fc && isFinite(fc.asteroid.pc), JSON.stringify(fc?.asteroid?.pc));

const res = new Simulation({ scenario: sc, policy: optimalPolicy() }).run({ maxTime: 80 });
ok('agent runs the real encounter without crashing', !!res.status, JSON.stringify(res));
console.log(`        sim result: ${res.status}  dv=${res.dvUsed.toFixed(2)} m/s`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
