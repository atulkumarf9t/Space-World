"""E1 — generative-world × verifiable-physics coupling (offline study).

The generative world couples to control through ONE channel: scene brightness -> solar
power -> thrust authority (the app's luminance->power link). Here we model that channel
headlessly to quantify, on identical physics:

  A. full power        : no world-driven dimming (baseline)
  B. eclipse           : the world dims (power drops in a shadow window) -> thrust weakens
  C. eclipse + noisy   : the agent also PERCEIVES the world imperfectly (proxy for reading a
                         generated frame: noisy/occasionally-missed threat readings)

Same analytic agent throughout, so any degradation is caused by the world coupling /
perception — not the controller. The pixel-level study (real Reactor frames) is the documented
extension via the capture-replay pipeline (see E1_frame_pipeline.md).

Run: python research/e1_coupling.py [--n 60]
"""

import argparse
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
from drift_env.policies import optimal_policy

SHADOW = (5.0, 13.0)   # eclipse window (s) — matches the app's shadow timeline
SHADOW_POWER = 0.25    # solar power during eclipse


def full_power(_t):
    return 1.0


def eclipse_power(t):
    return SHADOW_POWER if SHADOW[0] <= t <= SHADOW[1] else 1.0


def corrupt(obs, rng, noise):
    """Imperfect perception of the (generated) world: mis-sized/occasionally-missed threat."""
    if noise <= 0 or not obs["worst"]:
        return obs
    o = dict(obs)
    if rng.random() < 0.5 * noise:            # occasional miss-detection -> coast when unsafe
        o["worst"] = None
        o["worstRecommendedDv"] = 0.0
        return o
    o["worstRecommendedDv"] = obs["worstRecommendedDv"] * max(0.1, 1 + rng.gauss(0, noise))
    return o


def run(scenario, policy, power_fn, noise, rng):
    sim = Simulation(scenario=scenario, policy=None)
    dt = sim.flightDt
    t = 0.0
    while not sim.phys.finished and t < 80.0:
        true_obs = sim.observe()
        sim.execute(policy["decide"](corrupt(true_obs, rng, noise)))
        for _ in range(8):
            sim.fm.set_power_authority(power_fn(sim.phys.elapsed))  # world drives thrust authority
            sim.fm.tick(dt, "AGENT")
            sim.phys.step(dt)
            if sim.phys.finished:
                break
        t += 1.0
    p = sim.phys
    return {"resolved": p.status == "RESOLVED", "unsafe": p.status in ("UNSAFE", "COLLISION"),
            "dvUsed": p.dvUsed, "ratio": (p.dvUsed / p.parDv) if p.parDv > 0 else None}


def evaluate(scenarios, power_fn, noise):
    rng = random.Random(7)
    resolved = unsafe = 0
    regrets = []
    dv = 0.0
    for sc in scenarios:
        r = run(sc, optimal_policy(), power_fn, noise, rng)
        resolved += r["resolved"]
        unsafe += r["unsafe"]
        if r["resolved"] and r["ratio"]:
            regrets.append(r["ratio"])
        dv += r["dvUsed"]
    n = len(scenarios)
    return {"success": round(100 * resolved / n, 1), "unsafe": unsafe,
            "regret": round(sum(regrets) / len(regrets), 2) if regrets else None,
            "mean_dv": round(dv / n, 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--corpus", default=None, help="recorded Reactor corpus (.jsonl) to replay luminance from")
    args = ap.parse_args()
    scen = generate_batch(args.n, 900_000)

    if args.corpus:
        from drift_env.corpus import FrameCorpus
        fc = FrameCorpus(args.corpus)
        print(f"  (replaying recorded corpus: {len(fc)} frames, ref luminance {fc.ref:.1f})")
        replay = fc.power_schedule()
        conditions = [
            ("A full power", full_power, 0.0),
            ("B recorded world (replay luminance)", replay, 0.0),
            ("C recorded world + noisy perception", replay, 0.35),
        ]
    else:
        conditions = [
            ("A full power", full_power, 0.0),
            ("B eclipse", eclipse_power, 0.0),
            ("C eclipse+noisy perception", eclipse_power, 0.35),
        ]
    print(f"\nE1 — generative-world coupling study (n={args.n}, same analytic agent)\n")
    cols = ["condition", "success", "unsafe", "regret", "mean Δv"]
    rows = [cols]
    for label, pf, noise in conditions:
        r = evaluate(scen, pf, noise)
        rows.append([label, f"{r['success']}%", str(r["unsafe"]),
                     (f"{r['regret']}x" if r["regret"] is not None else "—"), f"{r['mean_dv']}"])
    w = [max(len(r[c]) for r in rows) for c in range(len(cols))]
    for r in rows:
        print("  " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
    print("\nThe world (eclipse) degrades control on identical physics; imperfect perception of it")
    print("compounds the loss — quantifying the generative-world coupling. Pixel-level study: see")
    print("E1_frame_pipeline.md (Reactor frame capture-replay).\n")


if __name__ == "__main__":
    main()
