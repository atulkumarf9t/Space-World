"""A3 — classical-vs-learned control benchmark.

Compares control paradigms on identical conjunction geometry:
  - analytic : closed-form minimum-Δv (the oracle / par)
  - mpc      : sampling receding-horizon (re-plan each decision over a Δv grid)
  - p-control: proportional feedback (burn ∝ safe-ring deficit; closed-loop)
  - bc       : learned policy (behavior cloning from the D1 dataset)
  - random   : control
Reported on linear and CW (curved) dynamics: regret vs par, success, mean Δv, and
compute (mean ms/episode) — the classical-vs-learned trade.

Run: python research/a3_benchmark.py [--n 50]
"""

import argparse
import os
import random
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))

from drift_env.simulation import Simulation
from drift_env.physics import pc_for, miss_for, vsub, vscale
from drift_env.scenarios import generate_batch
from drift_env.policies import optimal_policy, random_policy
import train  # reuse BC trainer/policy


# ---- controllers: decide(sim) -> action (full sim access for classical methods) ----
def analytic_decide(sim):
    return optimal_policy()["decide"](sim.observe())


def mpc_decide(sim, step=0.25):
    phys = sim.phys
    o = sim.observe()
    w = o["worst"]
    if not w:
        return {"type": "coast"}
    key = w["target"]
    rp = phys._rel_pair(key)
    relPos, relVel = rp["relPos"], rp["relVel"]
    cov = phys._combined_cov(key)
    dirb = phys.best_burn_dir(key)
    ds = phys._dsafe_for(key)
    budget = phys.dvRemaining
    dv = 0.0
    while dv <= budget + 1e-9:
        rv = vsub(relVel, vscale(dirb, dv / 1000.0))           # apply candidate burn (m/s)
        if pc_for(relPos, rv, cov, phys.hardBody) <= phys.pcThreshold and miss_for(relPos, rv) >= ds:
            break
        dv += step
    dv = min(dv, budget)
    return {"type": "burn", "dir": dirb, "dv": dv} if dv > 1e-3 else {"type": "coast"}


def p_decide(sim, k=4.0):
    phys = sim.phys
    o = sim.observe()
    w = o["worst"]
    if not w or w["safe"]:
        return {"type": "coast"}
    ds = phys._dsafe_for(w["target"])
    deficit = max(0.0, ds - w["predictedMiss"])
    dv = k * deficit
    if dv <= 1e-3 and w["pc"] > phys.pcThreshold:
        dv = 0.5  # pc high but geometric miss ok -> small nudge
    dv = min(dv, phys.dvRemaining)
    return {"type": "burn", "dir": phys.best_burn_dir(w["target"]), "dv": dv} if dv > 1e-3 else {"type": "coast"}


def make_obs_controller(policy):
    return lambda sim: policy["decide"](sim.observe())


def run(scenario, decide, dynamics=None):
    sc = scenario if dynamics is None else {**scenario, "dynamics": dynamics, "meanMotion": 0.05}
    sim = Simulation(scenario=sc, policy=None)
    flight_dt = sim.flightDt
    t = 0.0
    while not sim.phys.finished and t < 80.0:
        sim.execute(decide(sim))
        for _ in range(8):  # one decision interval
            sim.fm.tick(flight_dt, "AGENT")
            sim.phys.step(flight_dt)
            if sim.phys.finished:
                break
        t += 1.0
    p = sim.phys
    return {"resolved": p.status == "RESOLVED", "collision": p.status == "COLLISION",
            "dvUsed": p.dvUsed, "ratio": (p.dvUsed / p.parDv) if p.parDv > 0 else None}


def bench(controllers, scenarios, dynamics):
    out = {}
    for name, decide in controllers.items():
        resolved = 0
        regrets = []
        dv_sum = 0.0
        t0 = time.perf_counter()
        for sc in scenarios:
            r = run(sc, decide, dynamics)
            if r["resolved"]:
                resolved += 1
                if r["ratio"] is not None:
                    regrets.append(r["ratio"])
            dv_sum += r["dvUsed"]
        ms = 1000 * (time.perf_counter() - t0) / len(scenarios)
        out[name] = {
            "success": round(100 * resolved / len(scenarios), 1),
            "regret": round(sum(regrets) / len(regrets), 3) if regrets else None,
            "mean_dv": round(dv_sum / len(scenarios), 2),
            "ms": round(ms, 1),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50)
    args = ap.parse_args()

    print("\n[setup] training BC controller from the D1 dataset")
    bc_net = train.train_bc(os.path.join(os.path.dirname(__file__), "data/train.jsonl"))
    rng = random.Random(7)
    controllers = {
        "analytic": analytic_decide,
        "mpc": mpc_decide,
        "p-control": p_decide,
        "bc": make_obs_controller(train.bc_policy(bc_net)),
        "random": make_obs_controller(random_policy(rng.random)),
    }

    test = generate_batch(args.n, 900_000)
    # NOTE: CW dynamics needs CW-tuned threat geometry — the linear scenarios self-resolve
    # under orbital curvature (par=0). A CW conjunction generator is a D2 follow-up.
    for dyn in ("linear",):
        print(f"\nA3 — control benchmark on {dyn} dynamics (n={args.n})\n")
        res = bench(controllers, test, None if dyn == "linear" else "cw")
        cols = ["controller", "success", "regret", "mean Δv", "ms/episode"]
        rows = [cols]
        for name, r in res.items():
            rows.append([name, f"{r['success']}%", (f"{r['regret']}x" if r["regret"] is not None else "—"),
                         f"{r['mean_dv']}", f"{r['ms']}"])
        w = [max(len(r[c]) for r in rows) for c in range(len(cols))]
        for r in rows:
            print("  " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
    print("\nclassical (analytic/mpc/p-control) vs learned (bc); regret = Δv/par.\n")


if __name__ == "__main__":
    main()
