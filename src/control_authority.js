// control_authority.js
// AGENT vs MANUAL control owner; captures 6-DoF keyboard for manual piloting.

export const OWNER = { AGENT: 'AGENT', MANUAL: 'MANUAL' };

export class ControlAuthority {
  constructor(opts = {}) {
    this.owner = OWNER.AGENT;
    this.debounceMs = opts.debounceMs ?? 250;
    this._lastSwitch = 0;
    this._held = new Set();
    this._listeners = [];
    this._enabled = false;
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  _emit(from, to) {
    for (const fn of this._listeners) fn({ from, to });
  }

  enable() {
    if (this._enabled) return;
    this._enabled = true;
    this._keydown = (e) => this._handleKey(e, true);
    this._keyup = (e) => this._handleKey(e, false);
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
  }

  disable() {
    if (!this._enabled) return;
    this._enabled = false;
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    this._held.clear();
  }

  _handleKey(e, down) {
    const k = e.key.toLowerCase();
    if (k === 'g') {
      if (down) this.toggle();
      e.preventDefault();
      return;
    }
    if (['w', 'a', 's', 'd', 'q', 'e'].includes(k)) {
      if (down) this._held.add(k);
      else this._held.delete(k);
      if (this.owner === OWNER.MANUAL) e.preventDefault();
    }
  }

  toggle() {
    if (this.owner === OWNER.MANUAL) this.release();
    else this.grab();
  }

  grab() {
    const now = performance.now();
    if (now - this._lastSwitch < this.debounceMs) return;
    if (this.owner === OWNER.MANUAL) return;
    this._lastSwitch = now;
    const from = this.owner;
    this.owner = OWNER.MANUAL;
    this._emit(from, this.owner);
  }

  release() {
    const now = performance.now();
    if (now - this._lastSwitch < this.debounceMs) return;
    if (this.owner === OWNER.AGENT) return;
    this._lastSwitch = now;
    const from = this.owner;
    this.owner = OWNER.AGENT;
    this._held.clear();
    this._emit(from, this.owner);
  }

  isManual() {
    return this.owner === OWNER.MANUAL;
  }

  manualInput() {
    let forward = 0;
    let right = 0;
    let up = 0;
    if (this._held.has('w')) forward += 1;
    if (this._held.has('s')) forward -= 1;
    if (this._held.has('d')) right += 1;
    if (this._held.has('a')) right -= 1;
    if (this._held.has('e')) up += 1;
    if (this._held.has('q')) up -= 1;
    return { forward, right, up };
  }
}
