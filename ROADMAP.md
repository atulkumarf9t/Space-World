# DRIFT 3D — Roadmap

A phased plan to take DRIFT 3D from a convincing demo to a defensible, autonomous
space-traffic-management simulator. Each phase ships something demoable on its own.

**Cross-cutting principles**
- *Realism is always a toggle*, never a replacement for the playable game feel.
- *The deterministic layer is the safety net* under any LLM — non-negotiable.
- *Every new bit of physics is unit-tested* in Node before it touches the app.
- *The sim core is headless* so it can be benchmarked without a browser.

Legend: ✅ done · 🟡 partial · ⬜ planned · ⏭ deferred (out of session scope)

---

## Phase 0 — Foundations (prerequisite)

| Task | Status | Notes |
|---|---|---|
| Seeded PRNG for reproducible runs | ✅ | `src/rng.js` (mulberry32) |
| Scenario type + generator (replaces hard-coded constants) | ✅ | `src/scenarios.js` |
| Headless `Simulation` core (no DOM/Three/Reactor) | ✅ | `src/simulation.js`, runs in Node |
| Golden tests for the physics math | ✅ | `test/physics.test.mjs` |
| Build tooling (Vite) replacing the manual esbuild vendor step | ✅ | `vite.config.js`; `vite build` bundles three + Reactor SDK from node_modules. Native-ESM `node server/proxy.js` path also kept. |
| TypeScript on the math core | ✅ | `tsconfig.json` (checkJs) + `npm run typecheck`; passes clean on the engine core |

## Phase 1 — Credibility (speak the language of STM)

| Task | Status | Notes |
|---|---|---|
| Position **covariance** per body (3×3) propagated to TCA | ✅ | `physics.js` |
| **Probability of collision (Pc)** in the B-plane | ✅ | `pcFor()`, validated vs Monte-Carlo in tests |
| "Par" optimizer re-targets **Pc < threshold** (1e-4) | ✅ | `solveImpulsiveDvForPc()` |
| HUD: Pc readout + threshold | ✅ | side panel + overlay threat panel |
| 3D **uncertainty ellipse** at TCA | ✅ | `physics_viz.js` covariance ring |
| Real-data ingestion (TLE→SGP4→conjunction) | ✅ | `src/tle.js` (satellite.js); `node test/tle.test.mjs`. CLI/Node tool; in-browser use comes free via the Vite path. |

## Phase 2 — True autonomy (LLM in the loop, benchmarked)

| Task | Status | Notes |
|---|---|---|
| **Tool interface** over the headless core | ✅ | `src/policies.js` (decide→action), executor in `simulation.js` |
| **Deterministic safety guard** (veto over-budget / NaN / unsafe) | ✅ | `simulation.js` executor clamps & validates |
| Policies: optimal / heuristic / random | ✅ | `src/policies.js` |
| **Eval harness**: policy vs optimal vs random across N seeds | ✅ | `eval/run.mjs`, prints a scorecard |
| LLM policy via Gemini | ✅/🟡 | `/api/agent` endpoint + `llmPolicy` + in-app **BRAIN: LLM** toggle (key `B`), routed through the safety guard. Button auto-disables without `GEMINI_API_KEY`; live path not exercised this session (no key). |
| Explainability: action log in the feed | ✅ | agent burns routed through the guard + logged |

## Phase 3 — Depth & polish

| Task | Status | Notes |
|---|---|---|
| **Sound** (synthesized, no assets) | ✅ | `src/audio.js` — thruster, alert, eclipse drone, chimes |
| Multi-threat N-object screening | ✅ | engine + meshes + reticles + viz; `node test/multithreat.test.mjs` |
| CW / Keplerian orbital dynamics | ✅ | `src/dynamics.js` realism mode; `node test/dynamics.test.mjs` (n=0 ≡ linear) |
| Campaign / difficulty / leaderboards | ✅ | `src/campaign.js` + localStorage + in-app card; `node test/campaign.test.mjs` |
| Web Worker for the sim | ✅ | `src/benchmark.worker.js` + **BENCHMARK** button (runs the scorecard off-thread) |
| VR | ✅/🟡 | WebXR enabled + `VRButton` (auto-shown if a headset is present); XR loop wired but unverified without hardware |

---

## Verification strategy

- **Math + engine**: `npm test` runs all suites — `physics` (golden + Monte-Carlo Pc), `dynamics` (CW≡linear at n=0), `multithreat`, `campaign`, `tle`. 39 assertions.
- **Autonomy**: `node eval/run.mjs` — scorecard proving optimal beats heuristic/random and the guard holds budget. Same benchmark runs off-thread in-app via the **BENCHMARK** button.
- **Types**: `npm run typecheck` (tsc checkJs on the engine core) — clean.
- **App**: load in browser; confirm Reactor connects, Pc + uncertainty ellipses render, multi-threat/campaign/brain controls work, no console errors.

## Run paths

- **Native ESM (proven):** `node server/proxy.js` → http://localhost:5173 (uses importmap + the prebuilt `vendor/reactor.bundle.mjs`; rebuild with `npm run build`).
- **Vite (new):** `node server/proxy.js` (for `/api`) + `npm run vite` (dev on :5174, proxies `/api`), or `npm run vite:build` → `dist/` (bundles three + Reactor SDK from node_modules — no manual vendor step).
