# DRIFT: A Verifiable, Oracle-Backed, Shielded Environment for Agent / LLM Research in Spacecraft Collision Avoidance

**Technical report — v0.1**

## Abstract
DRIFT is a lightweight decision environment built on a deterministic spacecraft
conjunction-avoidance simulator. Its differentiators are the three ingredients most agent
benchmarks lack together: a **verifiable, dense reward** (least-Δv to resolve a conjunction),
an **analytic optimality oracle** (so we report *regret vs par*, not just success), and a
**deterministic safety shield** (hard constraints that hold under any policy). On top of these we
implement and verify seven research tracks spanning learned control, instruction following,
safe-RL, control-paradigm comparison, dataset release, curriculum generation, reasoning
faithfulness, and a generative-world coupling study. A Python port of the engine is **numerically
identical** to the JavaScript reference (golden parity), making every result reproducible from seeds.

## 1. The substrate
- **Physics.** Relative-motion conjunction model with closed-form time-of-closest-approach and
  miss distance, plus a short-term **probability of collision (Pc)** in the B-plane from each
  object's covariance (validated against Monte-Carlo, 0.1047 vs 0.1041). Optional Clohessy–Wiltshire
  curved dynamics (reduces to linear at n=0, tested).
- **Oracle / par.** Least Δv to bring Pc below threshold *and* clear the safe ring — the regret
  denominator.
- **Shield.** A deterministic guard validates actions and enforces the Δv budget before anything
  touches the craft.
- **Reward.** Shaped (−Δv per step, ±terminal) or sparse (terminal par/Δv).
- **Parity.** 11/11 cross-language tests (RNG, scenarios, TCA/miss/Pc, par, full rollouts).

**Headline metric: regret = Δv_used / par** (optimality gap). Plus violation-rate (safety),
ECE (calibration), faithfulness (reasoning), compliance (instruction following).

## 2. Results (held-out seeds unless noted)

### 2.1 Baselines & learned control
| policy | success | regret | over-budget |
|---|---|---|---|
| optimal | 100% | 1.06× | 0 |
| PPO (warm-start + fine-tune) | 100% | 1.48× | 0 |
| BC (from D1 dataset) | 100% | 1.59× | 0 |
| heuristic | 100% | 2.27× | 0 |
| random | 90% | 2.88× | 0 |
| null | 69% | — | 0 |

Learned policies (BC/PPO) resolve every held-out encounter near par; the guard holds budget for all.

### 2.2 A1 — instruction following (compliance %)
| instruction | follower / text-agent | blind (ignores it) |
|---|---|---|
| protect_ally (≥0.8 km) | 78% | 26% |
| conserve_fuel | 94% | 68% |

The benchmark discriminates instruction-following; a text-agent that reads the instruction matches
the oracle follower.

### 2.3 A2 — shielded-RL ablation
| policy | shield | budget violations | NaN-corrupted |
|---|---|---|---|
| over-burner | ON / OFF | 0 / 50 | 0 / 0 |
| nan-emitter | ON / OFF | 0 / 0 | 0 / 6 |

The shield guarantees budget and validity under reckless policies.

### 2.4 A3 — classical vs learned (linear dynamics)
| controller | regret | ms/episode |
|---|---|---|
| analytic | 1.05× | 63 |
| mpc (sampling RH) | 1.64× | 63 |
| bc (learned) | 2.00× | 73 |
| random | 4.08× | 67 |

### 2.5 D2 — curriculum + adversarial
Difficulty raises par 3.30→6.33 with graceful solvability decay (100%→70%); adversarial mining
drives a weak policy's regret to 8.53× (vs 1.14× random) while staying 100% oracle-solvable.

### 2.6 E2 — reasoning faithfulness & calibration
| agent | faithfulness | ECE |
|---|---|---|
| faithful | 100% | 0.08 |
| misattributing | 0% | 0.06 |
| overconfident | 100% | 0.28 |

Faithfulness and calibration are shown to be **independent axes** (a calibrated-in-aggregate agent
can still be 0% faithful on the decisions that matter).

### 2.7 E1 — generative-world coupling
| condition | success | regret |
|---|---|---|
| full power | 100% | 1.06× |
| eclipse (world dims thrust) | 100% | 1.12× |
| eclipse + noisy perception | 95% | 1.20× |

An anticipating agent absorbs known dimming; imperfect perception of the world is what breaks
safety. A capture→replay pipeline drives the study from recorded Reactor luminance.

## 3. Dataset (D1)
26.6k labeled decisions (train/val/test, disjoint seeds) of obs → optimal action + ground-truth
drivers (worst target, Pc, miss, TCA, par). Regenerable from seeds; sha256 manifest + datasheet in
`data/`.

## 4. Limitations
2D B-plane Pc with static covariance, impulsive Δv, game-tuned budget. **Correct for benchmarking,
not flight operations.** The pixel-level E1 study needs a live recording session (see
`E1_frame_pipeline.md`). CW dynamics needs CW-tuned threat geometry for informative results.

## 5. Reproducibility
`pip install -e .` then `python run_all.py` reproduces all of the above (parity + env gates, then
every benchmark). Results are deterministic in their seeds.

## Cite
> DRIFT: A Verifiable, Oracle-Backed, Shielded Environment for Spacecraft Collision-Avoidance
> Agent Research. v0.1, 2026.
