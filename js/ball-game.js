/* Swing Baseball — Home Run Derby: game flow, timing judge, 3D ballpark renderer. */
(function (root) {
  'use strict';
  const B = root.BASEBALL;
  const { PARK, makePitch, pitchPos, contact, flight } = B;
  const COLORS = ['#3fa9f5', '#ff5a5f', '#ffd23f', '#3ddc97', '#c77dff', '#ff9f1c'];
  const SWINGS = 10;
  const GRACE = 0.38;          // s after the ball crosses the plate that we still wait for a (delayed) swing message
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => performance.now() / 1000;
  const D2R = Math.PI / 180;

  // ---------------- simple pitched-camera 3D view ----------------
  class View {
    constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.cam = { x: 0, y: 1.4, z: -3.6, pitch: 0.075 }; }
    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      this.W = this.c.clientWidth || root.innerWidth; this.H = this.c.clientHeight || root.innerHeight;
      this.c.width = Math.round(this.W * dpr); this.c.height = Math.round(this.H * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.F = Math.min(this.H * 0.96, this.W * 0.75);
      this.CY = this.H * 0.5;
    }
    toCam(p) {
      const c = this.cam, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      const dx = p[0] - c.x, dy = p[1] - c.y, dz = p[2] - c.z;
      return [dx, dy * cp + dz * sp, dz * cp - dy * sp];
    }
    projCam(q) { return { x: this.W / 2 + q[0] * this.F / q[2], y: this.CY - q[1] * this.F / q[2], s: this.F / q[2] }; }
    proj(p) { const q = this.toCam(p); return q[2] < 0.1 ? null : this.projCam(q); }
    poly(pts, fill) {
      const N = 0.1;
      let cam = pts.map(p => this.toCam(p)), out = [];
      for (let i = 0; i < cam.length; i++) {
        const a = cam[i], b = cam[(i + 1) % cam.length];
        const ina = a[2] >= N, inb = b[2] >= N;
        if (ina) out.push(a);
        if (ina !== inb) { const t = (N - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, N]); }
      }
      if (out.length < 3) return;
      const ctx = this.ctx; ctx.beginPath();
      out.forEach((q, i) => { const s = this.projCam(q); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    }
    line(a, b, color, w) {
      let qa = this.toCam(a), qb = this.toCam(b);
      if (qa[2] < 0.1 && qb[2] < 0.1) return;
      if (qa[2] < 0.1 || qb[2] < 0.1) { const [i, o] = qa[2] < 0.1 ? [qb, qa] : [qa, qb]; const t = (0.1 - i[2]) / (o[2] - i[2]); const m = [i[0] + (o[0] - i[0]) * t, i[1] + (o[1] - i[1]) * t, 0.1]; if (qa[2] < 0.1) qa = m; else qb = m; }
      const s = this.projCam(qa), e = this.projCam(qb), ctx = this.ctx;
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    }
  }

  // fan-shaped polygon between radii r0..r1 (clamped to the fence) over the fair angles
  function ring(r0, r1) {
    const pts = [], steps = 30, a0 = -PARK.foul, a1 = PARK.foul;
    for (let i = 0; i <= steps; i++) { const t = a0 + (a1 - a0) * i / steps, r = Math.min(r1, PARK.fence(t)); pts.push([Math.sin(t) * r, 0, Math.cos(t) * r]); }
    for (let i = steps; i >= 0; i--) { const t = a0 + (a1 - a0) * i / steps, r = Math.min(r0, PARK.fence(t)); pts.push([Math.sin(t) * r, 0, Math.cos(t) * r]); }
    return pts;
  }
  const circle = (cx, cz, r, n = 28) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r]; });

  class BaseballGame {
    constructor({ canvas, hud, sfx, onUpdate }) {
      this.view = new View(canvas);
      this.sfx = sfx; this.onUpdate = onUpdate || (() => {});
      this.players = []; this.cur = 0; this.over = false; this.started = false;
      this.state = 'wait'; this.timer = 2.5; this.idle = 0;
      this.pitch = null; this.hit = null; this.armed = false; this.swingAnim = -1; this.lefty = false;
      this.crowd = Array.from({ length: 260 }, () => ({ t: (Math.random() * 2 - 1) * (PARK.foul + 0.15), h: Math.random(), c: ['#e8e8e8', '#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c'][Math.floor(Math.random() * 5)] }));
      this._buildHud(hud);
      this.view.resize(); root.addEventListener('resize', () => this.view.resize());
      this.last = performance.now();
      requestAnimationFrame(t => this._tick(t));
    }

    // ---------- players ----------
    canJoinNow() { return !this.started && this.players.length < 6; }
    addPlayer(name) {
      if (this.players.length >= 6) return -1;
      const i = this.players.length;
      this.players.push({ name: name || 'Player ' + (i + 1), color: COLORS[i % COLORS.length], swings: 0, hrs: 0, longest: 0, best: 0 });
      this._renderBoard(); this._emit();
      return i;
    }
    renamePlayer(i, n) { if (this.players[i] && n) { this.players[i].name = String(n).slice(0, 14); this._renderBoard(); this._emit(); } }
    newGame() {
      for (const p of this.players) { p.swings = 0; p.hrs = 0; p.longest = 0; }
      this.cur = 0; this.over = false; this.started = false; this.state = 'wait'; this.timer = 2; this.pitch = null; this.hit = null;
      this._flash('PLAY BALL!', 'info'); this._renderBoard(); this._emit();
    }
    info() {
      const p = this.players[this.cur];
      return {
        state: this.state, over: this.over, started: this.started, cur: this.cur,
        players: this.players.map(q => ({ name: q.name, color: q.color, hrs: q.hrs, longest: Math.round(q.longest) })),
        swingsLeft: p ? SWINGS - p.swings : SWINGS, hrs: p ? p.hrs : 0,
        pitching: this.state === 'windup' || this.state === 'pitch',
      };
    }

    // ---------- input ----------
    input(idx, m) {
      if (!this.players[idx]) return false;
      const mine = idx === this.cur && !this.over;
      if (m.t === 'arm') { if (mine) { this.armed = !!m.on; if (typeof m.lefty === 'boolean') this.lefty = m.lefty; } return true; }
      if (m.t === 'swing') {
        if (!mine) return false;
        if (typeof m.lefty === 'boolean') this.lefty = m.lefty;
        // swing time on the big screen's clock (phones send it already converted)
        const at = m.at ? m.at / 1000 : now() - 0.06;
        this._swing(at, Math.max(0, Math.min(1, +m.power || 0)));
        return true;
      }
      return false;
    }

    _swing(at, power) {
      this.swingAnim = 0;
      if (this.sfx) { this.sfx.unlock(); }
      if (this.state !== 'pitch' || !this.pitch || this.pitch.judged || at < this.pitch.releaseT) {
        if (this.state === 'wait' || this.state === 'windup') this._flash('WAIT FOR THE PITCH', 'info');
        return;
      }
      const pt = this.pitch, p = this.players[this.cur];
      pt.judged = true;
      this.started = true;
      p.swings++;
      const dt = at - pt.plateT;
      const c = contact(dt, power, pt.p, this.lefty);
      this.lastTiming = dt;
      if (c.kind === 'miss') {
        this._result(dt < 0 ? 'SWING AND A MISS · EARLY' : 'SWING AND A MISS · LATE', 'info', 1.2);
        return;
      }
      const u = Math.max(0.85, Math.min(1.05, (at - pt.releaseT) / pt.p.dur));
      const start = pitchPos(pt.p, u);
      const f = flight(start, c.ev, c.la, c.spray);
      this.hit = { f, i: 0, c, dt };
      this.state = 'hit';
      if (this.sfx) this.sfx.hit(1.5 + c.quality * 2.5);
      this._renderTop(); this._emit();
    }

    _result(text, kind, secs) {
      this._flash(text, kind);
      this.state = 'result'; this.timer = secs;
      this._renderBoard(); this._renderTop(); this._emit();
    }

    _finishHit() {
      const { f, c, dt } = this.hit, p = this.players[this.cur];
      const d = Math.round(f.dist);
      const timing = Math.abs(dt) < 0.03 ? 'PERFECT' : dt < 0 ? 'EARLY' : 'LATE';
      let msg, kind = 'info', secs = 1.6;
      if (f.outcome === 'hr') {
        p.hrs++; p.longest = Math.max(p.longest, f.dist);
        msg = `HOME RUN! ${d} M`; kind = 'strike'; secs = 2.4;
        if (this.sfx) this.sfx.fanfare('strike');
      } else if (f.outcome === 'wall') msg = `OFF THE WALL · ${d} M`;
      else if (f.outcome === 'foul' || c.kind === 'foul') msg = 'FOUL BALL';
      else if (f.outcome === 'ground') msg = `GROUNDER · ${timing}`;
      else msg = `FLY OUT · ${d} M`;
      this.hit = null;
      this._result(msg, kind, secs);
    }

    _nextBatterOrPitch() {
      const p = this.players[this.cur];
      if (p && p.swings >= SWINGS) {
        if (this.cur + 1 < this.players.length) {
          this.cur++;
          this._flash(`NOW BATTING: ${this.players[this.cur].name.toUpperCase()}`, 'info');
          this.state = 'wait'; this.timer = 2.6; this.armed = false;
        } else {
          this.over = true; this.state = 'over';
          const r = [...this.players].sort((a, b) => b.hrs - a.hrs || b.longest - a.longest);
          this._flash(r.length > 1 ? `${r[0].name} WINS · ${r[0].hrs} HR` : `DERBY OVER · ${r[0].hrs} HR`, 'over', true);
        }
      } else { this.state = 'wait'; this.timer = 1.2; }
      this.idle = 0;
      this._renderBoard(); this._renderTop(); this._emit();
    }

    // ---------- loop ----------
    _tick(ms) {
      const dt = Math.min(0.05, (ms - this.last) / 1000); this.last = ms;
      const t = now();
      if (this.players.length && !this.over) {
        if (this.state === 'wait') {
          this.timer -= dt; this.idle += dt;
          if (this.timer <= 0 && (this.armed || this.idle > 3.2)) { this.state = 'windup'; this.timer = 1.05; this._emit(); }
        } else if (this.state === 'windup') {
          this.timer -= dt;
          if (this.timer <= 0) {
            const p = makePitch();
            this.pitch = { p, releaseT: t, plateT: t + p.dur, judged: false };
            this.state = 'pitch';
            this._renderTop(); this._emit();
          }
        } else if (this.state === 'pitch') {
          if (!this.pitch.judged && t > this.pitch.plateT + GRACE) {
            this.pitch.judged = true;
            this._result(this.pitch.p.inZone ? 'STRIKE' : 'BALL', 'info', 0.9);
          }
        } else if (this.state === 'hit' && this.hit) {
          this.hit.i += dt * 60 * 1.25;
          if (this.hit.i >= this.hit.f.path.length - 1) { this.hit.i = this.hit.f.path.length - 1; this._finishHit(); }
        } else if (this.state === 'result') {
          this.timer -= dt;
          if (this.timer <= 0) { this.pitch = null; this._nextBatterOrPitch(); }
        }
      }
      if (this.swingAnim >= 0) { this.swingAnim += dt * 4; if (this.swingAnim > 1.6) this.swingAnim = -1; }
      this._camera(dt);
      this.draw(t);
      requestAnimationFrame(x => this._tick(x));
    }

    _camera(dt) {
      const c = this.view.cam;
      let tx = 0, ty = 1.4, tz = -3.6, tp = 0.075;
      const ballPt = this.hit ? this.hit.f.path[Math.floor(this.hit.i)] : null;
      if (ballPt && (this.state === 'hit' || this.state === 'result')) {
        const r = Math.hypot(ballPt.x, ballPt.z);
        tz = Math.max(-3.6, ballPt.z - 20);
        tx = ballPt.x * 0.8;
        ty = 3 + Math.min(32, ballPt.y * 0.7 + r * 0.06);
        tp = Math.max(0.03, Math.min(0.6, Math.atan2(ty - ballPt.y, ballPt.z - tz)));
      } else if (this.state === 'result' && this.lastBall) {
        const b = this.lastBall; tz = Math.max(-3.6, b.z - 20); tx = b.x * 0.8; ty = 3 + Math.hypot(b.x, b.z) * 0.06; tp = Math.max(0.03, Math.min(0.6, Math.atan2(ty, b.z - tz)));
      }
      if (ballPt) this.lastBall = ballPt;
      if (this.state === 'wait' || this.state === 'windup' || this.state === 'pitch') this.lastBall = null;
      const k = Math.min(1, dt * (this.state === 'hit' ? 3 : 2));
      c.x += (tx - c.x) * k; c.y += (ty - c.y) * k; c.z += (tz - c.z) * k; c.pitch += (tp - c.pitch) * k;
    }

    // ---------- drawing ----------
    draw(t) {
      const v = this.view, ctx = v.ctx, W = v.W, H = v.H;
      // night sky
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#060a1f'); sky.addColorStop(0.5, '#16234a'); sky.addColorStop(1, '#0d1430');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      // light towers glow
      for (const lx of [-90, 90]) { const p = v.proj([lx, 45, 120]); if (p) { const r = 9 * p.s; const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, 'rgba(255,255,230,0.9)'); g.addColorStop(1, 'rgba(255,255,230,0)'); ctx.fillStyle = g; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); } }
      // stands beyond the fence, then ground
      const steps = 30;
      for (let i = 0; i < steps; i++) {
        const a0 = -PARK.foul - 0.2 + (PARK.foul * 2 + 0.4) * i / steps, a1 = -PARK.foul - 0.2 + (PARK.foul * 2 + 0.4) * (i + 1) / steps;
        const f0 = PARK.fence(Math.max(-PARK.foul, Math.min(PARK.foul, a0))) + 4, f1 = PARK.fence(Math.max(-PARK.foul, Math.min(PARK.foul, a1))) + 4;
        v.poly([[Math.sin(a0) * f0, 0, Math.cos(a0) * f0], [Math.sin(a1) * f1, 0, Math.cos(a1) * f1], [Math.sin(a1) * (f1 + 40), 26, Math.cos(a1) * (f1 + 40)], [Math.sin(a0) * (f0 + 40), 26, Math.cos(a0) * (f0 + 40)]], i % 2 ? '#1c2340' : '#1f2747');
      }
      for (const cr of this.crowd) {
        const f = PARK.fence(Math.max(-PARK.foul, Math.min(PARK.foul, cr.t))) + 4 + cr.h * 40;
        const p = v.proj([Math.sin(cr.t) * f, cr.h * 26 + 0.8, Math.cos(cr.t) * f]);
        if (p) { ctx.fillStyle = cr.c; ctx.fillRect(p.x, p.y, Math.max(1.5, p.s * 0.9), Math.max(1.5, p.s * 1.1)); }
      }
      v.poly([[-500, 0, -60], [500, 0, -60], [500, 0, 600], [-500, 0, 600]], '#24572c');
      // fair territory with mowing rings
      for (let r = 0; r < 130; r += 9) v.poly(ring(r, r + 9), (r / 9) % 2 ? '#3c8a3f' : '#358038');
      // warning track
      for (let i = 0; i < steps; i++) {
        const a0 = -PARK.foul + PARK.foul * 2 * i / steps, a1 = -PARK.foul + PARK.foul * 2 * (i + 1) / steps;
        const f0 = PARK.fence(a0), f1 = PARK.fence(a1);
        v.poly([[Math.sin(a0) * (f0 - 4.5), 0, Math.cos(a0) * (f0 - 4.5)], [Math.sin(a1) * (f1 - 4.5), 0, Math.cos(a1) * (f1 - 4.5)], [Math.sin(a1) * f1, 0, Math.cos(a1) * f1], [Math.sin(a0) * f0, 0, Math.cos(a0) * f0]], '#a87b4f');
      }
      // infield dirt (fan clipped by a circle around the mound), grass diamond, mound, home circle
      const dirt = [[0, 0, -1.5]];
      for (let a = -47; a <= 47; a += 2) { const th = a * D2R, r = PARK.mound * Math.cos(th) + Math.sqrt(28.5 ** 2 - (PARK.mound * Math.sin(th)) ** 2); dirt.push([Math.sin(th) * r, 0, Math.cos(th) * r]); }
      v.poly(dirt, '#b98252');
      v.poly([[0, 0, 4.6], [14.6, 0, 19.4], [0, 0, 34.2], [-14.6, 0, 19.4]], '#3c8a3f');
      v.poly(circle(0, PARK.mound, 2.75), '#b98252');
      v.poly(circle(0, 0, 4.0), '#b98252');
      v.poly([[-0.3, 0, PARK.mound - 0.08], [0.3, 0, PARK.mound - 0.08], [0.3, 0, PARK.mound + 0.08], [-0.3, 0, PARK.mound + 0.08]], '#f4f4f4');
      // foul lines, bases, plate, batter's boxes
      for (const s of [-1, 1]) {
        const f = PARK.fence(s * PARK.foul);
        v.poly([[s * 0.05, 0, 0.3], [s * Math.sin(PARK.foul) * f + s * 0.05, 0, Math.cos(PARK.foul) * f], [s * Math.sin(PARK.foul) * f - s * 0.05, 0, Math.cos(PARK.foul) * f], [-s * 0.05, 0, 0.3]], '#f4f4f4');
      }
      const base = (x, z) => v.poly([[x, 0.02, z - 0.27], [x + 0.27, 0.02, z], [x, 0.02, z + 0.27], [x - 0.27, 0.02, z]], '#ffffff');
      const b45 = PARK.base * Math.SQRT1_2;
      base(b45, b45); base(0, b45 * 2); base(-b45, b45);
      v.poly([[-0.216, 0.01, 0.216], [0.216, 0.01, 0.216], [0.216, 0.01, 0], [0, 0.01, -0.216], [-0.216, 0.01, 0]], '#ffffff');
      for (const s of [-1, 1]) { const x0 = s * 0.38, x1 = s * 1.6; for (const [a, b] of [[[x0, 0.01, -0.9], [x1, 0.01, -0.9]], [[x1, 0.01, -0.9], [x1, 0.01, 0.9]], [[x1, 0.01, 0.9], [x0, 0.01, 0.9]], [[x0, 0.01, 0.9], [x0, 0.01, -0.9]]]) v.line(a, b, 'rgba(255,255,255,0.7)', 1.5); }
      // outfield wall
      for (let i = 0; i < steps; i++) {
        const a0 = -PARK.foul + PARK.foul * 2 * i / steps, a1 = -PARK.foul + PARK.foul * 2 * (i + 1) / steps;
        const f0 = PARK.fence(a0), f1 = PARK.fence(a1), h0 = PARK.fenceH(a0), h1 = PARK.fenceH(a1);
        const p0 = [Math.sin(a0) * f0, 0, Math.cos(a0) * f0], p1 = [Math.sin(a1) * f1, 0, Math.cos(a1) * f1];
        v.poly([p0, p1, [p1[0], h1, p1[2]], [p0[0], h0, p0[2]]], '#174a2b');
        v.poly([[p0[0], h0 - 0.25, p0[2]], [p1[0], h1 - 0.25, p1[2]], [p1[0], h1, p1[2]], [p0[0], h0, p0[2]]], '#ffd23f');
      }
      for (const s of [-1, 1]) { const f = PARK.fence(s * PARK.foul); v.line([s * Math.sin(PARK.foul) * f, 0, Math.cos(PARK.foul) * f], [s * Math.sin(PARK.foul) * f, 14, Math.cos(PARK.foul) * f], '#ffd23f', 3); }
      // distance markers
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const a of [-45, -22.5, 0, 22.5, 45]) {
        const th = a * D2R, f = PARK.fence(th) - 0.3, p = v.proj([Math.sin(th) * f, PARK.fenceH(th) * 0.5, Math.cos(th) * f]);
        if (p && p.s > 3) { ctx.fillStyle = '#ffffff'; ctx.font = `800 ${Math.min(42, p.s * 1.6)}px system-ui, sans-serif`; ctx.fillText(String(Math.round(PARK.fence(th))), p.x, p.y); }
      }
      // pitcher
      this._pitcher(t);
      // strike zone + pitch
      const pitching = this.state === 'pitch' || (this.state === 'result' && this.pitch && !this.hit);
      if (this.state === 'windup' || this.state === 'pitch') {
        const z = B.ZONE;
        const pts = [[-z.x, z.y0, 0], [z.x, z.y0, 0], [z.x, z.y1, 0], [-z.x, z.y1, 0]];
        for (let i = 0; i < 4; i++) v.line(pts[i], pts[(i + 1) % 4], 'rgba(255,255,255,0.35)', 2);
      }
      if (pitching && this.pitch) {
        const u = Math.min(1.25, (now() - this.pitch.releaseT) / this.pitch.p.dur);
        const bp = pitchPos(this.pitch.p, u);
        this._ball(bp);
      }
      if (this.hit) {
        const path = this.hit.f.path, n = Math.floor(this.hit.i);
        for (let i = Math.max(1, n - 30); i <= n; i++) v.line([path[i - 1].x, path[i - 1].y, path[i - 1].z], [path[i].x, path[i].y, path[i].z], `rgba(255,255,255,${0.15 + 0.5 * (i - n + 30) / 30})`, 2);
        this._ball(path[n]);
      } else if (this.state === 'result' && this.lastBall) this._ball(this.lastBall);
      this._batter();
    }

    _ball(p) {
      const v = this.view, ctx = v.ctx;
      const sh = v.proj([p.x, 0.01, p.z]);
      if (sh) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, Math.max(1.5, 0.05 * sh.s), Math.max(1, 0.02 * sh.s), 0, 0, Math.PI * 2); ctx.fill(); }
      const q = v.proj([p.x, p.y, p.z]);
      if (!q) return;
      const r = Math.max(3.5, 0.037 * q.s);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
      if (r > 6) { ctx.strokeStyle = '#d33'; ctx.lineWidth = Math.max(1, r * 0.12); ctx.beginPath(); ctx.arc(q.x - r * 0.9, q.y, r * 0.8, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(q.x + r * 0.9, q.y, r * 0.8, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke(); }
    }

    _pitcher(t) {
      const v = this.view, ctx = v.ctx, foot = v.proj([0.1, 0.25, PARK.mound + 0.3]);
      if (!foot) return;
      const s = foot.s;
      let wind = 0;
      if (this.state === 'windup') wind = 1 - this.timer / 1.05;
      if (this.state === 'pitch') wind = 1 + Math.min(1, (now() - this.pitch.releaseT) * 4);
      const kneeLift = this.state === 'windup' ? Math.sin(wind * Math.PI) * 0.45 : 0;
      ctx.save(); ctx.translate(foot.x, foot.y); ctx.scale(s, s);
      ctx.lineCap = 'round'; ctx.strokeStyle = '#e9ecf5'; ctx.fillStyle = '#e9ecf5';
      ctx.lineWidth = 0.16;
      ctx.beginPath(); ctx.moveTo(-0.15, 0); ctx.lineTo(-0.1, -0.9); ctx.stroke();                         // plant leg
      ctx.beginPath(); ctx.moveTo(0.15, -kneeLift); ctx.lineTo(0.1, -0.9); ctx.stroke();                    // stride leg
      ctx.lineWidth = 0.34; ctx.beginPath(); ctx.moveTo(0, -0.95); ctx.lineTo(0, -1.5); ctx.stroke();        // body
      ctx.fillStyle = '#2b3a67'; ctx.beginPath(); ctx.arc(0, -1.72, 0.14, 0, Math.PI * 2); ctx.fill();     // cap
      ctx.fillStyle = '#f1c9a5'; ctx.beginPath(); ctx.arc(0, -1.64, 0.12, 0, Math.PI * 2); ctx.fill();
      // throwing arm: back during windup, over the top at release
      const ang = wind < 1 ? -Math.PI / 2 - wind * 2.2 : -Math.PI / 2 - 2.2 + (wind - 1) * 3.6;
      ctx.strokeStyle = '#e9ecf5'; ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.moveTo(0.12, -1.45); ctx.lineTo(0.12 + Math.cos(ang) * 0.6, -1.45 + Math.sin(ang) * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.12, -1.45); ctx.lineTo(-0.45, -1.2 + kneeLift * 0.3); ctx.stroke();
      ctx.restore();
    }

    _batter() {
      if (!(this.state === 'wait' || this.state === 'windup' || this.state === 'pitch' || (this.state === 'result' && !this.lastBall))) return;
      const v = this.view, ctx = v.ctx, side = this.lefty ? 1 : -1;
      const foot = v.proj([side * 1.0, 0, 0.15]);
      if (!foot) return;
      const s = foot.s;
      ctx.save(); ctx.globalAlpha = 0.55; ctx.translate(foot.x, foot.y); ctx.scale(s * side * -1, s);
      const p = this.players[this.cur], col = p ? p.color : '#3fa9f5';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#d9dde8'; ctx.lineWidth = 0.17;
      ctx.beginPath(); ctx.moveTo(-0.2, 0); ctx.lineTo(-0.1, -0.85); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.25, 0); ctx.lineTo(0.1, -0.85); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 0.42; ctx.beginPath(); ctx.moveTo(0, -0.95); ctx.lineTo(0.02, -1.45); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0.03, -1.68, 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(0.03, -1.7, 0.2, 0.05);
      // bat: cocked behind the head, sweeping through on a swing
      let a = -2.3;
      if (this.armed) a = -2.5;
      if (this.swingAnim >= 0) a = -2.5 + Math.min(1, this.swingAnim) * 3.6;
      const hx = -0.15, hy = -1.35;
      ctx.strokeStyle = '#c8955c'; ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 0.85, hy + Math.sin(a) * 0.85); ctx.stroke();
      ctx.strokeStyle = '#d9dde8'; ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.moveTo(0, -1.4); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.restore();
    }

    // ---------- HUD ----------
    _buildHud(hud) {
      hud.classList.add('hud');
      hud.innerHTML = `<div class="holeinfo batinfo"></div><div class="wind pitchinfo"><span></span></div>
        <div class="scores card-golf board"></div><div class="turn"></div><div class="msg"><span></span></div>`;
      this.el = { bat: hud.querySelector('.batinfo'), pitch: hud.querySelector('.pitchinfo span'), board: hud.querySelector('.board'), turn: hud.querySelector('.turn'), msg: hud.querySelector('.msg'), msgText: hud.querySelector('.msg span') };
      this._renderTop();
    }
    _renderTop() {
      const p = this.players[this.cur];
      this.el.bat.innerHTML = p ? `<b style="color:${p.color}">${esc(p.name)}</b> · ${p.hrs} HR<small>Swing ${Math.min(SWINGS, p.swings + (this.over ? 0 : 1))} of ${SWINGS}</small>` : '<b>HOME RUN DERBY</b><small>Waiting for batters</small>';
      const pt = this.pitch && this.pitch.p;
      let s = pt ? `${pt.type.name}<br><b>${Math.round(pt.speed * 3.6)} km/h</b>` : 'Pitch';
      if (this.lastTiming !== undefined && this.state !== 'pitch') { const ms = Math.round(this.lastTiming * 1000); s += `<br>timing ${ms > 0 ? '+' : ''}${ms} ms`; }
      this.el.pitch.innerHTML = s;
      this.el.turn.innerHTML = this.over ? 'Derby over' : p ? (this.state === 'wait' && !this.armed ? 'Hold the button on your phone to get ready' : this.state === 'windup' ? 'Here comes the pitch…' : '') : '';
    }
    _renderBoard() {
      if (!this.players.length) { this.el.board.innerHTML = ''; return; }
      let h = '<table><thead><tr><th></th><th>HR</th><th>Longest</th><th>Swings</th></tr></thead><tbody>';
      this.players.forEach((p, i) => { h += `<tr class="${i === this.cur && !this.over ? 'active' : ''}"><td class="name"><i style="background:${p.color}"></i>${esc(p.name)}</td><td class="total">${p.hrs}</td><td>${p.longest ? Math.round(p.longest) + ' m' : '–'}</td><td>${p.swings}/${SWINGS}</td></tr>`; });
      this.el.board.innerHTML = h + '</tbody></table>';
    }
    _flash(text, kind, sticky) {
      const el = this.el.msg;
      this.el.msgText.textContent = text;
      el.className = 'msg ' + (kind || '');
      void el.offsetWidth;
      el.classList.add(sticky ? 'sticky' : 'show');
    }
    _emit() { this._renderTop(); try { this.onUpdate(this.info()); } catch (e) { console.error(e); } }
  }

  B.BaseballGame = BaseballGame;
})(self);
