"""Golden cross-language parity: the Python port must match the JS engine.
Run: python research/test_parity.py   (after: node research/gen_ref.mjs)"""

import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))
from drift_env.rng import mulberry32
from drift_env.scenarios import generate_scenario, DEFAULT_SCENARIO
from drift_env.physics import tca_for, miss_for, pc_for
from drift_env.simulation import Simulation
from drift_env.policies import optimal_policy

REF = json.load(open(os.path.join(os.path.dirname(__file__), "parity_ref.json")))

passed = failed = 0
def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1; print(f"  PASS  {name}")
    else:
        failed += 1; print(f"  FAIL  {name}  {detail}")
def close(a, b, tol): return abs(a - b) <= tol

print("\nRNG parity")
f1 = mulberry32(1); py1 = [f1() for _ in range(5)]
ok("mulberry32(1)", all(close(a, b, 1e-15) for a, b in zip(py1, REF["rng1"])), str(py1))
f42 = mulberry32(42); py42 = [f42() for _ in range(5)]
ok("mulberry32(42)", all(close(a, b, 1e-15) for a, b in zip(py42, REF["rng42"])))

print("\nscenario parity")
sc = generate_scenario(1000); r = REF["scenario1000"]
fields_ok = all(close(sc[k][ax], r[k][ax], 1e-12) for k in ["allyPos", "allyVel", "asteroidPos", "asteroidVel"] for ax in "xyz")
fields_ok = fields_ok and close(sc["covAsteroid"][0][0], r["covAsteroid"][0][0], 1e-15)
ok("generate_scenario(1000)", fields_ok)

print("\nconjunction math parity")
cov = [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]]
rp = {"x": 10, "y": 0.05, "z": 0}; rv = {"x": -1, "y": 0, "z": 0}
ok("tca", close(tca_for(rp, rv), REF["tca"], 1e-9))
ok("miss", close(miss_for(rp, rv), REF["miss"], 1e-9))
ok("pc (grid integration)", close(pc_for(rp, rv, cov, 0.05, 64), REF["pc"], 1e-9), f"{pc_for(rp, rv, cov, 0.05, 64)} vs {REF['pc']}")

print("\nfull optimal-rollout parity (engine + flight + guard end to end)")
d = Simulation(scenario=DEFAULT_SCENARIO, policy=optimal_policy()).run(80)
rd = REF["optimalDefault"]
ok("default status", d["status"] == rd["status"], f"{d['status']} vs {rd['status']}")
ok("default par Δv", close(d["parDv"], rd["parDv"], 1e-6), f"{d['parDv']} vs {rd['parDv']}")
ok("default Δv used", close(d["dvUsed"], rd["dvUsed"], 1e-4), f"{d['dvUsed']} vs {rd['dvUsed']}")

g = Simulation(scenario=generate_scenario(1000), policy=optimal_policy()).run(80)
rg = REF["optimalGen"]
ok("gen-1000 status", g["status"] == rg["status"], f"{g['status']} vs {rg['status']}")
ok("gen-1000 Δv used", close(g["dvUsed"], rg["dvUsed"], 1e-4), f"{g['dvUsed']} vs {rg['dvUsed']}")

print(f"\n{passed} passed, {failed} failed\n")
sys.exit(1 if failed else 0)
