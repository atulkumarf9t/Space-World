// campaign.js — level progression + a local (localStorage) leaderboard.
// Pure logic with an injectable storage, so it can be unit-tested in Node.

import { DEFAULT_SCENARIO, MULTI_THREAT_SCENARIO, generateMultiThreat } from './scenarios.js';

export const LEVELS = [
  { id: 'first', name: 'First Contact', desc: 'One ally, one asteroid. Learn the controls.', scenario: () => DEFAULT_SCENARIO },
  { id: 'debris', name: 'Debris Field', desc: 'Two extra debris threats to screen.', scenario: () => MULTI_THREAT_SCENARIO },
  { id: 'curve', name: 'Orbital Curve', desc: 'Realism: Clohessy–Wiltshire curved motion.', scenario: () => ({ ...DEFAULT_SCENARIO, dynamics: 'cw', meanMotion: 0.05 }) },
  { id: 'gauntlet', name: 'Gauntlet', desc: 'Three debris + curved orbital motion.', scenario: () => ({ ...generateMultiThreat(2024, 3), name: 'gauntlet', dynamics: 'cw', meanMotion: 0.05 }) },
];

const RANK = { A: 4, B: 3, C: 2, F: 1 };
const STARS = { A: 3, B: 2, C: 1, F: 0 };

function memStore() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } };
}

export class Campaign {
  constructor(storage) {
    this.storage = storage || memStore();
    this.index = 0;
    this.scores = this._load();
  }
  current() { return LEVELS[this.index]; }
  select(id) { const i = LEVELS.findIndex((l) => l.id === id); if (i >= 0) this.index = i; return this.current(); }
  next() { this.index = Math.min(LEVELS.length - 1, this.index + 1); return this.current(); }

  // result: { status, grade, ratio, dvUsed }
  record(result) {
    const id = this.current().id;
    const prev = this.scores[id];
    const better = !prev || (RANK[result.grade] || 0) > (RANK[prev.grade] || 0) ||
      ((result.grade === prev.grade) && (result.ratio ?? 9) < (prev.ratio ?? 9));
    if (result.status === 'RESOLVED' && better) {
      this.scores[id] = { grade: result.grade, ratio: result.ratio, dvUsed: result.dvUsed, date: Date.now() };
      this._save();
    }
    return this.scores[id] || null;
  }
  best(id) { return this.scores[id] || null; }
  stars(id) { const s = this.scores[id]; return s ? (STARS[s.grade] || 0) : 0; }
  totalStars() { return LEVELS.reduce((sum, l) => sum + this.stars(l.id), 0); }
  maxStars() { return LEVELS.length * 3; }

  _load() { try { return JSON.parse(this.storage.getItem('drift_scores') || '{}'); } catch { return {}; } }
  _save() { try { this.storage.setItem('drift_scores', JSON.stringify(this.scores)); } catch {} }
}
