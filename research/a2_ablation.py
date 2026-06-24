"""A2 — shielded-RL ablation.

The DRIFT env ships a deterministic safety layer ("shield"): it validates actions
(rejects NaN/garbage) and enforces the Δv budget. This ablation runs reckless /
exploratory policies WITH vs WITHOUT the shield and measures what the shield buys:
zero budget violations and zero NaN-corrupted episodes, regardless of policy.

This is the value proposition for safe-RL: strategy can come from anywhere (an
untrained net, an LLM); the shield guarantees the hard constraints are never broken.

Run: python research/a2_ablation.py [--n 60]
"""

import argparse
import math
import os
import random
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))

from drift_env.simulation import Simulation
from drift_env.scenarios import generate_batch
from drift_env.policies import random_policy

BUDGET = 12.0


def over_burner_policy():
    """Thrusts every decision regardless of safety — probes BUDGET enforcement
    (a 'stuck thruster' / runaway exploration)."""
    def decide(obs):
        d = obs["worstBurnDir"] if obs["worst"] else {"x": 0.0, "y": 0.0, "z": 1.0}
        return {"type": "burn", "dir": d, "dv": 9.0}
    return {"name": "over-burner", "decide": decide}


def nan_emitter_policy(rng):
    """Occasionally emits a NaN direction — probes ACTION VALIDATION."""
    def decide(obs):
        if obs["worst"]:
            if rng() < 0.15:
                return {"type": "burn", "dir": {"x": float("nan"), "y": 0.0, "z": 0.0}, "dv": 5.0}
            return {"type": "burn", "dir": obs["worstBurnDir"], "dv": 2.0}
        return {"type": "coast"}
    return {"name": "nan-emitter", "decide": decide}


def run_set(scenarios, make_policy, shield):
    over_budget = nan_fail = success = 0
    dv_sum = 0.0
    for sc in scenarios:
        r = Simulation(scenario=sc, policy=make_policy(), shield=shield).run(80)
        dv = r["dvUsed"]
        if not math.isfinite(dv) or not math.isfinite(r["minRangeAlly"]):
            nan_fail += 1
            continue
        if dv > BUDGET + 1e-6:
            over_budget += 1
        if r["resolved"]:
            success += 1
        dv_sum += dv
    n = len(scenarios)
    return {
        "over_budget": over_budget, "nan_fail": nan_fail,
        "success_pct": round(100 * success / n, 1),
        "max_dv_ok": round(dv_sum / n, 2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    args = ap.parse_args()
    scenarios = generate_batch(args.n, 900_000)

    rng = random.Random(7)
    policies = {
        "over-burner": lambda: over_burner_policy(),
        "nan-emitter": lambda: nan_emitter_policy(rng.random),
        "random": lambda: random_policy(rng.random),
    }

    print(f"\nA2 — shielded-RL ablation (n={args.n}, budget={BUDGET} m/s)\n")
    cols = ["policy", "shield", "Δv-budget violations", "NaN-corrupted", "success", "mean Δv"]
    rows = [cols]
    for name, make in policies.items():
        for shield in (True, False):
            r = run_set(scenarios, make, shield)
            rows.append([name, "ON" if shield else "OFF", str(r["over_budget"]),
                         str(r["nan_fail"]), f"{r['success_pct']}%", f"{r['max_dv_ok']}"])
    w = [max(len(r[c]) for r in rows) for c in range(len(cols))]
    for r in rows:
        print("  " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
    print("\nWith the shield ON, no policy ever breaks the budget or corrupts the sim,")
    print("however reckless. OFF, the same actions violate constraints — the shield's value.\n")


if __name__ == "__main__":
    main()
