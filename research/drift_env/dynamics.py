"""Clohessy-Wiltshire relative motion — port of src/dynamics.js. n->0 == linear."""

import math


def cw_step(s, n, dt):
    if abs(n) < 1e-12:
        return {"x": s["x"] + s["vx"] * dt, "y": s["y"] + s["vy"] * dt, "z": s["z"] + s["vz"] * dt,
                "vx": s["vx"], "vy": s["vy"], "vz": s["vz"]}
    x0, vx0 = s["x"], s["vx"]   # radial
    y0, vy0 = s["z"], s["vz"]   # along-track
    z0, vz0 = s["y"], s["vy"]   # cross-track
    t = dt
    c = math.cos(n * t)
    si = math.sin(n * t)
    x = (4 - 3 * c) * x0 + (si / n) * vx0 + (2 / n) * (1 - c) * vy0
    y = 6 * (si - n * t) * x0 + y0 + (2 / n) * (c - 1) * vx0 + (1 / n) * (4 * si - 3 * n * t) * vy0
    z = c * z0 + (si / n) * vz0
    vx = 3 * n * si * x0 + c * vx0 + 2 * si * vy0
    vy = 6 * n * (c - 1) * x0 - 2 * si * vx0 + (4 * c - 3) * vy0
    vz = -n * si * z0 + c * vz0
    return {"x": x, "y": z, "z": y, "vx": vx, "vy": vz, "vz": vy}


def closest_approach_cw(rel, n, horizon=80.0, coarse=0.5):
    best = {"t": 0.0, "r": float("inf"), "s": rel}
    t = 0.0
    while t <= horizon:
        st = cw_step(rel, n, t)
        r = math.hypot(st["x"], st["y"], st["z"])
        if r < best["r"]:
            best = {"t": t, "r": r, "s": st}
        t += coarse
    lo = max(0.0, best["t"] - coarse)
    hi = best["t"] + coarse
    t = lo
    while t <= hi:
        st = cw_step(rel, n, t)
        r = math.hypot(st["x"], st["y"], st["z"])
        if r < best["r"]:
            best = {"t": t, "r": r, "s": st}
        t += coarse / 25.0
    s = best["s"]
    return {"tca": best["t"], "miss": best["r"],
            "relPos": {"x": s["x"], "y": s["y"], "z": s["z"]},
            "relVel": {"x": s["vx"], "y": s["vy"], "z": s["vz"]}}
