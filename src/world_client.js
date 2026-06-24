// world_client.js
// Reactor SDK wrapper per official docs:
//   https://docs.reactor.inc/sdk-reference/using-the-sdk
//   https://docs.reactor.inc/model-api-reference/lingbot/schema
//
// Navigable backdrop uses LingBot (WASD via set_movement / set_look_* commands).
// Helios is prompt-only streaming (no WASD); supported as a non-synced backdrop fallback.

export class WorldClient {
  constructor(opts = {}) {
    this.opts = opts;
    this.mode = 'mock';
    this.reactor = null;
    this.video = null;
    this.modelName = opts.modelName ?? 'lingbot';
    this._movement = 'idle';
    this._lookH = 'idle';
    this._lookV = 'idle';
  }

  getVideoElement() {
    return this.video;
  }

  async connect(token, modelName) {
    if (modelName) this.modelName = modelName;
    if (!token) {
      this.mode = 'mock';
      return { mode: 'mock' };
    }
    try {
      const mod = await import('@reactor-team/js-sdk');
      const Reactor = mod.Reactor || mod.default;
      this.reactor = new Reactor({ modelName: this.modelName });
      this.video = document.createElement('video');
      this.video.autoplay = true;
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.crossOrigin = 'anonymous';

      this.reactor.on('trackReceived', (name, _track, stream) => {
        if (name !== 'main_video') return;
        this.video.srcObject = stream;
        void this.video.play();
      });

      this.reactor.on('error', (error) => {
        console.warn('[world_client] Reactor error:', error.code, error.message);
      });

      this.reactor.on('message', (msg) => {
        if (msg.type === 'command_error') {
          console.warn('[world_client] command rejected:', msg.data?.command, msg.data?.reason);
        }
      });

      this.reactor.on('statusChanged', async (status) => {
        if (status !== 'ready') return;
        await this._onReady();
      });

      await this.reactor.connect(token);
      this.mode = 'real';
      return { mode: 'real', model: this.modelName };
    } catch (err) {
      console.warn('[world_client] Reactor unavailable, using mock backdrop:', err.message);
      this.mode = 'mock';
      return { mode: 'mock', error: err.message };
    }
  }

  async _onReady() {
    const prompt =
      this.opts.initialPrompt ??
      'deep space over a banded gas giant at dusk, stars and nebula, cinematic sci-fi';

    if (this.modelName === 'lingbot') {
      await this._setupLingbot(prompt);
    } else {
      // Helios and other prompt-driven models (no WASD navigation).
      await this.reactor.sendCommand('set_prompt', { prompt });
      await this.reactor.sendCommand('start', {});
    }
  }

  async _setupLingbot(prompt) {
    const blob = await this._makeSeedBlob();
    const file = new File([blob], 'seed.jpg', { type: 'image/jpeg' });
    const ref = await this.reactor.uploadFile(file);

    const imageReady = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.type === 'image_accepted') {
          this.reactor.off('message', handler);
          resolve();
        }
      };
      this.reactor.on('message', handler);
    });

    await this.reactor.sendCommand('set_image', { image: ref });
    await imageReady;

    await this.reactor.sendCommand('set_prompt', { prompt });
    await this.reactor.sendCommand('start', {});
  }

  _makeSeedBlob() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 512, 512);
    g.addColorStop(0, '#0a1430');
    g.addColorStop(0.5, '#1a2750');
    g.addColorStop(1, '#2a1840');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(200,220,255,${0.3 + Math.random() * 0.7})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    const glow = ctx.createRadialGradient(360, 400, 20, 360, 400, 200);
    glow.addColorStop(0, 'rgba(120,150,255,0.35)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 512, 512);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }

  async setPrompt(prompt) {
    if (this.mode === 'real' && this.reactor) {
      try {
        await this.reactor.sendCommand('set_prompt', { prompt });
      } catch (e) {
        console.warn('[world_client] set_prompt failed:', e.message);
      }
    }
  }

  // LingBot: persistent movement/look state via sendCommand (not sendMessage pulses).
  syncControl({ movement, lookHorizontal, lookVertical }) {
    if (this.mode !== 'real' || !this.reactor || this.modelName !== 'lingbot') return;

    if (movement !== this._movement) {
      this._movement = movement;
      this.reactor.sendCommand('set_movement', { movement });
    }
    if (lookHorizontal !== this._lookH) {
      this._lookH = lookHorizontal;
      this.reactor.sendCommand('set_look_horizontal', { look_horizontal: lookHorizontal });
    }
    if (lookVertical !== this._lookV) {
      this._lookV = lookVertical;
      this.reactor.sendCommand('set_look_vertical', { look_vertical: lookVertical });
    }
  }

  threatPrompt(crossSign) {
    const side = crossSign >= 0 ? 'right' : 'left';
    return (
      `${this.opts.initialPrompt ?? 'deep space over a gas giant'}; another satellite drifts in from the ${side}, ` +
      `and a dark asteroid tumbles toward camera from upper-left, metallic glints in edge sunlight`
    );
  }

  destroy() {
    if (this.reactor) {
      this.reactor.disconnect?.().catch(() => {});
    }
    this.reactor = null;
  }
}
