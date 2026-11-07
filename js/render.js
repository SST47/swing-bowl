/* Swing Bowl — pseudo-3D canvas renderer for the lane, pins and ball. */
(function (root) {
  'use strict';
  const { C } = root.SB;

  const CAM_H = 1.2;
  const CAM_START_Z = -3.0;
  const CAM_MAX_Z = C.HEAD_PIN_Z - 4.4;
  const WALL_Z = 20.2;

  // Bowling pin outline (half-width, height) in metres.
  const PIN_PROFILE = [
    [0.026, 0], [0.047, 0.03], [0.0605, 0.105], [0.052, 0.18], [0.03, 0.24],
    [0.021, 0.272], [0.026, 0.305], [0.032, 0.335], [0.026, 0.365], [0.0, 0.381],
  ];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, z: CAM_START_Z, h: CAM_H };
      this.resize();
      root.addEventListener('resize', () => this.resize());
    }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const w = this.canvas.clientWidth || root.innerWidth;
      const h = this.canvas.clientHeight || root.innerHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.HY = h * (w < h ? 0.3 : 0.27);
      const dBottom = 2.3;
      this.F = Math.min((h - this.HY) * dBottom / CAM_H, w * (w < h ? 2.1 : 1.6));
    }

    // Move the camera toward where the action is.
    follow(ball, mode, dt) {
      let tz = CAM_START_Z, tx = 0;
      if (ball && (mode === 'rolling' || mode === 'result')) {
        tz = Math.max(CAM_START_Z, Math.min(CAM_MAX_Z, ball.z - 3.1));
        if (mode === 'result') tz = CAM_MAX_Z;
        tx = ball.gutter ? 0 : ball.x * 0.35;
      }
      const k = Math.min(1, dt * (mode === 'aim' ? 2.2 : 3.2));
      this.cam.z += (tz - this.cam.z) * k;
      this.cam.x += (tx - this.cam.x) * k;
    }

    snapCamera() { this.cam.z = CAM_START_Z; this.cam.x = 0; }

    proj(x, y, z) {
      const d = z - this.cam.z;
      if (d < 0.12) return null;
      const s = this.F / d;
      return { x: this.W / 2 + (x - this.cam.x) * s, y: this.HY + (this.cam.h - y) * s, s };
    }

    poly(points, fill) {
      const ctx = this.ctx;
      const pp = [];
      for (const p of points) { const q = this.proj(p[0], p[1], p[2]); if (!q) return; pp.push(q); }
      ctx.beginPath();
      ctx.moveTo(pp[0].x, pp[0].y);
      for (let i = 1; i < pp.length; i++) ctx.lineTo(pp[i].x, pp[i].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    ground(x0, x1, z0, z1, fill, y = 0) {
      const zn = this.cam.z + 0.2;
      if (z1 <= zn) return;
      z0 = Math.max(z0, zn);
      this.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], fill);
    }

    wallX(x, z0, z1, y0, y1, fill) {
      const zn = this.cam.z + 0.2;
      if (z1 <= zn) return;
      z0 = Math.max(z0, zn);
      this.poly([[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], fill);
    }

    line(a, b, color, width) {
      const p = this.proj(...a), q = this.proj(...b);
      if (!p || !q) return;
      const ctx = this.ctx;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }

    drawScene(lane, opts) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const LH = C.LANE_HALF, GW = C.GUTTER_W;

      // backdrop
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b1026'); bg.addColorStop(0.45, '#1a1636'); bg.addColorStop(1, '#2a1a12');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // back wall + masking panel above the pins
      this.poly([[-6, 0, WALL_Z], [6, 0, WALL_Z], [6, 3.2, WALL_Z], [-6, 3.2, WALL_Z]], '#120d22');
      const m0 = this.proj(-1.0, 1.55, WALL_Z - 0.01), m1 = this.proj(1.0, 0.72, WALL_Z - 0.01);
      if (m0 && m1) {
        const g = ctx.createLinearGradient(m0.x, m0.y, m1.x, m1.y);
        g.addColorStop(0, '#ff3d7f'); g.addColorStop(0.5, '#7b4dff'); g.addColorStop(1, '#26c6da');
        ctx.fillStyle = g;
        ctx.fillRect(m0.x, m0.y, m1.x - m0.x, m1.y - m0.y);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = `800 ${Math.max(8, (m1.y - m0.y) * 0.42)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('SWING BOWL', (m0.x + m1.x) / 2, (m0.y + m1.y) / 2);
      }
      // pin-deck lighting glow under the masking unit
      const glow = this.proj(0, 0.5, C.HEAD_PIN_Z + 0.4);
      if (glow) {
        const r = 2.2 * glow.s;
        const gg = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, r);
        gg.addColorStop(0, 'rgba(255,240,210,0.25)'); gg.addColorStop(1, 'rgba(255,240,210,0)');
        ctx.fillStyle = gg; ctx.fillRect(glow.x - r, glow.y - r, r * 2, r * 2);
      }

      // floor & neighbouring lanes for depth
      this.ground(-8, 8, -6, WALL_Z, '#1d1410');
      for (const off of [-2.0, 2.0]) {
        this.ground(off - LH - GW, off + LH + GW, -6, 19.2, '#2b2b33');
        this.ground(off - LH, off + LH, -6, 19.2, '#6e4a2b');
        this.ground(off - LH, off + LH, 19.2, WALL_Z, '#07060c');
      }
      // ball-return / capping between lanes
      this.ground(-1.47, -LH - GW, -6, WALL_Z, '#3a2f4a');
      this.ground(LH + GW, 1.47, -6, WALL_Z, '#3a2f4a');

      // gutters
      this.ground(-LH - GW, -LH, -6, 19.2, '#3d4049');
      this.ground(LH, LH + GW, -6, 19.2, '#3d4049');
      this.ground(-LH - GW * 0.75, -LH - GW * 0.25, -6, 19.2, '#2c2f37');
      this.ground(LH + GW * 0.25, LH + GW * 0.75, -6, 19.2, '#2c2f37');

      // approach, lane, pin deck, pit
      this.ground(-LH - GW, LH + GW, -6, 0, '#b98552');
      this.ground(-LH, LH, 0, C.DECK_Z, '#dcaa72');
      this.ground(-LH, LH, C.DECK_Z, 19.15, '#e8bd88');
      this.ground(-LH - GW, LH + GW, 19.15, WALL_Z, '#050409');

      // sheen down the middle of the lane
      const s0 = this.proj(0, 0, Math.max(this.cam.z + 0.3, 0)), s1 = this.proj(0, 0, 19);
      if (s0 && s1) {
        const sg = ctx.createLinearGradient(0, s1.y, 0, s0.y);
        sg.addColorStop(0, 'rgba(255,255,255,0.0)'); sg.addColorStop(1, 'rgba(255,255,255,0.10)');
        this.poly([[-LH * 0.6, 0, Math.max(this.cam.z + 0.3, 0)], [LH * 0.6, 0, Math.max(this.cam.z + 0.3, 0)], [LH * 0.2, 0, 19], [-LH * 0.2, 0, 19]], sg);
      }

      // boards
      const zs = Math.max(this.cam.z + 0.25, 0);
      for (let i = 1; i < 39; i++) {
        const x = -LH + i * (2 * LH / 39);
        this.line([x, 0, zs], [x, 0, 19.15], i % 5 === 0 ? 'rgba(110,60,25,0.22)' : 'rgba(110,60,25,0.10)', 1);
      }
      // foul line
      this.ground(-LH - GW, LH + GW, 0, 0.025, '#3a0d0d');
      // approach dots
      for (const b of [3, 5, 8, 11, 14]) for (const sgn of [-1, 1]) this.ground(sgn * (LH - b * 0.0271) - 0.008, sgn * (LH - b * 0.0271) + 0.008, 2.1, 2.13, '#5b371a');
      // target arrows
      for (let k = 0; k < 7; k++) {
        const board = 5 + k * 5;
        const x = LH - board * (2 * LH / 39);
        const z = 4.9 - Math.abs(k - 3) * 0.3;
        this.poly([[x - 0.022, 0, z], [x + 0.022, 0, z], [x, 0, z + 0.32]], '#4a2a12');
      }
      // pin spots
      for (const s of root.SB.SPOTS) this.ground(s.x - 0.03, s.x + 0.03, s.z - 0.03, s.z + 0.03, 'rgba(120,70,30,0.35)');
      // kickbacks
      this.wallX(-LH - GW, 17.2, WALL_Z, 0, 0.62, '#241b33');
      this.wallX(LH + GW, 17.2, WALL_Z, 0, 0.62, '#241b33');
      this.wallX(-LH - GW, 17.2, WALL_Z, 0.5, 0.62, '#ff3d7f');
      this.wallX(LH + GW, 17.2, WALL_Z, 0.5, 0.62, '#26c6da');

      // straight-line guide from the start position
      if (opts.aim) {
        const { x, aim, color } = opts.aim;
        const len = 7.5;
        const a = [x, 0.005, 0.2], b = [x + Math.sin(aim) * len, 0.005, 0.2 + Math.cos(aim) * len];
        ctx.save(); ctx.setLineDash([10, 10]); this.line(a, b, color, 3); ctx.restore();
        const tip = this.proj(...b);
        if (tip) {
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2); ctx.fill();
        }
      }

      // objects, far to near
      const items = [];
      for (const p of lane.pins) if (!p.gone) items.push({ z: p.z, draw: () => this.drawPin(p) });
      if (opts.ball) items.push({ z: opts.ball.z, draw: () => this.drawBall(opts.ball, opts.ballColor) });
      items.sort((a, b) => b.z - a.z);
      for (const it of items) it.draw();
    }

    drawPin(p) {
      const ctx = this.ctx;
      const base = this.proj(p.x, 0, p.z);
      if (!base) return;
      const s = base.s;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(base.x, base.y, 0.075 * s, 0.022 * s, 0, 0, Math.PI * 2); ctx.fill();

      if (!p.fallen) {
        const lean = p.wob ? Math.sin(performance.now() / 45 + p.n) * p.wob * 0.12 : 0;
        ctx.save();
        ctx.translate(base.x, base.y);
        ctx.rotate(lean);
        this._pinShape(s);
        ctx.restore();
        return;
      }
      // fallen / falling pin: draw it as a tilted stick
      const t = Math.min(1, p.tilt) * Math.PI / 2;
      const dx = Math.cos(p.dir), dz = Math.sin(p.dir);
      const at = (h) => this.proj(p.x + dx * Math.sin(t) * h, Math.cos(t) * h + Math.sin(t) * 0.055, p.z + dz * Math.sin(t) * h);
      const b0 = at(0.02), b1 = at(0.12), n0 = at(0.25), hd = at(0.34);
      if (!b0 || !b1 || !n0 || !hd) return;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#f4f1ea';
      ctx.lineWidth = 0.11 * s; ctx.beginPath(); ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
      ctx.lineWidth = 0.065 * s; ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(n0.x, n0.y); ctx.stroke();
      ctx.strokeStyle = '#d7263d'; ctx.lineWidth = 0.05 * s;
      const r0 = at(0.235), r1 = at(0.27);
      if (r0 && r1) { ctx.beginPath(); ctx.moveTo(r0.x, r0.y); ctx.lineTo(r1.x, r1.y); ctx.stroke(); }
      ctx.fillStyle = '#f4f1ea';
      ctx.beginPath(); ctx.arc(hd.x, hd.y, 0.034 * s, 0, Math.PI * 2); ctx.fill();
    }

    _pinShape(s) {
      const ctx = this.ctx;
      ctx.beginPath();
      const P = PIN_PROFILE;
      ctx.moveTo(-P[0][0] * s, 0);
      // left side, bottom to top
      for (let i = 1; i < P.length; i++) {
        const [w0, h0] = P[i - 1], [w1, h1] = P[i];
        ctx.quadraticCurveTo(-w0 * s, -h0 * s, -(w0 + w1) / 2 * s, -(h0 + h1) / 2 * s);
      }
      ctx.lineTo(0, -P[P.length - 1][1] * s);
      for (let i = P.length - 1; i > 0; i--) {
        const [w0, h0] = P[i], [w1, h1] = P[i - 1];
        ctx.quadraticCurveTo(w0 * s, -h0 * s, (w0 + w1) / 2 * s, -(h0 + h1) / 2 * s);
      }
      ctx.lineTo(P[0][0] * s, 0);
      ctx.closePath();
      const g = ctx.createLinearGradient(-0.06 * s, 0, 0.06 * s, 0);
      g.addColorStop(0, '#c9c4bb'); g.addColorStop(0.4, '#ffffff'); g.addColorStop(1, '#bdb7ad');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#d7263d';
      ctx.fillRect(-0.07 * s, -0.262 * s, 0.14 * s, 0.014 * s);
      ctx.fillRect(-0.07 * s, -0.24 * s, 0.14 * s, 0.009 * s);
      ctx.restore();
    }

    drawBall(b, color) {
      const ctx = this.ctx;
      const c = this.proj(b.x, C.BALL_R, b.z), g0 = this.proj(b.x, 0, b.z);
      if (!c || !g0) return;
      const r = C.BALL_R * c.s;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(g0.x, g0.y, r * 1.05, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      const gr = ctx.createRadialGradient(c.x - r * 0.4, c.y - r * 0.45, r * 0.1, c.x, c.y, r);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.18, color); gr.addColorStop(1, shade(color, -0.55));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
      // finger holes rolling with the ball
      const ang = (b.dist || 0) / C.BALL_R;
      ctx.fillStyle = 'rgba(10,10,20,0.75)';
      const holes = [[-0.28, 0], [0.28, 0], [0, 0.42]];
      for (const [hx, ho] of holes) {
        const a = ang + ho - 0.6;
        const vis = Math.cos(a);
        if (vis <= 0.05) continue;
        ctx.beginPath();
        ctx.ellipse(c.x + hx * r, c.y - Math.sin(a) * r * 0.7, r * 0.1, r * 0.1 * vis, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  root.SB = Object.assign(root.SB || {}, { Renderer, CAM_START_Z });
})(self);
