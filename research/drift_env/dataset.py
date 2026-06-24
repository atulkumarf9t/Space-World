"""Verifiable dataset exporter (D1). Rolls out the oracle and logs, per decision,
the observation, the optimal action it took, and ground-truth labels (worst target,
Pc, miss, TCA, par). Output is JSONL — directly usable for behavior cloning and for
the E2 faithfulness testbed."""

import json
from .env import DriftEnv, OBS_DIM
from .policies import optimal_policy


def export(scenarios, path, split=None, reward="shaped"):
    pol = optimal_policy()
    n_rows = 0
    with open(path, "w", encoding="utf-8") as f:
        for sc in scenarios:
            env = DriftEnv(scenario=sc, reward=reward)
            env.reset()
            step = 0
            done = False
            while not done:
                o = env.sim.observe()                    # structured obs (labels)
                vec = [float(x) for x in env._obs()]     # numeric obs (training)
                w = o["worst"]
                action = pol["decide"](o)
                row = {
                    "split": split,
                    "scenario": sc.get("name"),
                    "seed": sc.get("seed"),
                    "step": step,
                    "obs": vec,
                    "action_type": action["type"],
                    "action_dv": float(action.get("dv", 0.0)),
                    "worst_target": w["target"] if w else None,
                    "worst_pc": w["pc"] if w else 0.0,
                    "worst_miss": w["predictedMiss"] if w else None,
                    "worst_tca": w["tca"] if w else None,
                    "needs_burn": bool(o["worstRecommendedDv"] > 0),
                    "par": env.sim.phys.parDv,
                }
                f.write(json.dumps(row) + "\n")
                n_rows += 1
                step += 1
                _, _, term, trunc, _ = env.step(action)
                done = term or trunc
    return {"rows": n_rows, "path": path, "obs_dim": OBS_DIM}


def load(path):
    return [json.loads(line) for line in open(path, encoding="utf-8")]
