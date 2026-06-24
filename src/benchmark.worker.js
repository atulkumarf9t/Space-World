// benchmark.worker.js — runs the policy benchmark off the main thread using the
// headless Simulation core, so the UI never freezes. (Phase 3 / Web Worker.)
// Module worker: imports are relative-only, so no importmap is needed.

import { Simulation } from './simulation.js';
import { generateBatch } from './scenarios.js';
import { optimalPolicy, heuristicPolicy, randomPolicy, nullPolicy } from './policies.js';

self.onmessage = (e) => {
  const N = (e.data && e.data.n) || 100;
  const scenarios = generateBatch(N);
  const defs = [
    ['optimal', () => optimalPolicy()],
    ['heuristic', () => heuristicPolicy(1.2)],
    ['random', () => randomPolicy()],
    ['null', () => nullPolicy()],
  ];
  const rows = [];
  for (const [name, make] of defs) {
    let resolved = 0, dv = 0, ratioSum = 0, ratioN = 0, over = 0;
    for (const sc of scenarios) {
      const r = new Simulation({ scenario: sc, policy: make() }).run({ maxTime: 80 });
      if (r.resolved) resolved++;
      dv += r.dvUsed;
      if (r.ratio != null && r.resolved) { ratioSum += r.ratio; ratioN++; }
      if (r.dvUsed > 12 + 1e-6) over++;
    }
    rows.push({
      name,
      success: Math.round((100 * resolved) / N) + '%',
      avgDv: (dv / N).toFixed(2),
      ratio: ratioN ? (ratioSum / ratioN).toFixed(2) + 'x' : '—',
      over,
    });
  }
  self.postMessage({ rows, N });
};
