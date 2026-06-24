// orchestrator.js
// Shared state, three loops (8/10/1 Hz), 3D render + Reactor backdrop, dual-threat timeline.

import { Physics } from './physics.js';
import { FlightModel } from './flight_model.js';
import { ControlAuthority, OWNER } from './control_authority.js';
import { Agent } from './agent.js';
import { WorldClient } from './world_client.js';
import { Scene3D } from './scene3d.js';
import { FrameGrabber } from './frame_grabber.js';
import { PixelSense } from './pixel_sense.js';
import { VlmSense } from './vlm_sense.js';
import { Telemetry } from './telemetry.js';
import { Overlay } from './overlay.js';
import { Audio } from './audio.js';
import { Campaign, LEVELS } from './campaign.js';
import { llmPolicy } from './policies.js';
import { Recorder } from './reactor_record.js';

const CFG = {
  scenario: {
    allyPos: { x: 8, y: 0.42, z: 0 },
    allyVel: { x: 0, y: 0, z: 0 },
    asteroidPos: { x: 4, y: -0.35, z: 3 },
    asteroidVel: { x: -0.06, y: 0, z: -0.04 },
  },
  dSafe: 0.5,
  hardBody: 0.05,
  dvBudget: 12,
  thrustAccel: 0.0008,
  cruiseSeconds: 3.0,
  shadowStart: 6.0,
  shadowEnd: 13.0,
  shadowLevel: 0.3,
  flightHz: 8,
  pixelHz: 10,
  cognitionHz: 1,
  width: 960,
  height: 540,
};

class Orchestrator {
  constructor(dom) {
    this.dom = dom;
    this.phys = new Physics({ dSafe: CFG.dSafe, hardBody: CFG.hardBody, dvBudget: CFG.dvBudget });
    this.fm = new FlightModel(this.phys, { thrustAccel: CFG.thrustAccel });
    this.auth = new ControlAuthority();
    this.agent = new Agent(this.phys, this.fm);
    this.world = new WorldClient({
      initialPrompt: 'first-person view drifting through deep space over a banded gas giant at dusk, stars and nebula',
    });
    this.scene3d = new Scene3D(dom.worldMount, { width: CFG.width, height: CFG.height, dSafe: CFG.dSafe });
    this.grabber = new FrameGrabber();
    this.pixels = new PixelSense();
    this.vlm = new VlmSense();
    this.telemetry = new Telemetry(this.phys, this.fm, this.auth, this.scene3d);
    this.overlay = new Overlay(dom.overlay);
    this.audio = new Audio();
    this.campaign = new Campaign(typeof localStorage !== 'undefined' ? localStorage : null);
    this.activeScenario = CFG.scenario;
    this.brain = 'autopilot'; // 'autopilot' (deterministic) | 'llm'
    this.geminiAvailable = false;
    this.llm = llmPolicy({ endpoint: '/api/agent' });
    this._lastLlmAction = '';

    this.phase = 'cruise';
    this.totalElapsed = 0;
    this.refLum = 1;
    this.targetLight = 1.0;
    this.curLight = 1.0;
    this.finishedHandled = false;
    this.armingEnabled = false;

    this._flightAcc = 0;
    this._pixelAcc = 0;
    this._cogAcc = 0;
    this._last = 0;

    this.auth.onChange((e) => this.agent.onHandoff(e));
  }

  async start() {
    const params = new URLSearchParams(location.search);
    let token = params.get('reactorToken') || window.REACTOR_TOKEN || '';
    const modelName = params.get('model') || 'lingbot';

    if (params.get('level')) this.campaign.select(params.get('level'));
    this._loadLevel(this.campaign.current(), params.get('dynamics'));

    this.recorder = new Recorder({ enabled: params.get('record') === '1' });
    window.__driftRecorder = this.recorder;

    if (!token) {
      try {
        const cfg = await fetch('/api/config').then((r) => r.json());
        if (cfg.gemini) this.vlm.useGemini = true;
        this.geminiAvailable = !!cfg.gemini;
        if (cfg.reactor) {
          const tok = await fetch('/api/reactor-token', { method: 'POST' }).then((r) => r.json());
          if (tok.jwt) token = tok.jwt;
        }
      } catch { /* offline */ }
    }

    const res = await this.world.connect(token, modelName);
    this.dom.modeBadge.textContent = res.mode === 'real' ? 'REACTOR LIVE' : 'MOCK BACKDROP';
    this.dom.modeBadge.dataset.mode = res.mode;

    const video = this.world.getVideoElement();
    if (video) {
      this.scene3d.setVideoElement(video);
      this.grabber.attach(video);
    } else {
      this.grabber.attach(this.scene3d.getCanvas());
    }

    this.overlay.resize(CFG.width, CFG.height);
    this.auth.enable();
    this._bindUi();

    this.agent.say('Probe online. Cruising in 3D. Scanning for traffic.', 'info');
    this._last = performance.now();
    this.scene3d.enableVR(document.body, () => this._frame(performance.now())).catch(() => {});
    requestAnimationFrame((t) => this._frame(t));
  }

  _bindUi() {
    this.dom.grabBtn.addEventListener('click', () => this.auth.toggle());
    window.addEventListener('keydown', (e) => {
      if (!this.armingEnabled) { this._begin(); return; }
      const k = e.key.toLowerCase();
      if (k === 'r' && this.phys.finished) this._restart();
      if (k === 'm') this.audio.toggleMute();
      if (k === 'b') this.toggleBrain();
    });
    if (this.dom.introGo) this.dom.introGo.addEventListener('click', () => this._begin());
    if (this.dom.brainBtn) this.dom.brainBtn.addEventListener('click', () => this.toggleBrain());
    if (this.dom.benchBtn) this.dom.benchBtn.addEventListener('click', () => this.runBenchmark());
    this._renderBrainBtn();
    if (this.dom.levels) {
      this.dom.levels.addEventListener('click', (e) => {
        const el = e.target.closest('[data-level]');
        if (el) this.selectLevel(el.dataset.level);
      });
    }
    this._renderCampaign();
  }

  _renderCampaign() {
    const host = this.dom.levels;
    if (!host) return;
    const curId = this.campaign.current().id;
    host.innerHTML = '';
    for (const lv of LEVELS) {
      const best = this.campaign.best(lv.id);
      const g = best ? best.grade : null;
      const btn = document.createElement('button');
      btn.className = 'level' + (lv.id === curId ? ' active' : '');
      btn.dataset.level = lv.id;
      btn.innerHTML =
        `<span><span class="l-name">${lv.name}</span><div class="l-desc">${lv.desc}</div></span>` +
        `<span class="l-grade ${g || 'none'}">${g || '—'}</span>`;
      host.appendChild(btn);
    }
    if (this.dom.stars) this.dom.stars.textContent = `★ ${this.campaign.totalStars()} / ${this.campaign.maxStars()}`;
  }

  _begin() {
    if (this.armingEnabled) return;
    this.armingEnabled = true;
    this.totalElapsed = 0;
    this.phase = 'cruise';
    this.audio.init(); // user gesture — safe to start audio
    if (this.dom.intro) this.dom.intro.classList.add('hide');
  }

  // Observation for the LLM policy (same shape the headless Simulation builds).
  _observeLive() {
    const fc = this.phys.forecast();
    const threats = fc ? (fc.all || []) : [];
    let worst = null, worstReqDv = 0;
    for (const th of threats) {
      const reqDv = th.safe ? 0 : Math.max(th.requiredDv, th.pc > this.phys.pcThreshold ? this.phys.requiredDvForPc(th.target) : 0);
      if (!th.safe && reqDv >= worstReqDv) { worst = th; worstReqDv = reqDv; }
    }
    return {
      worst: worst && { target: worst.target, pc: worst.pc, predictedMiss: worst.predictedMiss, tca: worst.tca, safe: worst.safe },
      worstBurnDir: worst ? this.phys.bestBurnDir(worst.target) : { x: 0, y: 0, z: 1 },
      worstRecommendedDv: worstReqDv,
      dSafe: this.phys.dSafe,
      pcThreshold: this.phys.pcThreshold,
      budgetRemaining: this.phys.dvRemaining,
      dvUsed: this.phys.dvUsed,
      parDv: this.phys.parDv,
      powerAuthority: this.fm.powerAuthority,
    };
  }

  // Deterministic guard for LLM actions (same contract as the headless core).
  _executeLLM(action) {
    if (!action || action.type !== 'burn') { this.fm.cancelBurn(); return; }
    const d = action.dir;
    if (!d || !isFinite(d.x) || !isFinite(d.y) || !isFinite(d.z)) { this.fm.cancelBurn(); return; }
    const dv = Math.max(0, Math.min(this.phys.dvRemaining, +action.dv || 0));
    if (dv <= 0) { this.fm.cancelBurn(); return; }
    this.fm.setBurn({ dir: d, targetDv: dv });
    const sig = `${dv.toFixed(2)}@${d.x.toFixed(1)},${d.y.toFixed(1)},${d.z.toFixed(1)}`;
    if (sig !== this._lastLlmAction) {
      this._lastLlmAction = sig;
      this.agent.say(`LLM brain: burn ${dv.toFixed(2)} m/s toward avoidance.`, 'plan');
    }
  }

  // Run the policy benchmark off the main thread (Web Worker) so the UI stays live.
  runBenchmark(n = 100) {
    if (typeof Worker === 'undefined') { this.agent.say('Web Workers unavailable in this browser.', 'info'); return; }
    if (this._benchRunning) return;
    this._benchRunning = true;
    if (this.dom.benchBtn) { this.dom.benchBtn.disabled = true; this.dom.benchBtn.textContent = 'BENCHMARKING…'; }
    this.agent.say(`Running ${n}-encounter benchmark off-thread…`, 'info');
    try {
      const w = new Worker(new URL('./benchmark.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        for (const r of e.data.rows) {
          this.agent.say(`bench ${r.name}: ${r.success} resolved · ${r.ratio} par · ${r.over} over-budget`, r.name === 'optimal' ? 'good' : 'info');
        }
        this._benchDone(w);
      };
      w.onerror = (err) => { this.agent.say('Benchmark error: ' + (err.message || 'worker failed'), 'refuse'); this._benchDone(w); };
      w.postMessage({ n });
    } catch (err) {
      this.agent.say('Benchmark could not start: ' + err.message, 'refuse');
      this._benchDone(null);
    }
  }

  _benchDone(w) {
    this._benchRunning = false;
    if (w) w.terminate();
    if (this.dom.benchBtn) { this.dom.benchBtn.disabled = false; this.dom.benchBtn.textContent = 'BENCHMARK'; }
  }

  toggleBrain() {
    if (!this.geminiAvailable) {
      this.agent.say('LLM brain needs GEMINI_API_KEY — staying on deterministic autopilot.', 'info');
      return;
    }
    this.brain = this.brain === 'llm' ? 'autopilot' : 'llm';
    this.fm.cancelBurn();
    this._lastLlmAction = '';
    this._renderBrainBtn();
    this.agent.say(`Brain switched to ${this.brain === 'llm' ? 'LLM (Gemini)' : 'deterministic autopilot'}.`, 'handoff');
  }

  _renderBrainBtn() {
    const b = this.dom.brainBtn;
    if (!b) return;
    if (!this.geminiAvailable) { b.textContent = 'BRAIN: AUTOPILOT (LLM needs key)'; b.dataset.brain = 'autopilot'; b.disabled = true; return; }
    b.disabled = false;
    b.textContent = this.brain === 'llm' ? 'BRAIN: LLM (Gemini)' : 'BRAIN: AUTOPILOT';
    b.dataset.brain = this.brain;
  }

  _loadLevel(level, dynamicsOverride) {
    let sc = level.scenario();
    if (dynamicsOverride === 'cw') sc = { ...sc, dynamics: 'cw', meanMotion: sc.meanMotion ?? 0.05 };
    else if (dynamicsOverride === 'linear') sc = { ...sc, dynamics: 'linear' };
    this.activeScenario = sc;
    this._renderCampaign();
  }

  // Switch level from the UI: load it and start a fresh encounter.
  selectLevel(id) {
    this.campaign.select(id);
    this._loadLevel(this.campaign.current());
    this.audio.init();
    this._restart();
    if (!this.armingEnabled) this._begin();
  }

  _restart() {
    this.phys.reset();
    this.agent.reset();
    this.fm.cancelBurn();
    this.agent.feed.length = 0;
    this.phase = 'cruise';
    this.totalElapsed = 0;
    this.finishedHandled = false;
    this.targetLight = 1.0;
    this.auth.release();
    this.agent.say('Reset. Cruising. Scanning for traffic.', 'info');
  }

  _frame(t) {
    let dt = (t - this._last) / 1000;
    this._last = t;
    if (dt > 0.1) dt = 0.1;
    this.totalElapsed += dt;

    this._timeline(dt);

    this.curLight += (this.targetLight - this.curLight) * Math.min(1, dt * 2.5);
    this.scene3d.setLightLevel(this.curLight);

    this._flightAcc += dt;
    const fdt = 1 / CFG.flightHz;
    while (this._flightAcc >= fdt) {
      this._flightAcc -= fdt;
      this._stepPhysics(fdt);
    }

    const fc = this.phys.armed ? this.phys.forecast() : null;
    const worstBurnDir = fc?.worst && !fc.worst.safe ? this.phys.bestBurnDir(fc.worst.target) : null;
    this.scene3d.render({
      probe: this.phys.probe,
      ally: this.phys.ally,
      asteroid: this.phys.asteroid,
      extraThreats: this.phys.extraThreats,
      armed: this.phys.armed,
      thrusting: this.fm.thrustingNow,
      powerAuthority: this.fm.powerAuthority,
      forecast: fc,
      dSafe: CFG.dSafe,
      worstBurnDir,
      dt,
    });

    this.audio.setThrust(this.fm.thrustingNow ? this.fm.powerAuthority : 0);
    this.audio.setLight(this.curLight);

    this.grabber.update();

    this._pixelAcc += dt;
    if (this._pixelAcc >= 1 / CFG.pixelHz) {
      this._pixelAcc = 0;
      const pf = this.pixels.process(this.grabber.getImageData());
      if (this.phase === 'cruise') this.refLum = Math.max(this.refLum, pf.luminance);
      const power = this.world.mode === 'real'
        ? Math.min(1, Math.max(0.15, pf.luminance / (this.refLum * 0.95 || 1)))
        : this.curLight;
      this.fm.setPowerAuthority(power);
      this.agent.notePower(power);
      if (this.recorder.enabled) {
        const dvNow = this.phys.dvUsed;
        const dvStep = Math.max(0, dvNow - (this._recLastDv ?? dvNow));
        this._recLastDv = dvNow;
        const fc = this.phys.armed ? this.phys.forecast() : null;
        const w = fc?.worst ?? null;
        this.recorder.capture({
          t: this.totalElapsed,
          frame: this.grabber.getJpeg(0.5),
          luminance: pf.luminance,
          power,
          control: this.fm.controlForReactor(),
          mode: this.world.mode,
          dv: dvStep,                                  // BC label
          nobs: [                                      // compact numeric obs (fair vs pixels)
            +(w?.pc ?? 0).toFixed(4),
            +((w?.predictedMiss ?? 5) / 10).toFixed(4),
            +(Math.min(Math.max(w?.tca ?? 45, 0), 120) / 45).toFixed(4),
            +power.toFixed(3),
            +(this.phys.dvRemaining / this.phys.dvBudget).toFixed(4),
          ],
        });
      }
    }

    this.world.syncControl(this.fm.controlForReactor());

    this._cogAcc += dt;
    if (this._cogAcc >= 1 / CFG.cognitionHz) {
      this._cogAcc = 0;
      this.agent.tick(this.auth.owner, this.brain !== 'llm'); // agent narrates; LLM may fly
      if (this.brain === 'llm' && this.auth.owner === OWNER.AGENT && this.phys.armed && !this.phys.finished) {
        this._executeLLM(this.llm.decide(this._observeLive()));
      }
    }

    if (this.phys.finished && !this.finishedHandled) {
      this.finishedHandled = true;
      this.agent.onFinish();
      this.auth.release();
      if (this.phys.status === 'RESOLVED') this.audio.resolved();
      else this.audio.failed();
      this.campaign.record({ status: this.phys.status, grade: this.phys.grade, ratio: this.phys.gradeRatio, dvUsed: this.phys.dvUsed });
      this._renderCampaign();
    }

    const snap = this.telemetry.snapshot();
    this.overlay.render(snap);
    this._updateDom(snap);

    // In an XR session the renderer's setAnimationLoop drives frames instead.
    if (!this.scene3d.isPresenting()) requestAnimationFrame((tt) => this._frame(tt));
  }

  _stepPhysics(fdt) {
    if (!this.phys.armed || this.phys.finished) return;
    const owner = this.auth.owner;
    if (owner === OWNER.MANUAL) {
      this.fm.tick(fdt, OWNER.MANUAL, this.auth.manualInput());
    } else {
      this.fm.tick(fdt, OWNER.AGENT);
    }
    this.phys.step(fdt);
  }

  _timeline(dt) {
    if (this.phase === 'cruise') {
      if (this.armingEnabled && this.totalElapsed >= CFG.cruiseSeconds) {
        this._armEncounter();
        this.phase = 'encounter';
      }
      return;
    }
    if (this.phase === 'encounter') {
      const e = this.phys.elapsed;
      this.targetLight = e >= CFG.shadowStart && e <= CFG.shadowEnd ? CFG.shadowLevel : 1.0;
      if (this.phys.finished) {
        this.phase = 'scored';
        this.targetLight = 1.0;
      }
    }
  }

  _armEncounter() {
    this.phys.arm(this.activeScenario);
    this.audio.alert();
    const crossSign = Math.sign(this.activeScenario.allyPos.y) || 1;
    this.vlm.scene = this.vlm.baseScenePrompt();
    this.world.setPrompt(this.world.threatPrompt(crossSign));
  }

  _updateDom(s) {
    const d = this.dom;
    const worst = s.worstThreat;
    const ally = s.allyForecast;

    d.owner.textContent = s.controlOwner === 'MANUAL' ? 'YOU (manual)' : 'AGENT (autopilot)';
    d.owner.dataset.owner = s.controlOwner;
    d.grabBtn.textContent = s.controlOwner === 'MANUAL' ? 'RELEASE (G)' : 'GRAB CONTROL (G)';
    d.grabBtn.dataset.owner = s.controlOwner;

    d.miss.textContent = worst ? `${worst.predictedMiss.toFixed(2)} km` : '--';
    d.miss.dataset.state = worst ? (worst.safe ? 'safe' : 'danger') : '';
    if (d.pc) {
      const pc = s.worstPc ?? 0;
      d.pc.textContent = s.armed ? (pc >= 0.01 ? `${(pc * 100).toFixed(1)}%` : pc >= 1e-6 ? pc.toExponential(1) : '< 1e-6') : '--';
      d.pc.dataset.state = pc > (s.pcThreshold ?? 1e-4) ? 'low' : 'ok';
    }
    d.tca.textContent = worst ? (worst.tca > 0 ? `${worst.tca.toFixed(1)} s` : 'passed') : '--';
    d.range.textContent = ally ? `${ally.range.toFixed(2)} km` : '--';
    d.safeRing.textContent = `${s.dSafe.toFixed(2)} km`;

    d.dvUsed.textContent = `${s.dvUsed.toFixed(2)} m/s`;
    d.dvPar.textContent = `${s.parDv.toFixed(2)} m/s`;
    d.dvAgent.textContent = `${s.dvAgent.toFixed(2)}`;
    d.dvHuman.textContent = `${s.dvHuman.toFixed(2)}`;
    const ratio = s.parDv > 0 ? s.dvUsed / s.parDv : 0;
    d.dvRatio.textContent = s.parDv > 0 ? `${ratio.toFixed(2)}x par` : '--';

    d.power.textContent = `${(s.powerAuthority * 100) | 0}% · ${s.ep.powerKw.toFixed(1)} kW`;
    d.power.dataset.state = s.powerAuthority < 0.4 ? 'low' : 'ok';
    d.prop.textContent = `${s.ep.xenonKg.toFixed(2)} kg · ${(s.propellantPct * 100) | 0}%`;
    d.thrust.textContent = s.thrusting ? 'BURNING' : 'COAST';
    d.thrust.dataset.state = s.thrusting ? 'on' : 'off';

    d.epThrust.textContent = `${s.ep.thrustMn.toFixed(0)} mN`;
    d.epThrust.dataset.state = s.thrusting ? 'on' : '';
    d.epIsp.textContent = `${s.ep.isp} s`;
    d.epVe.textContent = `${s.ep.veKms.toFixed(1)} km/s`;
    d.epMdot.textContent = s.thrusting ? `${s.ep.mdotMgs.toFixed(2)} mg/s` : '0.00 mg/s';
    d.epWarp.textContent = `≈${s.ep.timeWarp.toFixed(0)}× real`;

    const allyOk = s.status !== 'COLLISION' || s.collisionTarget !== 'ally';
    d.ally.textContent = s.status === 'COLLISION' && s.collisionTarget === 'ally' ? 'HIT' : allyOk ? 'INTACT' : 'HIT';
    d.ally.dataset.state = s.status === 'COLLISION' && s.collisionTarget === 'ally' ? 'hit' : 'ok';

    const feed = this.agent.feed;
    if (feed.length !== d._feedLen) {
      d._feedLen = feed.length;
      d.feed.innerHTML = '';
      for (const f of feed.slice(-14)) {
        const li = document.createElement('div');
        li.className = `line kind-${f.kind}`;
        li.innerHTML = `<span class="t">T+${f.t.toFixed(0)}s</span> ${f.line}`;
        d.feed.appendChild(li);
      }
      d.feed.scrollTop = d.feed.scrollHeight;
    }
  }
}

export function boot() {
  const $ = (id) => document.getElementById(id);
  const dom = {
    overlay: $('overlay'),
    worldMount: $('world-mount'),
    modeBadge: $('mode-badge'),
    owner: $('owner'),
    grabBtn: $('grab-btn'),
    brainBtn: $('brain-btn'),
    benchBtn: $('bench-btn'),
    miss: $('miss'),
    pc: $('pc'),
    tca: $('tca'),
    range: $('range'),
    safeRing: $('safe-ring'),
    dvUsed: $('dv-used'),
    dvPar: $('dv-par'),
    dvAgent: $('dv-agent'),
    dvHuman: $('dv-human'),
    dvRatio: $('dv-ratio'),
    power: $('power'),
    prop: $('prop'),
    thrust: $('thrust'),
    epThrust: $('ep-thrust'),
    epIsp: $('ep-isp'),
    epVe: $('ep-ve'),
    epMdot: $('ep-mdot'),
    epWarp: $('ep-warp'),
    ally: $('ally'),
    feed: $('feed'),
    intro: $('intro'),
    introGo: $('intro-go'),
    levels: $('levels'),
    stars: $('stars'),
    _feedLen: -1,
  };
  const orch = new Orchestrator(dom);
  orch.start();
  window.__drift = orch;
}
