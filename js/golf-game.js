/* Swing Golf — game flow, turns, scoring and HUD. Drawing is done by a view (the 3D course) plus a 2D minimap. */
(function (root) {
  'use strict';
  const { HOLES, CLUBS, surfaceAt, simulate, suggestClub, scoreName } = root.GOLF;
  const COLORS = ['#ffffff', '#ffd23f', '#ff5a5f', '#3fa9f5', '#3ddc97', '#c77dff'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIE_TEXT = { tee: 'Tee', fairway: 'Fairway', fringe: 'Fringe', green: 'Green', rough: 'Rough', sand: 'Bunker' };
  const MAX_OVER_PAR = 5;
  const FLIGHT_SPEED = 1.25;   // replay speed of the simulated shot

  class GolfGame {
    /* opts: { hud, sfx, onUpdate, view } — view: { setHole(index), render(game, dt, nowMs) } */
    constructor({ hud, sfx, onUpdate, view }) {
      this.sfx = sfx; this.onUpdate = onUpdate || (() => {});
      this.view = view || null;
      this.players = [];
      this.hi = 0; this.cur = 0; this.state = 'address'; this.over = false; this.started = false;
      this.anim = null; this.armed = null; this.swingAt = 0; this.lastShot = null;
      this._buildHud(hud);
      this.minimap = new GolfMap2D(this.el.map);
      this._setupHole(0);
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
    get current() { return this.players[this.cur]; }
    _dist(p) { return Math.hypot(this.hole.pin.x - p.x, this.hole.pin.y - p.y); }
    aimOf(p) { return Math.atan2(this.hole.pin.y - p.y, this.hole.pin.x - p.x); }

    _setupHole(i) {
      this.hi = i;
      const h = this.hole;
      const a = Math.random() * Math.PI * 2, v = Math.random() * 5.5;
      this.wind = { x: Math.cos(a) * v, y: Math.sin(a) * v, v };
      for (const p of this.players) { p.ball = { ...h.tee }; p.prev = { ...h.tee }; p.lie = 'tee'; p.strokes = 0; p.holed = false; p.club = suggestClub(this._dist(h.tee), 'tee'); }
      this.cur = 0; this.state = 'address'; this.anim = null; this.lastShot = null;
      if (this.view) this.view.setHole(i);
      this.minimap.setHole(h);
      this._renderHole(); this._renderCard(); this._renderTurn();
    }

    info() {
      const p = this.current;
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
      const heading = this.aimOf(p.ball) + Math.max(-15, Math.min(15, +m.path || 0)) * Math.PI / 180;
      const res = simulate({ hole: this.hole, from: p.ball, heading, club, power: +m.power || 0, side: club.putter ? 0 : +m.side || 0, wind: club.putter ? null : this.wind, lie: p.lie });
      this.anim = { p, res, i: 0, club, from: { ...p.ball }, heading };
      this.lastShot = this.anim;
      this.swingAt = performance.now();
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
      this.resultT = 1.8;
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
        this.state = 'holeover'; this.resultT = 2.4;
        this._flash(`ON TO HOLE ${this.hi + 2}`, 'info');
        this._emit();
        return;
      }
      // farthest from the hole plays next (ties: player order)
      let best = null;
      for (const p of left) if (!best || this._dist(p.ball) > this._dist(best.ball) + 0.01) best = p;
      this.cur = this.players.indexOf(best);
      this.state = 'address';
      this._renderTurn(); this._emit();
    }

    _total(p) { return p.cards.reduce((a, b) => a + (b || 0), 0) + (p.cards[this.hi] === undefined ? p.strokes : 0); }
    _toPar(p) {
      let strokes = 0, par = 0;
      p.cards.forEach((s, i) => { if (s !== undefined) { strokes += s; par += HOLES[i].par; } });
      if (p.cards[this.hi] === undefined && p.holed && !this.over) { strokes += p.strokes; par += this.hole.par; }
      const d = strokes - par;
      return strokes === 0 || d === 0 ? 'E' : (d > 0 ? '+' + d : String(d));
    }

    // Where the flying ball is right now (world coords, z = height), or null.
    ballInFlight() {
      if (!this.anim) return null;
      const path = this.anim.res.path, i = Math.min(path.length - 1, this.anim.i);
      const a = path[Math.floor(i)], b = path[Math.min(path.length - 1, Math.floor(i) + 1)], f = i - Math.floor(i);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    }

    // ---------- loop ----------
    _tick(now) {
      requestAnimationFrame(t => this._tick(t));   // next frame first, so one bad frame can't stop the game
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      if (this.state === 'flight' && this.anim) {
        const a = this.anim;
        a.i += dt * 60 * FLIGHT_SPEED;   // path points are 60 per simulated second
        if (a.i >= a.res.path.length - 1) { a.i = a.res.path.length - 1; this._finishShot(); }
      } else if (this.state === 'result' || this.state === 'holeover') {
        this.resultT -= dt;
        if (this.resultT <= 0) {
          if (this.state === 'holeover') { this._setupHole(this.hi + 1); this._emit(); }
          else this._next();
        }
      }
      if (this.view) this.view.render(this, dt, now);
      this.minimap.draw(this, now);
      this._windArrow();
    }

    // ---------- HUD ----------
    _buildHud(hud) {
      hud.classList.add('hud');
      hud.innerHTML = `<div class="holeinfo"></div><div class="wind"><div class="arrow">➜</div><span></span></div>
        <div class="scores card-golf"></div><div class="turn"></div><div class="msg"><span></span></div>
        <canvas class="minimap" width="180" height="250"></canvas>`;
      this.el = { hole: hud.querySelector('.holeinfo'), wind: hud.querySelector('.wind'), card: hud.querySelector('.scores'), turn: hud.querySelector('.turn'), msg: hud.querySelector('.msg'), msgText: hud.querySelector('.msg span'), map: hud.querySelector('.minimap') };
    }
    _renderHole() {
      const h = this.hole;
      this.el.hole.innerHTML = `<b>HOLE ${this.hi + 1}</b> · PAR ${h.par} · ${Math.round(Math.hypot(h.pin.x - h.tee.x, h.pin.y - h.tee.y))} m<small>${esc(h.name)}</small>`;
    }
    _renderTurn() {
      const p = this.current;
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
    // Wind arrow relative to the way the camera faces: down the line towards the pin.
    _windArrow() {
      const p = this.current, w = this.wind;
      const facing = this.view && this.view.heading !== undefined ? this.view.heading : (p ? this.aimOf(p.ball) : Math.PI / 2);
      const rel = Math.atan2(w.y, w.x) - facing;
      const deg = Math.round(-90 - rel * 180 / Math.PI);
      if (deg !== this._windDeg) { this._windDeg = deg; this.el.wind.querySelector('.arrow').style.transform = `rotate(${deg}deg)`; }
      const txt = w.v < 0.5 ? 'calm' : `${w.v.toFixed(1)} m/s`;
      if (txt !== this._windTxt) { this._windTxt = txt; this.el.wind.querySelector('span').textContent = txt; }
    }
    _emit() {
      this._renderTurn();
      try { this.onUpdate(this.info()); } catch (e) { console.error(e); }
    }
  }

  // ---------------- 2D minimap (tee at the bottom, pin at the top) ----------------
  class GolfMap2D {
    constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); }
    setHole(h) {
      this.h = h;
      const W = this.c.width, H = this.c.height;
      this.ang = Math.atan2(h.pin.y - h.tee.y, h.pin.x - h.tee.x);
      const r = Math.PI / 2 - this.ang, cs = Math.cos(r), sn = Math.sin(r);
      const b = h.bounds, pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => [x * cs - y * sn, x * sn + y * cs]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      this.s = Math.min((W - 16) / (maxX - minX), (H - 16) / (maxY - minY));
      this.cx = (minX + maxX) / 2; this.cy = (minY + maxY) / 2; this.cs = cs; this.sn = sn;
      // static background
      this.bg = document.createElement('canvas'); this.bg.width = W; this.bg.height = H;
      const g = this.bg.getContext('2d');
      g.save(); this._xf(g);
      const px = 1 / this.s;
      g.fillStyle = '#3f7d34'; g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.fillStyle = '#5fae47';
      for (let i = 0; i < h.fairway.length; i++) {
        const a = h.fairway[i];
        g.beginPath(); g.arc(a.x, a.y, a.w / 2, 0, Math.PI * 2); g.fill();
        if (i < h.fairway.length - 1) {
          const n = h.fairway[i + 1], an = Math.atan2(n.y - a.y, n.x - a.x), nx = -Math.sin(an), ny = Math.cos(an);
          g.beginPath(); g.moveTo(a.x + nx * a.w / 2, a.y + ny * a.w / 2); g.lineTo(n.x + nx * n.w / 2, n.y + ny * n.w / 2); g.lineTo(n.x - nx * n.w / 2, n.y - ny * n.w / 2); g.lineTo(a.x - nx * a.w / 2, a.y - ny * a.w / 2); g.fill();
        }
      }
      const ell = (e, color) => { g.save(); g.translate(e.x, e.y); g.rotate(e.rot * Math.PI / 180); g.fillStyle = color; g.beginPath(); g.ellipse(0, 0, e.rx, e.ry, 0, 0, Math.PI * 2); g.fill(); g.restore(); };
      h.water.forEach(w => ell(w, '#3d9bd6'));
      h.bunkers.forEach(s => ell(s, '#ecdcae'));
      g.fillStyle = '#86dc6a'; g.beginPath(); g.arc(h.green.x, h.green.y, h.green.r + 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1f5a2a'; h.trees.forEach(t => { g.beginPath(); g.arc(t.x, t.y, t.r, 0, Math.PI * 2); g.fill(); });
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = px; g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.restore();
    }
    // world (x, y) -> map: rotate so tee->pin points up, centre the box, flip y for the screen
    _xf(g) {
      g.translate(this.c.width / 2, this.c.height / 2);
      g.scale(this.s, -this.s);
      g.translate(-this.cx, -this.cy);
      g.rotate(Math.PI / 2 - this.ang);
    }
    toMap(x, y) {
      const rx = x * this.cs - y * this.sn, ry = x * this.sn + y * this.cs;
      return { x: this.c.width / 2 + (rx - this.cx) * this.s, y: this.c.height / 2 - (ry - this.cy) * this.s };
    }
    draw(game, now) {
      if (!this.h || this.h !== game.hole) this.setHole(game.hole);
      const g = this.ctx, W = this.c.width, H = this.c.height;
      g.clearRect(0, 0, W, H);
      g.drawImage(this.bg, 0, 0);
      const pin = this.toMap(this.h.pin.x, this.h.pin.y);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(pin.x, pin.y); g.lineTo(pin.x, pin.y - 12); g.stroke();
      g.fillStyle = '#ff3d5a'; g.beginPath(); g.moveTo(pin.x, pin.y - 12); g.lineTo(pin.x + 7, pin.y - 9); g.lineTo(pin.x, pin.y - 6); g.fill();
      const shot = game.anim || (game.state === 'result' ? game.lastShot : null);
      if (shot) {
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.beginPath();
        const path = shot.res.path, n = Math.floor(shot.i);
        for (let i = 0; i <= n; i += 3) { const q = this.toMap(path[i].x, path[i].y); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }
        g.stroke();
      }
      game.players.forEach((p, i) => {
        if (p.holed) return;
        let b = p.ball;
        if (game.anim && game.anim.p === p) b = game.ballInFlight();
        const q = this.toMap(b.x, b.y);
        g.fillStyle = p.color; g.strokeStyle = '#000'; g.lineWidth = 1;
        g.beginPath(); g.arc(q.x, q.y, i === game.cur ? 4.5 : 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
      });
    }
  }

  root.GOLF.GolfGame = GolfGame;
  root.GOLF.GolfMap2D = GolfMap2D;
})(self);
