// gen_ref.mjs — emit reference values from the JS engine so the Python port can
// be checked for byte/numeric parity. Run: node research/gen_ref.mjs
import { writeFileSync } from 'node:fs';
import { mulberry32 } from '../src/rng.js';
import { DEFAULT_SCENARIO, generateScenario } from '../src/scenarios.js';
import { tcaFor, missFor, pcFor } from '../src/physics.js';
import { Simulation } from '../src/simulation.js';
import { optimalPolicy } from '../src/policies.js';

const first = (fn, n) => Array.from({ length: n }, () => fn());

const cov = [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]];
const relPos = { x: 10, y: 0.05, z: 0 };
const relVel = { x: -1, y: 0, z: 0 };

const optDefault = new Simulation({ scenario: DEFAULT_SCENARIO, policy: optimalPolicy() }).run({ maxTime: 80 });
const sc1000 = generateScenario(1000);
const optGen = new Simulation({ scenario: sc1000, policy: optimalPolicy() }).run({ maxTime: 80 });

const ref = {
  rng1: first(mulberry32(1), 5),
  rng42: first(mulberry32(42), 5),
  scenario1000: sc1000,
  tca: tcaFor(relPos, relVel),
  miss: missFor(relPos, relVel),
  pc: pcFor(relPos, relVel, cov, 0.05, 64),
  optimalDefault: { status: optDefault.status, dvUsed: optDefault.dvUsed, parDv: optDefault.parDv, resolved: optDefault.resolved },
  optimalGen: { status: optGen.status, dvUsed: optGen.dvUsed, parDv: optGen.parDv },
};
writeFileSync(new URL('./parity_ref.json', import.meta.url), JSON.stringify(ref, null, 2));
console.log('wrote parity_ref.json');
console.log('optimalDefault:', ref.optimalDefault);
