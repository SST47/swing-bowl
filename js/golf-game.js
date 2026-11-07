/* Swing Golf — game flow, turns, camera and top-down rendering. */
(function (root) {
  'use strict';
  const { HOLES, CLUBS, surfaceAt, simulate, suggestClub, scoreName } = root.GOLF;
  const COLORS = ['#ffffff', '#ffd23f', '#ff5a5f', '#3fa9f5', '#3ddc97', '#c77dff'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIE_TEXT = { tee: 'Tee', fairway: 'Fairway', fringe: 'Fringe', green: 'Green', rough: 'Rough', sand: 'Bunker' };
  const MAX_OVER_PAR = 5;
  const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };

  class GolfGame {
    constructor({ canvas, hud, sfx, onUpdate }) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.sfx = sfx; this.onUpdate = onUpdate || (() => {});
      this.players = [];
      this.hi = 0; this.cur = 0; this.state = 'address'; this.over = false; this.started = false;
      this.cam = { x: 0, y: 0, ang: Math.PI / 2, s: 2, oy: 0.8 };
      this.anim = null; this.armed = null;
      this._buildHud(hud);
      this._setupHole(0);
      this.resize(); root.addEventListener('resize', () => this.resize());
      this.last = performance.now();
      requestAnimationFrame(t => this._tick(t));
    }

    // ---------- players & state ----------
    canJoinNow() { return !this.started && this.players.length < 6; }
    addPlayer(name) {
      if (this.players.length >= 6) return -1;
      const i = this.players.length;
      const h = this.hole;
      this.players.push({ name: name || 'Player ' + (i + 1), color: COLORS[i % COLORS.length], cards: [], ball: { ...h.tee }, prev: { ...h.tee }, lie: 'tee', strokes: 0, holed: false, club: suggestClub(this._dist(h.tee), 'tee') });
      this._renderCard(); this._emit();
      return i;
    }
    renamePlayer(i, n) { if (this.players[i] && n) { this.players[i].name = String(n).slice(0, 14); this._renderCard(); this._emit(); } }
    // Kick a player, even mid-hole. If it was their shot, play moves on.
    removePlayer(i) {
      const p = this.players[i];
      if (!p) return;
      const wasCur = i === this.cur;
      if (this.anim && this.anim.p === p) this.anim = null;
      this.players.splice(i, 1);
      if (!this.players.length) { this.cur = 0; this.newGame(); return; }
      if (i < this.cur) this.cur--;
      if (wasCur && !this.over && ['address', 'flight', 'result'].includes(this.state)) {
        this.armed = null;
        this.cur = Math.min(this.cur, this.players.length - 1);
        this._next();
      } else if (this.cur >= this.players.length) this.cur = 0;
      this._renderCard(); this._emit();
    }

    newGame() {
      for (const p of this.players) p.cards = [];
      this.over = false; this.started = false;
      this._setupHole(0);
      this._flash('NEW ROUND', 'info');
      this._emit();
    }
    get hole() { return HOLES[this.hi]; }
    _dist(p) { return Math.hypot(this.hole.pin.x - p.x, this.hole.pin.y - p.y); }
    _aim(p) { return Math.atan2(this.hole.pin.y - p.y, this.hole.pin.x - p.x); }

    _setupHole(i) {
      this.hi = i;
      const h = this.hole;
      this.wind = (() => { const a = Math.random() * Math.PI * 2, v = Math.random() * 5.5; return { x: Math.cos(a) * v, y: Math.sin(a) * v, v }; })();
      for (const p of this.players) { p.ball = { ...h.tee }; p.prev = { ...h.tee }; p.lie = 'tee'; p.strokes = 0; p.holed = false; p.club = suggestClub(this._dist(h.tee), 'tee'); }
      this.cur = 0; this.state = 'address'; this.anim = null;
      this._frame(true);
      this._renderHole(); this._renderCard(); this._renderTurn();
    }

    info() {
      const p = this.players[this.cur];
      return {
        state: this.state, over: this.over, started: this.started, cur: this.cur,
        hole: this.hi + 1, holes: HOLES.length, par: this.hole.par,
        players: this.players.map(q => ({ name: q.name, color: q.color, toPar: this._toPar(q) })),
        dist: p ? Math.round(this._dist(p.ball)) : 0, lie: p ? p.lie : 'tee',
        club: p ? CLUBS[p.club].name : '', clubIdx: p ? p.club : 0, putter: p ? !!CLUBS[p.club].putter : false,
        stroke: p ? p.strokes + 1 : 1,
      };
    }

    // ---------- input ----------
    input(idx, m) {
      const p = this.players[idx];
      if (!p) return false;
      const myTurn = idx === this.cur && this.state === 'address' && !this.over;
      if (m.t === 'club') {
        if (!myTurn) return false;
        p.club = Math.max(0, Math.min(CLUBS.length - 1, p.club + (m.d > 0 ? 1 : -1)));
        this._renderTurn(); this._emit();
        return true;
      }
      if (m.t === 'arm') { this.armed = m.on && myTurn ? idx : null; this._renderTurn(); return true; }
      if (m.t === 'swing') {
        if (!myTurn) return false;
        this.armed = null;
        this._shoot(p, m);
        return true;
      }
      return false;
    }

    _shoot(p, m) {
      this.started = true;
      const club = CLUBS[p.club];
      const heading = this._aim(p.ball) + (Math.max(-15, Math.min(15, +m.path || 0))) * Math.PI / 180;
      const res = simulate({ hole: this.hole, from: p.ball, heading, club, power: +m.power || 0, side: club.putter ? 0 : +m.side || 0, wind: club.putter ? null : this.wind, lie: p.lie });
      this.anim = { p, res, i: 0, club, from: { ...p.ball } };
      this.state = 'flight';
      if (this.sfx) { this.sfx.unlock(); this.sfx.hit(club.putter ? 0.4 : 1.5 + (+m.power || 0) * 2); }
      this._renderTurn(); this._emit();
    }

    _finishShot() {
      const { p, res, club, from } = this.anim;
      const h = this.hole;
      let msg = '', kind = 'info';
      p.strokes++;
      if (res.result === 'water' || res.result === 'oob') {
        p.strokes++;   // penalty, replay from the same spot
        msg = res.result === 'water' ? 'SPLASH! +1' : 'OUT OF BOUNDS +1';
        p.ball = { ...from };
        if (this.sfx) this.sfx.sad();
      } else if (res.result === 'holed') {
        p.holed = true; p.ball = { ...h.pin };
        msg = scoreName(p.strokes, h.par); kind = p.strokes <= h.par ? 'strike' : 'spare';
        if (this.sfx) { this.sfx.clack(2); if (p.strokes < h.par || p.strokes === 1) this.sfx.fanfare('strike'); else if (p.strokes === h.par) this.sfx.fanfare('spare'); }
      } else {
        p.prev = { ...from };
        p.ball = { ...res.end };
        p.lie = surfaceAt(h, p.ball);
        const d = Math.round(res.total);
        if (club.putter) msg = this._dist(p.ball) < 1 ? 'SO CLOSE!' : `${d} M PUTT`;
        else msg = `${d} M` + (p.lie === 'fairway' ? ' · FAIRWAY' : p.lie === 'green' ? ' · ON THE GREEN' : p.lie === 'sand' ? ' · IN THE BUNKER' : p.lie === 'rough' ? ' · ROUGH' : '');
        if (this.sfx) this.sfx.thud();
      }
      if (!p.holed && p.strokes >= h.par + MAX_OVER_PAR) { p.holed = true; p.strokes = h.par + MAX_OVER_PAR; msg = 'PICKED UP'; }
      p.club = suggestClub(this._dist(p.ball), p.lie);
      this._flash(msg, kind);
      this.anim = null;
      this.state = 'result';
      this.resultT = 1.6;
      this._renderCard(); this._emit();
    }

    _next() {
      const left = this.players.filter(p => !p.holed);
      if (!left.length) {
        for (const p of this.players) p.cards[this.hi] = p.strokes;
        this._renderCard();
        if (this.hi + 1 >= HOLES.length) {
          this.over = true; this.state = 'over';
          const ranked = [...this.players].sort((a, b) => this._total(a) - this._total(b));
          const t = this._toPar(ranked[0]);
          this._flash(ranked.length > 1 ? `${ranked[0].name} WINS · ${t}` : `ROUND OVER · ${t}`, 'over', true);
          this._emit();
          return;
        }
        this.state = 'holeover'; this.resultT = 2.2;
        this._flash(`ON TO HOLE ${this.hi + 2}`, 'info');
        this._emit();
        return;
      }
      // farthest from the hole plays next (ties: player order)
      let best = null;
      for (const p of left) if (!best || this._dist(p.ball) > this._dist(best.ball) + 0.01) best = p;
      this.cur = this.players.indexOf(best);
      this.state = 'address';
      this._frame(false);
      this._renderTurn(); this._emit();
    }

    _total(p) { return p.cards.reduce((a, b) => a + (b || 0), 0) + (p.cards[this.hi] === undefined ? p.strokes : 0); }
    _toPar(p) {
      let strokes = 0, par = 0;
      p.cards.forEach((s, i) => { if (s !== undefined) { strokes += s; par += HOLES[i].par; } });
      if (p.cards[this.hi] === undefined && p.holed && !this.over) { strokes += p.strokes; par += this.hole.par; }
      const d = strokes - par;
      return strokes === 0 ? 'E' : d === 0 ? 'E' : (d > 0 ? '+' + d : String(d));
    }

    // ---------- loop ----------
    _tick(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      if (this.state === 'flight' && this.anim) {
        const a = this.anim;
        a.i += dt * 60 * 1.35;   // path points are 60 per simulated second
        if (a.i >= a.res.path.length - 1) { a.i = a.res.path.length - 1; this._finishShot(); }
      } else if (this.state === 'result' || this.state === 'holeover') {
        this.resultT -= dt;
        if (this.resultT <= 0) {
          if (this.state === 'holeover') { this._setupHole(this.hi + 1); this._emit(); }
          else this._next();
        }
      }
      this._camera(dt);
      this.draw(now);
      requestAnimationFrame(t => this._tick(t));
    }

    // Frame the current player's ball and the pin.
    _frame(snap) {
      const p = this.players[this.cur];
      const b = p ? p.ball : this.hole.tee;
      const d = Math.max(4, this._dist(b));
      const H = this.H || 720;
      this.camT = { x: b.x, y: b.y, ang: this._aim(b), s: Math.min(H * 0.64 / d, H / 9), oy: 0.8 };
      if (snap) Object.assign(this.cam, this.camT);
    }

    _camera(dt) {
      if (!this.camT) return;
      if (this.state === 'flight' && this.anim) {
        const pt = this.anim.res.path[Math.floor(this.anim.i)];
        // follow the ball once it heads for the top of the screen
        const sc = this.toScreen(pt.x, pt.y);
        if (sc.y < this.H * 0.3 || sc.x < this.W * 0.1 || sc.x > this.W * 0.9) { this.camT.x = pt.x; this.camT.y = pt.y; this.camT.oy = 0.5; }
      }
      const k = Math.min(1, dt * (this.state === 'flight' ? 1.6 : 2.4));
      const c = this.cam, t = this.camT;
      c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.s += (t.s - c.s) * k; c.oy += (t.oy - c.oy) * k;
      c.ang = lerpAng(c.ang, t.ang, k);
    }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      this.W = this.canvas.clientWidth || root.innerWidth; this.H = this.canvas.clientHeight || root.innerHeight;
      this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
      this.dpr = dpr;
      if (this.camT) this._frame(false);
    }

    toScreen(x, y) {
      const c = this.cam, r = Math.PI / 2 - c.ang;
      const dx = x - c.x, dy = y - c.y;
      const rx = dx * Math.cos(r) - dy * Math.sin(r), ry = dx * Math.sin(r) + dy * Math.cos(r);
      return { x: this.W / 2 + rx * c.s, y: this.H * c.oy - ry * c.s };
    }

    // ---------- drawing ----------
    draw(now) {
      const ctx = this.ctx, h = this.hole, c = this.cam;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#1f4a26'; ctx.fillRect(0, 0, this.W, this.H);
      // world transform
      ctx.save();
      ctx.translate(this.W / 2, this.H * c.oy);
      ctx.scale(c.s, -c.s);
      ctx.rotate(Math.PI / 2 - c.ang);
      ctx.translate(-c.x, -c.y);
      const px = 1 / c.s;   // one screen pixel in metres
      const b = h.bounds;
      // rough with soft stripes
      ctx.fillStyle = '#3f7d34'; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let y = b.y0; y < b.y1; y += 16) ctx.fillRect(b.x0, y, b.x1 - b.x0, 8);
      // OOB line
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 6 * px]);
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.setLineDash([]);
      // fairway (+ mowing stripes)
      ctx.save();
      const fw = new Path2D();
      for (let i = 0; i < h.fairway.length; i++) {
        const a = h.fairway[i];
        fw.moveTo(a.x + a.w / 2, a.y); fw.arc(a.x, a.y, a.w / 2, 0, Math.PI * 2);
        if (i < h.fairway.length - 1) {
          const n = h.fairway[i + 1], ang = Math.atan2(n.y - a.y, n.x - a.x), nx = -Math.sin(ang), ny = Math.cos(ang);
          // same winding as the arcs (counter-clockwise in world coords) so overlaps don't cancel out
          const q = [[a.x - nx * a.w / 2, a.y - ny * a.w / 2], [n.x - nx * n.w / 2, n.y - ny * n.w / 2], [n.x + nx * n.w / 2, n.y + ny * n.w / 2], [a.x + nx * a.w / 2, a.y + ny * a.w / 2]];
          let area = 0; for (let k = 0; k < 4; k++) { const u = q[k], v = q[(k + 1) % 4]; area += u[0] * v[1] - v[0] * u[1]; }
          if (area < 0) q.reverse();
          fw.moveTo(q[0][0], q[0][1]); for (let k = 1; k < 4; k++) fw.lineTo(q[k][0], q[k][1]); fw.closePath();
        }
      }
      ctx.fillStyle = '#5fae47'; ctx.fill(fw, 'nonzero');
      ctx.clip(fw, 'nonzero');
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      for (let y = b.y0; y < b.y1; y += 12) ctx.fillRect(b.x0, y, b.x1 - b.x0, 6);
      ctx.restore();
      // tee box
      ctx.fillStyle = '#6cbf52'; ctx.fillRect(h.tee.x - 6, h.tee.y - 4, 12, 8);
      // water
      for (const w of h.water) {
        ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.rot * Math.PI / 180);
        ctx.fillStyle = '#2a7fb8'; ctx.beginPath(); ctx.ellipse(0, 0, w.rx + 1.2, w.ry + 1.2, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, Math.max(w.rx, w.ry));
        g.addColorStop(0, '#4fb3e8'); g.addColorStop(1, '#2d8cc7');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, w.rx, w.ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5 * px;
        const ph = now / 900;
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(Math.sin(ph + k) * w.rx * 0.3, (k - 1.5) * w.ry * 0.35, w.rx * 0.25, 0.6, 0, 0, Math.PI); ctx.stroke(); }
        ctx.restore();
      }
      // green & fringe
      const gr = h.green;
      ctx.fillStyle = '#6fc457'; ctx.beginPath(); ctx.arc(gr.x, gr.y, gr.r + 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#86dc6a'; ctx.beginPath(); ctx.arc(gr.x, gr.y, gr.r, 0, Math.PI * 2); ctx.fill();
      // slope hint arrows on the green when putting-range
      if (c.s > 12) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2 * px;
        const sl = Math.hypot(gr.slope.x, gr.slope.y), ux = gr.slope.x / sl, uy = gr.slope.y / sl;
        for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
          const x0 = gr.x + i * gr.r * 0.38, y0 = gr.y + j * gr.r * 0.38;
          if (Math.hypot(x0 - gr.x, y0 - gr.y) > gr.r * 0.9) continue;
          ctx.beginPath(); ctx.moveTo(x0 - ux * 0.8, y0 - uy * 0.8); ctx.lineTo(x0 + ux * 0.8, y0 + uy * 0.8);
          ctx.lineTo(x0 + ux * 0.4 - uy * 0.3, y0 + uy * 0.4 + ux * 0.3); ctx.stroke();
        }
      }
      // bunkers
      for (const s of h.bunkers) {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot * Math.PI / 180);
        ctx.fillStyle = '#c9b27c'; ctx.beginPath(); ctx.ellipse(0, 0, s.rx + 0.5, s.ry + 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ecdcae'; ctx.beginPath(); ctx.ellipse(0, -0.2, s.rx, s.ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // cup
      ctx.fillStyle = '#10200f'; ctx.beginPath(); ctx.arc(h.pin.x, h.pin.y, Math.max(0.054, 2.5 * px), 0, Math.PI * 2); ctx.fill();
      // aim line + club reach
      const p = this.players[this.cur];
      if (p && this.state === 'address' && !this.over) {
        const club = CLUBS[p.club], a = this._aim(p.ball);
        const reach = Math.min(club.putter ? this._dist(p.ball) : club.target, this._dist(p.ball) + 30);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2 * px; ctx.setLineDash([5 * px, 6 * px]);
        ctx.beginPath(); ctx.moveTo(p.ball.x, p.ball.y); ctx.lineTo(p.ball.x + Math.cos(a) * reach, p.ball.y + Math.sin(a) * reach); ctx.stroke();
        ctx.setLineDash([]);
        if (!club.putter) {
          ctx.strokeStyle = p.color; ctx.lineWidth = 3 * px;
          ctx.beginPath(); ctx.arc(p.ball.x + Math.cos(a) * club.target, p.ball.y + Math.sin(a) * club.target, 8 * px + 2, 0, Math.PI * 2); ctx.stroke();
        }
      }
      // tree shadows then trees
      for (const t of h.trees) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(t.x + t.r * 0.35, t.y - t.r * 0.35, t.r, 0, Math.PI * 2); ctx.fill(); }
      for (const t of h.trees) {
        ctx.fillStyle = '#1f5a2a'; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2f7a38'; ctx.beginPath(); ctx.arc(t.x - t.r * 0.25, t.y + t.r * 0.25, t.r * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      // ----- screen-space overlays: flag, balls, trail -----
      const pin = this.toScreen(h.pin.x, h.pin.y);
      const pole = Math.max(26, Math.min(90, c.s * 2.4));
      ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pin.x, pin.y); ctx.lineTo(pin.x, pin.y - pole); ctx.stroke();
      const wave = Math.sin(now / 250) * 3;
      ctx.fillStyle = '#ff3d5a';
      ctx.beginPath(); ctx.moveTo(pin.x, pin.y - pole); ctx.lineTo(pin.x + pole * 0.45, pin.y - pole * 0.85 + wave); ctx.lineTo(pin.x, pin.y - pole * 0.7); ctx.fill();

      const ballR = Math.max(3, Math.min(9, c.s * 0.25));
      this.players.forEach((q, i) => {
        if (q.holed) return;
        if (this.anim && this.anim.p === q) return;
        this._ball(q.ball.x, q.ball.y, 0, q.color, ballR, i === this.cur && this.state === 'address');
      });
      if (this.anim) {
        const a = this.anim, path = a.res.path, n = Math.floor(a.i);
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        for (let i = 0; i <= n; i += 2) {
          const s = this.toScreen(path[i].x, path[i].y);
          const y = s.y - path[i].z * c.s * 0.5;
          if (i === 0) ctx.moveTo(s.x, y); else ctx.lineTo(s.x, y);
        }
        ctx.stroke();
        const pt = path[n];
        this._ball(pt.x, pt.y, pt.z, a.p.color, ballR, false);
      }
    }

    _ball(x, y, z, color, r, ring) {
      const ctx = this.ctx, s = this.toScreen(x, y), lift = z * this.cam.s * 0.5;
      const rr = r * (1 + Math.min(1.2, z * 0.03));
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(s.x + z * 0.4, s.y + 1, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      if (ring) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y - lift, rr + 6 + Math.sin(performance.now() / 200) * 2, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(s.x, s.y - lift, rr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color === '#ffffff' ? '#888' : color; ctx.lineWidth = 2; ctx.stroke();
    }

    // ---------- HUD ----------
    _buildHud(hud) {
      hud.classList.add('hud');
      hud.innerHTML = `<div class="holeinfo"></div><div class="wind"><div class="arrow">➜</div><span></span></div>
        <div class="scores card-golf"></div><div class="turn"></div><div class="msg"><span></span></div>`;
      this.el = { hole: hud.querySelector('.holeinfo'), wind: hud.querySelector('.wind'), card: hud.querySelector('.scores'), turn: hud.querySelector('.turn'), msg: hud.querySelector('.msg'), msgText: hud.querySelector('.msg span') };
    }
    _renderHole() {
      const h = this.hole;
      this.el.hole.innerHTML = `<b>HOLE ${this.hi + 1}</b> · PAR ${h.par} · ${Math.round(Math.hypot(h.pin.x - h.tee.x, h.pin.y - h.tee.y))} m<small>${esc(h.name)}</small>`;
    }
    _renderTurn() {
      const p = this.players[this.cur];
      if (!p || this.over) { this.el.turn.innerHTML = this.over ? 'Round over' : ''; return; }
      const club = CLUBS[p.club];
      let t = `<b style="color:${p.color}">${esc(p.name)}</b> · Stroke ${p.strokes + 1} · ${Math.round(this._dist(p.ball))} m to pin · <b>${club.name}</b> · ${LIE_TEXT[p.lie] || ''}`;
      if (this.armed !== null && this.state === 'address') t += ' · <span class="swinging">swinging…</span>';
      this.el.turn.innerHTML = t;
    }
    _renderCard() {
      if (!this.players.length) { this.el.card.innerHTML = ''; return; }
      let h = '<table><thead><tr><th></th>' + HOLES.map((x, i) => `<th>${i + 1}<br><small>P${x.par}</small></th>`).join('') + '<th>Tot</th></tr></thead><tbody>';
      this.players.forEach((p, i) => {
        h += `<tr class="${i === this.cur && !this.over ? 'active' : ''}"><td class="name"><i style="background:${p.color}"></i>${esc(p.name)}</td>`;
        HOLES.forEach((x, hi) => {
          const v = p.cards[hi] ?? (hi === this.hi && p.strokes ? p.strokes : '');
          const cls = p.cards[hi] !== undefined ? (p.cards[hi] < x.par ? 'under' : p.cards[hi] > x.par ? 'over' : '') : '';
          h += `<td class="frame ${hi === this.hi && !this.over ? 'cur' : ''} ${cls}"><div class="ft">${v}</div></td>`;
        });
        h += `<td class="total">${this._toPar(p)}</td></tr>`;
      });
      this.el.card.innerHTML = h + '</tbody></table>';
    }
    _flash(text, kind, sticky) {
      const el = this.el.msg;
      this.el.msgText.textContent = text;
      el.className = 'msg ' + (kind || '');
      void el.offsetWidth;
      el.classList.add(sticky ? 'sticky' : 'show');
    }
    _emit() {
      this._renderTurn();
      // wind arrow relative to the screen's "up" (= towards the pin)
      const w = this.wind, rel = Math.atan2(w.y, w.x) - (this.camT ? this.camT.ang : this.cam.ang);
      this.el.wind.querySelector('.arrow').style.transform = `rotate(${-90 - rel * 180 / Math.PI}deg)`;
      this.el.wind.querySelector('span').textContent = w.v < 0.5 ? 'calm' : `${w.v.toFixed(1)} m/s`;
      try { this.onUpdate(this.info()); } catch (e) { console.error(e); }
    }
  }

  root.GOLF.GolfGame = GolfGame;
})(self);
