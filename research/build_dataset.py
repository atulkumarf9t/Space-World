"""D1 — build & document the verifiable DRIFT dataset.

Generates deterministic train/val/test splits (disjoint seed ranges), exports oracle
rollouts to JSONL with verifiable labels, writes a manifest (counts + sha256) and a
DATASHEET. Everything regenerates byte-for-byte from seeds.

Run: python research/build_dataset.py [--train 600 --val 100 --test 100]
"""

import argparse
import hashlib
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))

from drift_env.scenarios import generate_batch
from drift_env.dataset import export, load

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SEED_BASE = {"train": 1_000, "val": 100_000, "test": 900_000}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def stats(rows):
    n = len(rows)
    burns = [r for r in rows if r["action_type"] == "burn"]
    dvs = [r["action_dv"] for r in burns]
    pcs = [r["worst_pc"] for r in rows if r["worst_pc"] > 0]
    return {
        "rows": n,
        "burn_fraction": round(len(burns) / n, 3) if n else 0,
        "mean_burn_dv": round(sum(dvs) / len(dvs), 3) if dvs else 0,
        "max_burn_dv": round(max(dvs), 3) if dvs else 0,
        "mean_active_pc": round(sum(pcs) / len(pcs), 5) if pcs else 0,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", type=int, default=600)
    ap.add_argument("--val", type=int, default=100)
    ap.add_argument("--test", type=int, default=100)
    args = ap.parse_args()
    sizes = {"train": args.train, "val": args.val, "test": args.test}
    os.makedirs(DATA_DIR, exist_ok=True)

    manifest = {"splits": {}, "seed_base": SEED_BASE, "obs_dim": 7,
                "schema": ["split", "scenario", "seed", "step", "obs[7]", "action_type",
                           "action_dv", "worst_target", "worst_pc", "worst_miss",
                           "worst_tca", "needs_burn", "par"]}
    print(f"\nBuilding DRIFT dataset → {DATA_DIR}\n")
    for split, n in sizes.items():
        scen = generate_batch(n, SEED_BASE[split])
        path = os.path.join(DATA_DIR, f"{split}.jsonl")
        meta = export(scen, path, split=split)
        st = stats(load(path))
        manifest["splits"][split] = {
            "file": f"{split}.jsonl", "scenarios": n, "rows": meta["rows"],
            "seeds": f"{SEED_BASE[split]}..{SEED_BASE[split] + n - 1}",
            "sha256": sha256(path), **st,
        }
        print(f"  {split:5s}: {n} scenarios, {meta['rows']:6d} rows, "
              f"burn {st['burn_fraction']*100:.0f}%, mean burn Δv {st['mean_burn_dv']}")

    with open(os.path.join(DATA_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    write_datasheet(manifest)
    print(f"\nwrote manifest.json + DATASHEET.md (splits disjoint by seed; regenerates deterministically)\n")


def write_datasheet(manifest):
    m = manifest["splits"]
    rows = "\n".join(
        f"| {s} | {m[s]['scenarios']} | {m[s]['rows']} | `{m[s]['seeds']}` | {m[s]['burn_fraction']*100:.0f}% | `{m[s]['sha256'][:12]}…` |"
        for s in ["train", "val", "test"])
    doc = f"""# DRIFT Conjunction Dataset — Datasheet

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
{rows}

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
"""
    with open(os.path.join(DATA_DIR, "DATASHEET.md"), "w", encoding="utf-8") as f:
        f.write(doc)


if __name__ == "__main__":
    main()
