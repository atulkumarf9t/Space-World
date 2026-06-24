"""DRIFT research environment — a verifiable, oracle-backed, shielded decision env
ported from the JS engine (golden-parity tested)."""

from .physics import Physics, pc_for, tca_for, miss_for
from .flight import FlightModel
from .simulation import Simulation
from .scenarios import DEFAULT_SCENARIO, generate_scenario, generate_batch, splits
from . import policies
from .env import DriftEnv, encode_obs, OBS_DIM

__all__ = [
    "Physics", "FlightModel", "Simulation", "pc_for", "tca_for", "miss_for",
    "DEFAULT_SCENARIO", "generate_scenario", "generate_batch", "splits", "policies",
    "DriftEnv", "encode_obs", "OBS_DIM",
]

# Register Gymnasium environments if gymnasium is installed (safe no-op otherwise).
try:
    from .gym_env import register as _register
    _register()
except Exception:
    pass
