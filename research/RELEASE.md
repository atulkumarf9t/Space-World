# DRIFT research substrate — release contents

A verifiable, oracle-backed, shielded conjunction-avoidance environment for agent / LLM / RL
research. Everything regenerates deterministically from seeds.

## What's in here
| path | contents |
|---|---|
| `drift_env/` | the package (engine, env, policies, instructions, dynamics, dataset, corpus, gym adapter) |
| `pyproject.toml` · `requirements.txt` | install (`pip install -e .` or `.[all]`) |
| `run_all.py` | one command: parity + env gates, then every benchmark |
| `REPORT.md` | technical report tying all results together |
| `README.md` | usage + per-track commands and result tables |
| `RESEARCH_ROADMAP.md` (repo root) | the full plan + status |
| `data/{train,val,test}.jsonl` | D1 dataset (26.6k labeled decisions) |
| `data/manifest.json` · `data/DATASHEET.md` | dataset checksums + datasheet |
| `results/leaderboard.json` | baseline scorecard (machine-readable) |
| benchmarks | `baselines.py a1_benchmark.py a2_ablation.py a3_benchmark.py d2_curriculum.py e1_coupling.py e2_faithfulness.py` |
| training | `train.py` (BC + PPO), `train_pixel.py` (pixel-policy scaffold) |
| tests | `test_parity.py test_env.py` + `gen_ref.mjs` |
| E1 pipeline | `E1_frame_pipeline.md`, `../src/reactor_record.js` (capture), `drift_env/corpus.py` (replay) |

## Quick start
```
cd research
pip install -e ".[all]"
python run_all.py            # reproduce everything (--full for big n)
```
Gymnasium: `import drift_env; gym.make("Drift-v0")` (also `DriftInstruct-Protect-v0`, `-Conserve-v0`).

## Headline numbers (held-out seeds)
optimal 1.06× regret · PPO 1.48× · BC 1.59× · shield → 0 violations · A1 compliance 78–94% vs
26–68% blind · E2 faithfulness 100% vs 0% · D2 adversarial 8.5× vs 1.1× regret. Full tables in
`REPORT.md`.

## Limitations
Benchmark-fidelity (2D Pc, static covariance, impulsive Δv) — not flight-operational. See REPORT §4.

## License
MIT. Dataset regenerable from seeds; redistribute freely.

## Cite
DRIFT: A Verifiable, Oracle-Backed, Shielded Environment for Spacecraft Collision-Avoidance Agent
Research. v0.1, 2026.
