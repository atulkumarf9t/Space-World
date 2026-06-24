"""Decision policies — port of src/policies.js. decide(obs) -> action."""

import random as _random


def coast():
    return {"type": "coast"}


def optimal_policy():
    def decide(obs):
        if not obs["worst"] or obs["worstRecommendedDv"] <= 0:
            return coast()
        return {"type": "burn", "dir": obs["worstBurnDir"], "dv": obs["worstRecommendedDv"]}
    return {"name": "optimal", "decide": decide}


def heuristic_policy(step=1.2):
    def decide(obs):
        w = obs["worst"]
        if not w or w["predictedMiss"] >= obs["dSafe"]:
            return coast()
        return {"type": "burn", "dir": obs["worstBurnDir"], "dv": step}
    return {"name": "heuristic", "decide": decide}


def random_policy(rng=_random.random):
    def decide(obs):
        if rng() < 0.25 and obs["worst"]:
            return {"type": "burn", "dir": obs["worstBurnDir"], "dv": 0.4 + rng() * 1.5}
        return coast()
    return {"name": "random", "decide": decide}


def null_policy():
    return {"name": "null", "decide": lambda obs: coast()}
