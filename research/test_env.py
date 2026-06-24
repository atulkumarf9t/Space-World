"""Smoke test for the Gym-style env, dataset exporter, and metrics.
Run: python research/test_env.py"""

import os
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))

from drift_env.env import DriftEnv, OBS_DIM
from drift_env.scenarios import DEFAULT_SCENARIO, generate_scenario
from drift_env.policies import optimal_policy, null_policy
from drift_env.dataset import export
from drift_env.metrics import aggregate

passed = failed = 0
def ok(n, c, d=""):
    global passed, failed
    if c: passed += 1; print(f"  PASS  {n}")
    else: failed += 1; print(f"  FAIL  {n}  {d}")

print("\nGym-style env")
env = DriftEnv(scenario=DEFAULT_SCENARIO, reward="shaped")
obs, info = env.reset()
ok("reset returns obs of OBS_DIM", len(obs) == OBS_DIM, str(len(obs)))
ok("reset info has par", "par" in info and info["par"] >= 0)

obs, r, term, trunc, info = env.step([0.0])  # coast
ok("step returns 5-tuple", all(v is not None for v in [obs is not None, r is not None, term in (True, False), trunc in (True, False)]))
ok("reward is finite", isinstance(r, float))

print("\npolicy rollout through env")
res_opt = DriftEnv(scenario=DEFAULT_SCENARIO).run_policy(optimal_policy())
res_null = DriftEnv(scenario=DEFAULT_SCENARIO).run_policy(null_policy())
ok("optimal resolves default", res_opt["resolved"], res_opt["status"])
ok("optimal within budget (no violations)", res_opt["violations"] == 0)
print(f"        optimal: {res_opt['status']} regret={res_opt['ratio']:.2f} | null: {res_null['status']}")

print("\nguard rejects illegal action")
env2 = DriftEnv(scenario=DEFAULT_SCENARIO); env2.reset()
env2.step({"type": "burn", "dir": {"x": float('nan'), "y": 0, "z": 0}, "dv": 1})
ok("NaN action counted as violation", env2.sim.violations >= 1)

print("\ndataset exporter")
scs = [generate_scenario(1000 + i) for i in range(5)]
with tempfile.TemporaryDirectory() as d:
    out = os.path.join(d, "ds.jsonl")
    meta = export(scs, out)
    ok("dataset rows > 0", meta["rows"] > 0, str(meta))
    import json
    first = json.loads(open(out, encoding="utf-8").readline())
    ok("row has obs vector + action + label", len(first["obs"]) == OBS_DIM and "action_dv" in first and "par" in first)

print(f"\n{passed} passed, {failed} failed\n")
sys.exit(1 if failed else 0)
