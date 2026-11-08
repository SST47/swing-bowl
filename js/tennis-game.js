/* Swing Tennis — match flow, players (phones or the computer), swing judging and the HUD. A view draws it. */
(function (root) {
  'use strict';
  const T = root.TENNIS;
  const { COURT, HZ, WINDOW, fly, hitPoint, stroke, serve, tossAt, tossContactT, serviceBox, inBox, inCourt, Score } = T;
  const COLORS = ['#3fa9f5', '#ff5a5f', '#ffd23f', '#3ddc97', '#c77dff', '#ff9f1c'];
  const CPU = { name: 'CPU', color: '#c9d1e0' };
  const TO_GAMES = 2;
  const GRACE = 0.45;          // s after the ideal moment that a swing message may still arrive
  const BIAS_MAX = 0.25;
  const SPEED = 6.8, ACCEL = 20; // how fast players get to the ball (m/s, m/s²)
  const REACT = 0.2;            // s before a player starts running for the other player's shot
  const REACH = 1.25;           // m: further than this from the ball's line and it gets past you
  const CPU_SD = 0.09;          // the computer's timing spread (s)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => performance.now() / 1000;
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  class TennisGame {
    /* opts: { hud, sfx, onUpdate, view } — view: { render(game, dt, nowSeconds) } */
    constructor({ hud, sfx, onUpdate, view }) {
      this.view = view || null; this.sfx = sfx; this.onUpdate = onUpdate || (() => {});
      this.players = [];        // everyone in the room: { name, color, wins, bias }
      this.court = [null, null];// player index at the near (0) and far (1) end; null = the computer
      this.ends = [this._end(-1), this._end(1)];
      this.score = new Score(TO_GAMES);
      this.state = 'idle'; this.timer = 0; this.over = false; this.started = false;
      this.ball = null;         // { flight, t0, hitter (end), kind: 'serve'|'shot', next: event index }
      this.toss = null;         // { hand, t0, contactT }
      this.expect = null;       // who must hit next: { end, T (ideal moment, s), p, forehand, early }
      this.faults = 0;          // faults on this point
      this.cpuSwing = null;     // { end, at, power }
      this.armed = false;
      this.lastShot = null;     // { speed km/h, kind }
      this.note = [null, null]; // per end: { text, at } for the phones
      this._buildHud(hud);
      this.last = performance.now(); this.movedTo = now();
      requestAnimationFrame(x => this._tick(x));
    }

    _end(side) { return { side, pos: { x: 0, z: side * (COURT.L + 0.8) }, vel: { x: 0, z: 0 }, goal: { x: 0, z: side * (COURT.L + 0.8) }, next: null, hist: [], swingAt: -10, swingKind: 'fh', tossAt: -10, mood: null, moodAt: 0 }; }
    // where the player at `end` was at time t (a swing message arrives a little after the swing)
    _posAt(end, t) { const h = this.ends[end].hist; for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i]; return h[0] || this.ends[end].pos; }
    who(end) { const i = this.court[end]; return i === null || i === undefined ? CPU : this.players[i]; }
    isCpu(end) { return this.court[end] === null || this.court[end] === undefined; }
    endOf(idx) { return this.court[0] === idx ? 0 : this.court[1] === idx ? 1 : -1; }
    get server() { return this.score.server; }   // end index (0 near, 1 far)

    // ---------- players ----------
    canJoinNow() { return this.players.length < 6; }
    addPlayer(name) {
      if (this.players.length >= 6) return -1;
      const i = this.players.length;
      this.players.push({ name: name || 'Player ' + (i + 1), color: COLORS[i % COLORS.length], wins: 0, bias: 0 });
      // a second player takes over from the computer straight away, with a fresh match
      if (this.court[0] === null && !this.isPlaying()) this.newGame();
      else if (this.court[1] === null && this.court[0] !== null && i !== this.court[0]) { this.court[1] = i; this._flash(`${this._nm(0)} VS ${this._nm(1)}`, 'info'); this._newMatch(); }
      this._renderBoard(); this._emit();
      return i;
    }
    renamePlayer(i, n) { if (this.players[i] && n) { this.players[i].name = String(n).slice(0, 14); this._renderBoard(); this._emit(); } }
    removePlayer(i) {
      if (!this.players[i]) return;
      this.players.splice(i, 1);
      const fix = c => (c === null ? null : c === i ? undefined : c > i ? c - 1 : c);
      this.court = this.court.map(fix);
      if (this.court.includes(undefined)) {
        // someone on court left: the next in line steps in, or the computer
        const free = this.players.map((_, k) => k).filter(k => !this.court.includes(k));
        this.court = this.court.map(c => (c === undefined ? (free.length ? free.shift() : null) : c));
        if (this.court[0] === null && this.court[1] !== null) this.court = [this.court[1], null];
        if (this.players.length) this._newMatch(); else { this.court = [null, null]; this.state = 'idle'; }
      }
      this._renderBoard(); this._emit();
    }
    isPlaying() { return this.state !== 'idle'; }

    newGame() {
      // who plays: the first two in the room (or the first one against the computer)
      this.court = [this.players.length ? 0 : null, this.players.length > 1 ? 1 : null];
      this.over = false; this.started = false;
      this._newMatch();
    }
    _newMatch() {
      this.score = new Score(TO_GAMES); this.faults = 0;
      this.over = false;
      if (this.court[0] === null) { this.state = 'idle'; this._renderBoard(); return; }
      this._flash(`${this._nm(0).toUpperCase()} VS ${this._nm(1).toUpperCase()}`, 'info');
      this._startPoint(2.2);
      this._renderBoard(); this._emit();
    }
    _nm(end) { return this.who(end).name; }

    info() {
      const s = this.score;
      return {
        state: this.state, over: this.over, started: this.started,
        players: this.players.map(q => ({ name: q.name, color: q.color, wins: q.wins })),
        court: this.court.slice(), server: s.server, games: s.games.slice(), points: [s.label(0), s.label(1)],
        cur: this.expect ? this.court[this.expect.end] : (this.state === 'serve' || this.state === 'toss') ? this.court[s.server] : null,
        hitting: this.expect ? this.expect.end : null, winner: s.winner,
      };
    }

    // ---------- input ----------
    input(idx, m) {
      const end = this.endOf(idx);
      if (end < 0) return false;
      if (m.t === 'arm') { if (end === this.server && this.state === 'serve') this.armed = true; return true; }
      if (m.t === 'swing') {
        const at = m.at ? m.at / 1000 : now() - 0.06;
        this._swing(end, at, Math.max(0, Math.min(1, +m.power || 0)), false);
        return true;
      }
      return false;
    }

    _lag(end) { const p = this.players[this.court[end]]; return p ? Math.max(-BIAS_MAX, Math.min(BIAS_MAX, p.bias)) : 0; }
    _learn(end, raw) { const p = this.players[this.court[end]]; if (p && Math.abs(raw - this._lag(end)) < 0.45) p.bias = p.bias * 0.7 + raw * 0.3; }
    _note(end, text) { this.note[end] = { text, at: Date.now() }; }

    // a swing from the player at `end`, peaking at `at` (s, this clock)
    _swing(end, at, power, cpu) {
      const E = this.ends[end], tNow = now();
      if (this.sfx && !cpu) this.sfx.unlock();
      // the serve
      if (this.state === 'toss' && end === this.server) {
        const raw = at - (this.toss.t0 + this.toss.contactT), dt = raw - (cpu ? 0 : this._lag(end));
        if (dt < -WINDOW) { E.swingAt = Math.min(tNow, at); E.swingKind = 'serve'; this._note(end, 'Too early: let the ball come down'); return; }
        E.swingAt = Math.max(tNow - 0.25, Math.min(tNow, at)); E.swingKind = 'serve';
        if (!cpu) this._learn(end, raw);
        const from = tossAt(this.toss.hand, Math.max(0, at - this.toss.t0));
        const second = this.faults === 1;
        if (cpu) power = second ? 0.45 + Math.random() * 0.35 : 0.6 + Math.random() * 0.38;
        const sv = serve({ dt, power, from, side: E.side, deuce: this.score.deuceSide, second });
        if (!sv) { this._note(end, dt > 0 ? 'Too late: hit it as it falls' : 'Too early'); return; }   // a whiff: the toss just drops
        this.toss = null; this.started = true;
        this._launch(end, from, sv, at, 'serve');
        if (!cpu) this._note(end, this._timingText(dt));
        return;
      }
      // a rally shot
      const X = this.expect;
      if (this.state !== 'rally' || !X || X.end !== end || X.done) return;
      const raw = at - X.T, dt = raw - (cpu ? 0 : this._lag(end));
      if (dt < -WINDOW) { if (!X.early) X.early = { at }; E.swingAt = Math.max(tNow - 0.25, Math.min(tNow, at)); E.swingKind = X.forehand ? 'fh' : 'bh'; return; }   // way early: a better one may follow
      E.swingAt = Math.max(tNow - 0.25, Math.min(tNow, at)); E.swingKind = X.forehand ? 'fh' : 'bh';
      if (!cpu) this._learn(end, raw);
      if (dt > WINDOW) { X.done = true; if (!cpu) this._note(end, `Missed: late by ${Math.round(dt * 1000)} ms`); return; }
      // too far away to get a racket on it (a wide, fast ball): a clean winner
      this._moveTo(tNow);   // players are moved up to this moment (a message can land between frames)
      const P = this._posAt(end, at), far = Math.hypot(P.x - E.goal.x, P.z - E.goal.z);
      if (far > REACH) { X.done = true; if (!cpu) this._note(end, 'Couldn’t reach that one'); return; }
      // a stretch or a fast ball makes it harder to play well
      const inKmh = this.lastShot ? this.lastShot.kmh : 80;
      const pressure = clamp(0.8 * Math.max(0, far - 0.4) / (REACH - 0.4) + 0.45 * clamp((inKmh - 95) / 70, 0, 1), 0, 1);
      const from = this._ballAt(at) || X.p, opp = this.ends[1 - end];
      if (cpu) power = this._cpuPower(pressure, inKmh, X.p);
      const sh = stroke({ dt, power, from, side: E.side, forehand: X.forehand, pressure,
        aimX: cpu ? this._cpuAim(end, pressure) : null, lean: clamp(-opp.pos.x * 1.5, -2.2, 2.2) });   // good timing finds the open court
      X.done = true;
      this.started = true;
      this._launch(end, from, sh, at, 'shot');
      if (!cpu) this._note(end, this._timingText(dt));
    }
    // the computer: how hard to hit it, and where (away from the other player)
    _cpuPower(pressure, inKmh, p) {
      if (pressure > 0.55) return 0.3 + Math.random() * 0.25;                   // stretched: just get it back
      if (Math.abs(p.z) < COURT.L - 1.6 || inKmh < 70) return 0.82 + Math.random() * 0.13;   // a short or slow ball: go after it
      return 0.5 + Math.random() * 0.32;
    }
    // the computer eases off a little when it is games ahead, and tightens up when behind
    _cpuSd(end) { const g = this.score.games; return clamp(CPU_SD + 0.03 * (g[end] - g[1 - end]), 0.07, 0.15); }
    _cpuAim(end, pressure) {
      if (pressure > 0.6) return (Math.random() - 0.5) * 2;                     // under pressure: anywhere in
      if (Math.random() < 0.35) return (Math.random() - 0.5) * 1.6;             // a neutral ball
      const ox = this.ends[1 - end].goal.x, away = ox > 0.3 ? -1 : ox < -0.3 ? 1 : Math.random() < 0.5 ? -1 : 1;
      return away * (1.9 + Math.random() * 1.1);
    }
    _timingText(dt) { const ms = Math.round(dt * 1000); return Math.abs(ms) < 40 ? 'Perfect timing!' : ms < 0 ? `Early by ${-ms} ms` : `Late by ${ms} ms`; }

    // the ball leaves `end`'s racket at time `at`
    _launch(end, from, sh, at, kind) {
      const flight = fly(from, sh.v, sh.spin);
      this.ball = { flight, t0: at, hitter: end, kind, next: 0 };
      this.lastShot = { kmh: Math.round(Math.hypot(sh.v.x, sh.v.y, sh.v.z) * 3.6), kind };
      this.state = 'rally';
      this.cpuSwing = null;
      if (this.sfx) this.sfx.pock(0.6 + 0.4 * (sh.quality || 0.5));
      // the other end now has to get there and hit it
      const to = 1 - end, side = this.ends[to].side;
      const hp = kind === 'serve' ? (this._serveIn(flight) ? hitPoint(flight, side) : null) : hitPoint(flight, side);
      this.expect = null;
      if (hp) {
        const right = side === -1 ? 1 : -1, P = this.ends[to].pos;
        const fhX = hp.p.x - 0.75 * right, bhX = hp.p.x + 0.75 * right;
        const forehand = Math.abs(fhX - P.x) <= Math.abs(bhX - P.x) + 0.6;   // forehands are preferred
        this.expect = { end: to, T: at + hp.t, p: hp.p, forehand, i: hp.i };
        this.ends[to].next = { goal: { x: forehand ? fhX : bhX, z: hp.p.z + side * 0.45 }, at: at + REACT };
        if (this.isCpu(to)) this.cpuSwing = { end: to, at: this.expect.T + gauss() * this._cpuSd(to), power: 0.6 };
      }
      // the hitter heads back to the middle of their baseline
      const H = this.ends[end];
      H.goal = { x: Math.max(-1.5, Math.min(1.5, (hp ? hp.p.x : 0) * 0.35)), z: H.side * (COURT.L + 0.7) };
      this._renderTop(); this._emit();
    }

    _serveIn(flight) {
      const b = flight.events.find(e => e.type === 'bounce');
      return !!b && inBox(b.x, b.z, serviceBox(this.ends[this.server].side, this.score.deuceSide));
    }

    // the ball's position at time t (on the current flight)
    _ballAt(t) {
      const B = this.ball; if (!B) return null;
      const i = Math.max(0, Math.min(B.flight.pts.length - 1, Math.round((t - B.t0) * HZ)));
      return B.flight.pts[i];
    }
    ballNow(t = now()) {
      if (this.toss) { const dt = t - this.toss.t0; return dt >= 0 ? tossAt(this.toss.hand, dt) : this.toss.hand; }
      return this._ballAt(t);
    }

    // ---------- points ----------
    _startPoint(delay) {
      const s = this.score, srv = s.server, deuce = s.deuceSide;
      this.state = 'serve'; this.timer = delay; this.idle = 0; this.armed = false;
      this.ball = null; this.toss = null; this.expect = null; this.cpuSwing = null;
      const S = this.ends[srv], R = this.ends[1 - srv], box = serviceBox(S.side, deuce);
      const sx = (box.x0 + box.x1 > 0 ? -1 : 1) * 0.75;   // stand on the half opposite the target box
      S.goal = { x: sx, z: S.side * (COURT.L + 0.25) };
      // the returner covers both the T and the wide serve (a second serve comes in slower and shorter)
      R.goal = { x: (box.x0 + box.x1) / 2 * (this.faults ? 1.2 : 1.45), z: R.side * (COURT.L + (this.faults ? 0.4 : 0.9)) };
      for (const E of this.ends) { E.mood = null; E.next = null; }
      this._renderTop(); this._emit();
    }

    _pointTo(end, text, kind) {
      const res = this.score.point(end);
      this.faults = 0;   // the next point starts with a first serve
      this.state = 'point'; this.timer = res === 'match' ? 6 : 2.4;
      this.expect = null; this.cpuSwing = null; this.toss = null;
      const W = this.ends[end], L = this.ends[1 - end], t = now();
      W.mood = res === 'point' ? 'yes' : 'win'; W.moodAt = t; L.mood = res === 'point' ? null : 'lose'; L.moodAt = t;
      let msg = text;
      if (res === 'game') msg = `GAME · ${this._nm(end).toUpperCase()}`;
      if (res === 'match') {
        msg = `${this._nm(end).toUpperCase()} WINS!`;
        this.over = true;
        const p = this.players[this.court[end]]; if (p) p.wins++;
        if (this.sfx) this.sfx.fanfare('strike');
      } else {
        const c = this.score.call();
        if (res === 'point') msg += ` · ${c.text === 'Advantage' ? 'AD ' + this._nm(c.to).toUpperCase() : c.text.toUpperCase()}`;
        if (this.sfx) this.sfx.crowd(res === 'game' ? 1 : 0.6);
      }
      this.lastPoint = { end, at: t, res };
      this._flash(msg, res === 'point' ? 'info' : 'strike');
      this._renderBoard(); this._renderTop(); this._emit();
    }

    _afterPoint() {
      if (!this.over) { this._startPoint(1.0); return; }
      // match over: winner stays on if others are waiting; the loser goes to the back of the line
      const s = this.score, win = this.court[s.winner], lose = this.court[1 - s.winner];
      const waiting = this.players.map((_, k) => k).filter(k => !this.court.includes(k));
      if (waiting.length && win !== null) this.court = [win, waiting[0]];
      else if (win === null) this.court = [lose, null];
      this._newMatch();
    }

    // events on the ball's path as time catches up with them
    _events(t) {
      const B = this.ball; if (!B) return;
      const ev = B.flight.events, X = this.expect;
      while (B.next < ev.length && ev[B.next].i / HZ <= t - B.t0) {
        const e = ev[B.next++];
        const hitter = B.hitter, other = 1 - hitter, side = this.ends[other].side;
        if (e.type === 'net') { if (this.sfx) this.sfx.net(); continue; }
        if (this.sfx) this.sfx.bounce();
        const bounces = ev.filter((q, k) => k < B.next && q.type === 'bounce');
        if (bounces.length === 1) {
          // first bounce decides serves and outs
          if (B.kind === 'serve') {
            const box = serviceBox(this.ends[hitter].side, this.score.deuceSide), inb = inBox(e.x, e.z, box);
            const netted = ev.some(q => q.type === 'net' && q.i < e.i);
            if (inb && netted && ev.find(q => q.type === 'net').cord) { this._let(); return; }
            if (!inb || e.side !== side) { this._fault(netted ? 'NET' : 'FAULT'); return; }
            continue;
          }
          if (e.side !== side) { this._pointTo(other, 'NET'); return; }
          if (!inCourt(e.x, e.z, side)) { this._pointTo(other, 'OUT'); return; }
          continue;
        }
        // a second bounce on the receiver's side: they didn't get it back (unless a swing is still on its way)
        if (e.side === side) {
          if (X && !X.done && t < X.T + GRACE) { B.next--; return; }   // wait a moment for a late message
          const ace = B.kind === 'serve';
          this._pointTo(hitter, ace ? 'ACE!' : 'WINNER!');
          return;
        }
      }
    }

    _fault(what) {
      this.faults++;
      if (this.faults >= 2) { this.faults = 0; this._pointTo(1 - this.server, 'DOUBLE FAULT'); return; }
      this._flash(what === 'NET' ? 'NET · SECOND SERVE' : 'FAULT · SECOND SERVE', 'info');
      if (this.sfx) this.sfx.sad();
      this._startPoint(1.4);
    }
    _let() { this._flash('LET · SERVE AGAIN', 'info'); this._startPoint(1.4); }

    // ---------- loop ----------
    _tick(ms) {
      requestAnimationFrame(x => this._tick(x));   // next frame first, so one bad frame can't stop the game
      // (the first frame can be stamped a hair early; a long gap, like a hidden tab, is capped)
      const dt = Math.max(0, Math.min(1.5, (ms - this.last) / 1000)); this.last = ms;
      const t = now();
      if (this.state === 'serve') {
        this.timer -= dt; this.idle += dt;
        if (this.timer <= 0 && (this.armed || this.idle > (this.isCpu(this.server) ? 1.4 : 2.4))) {
          // toss it up
          const S = this.ends[this.server], right = S.side === -1 ? 1 : -1;
          const hand = { x: S.pos.x + 0.28 * right, y: T.TOSS.from, z: S.pos.z - S.side * 0.25 };
          this.toss = { hand, t0: t, contactT: tossContactT(hand) };
          S.tossAt = t;
          this.state = 'toss';
          if (this.isCpu(this.server)) this.cpuSwing = { end: this.server, at: t + this.toss.contactT + gauss() * 0.06, power: 0.7 };
          this._renderTop(); this._emit();
        }
      } else if (this.state === 'toss') {
        // nobody hit it: catch it and toss again (no fault)
        if (t - this.toss.t0 > this.toss.contactT + WINDOW + 0.35) { this.toss = null; this.state = 'serve'; this.timer = 0.6; this.idle = 9; this.cpuSwing = null; this._renderTop(); }
      } else if (this.state === 'rally') {
        this._events(t);
        // an early swing that wasn't followed by a better one: it was a miss
        const X = this.expect;
        if (X && !X.done && X.early && t > X.T + 0.2) { X.done = true; if (!this.isCpu(X.end)) this._note(X.end, `Missed: early by ${Math.round((X.T - X.early.at) * 1000)} ms`); }
        // the ball flew off without a second bounce (a winner that left the court, or a ball nobody reached)
        if (this.state === 'rally' && this.ball && (t - this.ball.t0) * HZ > this.ball.flight.pts.length + HZ * 0.2) {
          const b = this.ball, ev = b.flight.events.filter(e => e.type === 'bounce');
          if (!ev.length) this._pointTo(1 - b.hitter, 'OUT'); else this._pointTo(b.hitter, b.kind === 'serve' ? 'ACE!' : 'WINNER!');
        }
      } else if (this.state === 'point') {
        this.timer -= dt;
        if (this.timer <= 0) this._afterPoint();
      }
      if (this.cpuSwing && t >= this.cpuSwing.at) { const c = this.cpuSwing; this.cpuSwing = null; this._swing(c.end, c.at, c.power, true); }
      this._moveTo(t);
      if (this.view) this.view.render(this, dt, t);
    }

    // Players run on their own, in small steps of real time, so a slow frame rate doesn't leave
    // them behind a ball that flies in real time.
    _moveTo(t) { const dt = Math.max(0, Math.min(1.5, t - this.movedTo)); this.movedTo = Math.max(this.movedTo, t); this._move(dt, t); }
    _move(dt, t) {
      if (!(dt > 0)) return;
      const n = Math.ceil(dt * 120), h = dt / n;
      for (let k = 1; k <= n; k++) {
        const tk = t - dt + k * h;
        for (const E of this.ends) {
          if (E.next && tk >= E.next.at) { E.goal = E.next.goal; E.next = null; }
          const dx = E.goal.x - E.pos.x, dz = E.goal.z - E.pos.z, d = Math.hypot(dx, dz);
          // speed we'd like: enough to arrive, easing in at the end
          const want = Math.min(SPEED, d * 4);
          const tx = d > 1e-3 ? dx / d * want : 0, tz = d > 1e-3 ? dz / d * want : 0;
          const ax = tx - E.vel.x, az = tz - E.vel.z, a = Math.hypot(ax, az), f = a > ACCEL * h ? ACCEL * h / a : 1;
          E.vel.x += ax * f; E.vel.z += az * f;
          E.pos.x += E.vel.x * h; E.pos.z += E.vel.z * h;
          if (k === n || k % 4 === 0) E.hist.push({ t: tk, x: E.pos.x, z: E.pos.z });
        }
      }
      for (const E of this.ends) while (E.hist.length > 2 && E.hist[0].t < t - 1.5) E.hist.shift();
    }

    // ---------- HUD ----------
    _buildHud(hud) {
      hud.classList.add('hud');
      hud.innerHTML = `<div class="holeinfo tscore"></div><div class="wind tinfo"><span></span></div>
        <div class="scores card-golf board"></div><div class="turn"></div><div class="msg"><span></span></div>`;
      this.el = { score: hud.querySelector('.tscore'), info: hud.querySelector('.tinfo span'), board: hud.querySelector('.board'), turn: hud.querySelector('.turn'), msg: hud.querySelector('.msg'), msgText: hud.querySelector('.msg span') };
      this._renderTop();
    }
    _renderTop() {
      const s = this.score;
      if (this.state === 'idle') { this.el.score.innerHTML = '<b>SWING TENNIS</b><small>Waiting for players</small>'; }
      else {
        const row = end => { const w = this.who(end); return `<tr><td class="srv">${s.server === end && !this.over ? '●' : ''}</td><td class="nm"><i style="background:${w.color}"></i>${esc(w.name)}</td><td class="g">${s.games[end]}</td><td class="p">${this.over ? '' : s.label(end)}</td></tr>`; };
        this.el.score.innerHTML = `<table class="tennis">${row(0)}${row(1)}</table><small>First to ${TO_GAMES} games</small>`;
      }
      const ls = this.lastShot;
      this.el.info.innerHTML = ls ? `${ls.kind === 'serve' ? 'Serve' : 'Shot'}<br><b>${ls.kmh} km/h</b>` : 'Tennis';
      let turn = '';
      if (this.state === 'serve' || this.state === 'toss') turn = this.isCpu(this.server) ? 'CPU to serve' : `${esc(this._nm(this.server))} to serve · swing as the ball comes down`;
      else if (this.state === 'rally' && this.expect && !this.isCpu(this.expect.end)) turn = `${esc(this._nm(this.expect.end))}: swing when the ring closes`;
      else if (this.state === 'idle') turn = 'Join on your phone to play';
      this.el.turn.innerHTML = turn;
    }
    _renderBoard() {
      if (this.players.length < 3) { this.el.board.innerHTML = ''; return; }
      let h = '<table><thead><tr><th></th><th>Wins</th><th></th></tr></thead><tbody>';
      this.players.forEach((p, i) => { const e = this.court.indexOf(i); h += `<tr class="${e >= 0 ? 'active' : ''}"><td class="name"><i style="background:${p.color}"></i>${esc(p.name)}</td><td class="total">${p.wins}</td><td>${e >= 0 ? 'on court' : 'next up'}</td></tr>`; });
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

  T.TennisGame = TennisGame;
  T.TO_GAMES = TO_GAMES;
})(self);
