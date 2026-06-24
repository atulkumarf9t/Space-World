# DRIFT 3D — Research Roadmap

Turning DRIFT from a demo into research infrastructure. Scope (per decision):

**In:** A1 verifiable LM-agent env · A2 shielded/constrained-RL testbed · A3 classical-vs-learned
control benchmark · D1 verifiable dataset · D2 adversarial/curriculum generator ·
E1 generative-world × verifiable-physics · E2 reasoning-faithfulness/calibration.
**Out:** product, courseware, operational decision-support.

## Thesis & headline metric

DRIFT's scarce assets are a **verifiable dense reward + an analytic optimality oracle + a
deterministic safety shield + a generative-world coupling**. Every track below exploits those.

- **Headline metric across all tracks: regret vs par** — `Δv_used / par_Δv` (optimality gap),
  not just success rate. The oracle makes this possible.
- **Safety metric:** constraint-violation rate (actions the shield had to clamp).
- **Calibration metric:** ECE of stated confidence vs realized Pc/outcome (E2).
- **Faithfulness metric:** fraction of LM rationales whose stated driver = the true driver (E2).

## Dependency graph

```
                ┌─────────────────────────────────────────────┐
                │  PHASE 0 — Research Substrate (keystone)      │
                │  gym env · reward · metrics · splits ·        │
                │  dataset exporter · baselines · leaderboard   │
                └───────┬───────────────┬───────────┬──────────┘
            ┌───────────┘     ┌─────────┘     ┌─────┘
            ▼                 ▼               ▼
   A2 shielded-RL      D1 dataset       E2 faithfulness
   (quick win)         (near-free)      (cheap, high value)
            │                 │
            ▼                 ▼
        A1 LM-agent env  ◄── D2 curriculum/adversarial
            │
            ▼
        A3 classical-vs-learned benchmark
            │
            ▼
        E1 generative-world × verifiable-physics  (moonshot; also needs frame replay)
```

Phase 0 unlocks everything. Recommended order: **0 → A2 → D1 → A1 → E2 → D2 → A3 → E1.**

---

## Implementation status — ALL TRACKS BUILT ✅ (see `research/`)

| track | status | artifact | result |
|---|---|---|---|
| Phase 0 substrate | ✅ | `research/drift_env/`, `test_parity.py` | 11/11 cross-language parity vs JS |
| BC + PPO loop | ✅ | `research/train.py` | both ~1.5× regret on held-out seeds |
| A1 instruction benchmark | ✅ | `research/a1_benchmark.py`, `instructions.py` | follower 78–94% vs blind 26–68% compliance |
| A2 shielded-RL | ✅ | `research/a2_ablation.py` | shield → 0 budget/NaN violations, however reckless |
| A3 classical-vs-learned | ✅ | `research/a3_benchmark.py` | analytic 1.05× · mpc 1.64× · bc 2.0× · random 4.08× |
| D1 dataset | ✅ | `research/build_dataset.py`, `data/` | 26.6k rows, datasheet + sha256 manifest |
| D2 curriculum/adversarial | ✅ | `research/d2_curriculum.py` | mined regret 8.5× vs 1.1× random, 100% solvable |
| E2 faithfulness | ✅ | `research/e2_faithfulness.py` | faithfulness 100% vs 0%; ECE 0.08 vs 0.28 |
| E1 coupling (offline) | ✅ | `research/e1_coupling.py` | eclipse +6% Δv; perception noise → 95% success |
| E1 pixel study | 🟡 | `research/E1_frame_pipeline.md` | capture-replay spec; needs live Reactor recording |

All verified; full details + commands in `research/README.md`.

---

## PHASE 0 — Research substrate (the keystone)  · effort M

The single deliverable that unlocks A1/A2/A3/D1/D2/E2.

**Build**
- **Gym/Gymnasium-style env** over `Simulation`: `reset(seed|scenario) -> obs`,
  `step(action) -> (obs, reward, terminated, truncated, info)`. `info` carries par, Pc,
  per-threat state, shield-clamp events.
- **Observation spec** (numeric vector) + **action space** (`coast` | `burn(dv[, dir])`),
  with a flag to expose raw geometry so the learner can choose direction (harder mode).
- **Reward module** (configurable): shaped (−Δv per burn, +Pc reduction, terminal ±resolved/collision)
  and sparse (terminal grade) variants.
- **Metrics module**: regret-vs-par, success, collision, unsafe, violation count, Δv, time.
- **Deterministic seed splits**: `train / val / test` via the seeded generator (no leakage).
- **Dataset exporter**: JSONL `{obs, oracle_action, oracle_reason, par, pc}` (reuses `simulation.log`).
- **Baseline registry**: oracle, random, null, heuristic, MLP-stub.
- **Repro CLI**: runs any policy over a split → scorecard + `leaderboard.json`.

**Key decision — runtime.** Recommend a **Python port of the engine core** (~few hundred lines of
vector math) as the primary substrate (Gymnasium/RL/LLM ecosystem is Python), validated by
**golden-parity tests against the JS `test/` values**. Keep the JS sim for the browser + E1.
(Alternative: stdio/websocket bridge to the JS sim — faster to stand up, slower at runtime.)

**Acceptance**
- Python env passes golden parity (TCA/miss/Pc/par within tol of JS tests).
- `optimal` baseline ≈ 1.0× regret; `random`/`null` clearly worse; **0 budget violations** for any.
- One command reproduces a scorecard from a fixed seed split.

**Output:** an installable env package (`pip`/`npm`) + a baselines table.

---

## A2 — Shielded / constrained-RL testbed  · effort S  · deps: Phase 0

**Goal:** a clean, lightweight benchmark for *safe RL* — the deterministic guard is a literal shield.

**Build**
- Make the shield **toggleable**; log every attempted-illegal/over-budget action (pre-clamp).
- Constrained-MDP framing: Δv as a cost budget; Pc/ring as the safety constraint.
- Baselines: PPO/SAC **with vs without** shield; report return, regret, **violation rate**, and
  "shielded exploration" sample efficiency.

**Acceptance:** shield drives violation rate to 0 while matching or beating unshielded return;
ablation table reproducible.

**Output:** short paper/report — *"a shielded-RL benchmark with an optimality oracle."*

---

## D1 — Verifiable synthetic dataset  · effort S  · deps: Phase 0

**Goal:** a citable dataset of conjunctions with *verifiable* labels.

**Build**
- Roll out the oracle over large seed batches → `{scenario, obs-trajectory, optimal action, Pc,
  par, reason}` with train/val/test splits.
- Datasheet (generation process, distributions, limitations) + loader.

**Acceptance:** dataset regenerates deterministically from seeds; a BC model trained on it
reaches < ~1.3× regret on held-out test.

**Output:** released dataset + datasheet; feeds A1/A3.

---

## A1 — Verifiable LM-agent environment  · effort M  · deps: Phase 0 (+ D1, D2)

**Goal:** an LM-agent benchmark whose differentiators are *oracle (regret), shield (safety),
and natural-language objectives (generalization)* — not "another gym."

**Build**
- **Instruction channel:** per-episode NL objectives ("protect the ally even at fuel cost",
  "minimize maneuvers", "respect this keep-out zone") → reward variants.
- Text obs serialization + JSON action protocol (reuse `/api/agent` + `llmPolicy`).
- Runner for local/hosted LMs across seeds; metrics: **regret vs par**, success, violation-attempts,
  **instruction-following score**, tokens/decision.
- **Distillation + RL hooks:** BC from oracle → small LM; GRPO/PPO fine-tune with sim reward
  (shield guarantees safe rollouts).

**Acceptance:** frontier LM, distilled small LM, MLP, and oracle all run on one held-out split with
a published leaderboard; instruction-generalization measured on unseen objectives.

**Output:** benchmark + leaderboard + baselines; paper on *instruction-conditioned, verifiable LM control.*

---

## E2 — Reasoning-faithfulness / calibration testbed  · effort S–M  · deps: Phase 0

**Goal:** exploit ground-truth *reasons* (the forecast numbers) to measure whether an LM's stated
rationale matches reality and whether its confidence is calibrated.

**Build**
- Expose per-decision ground-truth drivers (which threat, why, required Δv, Pc).
- Elicit LM `{action, rationale, confidence}`; score **faithfulness** (stated driver = true driver),
  **calibration** (ECE of confidence vs Pc/outcome), **action-rationale consistency**, and detect
  specification-gaming (good rationale, wrong action or vice-versa).

**Acceptance:** faithfulness/ECE computed automatically over a split; baselines (frontier vs small LM)
ranked; protocol documented.

**Output:** verifiable faithfulness benchmark + protocol.

---

## D2 — Adversarial / curriculum scenario generator  · effort S–M  · deps: Phase 0

**Goal:** generate *hard-but-solvable* scenarios for robust training/eval.

**Build**
- Difficulty controls (geometry, covariance, threat count, dynamics mode).
- **Adversarial search** for high-regret-inducing scenarios, filtered for solvability by the oracle.
- Optional generative (diffusion/VAE) scenario sampler, **solvability-filtered** by the sim.
- Curriculum schedules consumed by A1/A2 training.

**Acceptance:** generated sets are provably solvable (oracle resolves) yet drive baseline regret up;
curriculum improves a learner's test regret vs flat training.

**Output:** generator + curricula; strengthens A1/A2/A3.

---

## A3 — Classical-vs-learned control benchmark  · effort M  · deps: Phase 0 (+ D2)

**Goal:** a reproducible comparison of control paradigms on identical conjunction geometry.

**Build**
- Classical baselines: analytic (have it), **convex Δv optimization**, **MPC** (receding horizon),
  **LQR** for the CW/Hill mode.
- Standard suite across dynamics (linear, CW) × threat counts; report regret, violations, compute cost,
  robustness to noise/partial observability.

**Acceptance:** one harness produces the full comparison table; results reproducible from seeds.

**Output:** benchmark + analysis; situates learned methods against strong classical baselines.

---

## E1 — Generative-world × verifiable-physics  · effort L (moonshot)  · deps: Phase 0 + frame replay

**Goal:** study agents acting in a *non-deterministic, generated* world under deterministic physics —
the genuinely novel artifact (only DRIFT has the Reactor coupling).

**Build**
- **Frame capture & replay:** record Reactor sessions → an offline frame corpus (live Reactor is
  non-deterministic + rate-limited; research needs reproducibility). Optionally a lightweight
  surrogate world-model.
- **Perception channels:** numeric-state vs pixel-perception (incl. the existing luminance→power link).
- **Experiment grid / ablations:** deterministic backdrop vs generative; with/without world-model
  noise; numeric vs pixel obs; measure planning degradation and Pc/regret impact.

**Acceptance:** reproducible runs over the recorded corpus; quantified effect of generative perception
on control performance vs the numeric oracle.

**Output:** paper on *coupling generative world models with verifiable simulators.*

---

## Cross-cutting

- **Reproducibility:** every run = (seed split + config + code hash); configs in version control.
- **Packaging:** Gymnasium-compatible API; `pip` (Python core) + `npm` (JS sim); public leaderboard format.
- **Fidelity upgrades (optional, only where a track claims realism):** covariance *propagation*,
  3D/Monte-Carlo Pc validation (Foster/Chan/Alfano/Patera cross-check), real force models. Current
  2D Pc + static covariance is fine for *benchmark* purposes; flag clearly in datasheets.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Task too easy (oracle-solvable) → benchmark uninteresting | Push hardness into *generalization* (instructions), *constraints* (shield), *reasoning* (E2), and *curriculum/dynamics* (D2, CW, multi-threat) — not raw control |
| Benchmark adoption | Gymnasium API, public leaderboard, strong baselines, datasheet, clear metrics |
| E1 non-determinism/cost | Frame capture-and-replay corpus; surrogate world-model |
| Python/JS divergence | Golden-parity tests gate the port |
| Overclaiming realism | Datasheets state fidelity ceiling; realism upgrades are opt-in |

## Recommended sequence & milestones

1. **M1 — Substrate (Phase 0):** env + metrics + dataset exporter + baselines + leaderboard.
2. **M2 — A2 + D1:** shielded-RL ablation; released verifiable dataset. *(first publishable results)*
3. **M3 — A1 + E2:** LM-agent benchmark with instructions; faithfulness/calibration protocol.
4. **M4 — D2 + A3:** curriculum/adversarial generator; classical-vs-learned comparison.
5. **M5 — E1:** generative-world × verifiable-physics study. *(flagship paper)*
