# DRIFT — Research Substrate (Phase 0)

A headless, deterministic, **golden-parity** Python port of the DRIFT conjunction engine,
wrapped as a Gymnasium-style environment with a verifiable reward, an optimality oracle, a
safety guard, dataset export, and a baseline benchmark. This is the keystone that unlocks the
research tracks (A1 LM-agent env, A2 shielded-RL, A3 classical-vs-learned, D1 dataset,
D2 curriculum, E2 faithfulness).

## Install & reproduce
```
cd research
pip install -e .            # core (pure stdlib); or:  pip install -e ".[all]"  (numpy+torch+gymnasium)
python run_all.py           # one command: parity + env gates, then every benchmark (--full for big n)
```
Gymnasium (optional):
```python
import gymnasium as gym, drift_env          # importing drift_env registers the ids
env = gym.make("Drift-v0")                   # or "DriftInstruct-Protect-v0" / "DriftInstruct-Conserve-v0"
obs, info = env.reset(seed=1234)
obs, reward, terminated, truncated, info = env.step([0.4])
```

## Why it's trustworthy: cross-language parity
The Python core is verified **numerically identical** to the JS engine (RNG, scenarios,
TCA/miss/Pc, par, and full optimal rollouts):

```
node research/gen_ref.mjs       # emit reference values from the JS engine
python research/test_parity.py  # 11/11: Python matches JS to fp tolerance
```

## Quick start
```
python research/test_parity.py            # cross-language parity
python research/test_env.py               # env / dataset / guard smoke tests
python research/baselines.py --split test --n 120   # scorecard + leaderboard.json
```
Example scorecard (test split, n=120):

| policy | success | regret (Δv/par) | unsafe | over-budget |
|---|---|---|---|---|
| optimal | 100% | **1.06×** | 0 | 0 |
| heuristic | 100% | 2.27× | 0 | 0 |
| random | 90% | 2.88× | 12 | 0 |
| null | 69% | — | 37 | 0 |

The **headline metric is regret vs par** (optimality gap). The deterministic guard holds the
12 m/s budget for *every* policy (0 over-budget, even random).

## The environment (Gymnasium API)
```python
from drift_env.env import DriftEnv
from drift_env.scenarios import generate_scenario

env = DriftEnv(scenario_fn=generate_scenario, reward="shaped")  # or reward="sparse"
obs, info = env.reset(seed=1234)
obs, reward, terminated, truncated, info = env.step([0.4])       # scalar Δv (0 = coast)
# info carries: par, dvUsed, status, regret, violations, instruction
```
- **Observation** (7-d, normalized): worst-threat Pc, miss, TCA, recommended Δv, budget left, Δv used, power.
- **Action**: scalar Δv (burn in the optimal avoidance direction), or set `full_direction=True` for a 3-vector.
- **Reward**: `shaped` (dense: −Δv per step, ±terminal) or `sparse` (terminal par/Δv).
- **Safety guard**: every action is validated/clamped; out-of-bounds attempts increment `violations`.
- **Instruction hook**: `DriftEnv(..., instruction="protect the ally even at fuel cost")` (A1).

## Files
```
research/
  drift_env/
    rng.py scenarios.py     # seeded PRNG + scenario generator (byte-parity with JS)
    dynamics.py physics.py  # CW dynamics + conjunction engine (TCA/miss/Pc/par/oracle)
    flight.py simulation.py # EP flight model + headless core + safety guard
    policies.py             # optimal / heuristic / random / null
    env.py reward.py metrics.py   # Gym env, reward fns, regret metrics
    dataset.py              # JSONL behavior-cloning exporter (D1)
  baselines.py              # benchmark CLI -> scorecard + leaderboard.json
  gen_ref.mjs test_parity.py test_env.py
  data/bc_train.jsonl       # example oracle dataset (obs -> optimal action + labels)
```

## Training example (BC + PPO end-to-end)
```
python research/train.py --ppo-updates 40 --eval-n 60
```
- **BC**: a small torch MLP cloned from the oracle dataset (obs → Δv).
- **PPO**: from-scratch clipped PPO (torch) on the env reward, oracle-warm-started and
  fine-tuned, with validation model-selection.

Held-out test split (seeds 900000+, disjoint from train/val), headline = regret (Δv/par):

| policy | success | regret | unsafe | violations | over-budget |
|---|---|---|---|---|---|
| oracle | 100% | 1.06× | 0 | 0 | 0 |
| **ppo** | **100%** | **1.48×** | 0 | 0 | 0 |
| **bc** | **100%** | **1.59×** | 0 | 0 | 0 |
| random | 93% | 2.86× | 4 | — | 0 |

Both learned policies resolve every held-out encounter near par; the guard holds the budget
for all (0 over-budget). Demonstrates the full loop: dataset → BC → PPO → benchmark vs oracle.

## A1 — instruction-following benchmark
```
python research/a1_benchmark.py --n 50
```
Per-episode natural-language objectives change the *optimal* behavior; the headline metric
is **compliance %** (did the trajectory obey the instruction?). `drift_env/instructions.py`
defines them; an LLM receives the `text` and is scored on the same metric.

| instruction | follower / text-agent | blind (ignores it) |
|---|---|---|
| protect_ally ("≥0.8 km clear") | **78%** compliance, ally clr 0.85 km | 26%, 0.70 km |
| conserve_fuel ("burn only if needed") | **94%** compliance, 0.39 m/s | 68%, 0.97 m/s |

The `text-agent` (parses the instruction text → behavior) matches the `follower` oracle exactly,
proving the text→action pipeline; `blind` shows the benchmark **discriminates** instruction-following.

## E2 — reasoning-faithfulness & calibration
```
python research/e2_faithfulness.py --n 80
```
The env exposes the **ground-truth drivers** of every decision (true worst threat, whether a burn
is needed, its Pc), so an agent's *stated reasoning* can be scored, not just its action. The oracle
drives a fixed correct trajectory; each agent is *queried* on the same situations.

| agent | faithfulness | action-consistency | ECE (cal.) |
|---|---|---|---|
| faithful | **100%** | 100% | **0.08** |
| misattributing | **0%** | 100% | 0.06 |
| overconfident | 100% | 71% | **0.28** |
| random | 53% | 51% | 0.50 |

- **Faithfulness** (claimed threat == true worst) cleanly separates the faithful agent from the
  misattributing one (100% vs 0%) — note the latter is still *calibrated* in aggregate, showing
  faithfulness and calibration are **independent axes** (the whole point of E2).
- **ECE** separates well-calibrated (0.08) from overconfident (0.28).
- A real LLM emits `{claimed_target, action, confidence}` (+ rationale) and is scored identically.

## A3 — classical-vs-learned control benchmark
```
python research/a3_benchmark.py --n 40
```
Same conjunction geometry, different control paradigms (linear dynamics, regret = Δv/par):

| controller | success | regret | mean Δv | ms/episode |
|---|---|---|---|---|
| analytic (closed-form min-Δv) | 100% | **1.05×** | 0.70 | 63 |
| mpc (sampling receding-horizon) | 100% | 1.64× | 0.73 | 63 |
| bc (learned, from D1) | 100% | 2.00× | 0.74 | 73 |
| p-control (proportional feedback) | 75% | — | 0.79 | 83 |
| random | 95% | 4.08× | 0.94 | 67 |

Analytic is optimal; MPC trades a little regret (grid quantization) for not needing the closed
form; BC generalizes but loosely; pure feedback under-resolves. *(CW dynamics needs CW-tuned
threat geometry — the linear scenarios self-resolve under curvature; a D2 follow-up.)*

## E1 — generative-world × verifiable-physics coupling
```
python research/e1_coupling.py --n 60
```
The generative world couples to control through one channel: scene brightness → solar power →
thrust authority. We model it headlessly (same analytic agent throughout, so degradation is the
world's fault, not the controller's):

| condition | success | unsafe | regret | mean Δv |
|---|---|---|---|---|
| A — full power | 100% | 0 | 1.06× | 0.98 |
| B — eclipse (world dims thrust) | 100% | 0 | 1.12× | 1.09 |
| C — eclipse + noisy perception | 95% | 3 | 1.20× | 1.25 |

Finding: an *anticipating* agent absorbs known dimming (B costs ~6% more Δv but stays safe);
**imperfect perception** of the world is what breaks safety (C).

**Capture-replay pipeline (implemented):** run the app with `?record=1` to record a real Reactor
corpus (`src/reactor_record.js` → floating REC panel + Download), then replay it:
```
python research/e1_coupling.py --corpus <recorded.jsonl>   # power driven by recorded luminance
```
`drift_env/corpus.py` loads the corpus; verified end-to-end. See [E1_frame_pipeline.md](E1_frame_pipeline.md).

**Pixel-policy scaffold** (open-loop pixel-vs-numeric comparison):
```
python research/train_pixel.py --synth 600        # smoke test (CNN learns: val MSE 0.0008, 100%)
python research/train_pixel.py --corpus rec.jsonl # train CNN(frame)→Δv vs MLP(numeric)→Δv on a real corpus
```
The recorder logs `dv` (BC label) + a numeric `nobs` per frame, so a frame-conditioned CNN and a
clean-state MLP are trained on the *same* target — quantifying the perception gap once a real
Reactor corpus is captured.

## D2 — adversarial / curriculum generator
```
python research/d2_curriculum.py --n 40 --pool 150 --topk 30
```
A difficulty knob and an adversarial miner (oracle = solvability filter):

| difficulty | oracle success | mean par Δv |
|---|---|---|
| 0.00 | 100% | 3.30 |
| 0.30 | 98% | 4.19 |
| 0.60 | 90% | 5.59 |
| 0.85 | 70% | 6.33 |

| set | weak-policy regret | oracle-solvable |
|---|---|---|
| random | 1.14× | 100% |
| **adversarial (mined)** | **8.53×** | 100% |

Difficulty raises required Δv with graceful solvability decay; mining finds **hard-but-solvable**
scenarios that break the weak policy while the oracle still resolves them — ideal for robust
training/eval curricula.

## D1 — verifiable dataset release
```
python research/build_dataset.py --train 500 --val 100 --test 100
```
Deterministic train/val/test splits (disjoint seed ranges) of oracle rollouts with verifiable
labels — obs, optimal Δv, and ground-truth drivers (worst target, Pc, miss, TCA, par). Ships
`data/{train,val,test}.jsonl`, `data/manifest.json` (counts + sha256), and `data/DATASHEET.md`.

| split | scenarios | rows | seeds |
|---|---|---|---|
| train | 500 | 18,981 | 1000..1499 |
| val | 100 | 3,819 | 100000..100099 |
| test | 100 | 3,858 | 900000..900099 |

Regenerates byte-for-byte from seeds. Used by the BC trainer (`train.py`) and the E2 testbed.

## A2 — shielded-RL ablation
```
python research/a2_ablation.py --n 50
```
The env's deterministic safety layer ("shield") validates actions and enforces the Δv budget.
Toggling it off shows what it buys — reckless/exploratory policies break constraints; with the
shield, they never can:

| policy | shield | budget violations | NaN-corrupted | success | mean Δv |
|---|---|---|---|---|---|
| over-burner (runaway thrust) | **ON** | **0** | 0 | 92% | 12.0 |
| over-burner | OFF | **50/50** | 0 | 94% | 30.4 |
| nan-emitter (garbage actions) | **ON** | 0 | **0** | 100% | 1.15 |
| nan-emitter | OFF | 0 | **6** | 88% | 0.32 |
| random | ON/OFF | 0 | 0 | ~90% | ~1.0 |

Safe-RL value proposition: strategy can come from anywhere (an untrained net, an LLM); the shield
guarantees the budget is never exceeded and invalid actions never corrupt the sim.

## What this unlocks
- **A2 shielded-RL:** `violations` + a guard toggle = a safe-RL benchmark with an oracle.
- **A1 LM-agent:** structured obs + JSON actions + the `instruction` channel + regret metric.
- **D1 dataset:** `dataset.export(...)` already produces verifiable (obs → optimal action) data.
- **D2 curriculum:** `scenarios.generate_*` + the oracle as a solvability filter.
- **E2 faithfulness:** `info` exposes ground-truth drivers (worst target, Pc, par) to score rationales.

## Notes
- Pure-Python core (stdlib); numpy used only to vectorize the Pc grid (with a pure fallback) — parity preserved.
- Gymnasium is optional; the env matches its API and uses `Box` spaces if installed.
- Fidelity: 2D B-plane Pc + static covariance — correct for *benchmarking*, not flight operations (see RESEARCH_ROADMAP.md).
