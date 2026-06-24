// audio.js — synthesized sound (Web Audio, no asset files). Fully defensive:
// if Web Audio is unavailable or blocked, every method is a safe no-op.
//
// - thruster: filtered noise + low rumble, gain tracks delivered thrust
// - eclipse drone: low sine that swells as the scene darkens
// - alert / resolved / failed: short synthesized cues
// Must be init()'d from a user gesture (we call it on "BEGIN").

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
  }

  init() {
    if (this.ready) { this._resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);

      // --- thruster: white-noise hiss through a bandpass + low rumble ---
      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buf; noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.7;
      this.thrustGain = ctx.createGain(); this.thrustGain.gain.value = 0;
      noise.connect(bp).connect(this.thrustGain).connect(this.master);

      const rumble = ctx.createOscillator();
      rumble.type = 'sawtooth'; rumble.frequency.value = 70;
      const rg = ctx.createGain(); rg.gain.value = 0.4;
      rumble.connect(rg).connect(this.thrustGain);

      // --- eclipse drone ---
      const drone = ctx.createOscillator();
      drone.type = 'sine'; drone.frequency.value = 55;
      this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
      drone.connect(this.droneGain).connect(this.master);

      noise.start(); rumble.start(); drone.start();
      this.ready = true;
      this._resume();
    } catch { /* no audio */ }
  }

  _resume() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch {} }

  setThrust(frac) {
    if (!this.ready) return;
    const g = this.muted ? 0 : Math.max(0, Math.min(1, frac)) * 0.06;
    this._ramp(this.thrustGain.gain, g, 0.08);
  }

  setLight(level) {
    if (!this.ready) return;
    const dark = Math.max(0, 0.7 - level); // swells as it darkens
    this._ramp(this.droneGain.gain, this.muted ? 0 : dark * 0.05, 0.4);
  }

  alert() { this._cue([[660, 0.0], [880, 0.12]], 0.18, 'square'); }
  resolved() { this._cue([[523, 0], [659, 0.12], [784, 0.24]], 0.3, 'triangle'); }
  failed() { this._cue([[330, 0], [247, 0.18]], 0.4, 'sawtooth'); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ready) this._ramp(this.master.gain, this.muted ? 0 : 0.9, 0.1);
    return this.muted;
  }

  _cue(notes, dur, type) {
    if (!this.ready || this.muted) return;
    const t0 = this.ctx.currentTime;
    for (const [freq, at] of notes) {
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(this.master);
      o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
    }
  }

  _ramp(param, target, time) {
    try { param.setTargetAtTime(target, this.ctx.currentTime, time / 3); }
    catch { try { param.value = target; } catch {} }
  }
}
