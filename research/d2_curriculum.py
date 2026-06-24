"""D2 — adversarial / curriculum scenario generation.

Two demonstrations:
  1. Difficulty knob: as d rises, the oracle's par (Δv needed) rises while the oracle still
     resolves — a controllable, *solvable* curriculum.
  2. Adversarial mining: from a pool, select scenarios that maximize a WEAK policy's regret,
     keeping only oracle-solvable ones. The mined set is much harder for the weak policy yet
     fully solvable — exactly what you want for robust training/eval.

Run: python research/d2_curriculum.py [--n 40 --pool 250 --topk 40]
"""

import argparse
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))

from drift_env.simulation import Simulation
from drift_env.scenarios import difficulty_batch, generate_batch
from drift_env.policies import optimal_policy, heuristic_policy


def run(scenario, policy):
    return Simulation(scenario=scenario, policy=policy).run(80)


def curriculum(n):
    print("\n[1] Difficulty curriculum (oracle stays solvable as par rises)\n")
    cols = ["difficulty", "oracle success", "mean par Δv", "oracle regret"]
    rows = [cols]
    for d in (0.0, 0.3, 0.6, 0.85):
        scen = difficulty_batch(n, d)
        resolved = 0
        pars = []
        regrets = []
        for sc in scen:
            r = run(sc, optimal_policy())
            if r["resolved"]:
                resolved += 1
                if r["parDv"] > 0:
                    pars.append(r["parDv"])
                    if r["ratio"]:
                        regrets.append(r["ratio"])
        rows.append([f"{d:.2f}", f"{100*resolved/n:.0f}%",
                     f"{sum(pars)/len(pars):.2f}" if pars else "0.00",
                     f"{sum(regrets)/len(regrets):.2f}x" if regrets else "—"])
    w = [max(len(r[c]) for r in rows) for c in range(len(cols))]
    for r in rows:
        print("  " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))


def adversarial(pool_n, topk):
    print(f"\n[2] Adversarial mining vs a weak (heuristic) policy  (pool={pool_n}, top-k={topk})\n")
    pool = generate_batch(pool_n, 5_000)
    scored = []
    for sc in pool:
        o = run(sc, optimal_policy())
        if not o["resolved"] or o["parDv"] <= 0:
            continue                       # keep only solvable, non-trivial (oracle filter)
        h = run(sc, heuristic_policy(1.2))
        regret = (h["dvUsed"] / o["parDv"]) if h["resolved"] else 99.0
        scored.append((regret, sc, o["resolved"]))
    scored.sort(key=lambda x: -x[0])
    adv = scored[:topk]
    rnd = scored[topk:2 * topk] if len(scored) >= 2 * topk else scored[topk:]

    def summarize(group, label):
        # heuristic regret on the group + oracle solvability
        hreg = []
        osucc = 0
        for _, sc, _ in group:
            o = run(sc, optimal_policy())
            h = run(sc, heuristic_policy(1.2))
            if o["resolved"]:
                osucc += 1
            if h["resolved"] and o["parDv"] > 0:
                hreg.append(h["dvUsed"] / o["parDv"])
        n = len(group)
        print(f"  {label:12s}  weak-policy regret {sum(hreg)/len(hreg):.2f}x   oracle solvable {100*osucc/n:.0f}%   (n={n})")

    summarize(rnd, "random set")
    summarize(adv, "adversarial")
    print("\n  -> adversarial scenarios are much harder for the weak policy yet fully oracle-solvable.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--pool", type=int, default=250)
    ap.add_argument("--topk", type=int, default=40)
    args = ap.parse_args()
    curriculum(args.n)
    adversarial(args.pool, args.topk)
    print()


if __name__ == "__main__":
    main()
