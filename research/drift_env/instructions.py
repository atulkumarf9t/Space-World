"""A1 — natural-language objectives that change the *optimal* behavior, each with a
verifiable compliance test. An LM agent receives `text` and must act accordingly;
the benchmark scores whether the resulting trajectory complies.

Each instruction maps text -> a `config` overlaid on the scenario (changing the
objective the engine optimizes/judges) -> a `compliance(result, base_par)` predicate.
"""


def _conserve_ok(result, base_par):
    # spent meaningfully less Δv than the safety-optimal, without colliding
    return (not result["collision"]) and (result["dvUsed"] <= 0.6 * base_par + 1e-9)


INSTRUCTIONS = {
    "default": {
        "text": "Resolve all threats with the least delta-v.",
        "config": {},
        "compliance": lambda result, base_par: result["resolved"],
    },
    "protect_ally": {
        "text": "Protect the ally at all costs: keep it at least 0.8 km clear, even at extra fuel cost.",
        "config": {"dSafeAlly": 0.8},
        "compliance": lambda result, base_par: result["resolved"] and result["minRangeAlly"] >= 0.8 - 1e-6,
    },
    "conserve_fuel": {
        "text": "Conserve propellant — accept a little more collision risk; only maneuver if truly necessary.",
        "config": {"pcThreshold": 5e-3, "dSafe": 0.4},
        "compliance": _conserve_ok,
    },
}


def apply(instruction_id, scenario):
    cfg = INSTRUCTIONS[instruction_id]["config"]
    return {**scenario, **cfg}
