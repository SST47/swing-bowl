/* Swing Bowl — game loop: ties the engine, renderer, sound and HUD together. */
(function (root) {
  'use strict';
  const { C, Lane, Match, Renderer, scoreCard, clamp } = root.SB;

  const COLORS = ['#3fa9f5', '#ff5a5f', '#ffd23f', '#3ddc97', '#c77dff', '#ff9f1c'];
  const MAX_PLAYERS = 6;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  class GameApp {
    constructor({ canvas, hud, sfx, onUpdate }) {
      this.lane = new Lane();
      this.match = new Match();
      this.renderer = new Renderer(canvas);
      this.sfx = sfx || null;
      this.onUpdate = onUpdate || (() => {});
      this.state = 'aim';
      this.resultTimer = 0;
      this.pending = null;
      this.holding = null;
      this._buildHud(hud);
      this.last = performance.now();
      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);
    }

    // ---------- players ----------
    get full() { return this.match.players.length >= MAX_PLAYERS; }
    canJoinNow() { return !this.match.started && !this.full; }

    addPlayer(name) {
      if (this.full) return -1;
      const i = this.match.players.length;
      this.match.addPlayer(name || 'Player ' + (i + 1), COLORS[i % COLORS.length]);
      this._renderScores();
      this._emit();
      return i;
    }

    renamePlayer(i, name) {
      const p = this.match.players[i];
      if (!p || !name) return;
      p.name = String(name).slice(0, 14);
      this._renderScores();
      this._emit();
    }

    newGame() {
      this.match.reset();
      this.lane.resetPins();
      this.lane.ball = null;
      this.state = 'aim';
      this.renderer.snapCamera();
      this._renderScores();
      this._renderPins();
      this._flash('NEW GAME', 'info');
      this._emit();
    }

    info() {
      const m = this.match;
      return {
        state: this.state, over: m.over, cur: m.cur, frame: m.frame + 1,
        ball: m.players.length ? m.ballInFrame() + 1 : 1, started: m.started,
        players: m.players.map(p => ({ name: p.name, color: p.color, total: scoreCard(p.frames).total })),
      };
    }

    // ---------- input from any controller (phone, keyboard, solo) ----------
    input(idx, msg) {
      const m = this.match;
      if (!m.players.length) return false;
      const p = m.players[idx];
      if (!p) return false;
      const myTurn = idx === m.cur && this.state === 'aim' && !m.over;
      switch (msg.t) {
        case 'move':
          if (!myTurn) return false;
          p.startX = clamp(p.startX + (msg.d > 0 ? 1 : -1) * 0.035, -C.MAX_START_X, C.MAX_START_X);
          return true;
        case 'hold':
          this.holding = msg.on && myTurn ? idx : null;
          this._renderTurn();
          return true;
        case 'throw':
          if (!myTurn) return false;
          this.holding = null;
          const steer = clamp(+msg.steer || 0, -0.09, 0.09);
          this.lane.throwBall({ x: p.startX, aim: steer, speed: msg.speed, spin: msg.spin || 0 });   // direction comes only from the swing
          this.state = 'rolling';
          this.lastThrow = { speed: msg.speed, spin: msg.spin || 0 };
          this._renderTurn();
          this._emit();
          return true;
        case 'newgame':
          if (m.over || !m.started) { this.newGame(); return true; }
          return false;
      }
      return false;
    }

    // ---------- loop ----------
    _tick(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;

      if (this.state === 'rolling') {
        this.lane.update(dt);
        for (const e of this.lane.drainEvents()) this._onEvent(e);
        const b = this.lane.ball;
        if (this.sfx) this.sfx.roll(b && !b.done && b.z < C.BALL_END_Z ? Math.hypot(b.vx, b.vz) / 9 * (b.gutter ? 0.6 : 1) : 0);
      } else if (this.sfx) this.sfx.roll(0);

      if (this.state === 'result') {
        this.lane.update(dt);
        this.lane.drainEvents();
        this.resultTimer -= dt;
        if (this.resultTimer <= 0) this._afterResult();
      }

      this.renderer.follow(this.lane.ball, this.state, dt);
      const p = this.match.current();
      const aiming = this.state === 'aim' && p && !this.match.over;
      this.renderer.drawScene(this.lane, {
        ball: this.lane.ball || (aiming ? { x: p.startX, z: -0.25, dist: 0 } : null),
        ballColor: p ? p.color : COLORS[0],
        aim: aiming ? { x: p.startX, aim: 0, color: p.color + '88' } : null,   // straight-line guide from the start position
      });
      if (this.state === 'rolling') this._renderPins();
      requestAnimationFrame(this._tick);
    }

    _onEvent(e) {
      const s = this.sfx;
      if (e.type === 'hit' && s) s.hit(e.strength);
      else if (e.type === 'clack' && s) s.clack(e.strength);
      else if (e.type === 'pit' && s) s.thud();
      else if (e.type === 'settled') {
        const r = this.match.record(e.knocked, e.gutter);
        this.pending = r;
        this.state = 'result';
        this.resultTimer = r.kind === 'strike' ? 2.4 : 1.8;
        this._flash(r.message, r.kind);
        if (s) { if (r.kind === 'strike' || r.kind === 'spare') s.fanfare(r.kind); else if (e.gutter) s.sad(); }
        this._renderScores();
        this._renderPins();
        this._emit();
      }
    }

    _afterResult() {
      const r = this.pending;
      if (r && r.resetPins) this.lane.resetPins(); else this.lane.sweep();
      this.lane.ball = null;
      this.pending = null;
      if (this.match.over) {
        this.state = 'over';
        const ps = this.match.players.map(p => ({ p, t: scoreCard(p.frames).total }));
        ps.sort((a, b) => b.t - a.t);
        const msg = ps.length > 1 ? `${ps[0].p.name} WINS · ${ps[0].t}` : `FINAL SCORE · ${ps[0].t}`;
        this._flash(msg, 'over', true);
      } else {
        this.state = 'aim';
      }
      this._renderPins();
      this._renderTurn();
      this._emit();
    }

    _emit() { this._renderTurn(); try { this.onUpdate(this.info()); } catch (e) { console.error(e); } }

    // ---------- HUD ----------
    _buildHud(hud) {
      this.hud = hud;
      hud.classList.add('hud');
      hud.innerHTML = `
        <div class="scores"></div>
        <div class="turn"></div>
        <div class="msg"><span></span></div>
        <div class="pindicator"></div>`;
      this.el = {
        scores: hud.querySelector('.scores'), turn: hud.querySelector('.turn'),
        msg: hud.querySelector('.msg'), msgText: hud.querySelector('.msg span'), pins: hud.querySelector('.pindicator'),
      };
      this._renderScores();
      this._renderPins();
    }

    _flash(text, kind, sticky) {
      const el = this.el.msg;
      this.el.msgText.textContent = text;
      el.className = 'msg ' + (kind || '');
      void el.offsetWidth; // restart the CSS animation
      el.classList.add(sticky ? 'sticky' : 'show');
    }

    _renderTurn() {
      const m = this.match, p = m.current();
      if (!p) { this.el.turn.innerHTML = ''; return; }
      if (m.over) { this.el.turn.innerHTML = this.state === 'over' ? 'Game over' : ''; return; }
      let t = `<b style="color:${p.color}">${esc(p.name)}</b> · Frame ${m.frame + 1} · Ball ${m.ballInFrame() + 1}`;
      if (this.holding !== null && this.state === 'aim') t += ' · <span class="swinging">swinging…</span>';
      this.el.turn.innerHTML = t;
    }

    _renderScores() {
      const m = this.match;
      if (!m.players.length) { this.el.scores.innerHTML = ''; return; }
      let h = '<table><thead><tr><th></th>';
      for (let f = 1; f <= 10; f++) h += `<th>${f}</th>`;
      h += '<th>Total</th></tr></thead><tbody>';
      m.players.forEach((p, i) => {
        const card = scoreCard(p.frames);
        const active = i === m.cur && !m.over;
        h += `<tr class="${active ? 'active' : ''}"><td class="name"><i style="background:${p.color}"></i>${esc(p.name)}</td>`;
        card.frames.forEach((f, fi) => {
          const cur = active && fi === m.frame ? ' cur' : '';
          h += `<td class="frame${fi === 9 ? ' tenth' : ''}${cur}"><div class="marks">${f.marks.map(x => `<span>${x}</span>`).join('')}</div><div class="ft">${f.total ?? ''}</div></td>`;
        });
        h += `<td class="total">${card.total}</td></tr>`;
      });
      this.el.scores.innerHTML = h + '</tbody></table>';
    }

    _renderPins() {
      const standing = new Set(this.lane.pins.filter(p => !p.fallen && !p.gone).map(p => p.n));
      const key = [...standing].sort((a, b) => a - b).join(',');
      if (key === this._pinKey) return;
      this._pinKey = key;
      // from the bowler's view: back row on top
      const rows = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
      let svg = '<svg viewBox="0 0 80 72">';
      rows.forEach((row, r) => row.forEach((n, i) => {
        const x = 40 + (i - (row.length - 1) / 2) * 18, y = 10 + r * 17;
        svg += `<circle cx="${x}" cy="${y}" r="7" class="${standing.has(n) ? 'up' : 'down'}"/>`;
      }));
      this.el.pins.innerHTML = svg + '</svg>';
    }
  }

  root.SB = Object.assign(root.SB || {}, { GameApp, COLORS });
})(self);
