"""Scenario definitions + generator — port of src/scenarios.js. The rng call
order matches the JS object-literal evaluation order exactly (parity-critical)."""

from .rng import Rng


def diag_cov(sx, sy, sz):
    return [[sx * sx, 0, 0], [0, sy * sy, 0], [0, 0, sz * sz]]


DEFAULT_SCENARIO = {
    "name": "baseline-dual-threat",
    "allyPos": {"x": 8, "y": 0.42, "z": 0},
    "allyVel": {"x": 0, "y": 0, "z": 0},
    "asteroidPos": {"x": 4, "y": -0.35, "z": 3},
    "asteroidVel": {"x": -0.06, "y": 0, "z": -0.04},
    "covAlly": diag_cov(0.02, 0.02, 0.02),
    "covAsteroid": diag_cov(0.08, 0.15, 0.08),
}


def generate_scenario(seed: int) -> dict:
    r = Rng(seed)
    ally_side = r.sign()
    asteroid_side = r.sign()
    # NOTE: order below mirrors JS literal evaluation (top-to-bottom, left-to-right)
    ally_x = r.float(6, 9)
    ally_y = ally_side * r.float(0.2, 0.6)
    ally_z = r.float(-0.6, 0.6)
    avx = r.float(-0.02, 0.02)
    avz = r.float(-0.02, 0.02)
    ast_x = r.float(3, 6)
    ast_y = asteroid_side * r.float(0.2, 0.5)
    ast_z = r.float(2, 4)
    astvx = r.float(-0.09, -0.03)
    astvz = r.float(-0.06, -0.02)
    cov_sx = r.float(0.05, 0.12)
    cov_sy = r.float(0.1, 0.2)
    cov_sz = r.float(0.05, 0.12)
    return {
        "name": f"gen-{seed}",
        "seed": seed,
        "allyPos": {"x": ally_x, "y": ally_y, "z": ally_z},
        "allyVel": {"x": avx, "y": 0, "z": avz},
        "asteroidPos": {"x": ast_x, "y": ast_y, "z": ast_z},
        "asteroidVel": {"x": astvx, "y": 0, "z": astvz},
        "covAlly": diag_cov(0.02, 0.02, 0.02),
        "covAsteroid": diag_cov(cov_sx, cov_sy, cov_sz),
    }


def generate_batch(n: int, base_seed: int = 1000):
    return [generate_scenario(base_seed + i) for i in range(n)]


def generate_difficulty(seed, d):
    """Difficulty knob d in [0,1]: closer + faster asteroid (more required Δv) and
    larger uncertainty. Higher d => harder but (up to ~0.85) still oracle-solvable."""
    base = generate_scenario(seed)
    # asteroid: faster + closer (less time/closer => more Δv to deflect)
    av = base["asteroidVel"]
    base["asteroidVel"] = {"x": av["x"] * (1 + 1.6 * d), "y": av["y"], "z": av["z"] * (1 + 1.6 * d)}
    ap = base["asteroidPos"]
    base["asteroidPos"] = {"x": ap["x"] * (1 - 0.35 * d), "y": ap["y"] * (1 - 0.6 * d), "z": ap["z"] * (1 - 0.45 * d)}
    # ally: drift its offset toward the probe path so it too needs more clearance Δv
    al = base["allyPos"]
    base["allyPos"] = {"x": al["x"] * (1 - 0.25 * d), "y": al["y"] * (1 - 0.6 * d), "z": al["z"]}
    s = 0.08 + 0.12 * d
    base["covAsteroid"] = diag_cov(s, s * 1.5, s)
    base["name"] = f"diff{d:.2f}-{seed}"
    base["difficulty"] = d
    return base


def difficulty_batch(n, d, base_seed=300_000):
    return [generate_difficulty(base_seed + i, d) for i in range(n)]


# Deterministic train/val/test splits over disjoint seed ranges (no leakage).
def splits(n_train=800, n_val=100, n_test=100):
    return {
        "train": generate_batch(n_train, 1_000),
        "val": generate_batch(n_val, 100_000),
        "test": generate_batch(n_test, 900_000),
    }
