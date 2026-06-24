"""A1 LM-agent benchmark — instruction-following under verifiable physics.

For each natural-language instruction we compare:
  - follower : reads the instruction (optimizes the instructed objective)  [oracle upper bound]
  - text-agent: parses the instruction TEXT by keyword, then acts (the LM stand-in)
  - blind    : ignores the instruction (optimizes the default objective)
  - random   : control
The headline A1 metric is COMPLIANCE % (did the trajectory obey the instruction?).
A good instruction-following agent matches `follower`; `blind` reveals the benchmark
discriminates instruction-following (low compliance on non-default instructions).

A real LLM slots in as another policy: it receives `instruction text + observation`
(via env.info['instruction'] / the /api/agent contract) and emits actions; it is scored
on the same compliance metric.

Run: python research/a1_benchmark.py [--n 60]
"""

import argparse
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))

from drift_env.physics import Physics
from drift_env.simulation import Simulation
from drift_env.scenarios import generate_batch
from drift_env.policies import optimal_policy, random_policy
from drift_env.instructions import INSTRUCTIONS, apply


def base_par(scenario):
    p = Physics()
    p.arm(scenario)            # default objective
    return p.parDv


def run(scenario, policy):
    return Simulation(scenario=scenario, policy=policy).run(80)


def keyword_text_agent(text):
    """A trivial 'LM' that reads the instruction text and chooses behavior by keyword.
    Stand-in proving the text->action pipeline; a real LLM replaces this."""
    t = text.lower()
    if "1.0 km" in t or "protect the ally" in t:
        return "protect_ally"
    if "conserve" in t or "least maneuver" in t or "only maneuver if" in t:
        return "conserve_fuel"
    return "default"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    args = ap.parse_args()
    scenarios = generate_batch(args.n, 900_000)  # held-out test seeds
    bpar = [base_par(sc) for sc in scenarios]

    print(f"\nA1 — instruction-following benchmark (n={args.n}, held-out seeds)\n")
    for iid, spec in INSTRUCTIONS.items():
        comply = spec["compliance"]
        print(f'  [{iid}]  "{spec["text"]}"')

        agents = {
            "follower":   ("inst", optimal_policy),
            "text-agent": ("text", optimal_policy),
            "blind":      ("none", optimal_policy),
            "random":     ("none", random_policy),
        }
        rows = [["agent", "compliance", "success", "mean Δv", "ally clr"]]
        for name, (cond, make) in agents.items():
            comp = succ = dv = ally = 0
            for sc, bp in zip(scenarios, bpar):
                if cond == "inst":
                    use = apply(iid, sc)
                elif cond == "text":
                    use = apply(keyword_text_agent(spec["text"]), sc)
                else:
                    use = sc
                r = run(use, make())
                if comply(r, bp):
                    comp += 1
                if r["resolved"]:
                    succ += 1
                dv += r["dvUsed"]
                ally += r["minRangeAlly"]
            n = len(scenarios)
            rows.append([name, f"{100*comp/n:.0f}%", f"{100*succ/n:.0f}%", f"{dv/n:.2f}", f"{ally/n:.2f}"])
        w = [max(len(r[c]) for r in rows) for c in range(len(rows[0]))]
        for r in rows:
            print("    " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
        print()
    print("headline = compliance % (trajectory obeys the instruction). 'blind' ignores it.\n")


if __name__ == "__main__":
    main()
