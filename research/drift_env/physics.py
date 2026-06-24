"""Authoritative conjunction sim — faithful port of src/physics.js.
Vectors are dicts {x,y,z} to mirror the JS exactly. Covariance is a 3x3 list."""

import math
from .dynamics import cw_step, closest_approach_cw

try:
    import numpy as _np
except Exception:
    _np = None

# Precomputed integration grids per (res, hbr) for the numpy fast path.
_GRID_CACHE = {}

STATUS = {"CRUISE": "CRUISE", "ALERT": "ALERT", "RESOLVED": "RESOLVED", "UNSAFE": "UNSAFE", "COLLISION": "COLLISION"}


# ---- vector helpers ----
def vsub(a, b): return {"x": a["x"] - b["x"], "y": a["y"] - b["y"], "z": a["z"] - b["z"]}
def vadd(a, b): return {"x": a["x"] + b["x"], "y": a["y"] + b["y"], "z": a["z"] + b["z"]}
def vscale(a, s): return {"x": a["x"] * s, "y": a["y"] * s, "z": a["z"] * s}
def vdot(a, b): return a["x"] * b["x"] + a["y"] * b["y"] + a["z"] * b["z"]
def vcross(a, b): return {"x": a["y"] * b["z"] - a["z"] * b["y"], "y": a["z"] * b["x"] - a["x"] * b["z"], "z": a["x"] * b["y"] - a["y"] * b["x"]}
def vmag(a): return math.hypot(a["x"], a["y"], a["z"])
def vnorm(a):
    m = math.hypot(a["x"], a["y"], a["z"]) or 1
    return {"x": a["x"] / m, "y": a["y"] / m, "z": a["z"] / m}
def vclone(a): return {"x": a["x"], "y": a["y"], "z": a["z"]}


def miss_for(rel_pos, rel_vel):
    speed = vmag(rel_vel)
    if speed < 1e-9:
        return vmag(rel_pos)
    return vmag(vcross(rel_pos, rel_vel)) / speed


def tca_for(rel_pos, rel_vel):
    s2 = vdot(rel_vel, rel_vel)
    if s2 < 1e-12:
        return math.inf
    return -vdot(rel_pos, rel_vel) / s2


def solve_impulsive_dv(rel_pos, rel_vel, target_miss, budget_ms):
    if miss_for(rel_pos, rel_vel) >= target_miss:
        return 0.0
    speed = vmag(rel_vel)
    if speed < 1e-9:
        return budget_ms
    perp1 = vnorm(vcross(rel_vel, {"x": 0, "y": 1, "z": 0}))
    perp2 = vnorm(vcross(rel_vel, perp1))
    if vmag(perp2) < 1e-9:
        perp2 = vnorm(vcross(rel_vel, {"x": 1, "y": 0, "z": 0}))
    dirs = [perp1, vscale(perp1, -1), perp2, vscale(perp2, -1)]
    best = math.inf
    hi = budget_ms / 1000.0
    for d in dirs:
        miss_at = lambda dd: miss_for(rel_pos, vsub(rel_vel, vscale(d, dd)))
        if miss_at(hi) < target_miss:
            continue
        lo, h = 0.0, hi
        for _ in range(40):
            mid = (lo + h) / 2
            if miss_at(mid) >= target_miss:
                h = mid
            else:
                lo = mid
        best = min(best, h * 1000.0)
    return best


# ---- covariance / probability of collision ----
def add_cov(a, b):
    return [[a[i][j] + b[i][j] for j in range(3)] for i in range(3)]


def bplane_basis(rel_vel):
    u = vnorm(rel_vel)
    t = {"x": 0, "y": 1, "z": 0} if abs(u["y"]) < 0.9 else {"x": 1, "y": 0, "z": 0}
    e1 = vnorm(vcross(u, t))
    e2 = vnorm(vcross(u, e1))
    return u, e1, e2


def project_cov2(c3, e1, e2):
    P = [[e1["x"], e1["y"], e1["z"]], [e2["x"], e2["y"], e2["z"]]]
    cpt = [[0, 0], [0, 0], [0, 0]]
    for i in range(3):
        for k in range(2):
            s = 0.0
            for j in range(3):
                s += c3[i][j] * P[k][j]
            cpt[i][k] = s
    out = [[0, 0], [0, 0]]
    for r in range(2):
        for c in range(2):
            s = 0.0
            for i in range(3):
                s += P[r][i] * cpt[i][c]
            out[r][c] = s
    return out


def eig2(c2):
    a, b, c = c2[0][0], c2[0][1], c2[1][1]
    tr = a + c
    det = a * c - b * b
    disc = math.sqrt(max(0.0, (tr * tr) / 4 - det))
    l1, l2 = tr / 2 + disc, tr / 2 - disc
    theta = 0.5 * math.atan2(2 * b, a - c)
    return math.sqrt(max(l1, 1e-12)), math.sqrt(max(l2, 1e-12)), theta


def pc_for(rel_pos, rel_vel, cov3, hbr, res=64):
    speed = vmag(rel_vel)
    if speed < 1e-9:
        return 0.0
    tca = tca_for(rel_pos, rel_vel)
    if tca <= 0:
        return 0.0
    miss = {"x": rel_pos["x"] + rel_vel["x"] * tca, "y": rel_pos["y"] + rel_vel["y"] * tca, "z": rel_pos["z"] + rel_vel["z"] * tca}
    _, e1, e2 = bplane_basis(rel_vel)
    mu = {"x": vdot(miss, e1), "y": vdot(miss, e2)}
    c2 = project_cov2(cov3, e1, e2)
    c2[0][0] += 1e-10
    c2[1][1] += 1e-10
    s1, s2, theta = eig2(c2)
    ct, st = math.cos(theta), math.sin(theta)
    mx = ct * mu["x"] + st * mu["y"]
    my = -st * mu["x"] + ct * mu["y"]
    if s1 < hbr * 1e-3 and s2 < hbr * 1e-3:
        return 1.0 if vmag(miss) < hbr else 0.0
    n = res
    step = (2 * hbr) / n
    if _np is not None:
        # Vectorized over the same grid as the reference loop (matches to fp tol).
        key = (n, hbr)
        cached = _GRID_CACHE.get(key)
        if cached is None:
            xs = -hbr + (_np.arange(n) + 0.5) * step
            X, Y = _np.meshgrid(xs, xs, indexing="ij")
            mask = (X * X + Y * Y) <= hbr * hbr
            cached = (X[mask], Y[mask])
            _GRID_CACHE[key] = cached
        Xm, Ym = cached
        dx = (Xm - mx) / s1
        dy = (Ym - my) / s2
        total = float(_np.exp(-0.5 * (dx * dx + dy * dy)).sum())
    else:
        total = 0.0
        i = 0
        while i < n:
            x = -hbr + (i + 0.5) * step
            j = 0
            while j < n:
                y = -hbr + (j + 0.5) * step
                if x * x + y * y <= hbr * hbr:
                    dx = (x - mx) / s1
                    dy = (y - my) / s2
                    total += math.exp(-0.5 * (dx * dx + dy * dy))
                j += 1
            i += 1
    return min(1.0, (total * step * step) / (2 * math.pi * s1 * s2))


def solve_impulsive_dv_for_pc(rel_pos, rel_vel, cov3, hbr, pc_threshold, budget_ms, res=40):
    if pc_for(rel_pos, rel_vel, cov3, hbr, res) <= pc_threshold:
        return 0.0
    speed = vmag(rel_vel)
    if speed < 1e-9:
        return budget_ms
    perp1 = vnorm(vcross(rel_vel, {"x": 0, "y": 1, "z": 0}))
    perp2 = vnorm(vcross(rel_vel, perp1))
    if vmag(perp2) < 1e-9:
        perp2 = vnorm(vcross(rel_vel, {"x": 1, "y": 0, "z": 0}))
    dirs = [perp1, vscale(perp1, -1), perp2, vscale(perp2, -1)]
    hi = budget_ms / 1000.0
    best = math.inf
    for d in dirs:
        pc_at = lambda dd: pc_for(rel_pos, vsub(rel_vel, vscale(d, dd)), cov3, hbr, res)
        if pc_at(hi) > pc_threshold:
            continue
        lo, h = 0.0, hi
        for _ in range(32):
            mid = (lo + h) / 2
            if pc_at(mid) <= pc_threshold:
                h = mid
            else:
                lo = mid
        best = min(best, h * 1000.0)
    return best


def _diag(s):
    return [[s * s, 0, 0], [0, s * s, 0], [0, 0, s * s]]


class Physics:
    def __init__(self, dSafe=0.5, hardBody=0.05, dvBudget=12.0, pcThreshold=1e-4, dynamics="linear", meanMotion=0.05, dSafeAlly=None):
        self.dSafe = dSafe
        self.hardBody = hardBody
        self.dvBudget = dvBudget
        self.pcThreshold = pcThreshold
        self.dynamics = dynamics
        self.meanMotion = meanMotion
        self.dSafeAlly = dSafeAlly  # optional stricter safe ring for the ally (A1: protect-ally)
        self.reset()

    def _dsafe_for(self, key):
        if key == "ally" and self.dSafeAlly:
            return self.dSafeAlly
        return self.dSafe

    def _propagate(self, body, dt):
        if self.dynamics != "cw":
            body["pos"] = vadd(body["pos"], vscale(body["vel"], dt))
            return
        s = cw_step({"x": body["pos"]["x"], "y": body["pos"]["y"], "z": body["pos"]["z"],
                     "vx": body["vel"]["x"], "vy": body["vel"]["y"], "vz": body["vel"]["z"]}, self.meanMotion, dt)
        body["pos"] = {"x": s["x"], "y": s["y"], "z": s["z"]}
        body["vel"] = {"x": s["vx"], "y": s["vy"], "z": s["vz"]}

    def reset(self):
        self.probe = {"pos": {"x": 0, "y": 0, "z": 0}, "vel": {"x": 0.2, "y": 0, "z": 0}}
        self.ally = {"pos": {"x": 8, "y": 0.42, "z": 0}, "vel": {"x": 0, "y": 0, "z": 0}}
        self.asteroid = {"pos": {"x": 4, "y": -0.35, "z": 3}, "vel": {"x": -0.06, "y": 0, "z": -0.04}}
        self.status = STATUS["CRUISE"]
        self.armed = False
        self.finished = False
        self.elapsed = 0.0
        self.minRangeAlly = math.inf
        self.minRangeAsteroid = math.inf
        self.dvAgent = 0.0
        self.dvHuman = 0.0
        self.parDv = 0.0
        self.grade = None
        self.gradeRatio = None
        self.collisionTarget = None
        Z = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
        self.cov = {"probe": Z, "ally": _diag(0.02), "asteroid": _diag(0.1)}
        self.extraThreats = []
        self.minRange = {}
        self.enforce_budget = True  # shield layer (A2 toggles this)

    def _lookup(self, key):
        if key == "ally":
            return self.ally
        if key == "asteroid":
            return self.asteroid
        for t in self.extraThreats:
            if t["key"] == key:
                return t
        return None

    def _threat_keys(self):
        return ["ally", "asteroid"] + [t["key"] for t in self.extraThreats]

    def arm(self, scenario):
        ap = scenario.get("allyPos", {"x": 8, "y": 0.42, "z": 0})
        av = scenario.get("allyVel", {"x": 0, "y": 0, "z": 0})
        sp = scenario.get("asteroidPos", {"x": 4, "y": -0.35, "z": 3})
        sv = scenario.get("asteroidVel", {"x": -0.06, "y": 0, "z": -0.04})
        self.probe = {"pos": {"x": 0, "y": 0, "z": 0}, "vel": {"x": 0.2, "y": 0, "z": 0}}
        self.ally = {"pos": vclone(ap), "vel": vclone(av)}
        self.asteroid = {"pos": vclone(sp), "vel": vclone(sv)}
        if scenario.get("covAlly"):
            self.cov["ally"] = scenario["covAlly"]
        if scenario.get("covAsteroid"):
            self.cov["asteroid"] = scenario["covAsteroid"]
        if scenario.get("dynamics"):
            self.dynamics = scenario["dynamics"]
        if scenario.get("meanMotion") is not None:
            self.meanMotion = scenario["meanMotion"]
        if scenario.get("dSafe") is not None:
            self.dSafe = scenario["dSafe"]
        if scenario.get("pcThreshold") is not None:
            self.pcThreshold = scenario["pcThreshold"]
        self.dSafeAlly = scenario.get("dSafeAlly", None)
        self.extraThreats = []
        for i, t in enumerate(scenario.get("extraThreats", []) or []):
            key = t.get("key", f"threat{i + 1}")
            self.cov[key] = t.get("cov", _diag(0.1))
            self.extraThreats.append({"key": key, "role": t.get("role", "avoid"),
                                      "pos": vclone(t["pos"]), "vel": vclone(t["vel"]),
                                      "radius": t.get("radius", self.hardBody)})
        self.armed = True
        self.finished = False
        self.status = STATUS["ALERT"]
        self.elapsed = 0.0
        self.minRange = {}
        for k in self._threat_keys():
            self.minRange[k] = vmag(vsub(self._lookup(k)["pos"], self.probe["pos"]))
        self.minRangeAlly = self.minRange["ally"]
        self.minRangeAsteroid = self.minRange["asteroid"]
        self.collisionTarget = None
        par = 0.0
        for k in self._threat_keys():
            fc = self._forecast_pair(k)
            if not fc:
                continue
            ds = self._dsafe_for(k)
            dv = solve_impulsive_dv_for_pc(fc["relPos"], fc["relVel"], self._combined_cov(k), self.hardBody, self.pcThreshold, self.dvBudget)
            if dv == 0 and fc["predictedMiss"] < ds:
                dv = solve_impulsive_dv(fc["relPos"], fc["relVel"], ds, self.dvBudget)
            par = max(par, dv)
        self.parDv = par

    def _combined_cov(self, key):
        return add_cov(self.cov["probe"], self.cov[key])

    @property
    def dvUsed(self):
        return self.dvAgent + self.dvHuman

    @property
    def dvRemaining(self):
        return max(0.0, self.dvBudget - self.dvUsed)

    def apply_delta_v(self, dv_vec, source):
        if self.finished:
            return 0.0
        mag_ms = vmag(dv_vec) * 1000.0
        if mag_ms <= 0:
            return 0.0
        if self.enforce_budget:  # shield layer: clamp to remaining budget
            remaining = self.dvRemaining
            if mag_ms > remaining:
                scale = remaining / mag_ms
                dv_vec = vscale(dv_vec, scale)
                mag_ms = remaining
            if mag_ms <= 0:
                return 0.0
        self.probe["vel"] = vadd(self.probe["vel"], dv_vec)
        if source == "human":
            self.dvHuman += mag_ms
        else:
            self.dvAgent += mag_ms
        return mag_ms

    def step(self, dt):
        if not self.armed or self.finished:
            return
        self._propagate(self.probe, dt)
        self._propagate(self.ally, dt)
        self._propagate(self.asteroid, dt)
        for t in self.extraThreats:
            self._propagate(t, dt)
        self.elapsed += dt
        for k in self._threat_keys():
            body = self._lookup(k)
            r = vmag(vsub(body["pos"], self.probe["pos"]))
            if r < self.minRange.get(k, math.inf):
                self.minRange[k] = r
            if r < body.get("radius", self.hardBody):
                self.collisionTarget = k
                self.minRangeAlly = self.minRange["ally"]
                self.minRangeAsteroid = self.minRange["asteroid"]
                self._finish(STATUS["COLLISION"])
                return
        self.minRangeAlly = self.minRange["ally"]
        self.minRangeAsteroid = self.minRange["asteroid"]
        fcs = [(k, self._forecast_pair(k)) for k in self._threat_keys()]
        all_passed = all(fc and fc["tca"] <= 0 for _, fc in fcs)
        if all_passed or self.elapsed > 45:
            all_safe = all(fc["predictedMiss"] >= self._dsafe_for(k) and self.minRange.get(k, math.inf) >= self._dsafe_for(k) for k, fc in fcs)
            self._finish(STATUS["RESOLVED"] if all_safe else STATUS["UNSAFE"])

    def _rel_pair(self, key):
        target = self._lookup(key)
        return {"relPos": vsub(target["pos"], self.probe["pos"]), "relVel": vsub(target["vel"], self.probe["vel"])}

    def _forecast_pair(self, key):
        if not self.armed:
            return None
        rp = self._rel_pair(key)
        rel_pos, rel_vel = rp["relPos"], rp["relVel"]
        cov = self._combined_cov(key)
        if self.dynamics == "cw":
            rel0 = {"x": rel_pos["x"], "y": rel_pos["y"], "z": rel_pos["z"], "vx": rel_vel["x"], "vy": rel_vel["y"], "vz": rel_vel["z"]}
            ca = closest_approach_cw(rel0, self.meanMotion)
            tca = ca["tca"] if ca["tca"] > 1e-6 else -1
            predicted_miss = ca["miss"]
            s = cw_step(rel0, self.meanMotion, max(0.0, ca["tca"] - 0.5))
            pc_pos = {"x": s["x"], "y": s["y"], "z": s["z"]}
            pc_vel = {"x": s["vx"], "y": s["vy"], "z": s["vz"]}
        else:
            tca = tca_for(rel_pos, rel_vel)
            predicted_miss = miss_for(rel_pos, rel_vel)
            pc_pos, pc_vel = rel_pos, rel_vel
        rng = vmag(rel_pos)
        speed = vmag(rel_vel)
        closing = speed if tca > 0 else -speed
        ds = self._dsafe_for(key)
        required_dv = 0.0 if predicted_miss >= ds else solve_impulsive_dv(rel_pos, rel_vel, ds, self.dvBudget)
        pc = pc_for(pc_pos, pc_vel, cov, self.hardBody)
        return {
            "target": key, "relPos": rel_pos, "relVel": rel_vel, "tca": tca,
            "predictedMiss": predicted_miss, "range": rng, "closingSpeed": closing,
            "requiredDv": required_dv, "pc": pc,
            "safe": pc <= self.pcThreshold and predicted_miss >= ds,
        }

    def forecast(self):
        if not self.armed:
            return None
        ally = self._forecast_pair("ally")
        asteroid = self._forecast_pair("asteroid")
        extras = [self._forecast_pair(t["key"]) for t in self.extraThreats]
        all_t = [x for x in [ally, asteroid] + extras if x]
        def sev(x):
            return x["requiredDv"] / max(x["predictedMiss"], 0.01)
        worst = all_t[0]
        for x in all_t[1:]:
            if sev(x) >= sev(worst):
                worst = x
        return {"ally": ally, "asteroid": asteroid, "extras": extras, "all": all_t, "worst": worst}

    def best_burn_dir(self, key="ally"):
        fc = self._forecast_pair(key)
        if not fc:
            return {"x": 0, "y": 0, "z": 1}
        rel_pos, rel_vel = fc["relPos"], fc["relVel"]
        perp1 = vnorm(vcross(rel_vel, {"x": 0, "y": 1, "z": 0}))
        perp2 = vnorm(vcross(rel_vel, perp1))
        if vmag(perp2) < 1e-9:
            perp2 = vnorm(vcross(rel_vel, {"x": 1, "y": 0, "z": 0}))
        candidates = [perp1, vscale(perp1, -1), perp2, vscale(perp2, -1)]
        best = candidates[0]
        best_miss = -1.0
        eps = 1e-4
        for d in candidates:
            m = miss_for(rel_pos, vsub(rel_vel, vscale(d, eps)))
            if m > best_miss:
                best_miss = m
                best = d
        return best

    def required_dv_for_pc(self, key):
        rp = self._rel_pair(key)
        return solve_impulsive_dv_for_pc(rp["relPos"], rp["relVel"], self._combined_cov(key), self.hardBody, self.pcThreshold, self.dvBudget)

    def probe_forward(self):
        v = self.probe["vel"]
        m = vmag(v)
        return vnorm(v) if m > 1e-6 else {"x": 1, "y": 0, "z": 0}

    def _finish(self, status):
        self.status = status
        self.finished = True
        self._grade()

    def _grade(self):
        if self.status in (STATUS["COLLISION"], STATUS["UNSAFE"]):
            self.grade = "F"
            self.gradeRatio = (self.dvUsed / self.parDv) if self.parDv > 0 else None
            return
        ratio = (self.dvUsed / self.parDv) if self.parDv > 0 else 1.0
        self.gradeRatio = ratio
        self.grade = "A" if ratio <= 1.2 else ("B" if ratio <= 2.0 else "C")
