"""Baseline benchmark + leaderboard CLI for the DRIFT research env.

Usage:
  python research/baselines.py [--split test|val|train] [--n N] [--out leaderboard.json]

Runs each registered policy over a held-out seed split via the headless sim and
prints a scorecard (headline metric: regret vs par). The deterministic guard
guarantees no policy exceeds the Δv budget, however badly it behaves.
"""

import argparse
import json
import os
import random
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))

from drift_env.simulation import Simulation
from drift_env.scenarios import splits
from drift_env.policies import optimal_policy, heuristic_policy, random_policy, null_policy
from drift_env.metrics import aggregate


def registry():
    rng = random.Random(7)
    return {
        "optimal": lambda: optimal_policy(),
        "heuristic": lambda: heuristic_policy(1.2),
        "random": lambda: random_policy(rng.random),
        "null": lambda: null_policy(),
    }


def run_policy_over(scenarios, make_policy, max_time=80.0):
    results = []
    for sc in scenarios:
        results.append(Simulation(scenario=sc, policy=make_policy()).run(max_time))
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test", choices=["train", "val", "test"])
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "leaderboard.json"))
    args = ap.parse_args()

    all_splits = splits(n_train=args.n, n_val=args.n, n_test=args.n)
    scenarios = all_splits[args.split]

    board = {}
    for name, make in registry().items():
        agg = aggregate(run_policy_over(scenarios, make))
        board[name] = agg

    # scorecard
    cols = ["policy", "success", "regret", "collisions", "unsafe", "mean Δv", "violations", "over-budget"]
    rows = [cols]
    for name, a in board.items():
        rows.append([
            name, f"{a['success_pct']}%", (f"{a['mean_regret']}x" if a["mean_regret"] is not None else "—"),
            str(a["collisions"]), str(a["unsafe"]), f"{a['mean_dv']}", str(a["violations"]), str(a["over_budget"]),
        ])
    w = [max(len(r[c]) for r in rows) for c in range(len(cols))]
    print(f"\nDRIFT research env — baseline scorecard  (split={args.split}, n={len(scenarios)})\n")
    for r in rows:
        print("  " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
    print("\nheadline metric = regret (Δv_used / par). guard-enforced budget = 12 m/s.\n")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"split": args.split, "n": len(scenarios), "results": board}, f, indent=2)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
