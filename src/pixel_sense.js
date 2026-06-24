// pixel_sense.js
// Cheap reflex signals from the downsampled frame: mean luminance (-> power
// authority), frame-difference motion magnitude, and a rough edge density.
// Fast and load-bearing for the EP power-from-light constraint; Gemini is not.

export class PixelSense {
  constructor() {
    this._prev = null;
  }

  // imageData: from FrameGrabber.getImageData(). Returns {luminance, flow, edges}.
  process(imageData) {
    const d = imageData.data;
    const n = d.length / 4;
    let sum = 0;
    let flow = 0;
    let edges = 0;
    const w = imageData.width;

    const lum = new Float32Array(n);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      lum[p] = l;
      sum += l;
    }
    const mean = sum / n;

    // motion vs previous frame (sampled)
    if (this._prev && this._prev.length === n) {
      let acc = 0;
      for (let p = 0; p < n; p += 2) acc += Math.abs(lum[p] - this._prev[p]);
      flow = acc / (n / 2);
    }
    this._prev = lum;

    // rough horizontal edge density
    let eAcc = 0;
    for (let p = 1; p < n; p++) {
      if (p % w === 0) continue;
      eAcc += Math.abs(lum[p] - lum[p - 1]);
    }
    edges = eAcc / n;

    return { luminance: mean, flow, edges };
  }
}
