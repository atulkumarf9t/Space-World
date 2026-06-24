// physics_viz.js
// In-scene 3D visualization of the conjunction geometry: straight-line trajectory
// predictions (motion is constant-velocity between burns, so two points are exact),
// closest-approach (TCA) markers, the miss-distance segment, translucent safe-ring
// spheres around each threat, and the agent's planned burn-direction arrow.

import * as THREE from 'three';

const COL = {
  probe: 0x5cc8ff,
  ally: 0x3ad29f,
  asteroid: 0xc48855,
  safe: 0x3ad29f,
  danger: 0xff5d5d,
  burn: 0xff9f43,
};

function line(color, opacity = 0.8, dashed = false) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.15, gapSize: 0.1 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const l = new THREE.Line(geo, mat);
  l.frustumCulled = false;
  return l;
}

function setLine(l, a, b) {
  const p = l.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z);
  p.setXYZ(1, b.x, b.y, b.z);
  p.needsUpdate = true;
  if (l.material.isLineDashedMaterial) l.computeLineDistances();
}

function ring(color) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.012, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
  );
  m.frustumCulled = false;
  return m;
}

function safeSphere(color, r) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 24, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, wireframe: false, depthWrite: false })
  );
  const wire = new THREE.Mesh(
    new THREE.SphereGeometry(r, 16, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, wireframe: true, depthWrite: false })
  );
  m.add(wire);
  m.frustumCulled = false;
  return m;
}

export class PhysicsViz {
  constructor(scene, dSafe) {
    this.dSafe = dSafe;
    this.group = new THREE.Group();

    this.pathProbe = line(COL.probe, 0.55);
    this.pathAlly = line(COL.ally, 0.45, true);
    this.pathAst = line(COL.asteroid, 0.45, true);

    this.markAlly = ring(COL.ally);
    this.markAst = ring(COL.asteroid);
    this.missAlly = line(COL.danger, 0.9);
    this.missAst = line(COL.danger, 0.9);

    this.safeAlly = safeSphere(COL.ally, dSafe);
    this.safeAst = safeSphere(COL.asteroid, dSafe);

    this.ellAlly = this._ellipse(COL.ally);
    this.ellAst = this._ellipse(COL.asteroid);

    this.burnArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.8, COL.burn, 0.18, 0.1
    );
    this.velArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.6, COL.probe, 0.14, 0.08
    );

    this.group.add(
      this.pathProbe, this.pathAlly, this.pathAst,
      this.markAlly, this.markAst, this.missAlly, this.missAst,
      this.safeAlly, this.safeAst, this.ellAlly, this.ellAst,
      this.burnArrow, this.velArrow
    );
    this.extras = []; // pooled viz for additional threats
    this.group.visible = false;
    scene.add(this.group);
  }

  _ensureExtras(n) {
    while (this.extras.length < n) {
      const path = line(COL.asteroid, 0.45, true);
      const mark = ring(COL.asteroid);
      const miss = line(COL.danger, 0.9);
      const safe = safeSphere(COL.asteroid, this.dSafe);
      const ell = this._ellipse(COL.asteroid);
      const slot = { path, mark, miss, safe, ell };
      this.group.add(path, mark, miss, safe, ell);
      this.extras.push(slot);
    }
  }

  _ellipse(color, N = 48) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 3), 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
    const l = new THREE.Line(geo, mat);
    l.frustumCulled = false;
    l.userData.N = N;
    return l;
  }

  // Draw the n-sigma uncertainty footprint as a closed ring in the B-plane.
  _updateEllipse(line, u, nSigma = 3) {
    if (!u) { line.visible = false; return; }
    const N = line.userData.N;
    const p = line.geometry.attributes.position;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const a = nSigma * u.s1 * Math.cos(t);
      const b = nSigma * u.s2 * Math.sin(t);
      p.setXYZ(i,
        u.center.x + u.axis1.x * a + u.axis2.x * b,
        u.center.y + u.axis1.y * a + u.axis2.y * b,
        u.center.z + u.axis1.z * a + u.axis2.z * b);
    }
    p.needsUpdate = true;
    line.visible = true;
  }

  _at(body, t) {
    return {
      x: body.pos.x + body.vel.x * t,
      y: body.pos.y + body.vel.y * t,
      z: body.pos.z + body.vel.z * t,
    };
  }

  // args: { armed, probe, ally, asteroid, allyFc, asteroidFc, worstBurnDir }
  update(args) {
    this.group.visible = !!args.armed;
    if (!args.armed) return;
    const { probe, ally, asteroid, allyFc, asteroidFc, worstBurnDir } = args;

    const horizon = Math.min(
      30,
      Math.max(3, allyFc?.tca > 0 ? allyFc.tca : 3, asteroidFc?.tca > 0 ? asteroidFc.tca : 3)
    );

    // Trajectory predictions (exact: constant velocity).
    setLine(this.pathProbe, probe.pos, this._at(probe, horizon));
    setLine(this.pathAlly, ally.pos, this._at(ally, horizon));
    setLine(this.pathAst, asteroid.pos, this._at(asteroid, horizon));

    this._threat(this.markAlly, this.missAlly, probe, ally, allyFc);
    this._threat(this.markAst, this.missAst, probe, asteroid, asteroidFc);

    this._updateEllipse(this.ellAlly, allyFc?.uncertainty ?? null);
    this._updateEllipse(this.ellAst, asteroidFc?.uncertainty ?? null);

    // Extra threats.
    const extras = args.extras || [];
    this._ensureExtras(extras.length);
    for (let i = 0; i < this.extras.length; i++) {
      const slot = this.extras[i];
      const e = extras[i];
      const show = !!e && !!e.body;
      slot.path.visible = slot.mark.visible = slot.miss.visible = slot.safe.visible = slot.ell.visible = show;
      if (!show) continue;
      const h = e.fc?.tca > 0 ? Math.min(30, Math.max(3, e.fc.tca)) : 6;
      setLine(slot.path, e.body.pos, this._at(e.body, h));
      this._threat(slot.mark, slot.miss, probe, e.body, e.fc);
      slot.safe.position.set(e.body.pos.x, e.body.pos.y, e.body.pos.z);
      this._updateEllipse(slot.ell, e.fc?.uncertainty ?? null);
    }

    // Safe-ring spheres ride the threats.
    this.safeAlly.position.set(ally.pos.x, ally.pos.y, ally.pos.z);
    this.safeAst.position.set(asteroid.pos.x, asteroid.pos.y, asteroid.pos.z);

    // Probe velocity arrow.
    const v = new THREE.Vector3(probe.vel.x, probe.vel.y, probe.vel.z);
    const vlen = v.length();
    this.velArrow.position.set(probe.pos.x, probe.pos.y, probe.pos.z);
    if (vlen > 1e-6) {
      this.velArrow.setDirection(v.clone().normalize());
      this.velArrow.setLength(0.7, 0.16, 0.09);
      this.velArrow.visible = true;
    } else this.velArrow.visible = false;

    // Planned burn-direction arrow (only when a maneuver is actually needed).
    const need = (allyFc && !allyFc.safe) || (asteroidFc && !asteroidFc.safe);
    if (need && worstBurnDir) {
      const d = new THREE.Vector3(worstBurnDir.x, worstBurnDir.y, worstBurnDir.z);
      if (d.lengthSq() > 1e-9) {
        this.burnArrow.position.set(probe.pos.x, probe.pos.y, probe.pos.z);
        this.burnArrow.setDirection(d.normalize());
        this.burnArrow.setLength(0.9, 0.2, 0.11);
        this.burnArrow.visible = true;
      }
    } else this.burnArrow.visible = false;
  }

  _threat(mark, missLine, probe, body, fc) {
    if (!fc || fc.tca <= 0) {
      mark.visible = false;
      missLine.visible = false;
      return;
    }
    const t = fc.tca;
    const pAt = this._at(probe, t);
    const bAt = this._at(body, t);
    mark.position.set(bAt.x, bAt.y, bAt.z);
    mark.lookAt(pAt.x, pAt.y, pAt.z);
    mark.visible = true;

    const col = fc.safe ? COL.safe : COL.danger;
    mark.material.color.setHex(col);
    missLine.material.color.setHex(col);
    setLine(missLine, pAt, bAt);
    missLine.visible = true;
  }
}
