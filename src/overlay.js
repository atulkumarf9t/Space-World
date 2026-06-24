// overlay.js
// HUD over the 3D view: ally + asteroid reticles, threat panels, delta-v gauge, grade card.

const COL = {
  safe: '#3ad29f',
  warn: '#ffcf5c',
  danger: '#ff5d5d',
  agent: '#5cc8ff',
  human: '#ff9f43',
  par: '#8a93a6',
  ink: '#dbe7ff',
  dim: 'rgba(219,231,255,0.55)',
  asteroid: '#c48855',
};

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  render(snapshot) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!snapshot) return;

    this._drawFrameChrome(W, H, snapshot);

    if (snapshot.armed) {
      if (snapshot.screenAlly) this._drawReticle(snapshot.screenAlly, snapshot.allyForecast, 'ALLY — PROTECT', COL.safe, snapshot.dSafe);
      if (snapshot.screenAsteroid) this._drawReticle(snapshot.screenAsteroid, snapshot.asteroidForecast, 'ASTEROID — AVOID', COL.asteroid, snapshot.dSafe);
      for (const e of snapshot.screenExtras || []) {
        if (e.screen && e.fc) this._drawReticle(e.screen, e.fc, 'DEBRIS — AVOID', COL.asteroid, snapshot.dSafe);
      }
      this._drawThreatPanel(W, H, snapshot);
    }
    this._drawDvGauge(W, H, snapshot);
    this._drawOwnerBadge(W, H, snapshot);
    this._drawCallout(W, H, snapshot);
    if (snapshot.finished) this._drawGradeCard(W, H, snapshot);
  }

  // Brief animated banner the first time the dual threat appears (onboarding).
  _drawCallout(W, H, s) {
    if (s.armed && !this._sawArmed) {
      this._sawArmed = true;
      this._calloutUntil = performance.now() + 2800;
    }
    if (!s.armed) this._sawArmed = false;
    if (!this._calloutUntil) return;
    const now = performance.now();
    const left = this._calloutUntil - now;
    if (left <= 0) { this._calloutUntil = 0; return; }
    const a = Math.min(1, left / 700); // fade out last 0.7s
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = COL.danger;
    ctx.font = '800 26px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('DUAL THREAT', W / 2, H * 0.26);
    ctx.fillStyle = COL.ink;
    ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('Protect the ally · avoid the asteroid · least Δv', W / 2, H * 0.26 + 24);
    ctx.restore();
  }

  _drawFrameChrome(W, H, s) {
    const { ctx } = this;
    let label = 'CRUISE';
    let color = COL.dim;
    if (s.status === 'ALERT') {
      label = 'DUAL THREAT ALERT';
      color = s.worstThreat?.safe ? COL.safe : COL.danger;
    } else if (s.status === 'RESOLVED') {
      label = 'THREATS RESOLVED';
      color = COL.safe;
    } else if (s.status === 'UNSAFE') {
      label = 'UNSAFE PASS';
      color = COL.warn;
    } else if (s.status === 'COLLISION') {
      label = 'COLLISION';
      color = COL.danger;
    }
    ctx.save();
    ctx.font = '700 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    const pad = 10;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(6,10,20,0.65)';
    ctx.fillRect(pad, pad, tw + 20, 26);
    ctx.fillStyle = color;
    ctx.fillRect(pad, pad, 4, 26);
    ctx.fillText(label, pad + 12, pad + 6);
    ctx.restore();
  }

  _drawReticle(screen, fc, label, baseCol, dSafe) {
    if (!fc || screen.behind) return;
    const { ctx } = this;
    const { x, y } = screen;
    const safe = fc.safe;
    const col = safe ? baseCol : fc.predictedMiss > dSafe * 0.5 ? COL.warn : COL.danger;
    const r = Math.max(10, Math.min(40, 120 / Math.max(fc.range, 0.5)));

    ctx.save();
    ctx.strokeStyle = safe ? baseCol : 'rgba(255,93,93,0.5)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r - 8, y); ctx.lineTo(x - r, y);
    ctx.moveTo(x + r, y); ctx.lineTo(x + r + 8, y);
    ctx.moveTo(x, y - r - 8); ctx.lineTo(x, y - r);
    ctx.moveTo(x, y + r); ctx.lineTo(x, y + r + 8);
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - r - 18);
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COL.ink;
    ctx.fillText(`${fc.range.toFixed(2)} km · miss ${fc.predictedMiss.toFixed(2)}`, x, y + r + 16);
    ctx.restore();
  }

  _drawThreatPanel(W, H, s) {
    const { ctx } = this;
    const a = s.allyForecast;
    const b = s.asteroidForecast;
    if (!a || !b) return;
    const closeMs = (fc) => (fc.closingSpeed * 1000).toFixed(0);
    const fmtPc = (v) => (v >= 0.01 ? `${(v * 100).toFixed(1)}%` : v >= 1e-6 ? v.toExponential(1) : '< 1e-6');
    const lines = [
      ['ALLY MISS', `${a.predictedMiss.toFixed(2)} km`, a.safe ? COL.safe : COL.danger],
      ['AST MISS', `${b.predictedMiss.toFixed(2)} km`, b.safe ? COL.safe : COL.danger],
      ['SAFE RING', `${s.dSafe.toFixed(2)} km`, COL.dim],
      ['TCA ALLY', a.tca > 0 ? `${a.tca.toFixed(1)} s` : 'passed', COL.ink],
      ['TCA AST', b.tca > 0 ? `${b.tca.toFixed(1)} s` : 'passed', COL.ink],
      ['CLOSE ALLY', `${closeMs(a)} m/s`, COL.dim],
      ['CLOSE AST', `${closeMs(b)} m/s`, COL.dim],
      ['COLLISION Pc', fmtPc(s.worstPc), s.worstPc > s.pcThreshold ? COL.danger : COL.safe],
      ['NEED Δv', `${s.worstThreat.requiredDv.toFixed(2)} m/s`, s.worstThreat.requiredDv > s.dvRemaining ? COL.danger : COL.warn],
      ['Δv LEFT', `${s.dvRemaining.toFixed(2)} m/s`, s.dvRemaining < s.worstThreat.requiredDv ? COL.danger : COL.dim],
    ];
    const x = 12;
    let y = 48;
    ctx.save();
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(6,10,20,0.6)';
    ctx.fillRect(x, y, 168, lines.length * 20 + 8);
    y += 14;
    for (const [k, v, c] of lines) {
      ctx.fillStyle = COL.dim;
      ctx.textAlign = 'left';
      ctx.fillText(k, x + 10, y);
      ctx.fillStyle = c;
      ctx.textAlign = 'right';
      ctx.fillText(v, x + 158, y);
      y += 20;
    }
    ctx.restore();
  }

  _drawDvGauge(W, H, s) {
    const { ctx } = this;
    const x = 12;
    const y = H - 56;
    const w = 220;
    const h = 14;
    ctx.save();
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COL.dim;
    ctx.fillText('Δv LEDGER (m/s)', x, y - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    const aw = Math.min(w, (s.dvAgent / s.dvBudget) * w);
    const hw = Math.min(w - aw, (s.dvHuman / s.dvBudget) * w);
    ctx.fillStyle = COL.agent;
    ctx.fillRect(x, y, aw, h);
    ctx.fillStyle = COL.human;
    ctx.fillRect(x + aw, y, hw, h);
    const px = x + Math.min(w, (s.parDv / s.dvBudget) * w);
    ctx.strokeStyle = COL.par;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, y - 3); ctx.lineTo(px, y + h + 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.ink;
    ctx.textAlign = 'left';
    ctx.fillText(`used ${s.dvUsed.toFixed(2)}  |  par ${s.parDv.toFixed(2)}  |  budget ${s.dvBudget}`, x, y + h + 14);
    ctx.restore();
  }

  _drawOwnerBadge(W, H, s) {
    const { ctx } = this;
    const manual = s.controlOwner === 'MANUAL';
    const label = manual ? 'MANUAL — YOU' : 'AUTOPILOT — AGENT';
    const col = manual ? COL.human : COL.agent;
    ctx.save();
    ctx.font = '700 12px ui-monospace, Menlo, Consolas, monospace';
    const tw = ctx.measureText(label).width;
    const x = W - tw - 24;
    const y = 12;
    ctx.fillStyle = 'rgba(6,10,20,0.65)';
    ctx.fillRect(x - 6, y, tw + 16, 24);
    ctx.fillStyle = col;
    ctx.fillRect(x - 6, y, 4, 24);
    ctx.textBaseline = 'top';
    ctx.fillText(label, x + 4, y + 5);
    ctx.restore();
  }

  _drawGradeCard(W, H, s) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(4,8,16,0.78)';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const crash = s.status === 'COLLISION';
    const win = s.status === 'RESOLVED';
    const big = crash ? 'COLLISION' : `GRADE ${s.grade}`;
    const col = crash ? COL.danger : win ? COL.safe : COL.warn;
    ctx.textAlign = 'center';
    ctx.fillStyle = col;
    ctx.font = '800 56px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(big, cx, cy - 10);
    ctx.font = '600 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COL.ink;
    const sub = crash
      ? `You hit the ${s.collisionTarget ?? 'target'} you were meant to avoid.`
      : win
        ? 'Ally protected. Asteroid avoided.'
        : 'Survived, but the pass was unsafe.';
    ctx.fillText(sub, cx, cy + 28);
    ctx.fillStyle = COL.dim;
    const ratio = s.gradeRatio ? `${s.gradeRatio.toFixed(2)}x par` : '';
    ctx.fillText(`Δv used ${s.dvUsed.toFixed(2)} m/s   (par ${s.parDv.toFixed(2)})   ${ratio}`, cx, cy + 52);
    ctx.fillStyle = COL.agent;
    ctx.fillText(`agent ${s.dvAgent.toFixed(2)} m/s`, cx - 70, cy + 76);
    ctx.fillStyle = COL.human;
    ctx.fillText(`you ${s.dvHuman.toFixed(2)} m/s`, cx + 70, cy + 76);
    ctx.fillStyle = COL.dim;
    ctx.font = '600 12px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('press R to run another encounter', cx, cy + 108);
    ctx.restore();
  }
}
