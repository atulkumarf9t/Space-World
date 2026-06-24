// vlm_sense.js
// Slow (~1 Hz) semantic layer. Advisory only: it never drives control or scoring.
// Two jobs:
//   1) Provide a scene line for the UI (real Gemini via proxy if available, else canned).
//   2) Build the Reactor re-prompt that spawns the approaching ally craft from the
//      side the sim's reticle says it is on (visual mood only; geometry stays in sim).

const SCENES = [
  'first-person view drifting through deep space over a banded gas giant at dusk, stars and nebula',
  'first-person drift past a ringed planet, faint sunlight raking across debris fields',
  'first-person view through a slow field of glinting satellites and tumbling asteroids',
];

export class VlmSense {
  constructor(opts = {}) {
    this.proxyUrl = opts.proxyUrl ?? '/api/gemini';
    this.useGemini = opts.useGemini ?? false; // off by default for offline demos
    this.scene = SCENES[0];
    this.openings = [];
    this.poi = [];
    this._inflight = false;
  }

  baseScenePrompt() {
    return SCENES[(Math.random() * SCENES.length) | 0];
  }

  // Re-prompt issued when a conjunction arms. crossSign>0 -> ally enters from right.
  allyPrompt(crossSign) {
    const side = crossSign >= 0 ? 'right' : 'left';
    return (
      `${this.scene}; another satellite drifts into frame from the ${side}, ` +
      `slowly growing larger on a near head-on approach, metallic and lit by edge sunlight`
    );
  }

  // Optional Gemini enrichment. Returns {scene} or null on failure.
  async describe(jpegDataUrl) {
    if (!this.useGemini || this._inflight) return null;
    this._inflight = true;
    try {
      const res = await fetch(this.proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'scene',
          prompt:
            'In one short vivid clause, describe this first-person space view. No preamble.',
          image: jpegDataUrl,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.text) {
        this.scene = String(data.text).trim().slice(0, 120);
        return { scene: this.scene };
      }
      return null;
    } catch {
      return null;
    } finally {
      this._inflight = false;
    }
  }
}
