// eval/run.mjs — benchmark decision policies across many seeded encounters.
// Run: node eval/run.mjs [N]
//
// Proves the autonomy story with numbers: the optimal policy should resolve nearly
// every encounter near par; weaker policies waste Δv or fail; the null policy shows
// how dangerous "do nothing" is. The deterministic guard guarantees no policy ever
// exceeds the Δv budget, however badly it behaves.

import { Simulation } from '../src/simulation.js';
import { generateBatch } from '../src/scenarios.js';
import { optimalPolicy, heuristicPolicy, randomPolicy, nullPolicy } from '../src/policies.js';
import { Rng } from '../src/rng.js';

const N = parseInt(process.argv[2] || '200', 10);
const scenarios = generateBatch(N);

const rng = new Rng(7);
const policies = [
  ['optimal', () => optimalPolicy()],
  ['heuristic', () => heuristicPolicy(1.2)],
  ['random', () => randomPolicy(() => rng.next())],
  ['null', () => nullPolicy()],
];

function evalPolicy(makePolicy) {
  let resolved = 0, collisions = 0, unsafe = 0, dvSum = 0, ratioSum = 0, ratioN = 0, overBudget = 0, maxDv = 0;
  for (const sc of scenarios) {
    const sim = new Simulation({ scenario: sc, policy: makePolicy() });
    const r = sim.run({ maxTime: 80 });
    if (r.resolved) resolved++;
    if (r.collision) collisions++;
    if (r.status === 'UNSAFE') unsafe++;
    dvSum += r.dvUsed;
    maxDv = Math.max(maxDv, r.dvUsed);
    if (r.ratio != null && r.resolved) { ratioSum += r.ratio; ratioN++; }
    if (r.dvUsed > sim.phys.dvBudget + 1e-6) overBudget++;
  }
  return {
    success: (100 * resolved / N).toFixed(1) + '%',
    collisions,
    unsafe,
    avgDv: (dvSum / N).toFixed(2),
    avgRatio: ratioN ? (ratioSum / ratioN).toFixed(2) + 'x' : '—',
    maxDv: maxDv.toFixed(2),
    overBudget,
  };
}

console.log(`\nDRIFT 3D — policy benchmark over ${N} seeded encounters\n`);
const rows = [['policy', 'success', 'collisions', 'unsafe', 'avg Δv', 'avg Δv/par', 'max Δv', 'over-budget']];
for (const [name, make] of policies) {
  const r = evalPolicy(make);
  rows.push([name, r.success, String(r.collisions), String(r.unsafe), r.avgDv, r.avgRatio, r.maxDv, String(r.overBudget)]);
}

const w = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
for (const row of rows) console.log('  ' + row.map((c, i) => c.padEnd(w[i])).join('  '));
console.log('\nbudget = 12.00 m/s (guard-enforced); par = least-Δv to bring Pc < 1e-4 and clear the safe ring.\n');
