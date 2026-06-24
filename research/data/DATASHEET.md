# DRIFT Conjunction Dataset — Datasheet

## Motivation
Verifiable supervised/offline-RL data for spacecraft collision avoidance: each row pairs an
observation with the **analytically optimal** least-Δv maneuver and ground-truth conjunction
labels. Labels are produced by the DRIFT engine's oracle (no human annotation); the engine is
**golden-parity tested** against its JS reference.

## Composition (one row per agent decision)
| field | meaning |
|---|---|
| `obs[7]` | normalized features: worst-threat Pc, miss/10, tca/45, recommendedΔv/budget, budgetLeft/budget, ΔvUsed/budget, power |
| `action_type`, `action_dv` | oracle action: `coast` or `burn` of `action_dv` m/s (optimal direction is implicit = avoidance direction) |
| `worst_target`, `worst_pc`, `worst_miss`, `worst_tca` | ground-truth drivers of the decision |
| `needs_burn` | whether a maneuver is required this step |
| `par` | least Δv to resolve the encounter (regret denominator) |
| `split`, `scenario`, `seed`, `step` | provenance |

## Splits (disjoint seed ranges — no leakage)
| split | scenarios | rows | seeds | burn rows | sha256 |
|---|---|---|---|---|---|
| train | 500 | 18981 | `1000..1499` | 5% | `6a1ae4360665…` |
| val | 100 | 3819 | `100000..100099` | 4% | `92202e6c1611…` |
| test | 100 | 3858 | `900000..900099` | 4% | `046b67855ba0…` |

## Collection process
Scenarios are sampled by a seeded PRNG (`generate_batch`). For each, the oracle policy is rolled
out at 1 Hz decisions / 8 Hz physics; every decision is logged. Fully deterministic: regenerate via
`python research/build_dataset.py`.

## Recommended uses
- **Behavior cloning** (obs → Δv) and **offline RL** baselines.
- **E2 reasoning-faithfulness**: the `worst_*` fields are the ground-truth decision drivers.
- Train/val for instruction-conditioned agents (A1).

## Limitations / fidelity ceiling
2D B-plane Pc with static covariance, impulsive Δv, straight-line (or CW) relative motion, and
game-tuned budget. Correct for **benchmarking**, **not** flight operations. Do not use for
operational conjunction assessment.

## License
MIT (same as the project). Regenerable from seeds; redistribute freely.
