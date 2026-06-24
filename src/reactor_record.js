// reactor_record.js
// E1 capture: records the Reactor stream into a reproducible corpus for the offline
// pixel-level study (see research/E1_frame_pipeline.md). Activate with ?record=1.
//
// One JSONL row per sampled frame:
//   { t, luminance, power, mode, action:{movement,lookHorizontal,lookVertical}, frame:<jpeg dataURL> }
// Frames are the grabber's 160x90 downscale (cheap). A floating panel shows count +
// a Download button; capture stops at maxFrames. Zero overhead when disabled.

export class Recorder {
  constructor({ enabled = false, maxFrames = 1500 } = {}) {
    this.enabled = enabled;
    this.maxFrames = maxFrames;
    this.rows = [];
    this.stopped = false;
    if (enabled) this._buildUi();
  }

  capture(row) {
    if (!this.enabled || this.stopped) return;
    this.rows.push({
      t: +(row.t ?? 0).toFixed(3),
      luminance: +(row.luminance ?? 0).toFixed(2),
      power: +(row.power ?? 1).toFixed(3),
      mode: row.mode,
      action: row.control,
      dv: +(row.dv ?? 0).toFixed(4),   // Δv applied this sample (BC label)
      nobs: row.nobs ?? null,           // compact numeric obs (pixel-vs-numeric comparison)
      frame: row.frame,
    });
    if (this._count) this._count.textContent = String(this.rows.length);
    if (this.rows.length >= this.maxFrames) {
      this.stopped = true;
      if (this._badge) this._badge.textContent = '■ FULL';
    }
  }

  toJSONL() {
    return this.rows.map((r) => JSON.stringify(r)).join('\n');
  }

  download(name = `reactor_corpus_${Date.now()}.jsonl`) {
    const blob = new Blob([this.toJSONL()], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  _buildUi() {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;top:10px;right:10px;z-index:9999;display:flex;gap:8px;align-items:center;' +
      'font:700 11px ui-monospace,Consolas,monospace;background:rgba(8,12,22,0.92);' +
      'border:1px solid #ff5d5d;border-radius:8px;padding:6px 9px;color:#dbe7ff;';
    this._badge = document.createElement('span');
    this._badge.textContent = '● REC';
    this._badge.style.color = '#ff5d5d';
    const count = document.createElement('span');
    count.textContent = '0';
    this._count = count;
    const lbl = document.createElement('span');
    lbl.textContent = 'frames';
    lbl.style.color = '#8a93a6';

    const mk = (text, color) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText =
        `font:700 11px ui-monospace,Consolas,monospace;cursor:pointer;border-radius:6px;` +
        `padding:4px 8px;background:#0b1424;color:${color};border:1px solid ${color};`;
      return b;
    };
    const stop = mk('PAUSE', '#ffcf5c');
    stop.onclick = () => {
      this.stopped = !this.stopped;
      stop.textContent = this.stopped ? 'RESUME' : 'PAUSE';
      this._badge.textContent = this.stopped ? '❚❚ PAUSED' : '● REC';
    };
    const dl = mk('DOWNLOAD', '#3ad29f');
    dl.onclick = () => this.download();

    wrap.append(this._badge, count, lbl, stop, dl);
    document.body.appendChild(wrap);
  }
}
