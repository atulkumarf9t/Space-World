// dynamics.js — optional orbital relative motion (Clohessy–Wiltshire / Hill's
// equations) for a "realism" mode. Default sim uses straight-line relative motion;
// CW adds the curvature real proximity operations must account for.
//
// World-axis mapping into the CW frame: radial = +X, along-track = +Z, cross-track = +Y.
// As mean motion n -> 0, every formula reduces to straight-line motion (tested).

// Propagate a 6-state {x,y,z,vx,vy,vz} forward by dt under CW with mean motion n.
export function cwStep(s, n, dt) {
  if (Math.abs(n) < 1e-12) {
    return { x: s.x + s.vx * dt, y: s.y + s.vy * dt, z: s.z + s.vz * dt, vx: s.vx, vy: s.vy, vz: s.vz };
  }
  // map world -> CW (radial=x, along=z(world), cross=y(world))
  const x0 = s.x, vx0 = s.vx;   // radial
  const y0 = s.z, vy0 = s.vz;   // along-track
  const z0 = s.y, vz0 = s.vy;   // cross-track
  const t = dt, c = Math.cos(n * t), si = Math.sin(n * t);

  const x = (4 - 3 * c) * x0 + (si / n) * vx0 + (2 / n) * (1 - c) * vy0;
  const y = 6 * (si - n * t) * x0 + y0 + (2 / n) * (c - 1) * vx0 + (1 / n) * (4 * si - 3 * n * t) * vy0;
  const z = c * z0 + (si / n) * vz0;
  const vx = 3 * n * si * x0 + c * vx0 + 2 * si * vy0;
  const vy = 6 * n * (c - 1) * x0 - 2 * si * vx0 + (4 * c - 3) * vy0;
  const vz = -n * si * z0 + c * vz0;

  // map CW -> world (world x=radial, world z=along, world y=cross)
  return { x, y: z, z: y, vx, vy: vz, vz: vy };
}

// Numerical closest approach of a relative state under CW (or linear when n=0).
// Returns { tca, relPos, relVel, miss }.
export function closestApproachCW(rel, n, { horizon = 80, coarse = 0.5 } = {}) {
  let best = { t: 0, r: Infinity, s: rel };
  for (let t = 0; t <= horizon; t += coarse) {
    const st = cwStep(rel, n, t);
    const r = Math.hypot(st.x, st.y, st.z);
    if (r < best.r) best = { t, r, s: st };
  }
  // refine around the coarse minimum
  const lo = Math.max(0, best.t - coarse), hi = best.t + coarse;
  for (let t = lo; t <= hi; t += coarse / 25) {
    const st = cwStep(rel, n, t);
    const r = Math.hypot(st.x, st.y, st.z);
    if (r < best.r) best = { t, r, s: st };
  }
  return {
    tca: best.t,
    miss: best.r,
    relPos: { x: best.s.x, y: best.s.y, z: best.s.z },
    relVel: { x: best.s.vx, y: best.s.vy, z: best.s.vz },
  };
}
