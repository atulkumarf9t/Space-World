// scene3d.js
// Three.js third-person scene: detailed ion-propulsion probe, ally, asteroid,
// starfield, Reactor VideoTexture backdrop, in-scene physics visualization,
// UnrealBloom glow, and 3D->screen projection for HUD reticles.

import * as THREE from 'three';
import { PhysicsViz } from './physics_viz.js';

let EffectComposer, RenderPass, UnrealBloomPass, OutputPass, VRButton;
try {
  ({ EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js'));
  ({ RenderPass } = await import('three/addons/postprocessing/RenderPass.js'));
  ({ UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js'));
  ({ OutputPass } = await import('three/addons/postprocessing/OutputPass.js'));
} catch (e) {
  console.warn('[scene3d] postprocessing unavailable, bloom disabled:', e.message);
}
try {
  ({ VRButton } = await import('three/addons/webxr/VRButton.js'));
} catch (e) {
  console.warn('[scene3d] WebXR button unavailable:', e.message);
}

const KM_SCALE = 1; // 1 Three.js unit = 1 km

export class Scene3D {
  constructor(mountEl, opts = {}) {
    this.width = opts.width ?? 960;
    this.height = opts.height ?? 540;
    this.mountEl = mountEl;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.xr.enabled = true; // WebXR / VR
    mountEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, this.width / this.height, 0.01, 500);
    this.scene.add(this.camera);

    this._videoTexture = null;
    this._starfield = this._makeStarfield();
    this.scene.add(this._starfield);

    this.ambient = new THREE.AmbientLight(0x446688, 0.4);
    this.sun = new THREE.DirectionalLight(0xaaccff, 1.2);
    this.sun.position.set(5, 8, 3);
    this.rim = new THREE.DirectionalLight(0x88bbff, 0.5);
    this.rim.position.set(-6, -2, -5);
    this.scene.add(this.ambient, this.sun, this.rim);

    this.probe = this._makeProbe(0.08);
    this.ally = this._makeSatellite(0x3ad29f, 0.1);
    this.asteroid = this._makeAsteroid(0.15);
    this.scene.add(this.probe, this.ally, this.asteroid);

    this.viz = new PhysicsViz(this.scene, opts.dSafe ?? 0.5);
    this.extraMeshes = []; // pooled meshes for additional threats

    this._camOffset = new THREE.Vector3(0, 0.35, -1.2);
    this._camLookAhead = 0.6;
    this._lightLevel = 1;
    this._shake = 0;
    this._plumeFlicker = 0;

    this._setupBloom();
  }

  _setupBloom() {
    this.composer = null;
    if (!EffectComposer) return;
    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        0.7, // strength
        0.5, // radius
        0.82 // threshold
      );
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } catch (e) {
      console.warn('[scene3d] bloom setup failed:', e.message);
      this.composer = null;
    }
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }

  setVideoElement(video) {
    if (!video) {
      this._videoTexture = null;
      this.scene.background = null;
      return;
    }
    this._videoTexture = new THREE.VideoTexture(video);
    this._videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this._videoTexture;
  }

  setLightLevel(v) {
    this._lightLevel = Math.min(1, Math.max(0.15, v));
    this.sun.intensity = 0.3 + this._lightLevel * 1.1;
    this.ambient.intensity = 0.15 + this._lightLevel * 0.35;
    // Solar arrays glow brighter in full sun (visual power cue).
    if (this._panelMat) this._panelMat.emissiveIntensity = 0.12 + this._lightLevel * 0.5;
  }

  render(state) {
    const {
      probe, ally, asteroid, armed, thrusting, powerAuthority,
      forecast, dSafe, worstBurnDir, dt = 0.016,
    } = state;

    this.probe.position.set(probe.pos.x, probe.pos.y, probe.pos.z);
    this.ally.position.set(ally.pos.x, ally.pos.y, ally.pos.z);
    this.asteroid.position.set(asteroid.pos.x, asteroid.pos.y, asteroid.pos.z);

    this.ally.visible = armed;
    this.asteroid.visible = armed;

    // Extra threats (debris field).
    const extras = state.extraThreats || [];
    while (this.extraMeshes.length < extras.length) {
      const m = this._makeAsteroid(0.12);
      this.scene.add(m);
      this.extraMeshes.push(m);
    }
    for (let i = 0; i < this.extraMeshes.length; i++) {
      const m = this.extraMeshes[i];
      if (i < extras.length && armed) {
        m.visible = true;
        m.position.set(extras[i].pos.x, extras[i].pos.y, extras[i].pos.z);
        m.rotation.x += dt * 0.4; m.rotation.y += dt * 0.3;
      } else m.visible = false;
    }

    const fwd = new THREE.Vector3(probe.vel.x, probe.vel.y, probe.vel.z);
    if (fwd.lengthSq() < 1e-8) fwd.set(1, 0, 0);
    fwd.normalize();
    this.probe.lookAt(
      this.probe.position.x + fwd.x,
      this.probe.position.y + fwd.y,
      this.probe.position.z + fwd.z
    );

    const allyDir = new THREE.Vector3(
      ally.pos.x - probe.pos.x,
      ally.pos.y - probe.pos.y,
      ally.pos.z - probe.pos.z
    );
    if (allyDir.lengthSq() > 1e-6) {
      this.ally.lookAt(
        this.ally.position.x + allyDir.x,
        this.ally.position.y + allyDir.y,
        this.ally.position.z + allyDir.z
      );
    }

    // Asteroid slow tumble.
    this.asteroid.rotation.x += dt * 0.3;
    this.asteroid.rotation.y += dt * 0.22;

    // Ion plume + thruster glow scale with delivered thrust and available power.
    const thrustFrac = thrusting ? Math.max(0.15, powerAuthority ?? 1) : 0;
    this._plumeFlicker += dt * 30;
    const flick = 0.85 + 0.15 * Math.sin(this._plumeFlicker) + (Math.random() - 0.5) * 0.08;
    const len = thrustFrac > 0 ? (0.5 + thrustFrac * 1.6) * flick : 0;
    this.plume.scale.set(thrustFrac > 0 ? 0.7 + thrustFrac * 0.6 : 0.001, len || 0.001, thrustFrac > 0 ? 0.7 + thrustFrac * 0.6 : 0.001);
    this.plume.visible = thrustFrac > 0;
    this.plumeCore.visible = thrustFrac > 0;
    this.plume.material.opacity = 0.55 * thrustFrac;
    this.thrustGlow.intensity = thrustFrac > 0 ? 2.2 * thrustFrac * flick : 0;
    this._shake = thrustFrac * 0.012;

    // Physics visualization layer.
    this.viz.update({
      armed,
      probe, ally, asteroid,
      allyFc: forecast?.ally ?? null,
      asteroidFc: forecast?.asteroid ?? null,
      extras: extras.map((b, i) => ({ body: b, fc: forecast?.extras?.[i] ?? null })),
      worstBurnDir,
    });

    if (this._videoTexture) this._videoTexture.needsUpdate = true;

    if (this.renderer.xr.isPresenting) {
      // In VR the headset drives the camera; bloom composer is bypassed.
      this.renderer.render(this.scene, this.camera);
    } else {
      this._updateCamera(probe);
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    }
  }

  isPresenting() {
    return !!(this.renderer.xr && this.renderer.xr.isPresenting);
  }

  // Add an "Enter VR" button if a headset is available. The XR session drives the
  // render loop via setAnimationLoop; the non-VR rAF path is unaffected.
  async enableVR(container, frameFn) {
    if (!VRButton || typeof navigator === 'undefined' || !navigator.xr) return false;
    let ok = false;
    try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch { ok = false; }
    if (!ok) return false;
    container.appendChild(VRButton.createButton(this.renderer));
    this.renderer.xr.addEventListener('sessionstart', () => this.renderer.setAnimationLoop(frameFn));
    this.renderer.xr.addEventListener('sessionend', () => this.renderer.setAnimationLoop(null));
    return true;
  }

  projectWorldPos(x, y, z) {
    const v = new THREE.Vector3(x, y, z);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height,
      behind: v.z > 1,
      ndcZ: v.z,
    };
  }

  getCanvas() {
    return this.renderer.domElement;
  }

  _updateCamera(probe) {
    const pos = new THREE.Vector3(probe.pos.x, probe.pos.y, probe.pos.z);
    const vel = new THREE.Vector3(probe.vel.x, probe.vel.y, probe.vel.z);
    if (vel.lengthSq() < 1e-8) vel.set(1, 0, 0);
    vel.normalize();

    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, vel).normalize();
    const camUp = new THREE.Vector3().crossVectors(vel, right);

    const offset = new THREE.Vector3()
      .addScaledVector(right, this._camOffset.x)
      .addScaledVector(camUp, this._camOffset.y)
      .addScaledVector(vel, this._camOffset.z);

    if (this._shake > 0) {
      offset.addScaledVector(right, (Math.random() - 0.5) * this._shake);
      offset.addScaledVector(camUp, (Math.random() - 0.5) * this._shake);
    }

    const camPos = pos.clone().add(offset);
    const lookAt = pos.clone().addScaledVector(vel, this._camLookAhead);

    this.camera.position.copy(camPos);
    this.camera.up.copy(camUp);
    this.camera.lookAt(lookAt);
  }

  // ---- meshes -------------------------------------------------------------

  // Detailed solar-electric ion probe. Local frame: nose at -Z (faces velocity),
  // thruster + plume at +Z, solar arrays along ±X.
  _makeProbe(s) {
    const g = new THREE.Group();

    const foil = new THREE.MeshStandardMaterial({
      color: 0xcaa85e, metalness: 0.85, roughness: 0.35, emissive: 0x3a2c10, emissiveIntensity: 0.2,
    });
    const hull = new THREE.MeshStandardMaterial({
      color: 0x9fb2c8, metalness: 0.7, roughness: 0.4, emissive: 0x10202f, emissiveIntensity: 0.2,
    });

    // Octagonal main bus along Z.
    const bus = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.42, s * 0.42, s * 0.9, 8), foil);
    bus.rotation.x = Math.PI / 2;
    g.add(bus);

    // Forward nose cone (sensor head) at -Z.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(s * 0.42, s * 0.5, 8), hull);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -s * 0.7;
    g.add(nose);

    // Solar arrays: gridded panels on booms along ±X.
    this._panelMat = new THREE.MeshStandardMaterial({
      map: this._solarTexture(), color: 0x4466aa, metalness: 0.4, roughness: 0.5,
      emissive: 0x1b3a6b, emissiveIntensity: 0.4,
    });
    const boomMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.4 });
    for (const sign of [-1, 1]) {
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 0.7, 6), boomMat);
      boom.rotation.z = Math.PI / 2;
      boom.position.x = sign * s * 0.6;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 0.04, s * 0.95), this._panelMat);
      panel.position.x = sign * s * 1.6;
      g.add(boom, panel);
    }

    // High-gain antenna dish on top, facing forward.
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide })
    );
    dish.rotation.x = -Math.PI / 2.3;
    dish.position.set(0, s * 0.45, -s * 0.1);
    g.add(dish);

    // Gridded ion thruster ring at the rear (+Z).
    const thruster = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.3, s * 0.34, s * 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x33414f, metalness: 0.6, roughness: 0.5 })
    );
    thruster.rotation.x = Math.PI / 2;
    thruster.position.z = s * 0.55;
    g.add(thruster);
    // Glowing accelerator grid recessed in the thruster.
    const grid = new THREE.Mesh(
      new THREE.CircleGeometry(s * 0.26, 24),
      new THREE.MeshBasicMaterial({ color: 0x7fdfff })
    );
    grid.position.z = s * 0.5;
    grid.rotation.y = Math.PI;
    g.add(grid);

    // Nav beacon.
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x88ffaa })
    );
    beacon.position.set(0, s * 0.5, -s * 0.4);
    g.add(beacon);

    // Ion plume: open cone widening backward from the grid. Built along +Y then
    // rotated to +Z; scale.y is animated by thrust in render().
    const plumeGeo = new THREE.ConeGeometry(s * 0.5, s * 1.0, 18, 1, true);
    plumeGeo.translate(0, -s * 0.5, 0); // base at origin, tip toward -Y
    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0x66d9ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.plume = new THREE.Mesh(plumeGeo, plumeMat);
    this.plume.rotation.x = -Math.PI / 2; // +Y(base->tip toward -Y) maps so plume extends +Z
    this.plume.position.z = s * 0.6;
    g.add(this.plume);

    // Bright plume core (bloom seed).
    this.plumeCore = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.18, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xbff0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.plumeCore.position.z = s * 0.62;
    g.add(this.plumeCore);

    this.thrustGlow = new THREE.PointLight(0x6fd6ff, 0, 0.8);
    this.thrustGlow.position.z = s * 0.7;
    g.add(this.thrustGlow);

    return g;
  }

  _solarTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#16386b';
    ctx.fillRect(0, 0, 128, 80);
    ctx.fillStyle = '#1e4f9c';
    const cols = 8;
    const rows = 5;
    const gap = 2;
    const cw = (128 - gap * (cols + 1)) / cols;
    const ch = (80 - gap * (rows + 1)) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        ctx.fillRect(gap + i * (cw + gap), gap + j * (ch + gap), cw, ch);
      }
    }
    ctx.strokeStyle = 'rgba(140,180,255,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= cols; i++) {
      const x = gap / 2 + i * (cw + gap);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 80); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeSatellite(color, scale) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(scale * 0.6, scale * 0.4, scale * 0.8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.4 })
    );
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x224488, emissive: 0x112244, emissiveIntensity: 0.2, metalness: 0.8, roughness: 0.3 });
    const panelL = new THREE.Mesh(new THREE.BoxGeometry(scale * 1.2, scale * 0.05, scale * 0.5), panelMat);
    const panelR = panelL.clone();
    panelL.position.x = -scale * 0.9;
    panelR.position.x = scale * 0.9;
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(scale * 0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x88ffaa })
    );
    beacon.position.y = scale * 0.28;
    g.add(body, panelL, panelR, beacon);
    return g;
  }

  _makeAsteroid(scale) {
    const geo = new THREE.IcosahedronGeometry(scale, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) + (Math.random() - 0.5) * 0.15;
      const ny = pos.getY(i) + (Math.random() - 0.5) * 0.15;
      const nz = pos.getZ(i) + (Math.random() - 0.5) * 0.15;
      pos.setXYZ(i, nx, ny, nz);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x886644, emissive: 0x332211, emissiveIntensity: 0.15, roughness: 0.9, metalness: 0.1 })
    );
    return mesh;
  }

  _makeStarfield() {
    const n = 1200;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xaaccff, size: 0.08, sizeAttenuation: true });
    return new THREE.Points(geo, mat);
  }
}
