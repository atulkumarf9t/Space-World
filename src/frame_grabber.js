// frame_grabber.js
// Pulls the world source (mock canvas or Reactor <video>) into a small offscreen
// canvas so perception can read pixels cheaply and (optionally) export a JPEG for
// Gemini. Downsamples hard: pixel features don't need full resolution.

export class FrameGrabber {
  constructor(opts = {}) {
    this.w = opts.sampleWidth ?? 160;
    this.h = opts.sampleHeight ?? 90;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.source = null;
  }

  attach(source) {
    this.source = source;
  }

  update() {
    if (!this.source) return;
    try {
      this.ctx.drawImage(this.source, 0, 0, this.w, this.h);
    } catch {
      /* video not ready yet */
    }
  }

  getImageData() {
    return this.ctx.getImageData(0, 0, this.w, this.h);
  }

  getJpeg(quality = 0.5) {
    return this.canvas.toDataURL('image/jpeg', quality);
  }
}
