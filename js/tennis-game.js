/* Swing Tennis — match flow, players (phones or the computer), swing judging and the HUD. A view draws it.
 * Two ways to play: head to head (people face each other; on your own you play the computer), or as a team
 * (two people side by side, doubles, against a computer pair). Head to head, the camera changes ends every
 * game so each player gets the view from behind themselves. */
(function (root) {
  'use strict';
  const T = root.TENNIS;
  const { COURT, HZ, WINDOW, fly, hitPoint, stroke, serve, tossAt, tossContactT, serviceBox, inBox, inCourt, Score } = T;
  const COLORS = ['#3fa9f5', '#ff5a5f', '#ffd23f', '#3ddc97', '#c77dff', '#ff9f1c'];
  const CPU = { name: 'CPU', color: '#c9d1e0' };
  const MODES = { h2h: 'Head to head', team: 'Team vs CPU' };
  const TO_GAMES = 2;
  const GRACE = 0.45;          // s after the ideal moment that a swing message may still arrive
  const BIAS_MAX = 0.25;
  const SPEED = 6.8, ACCEL = 20; // how fast players get to the ball (m/s, m/s²)
  const JOG = 3.4;              // ...and how fast they wander into place between points
  const SWING_LEAD = 0.04;      // a phone's swing is drawn reaching contact this long after it arrives (it lands a little late)
  const REACT = 0.2;            // s before a player starts running for the other side's shot
  const REACT_SERVE = 0.1;      // ...and for a serve (the returner is ready for it)
  const REACH = 1.25;           // m: further than this from the ball's line and it gets past you
  const REACH_RETURN = 2.2;     // ...but a serve that lands in can always be got to (returning is hard enough)
  const SERVE_EASE = 0.68;      // serves to a person are this much slower than serves to the computer
  const RETURN_SLACK = 0.6;     // ...and timing on the return is judged this much more kindly
  const REACH_TILT = 1.6;       // ...a little more for someone steering by tilting their phone
  const TILT_HELP = 2.5;        // m/s: in the last moment before your ball, a tilt-steered player drifts into range
  const ACCEL_TILT = 34;        // m/s²: someone steering turns round quicker (so it feels like it follows the phone)
  const CPU_SD = 0.09;          // the computer's timing spread (s)
  const HALF = 2.6;             // doubles: where each partner stands across their half of the court
  const SEAM_PAUSE = 0.22;      // doubles: extra moment to react to a ball down the middle
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => performance.now() / 1000;
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  class TennisGame {
    /* opts: { hud, sfx, onUpdate, view } — view: { render(game, dt, nowSeconds) } */
    constructor({ hud, sfx, onUpdate, view }) {
      this.view = view || null; this.sfx = sfx; this.onUpdate = onUpdate || (() => {});
      this.players = [];        // everyone in the room: { name, color, wins, bias, played }
      this.mode = 'h2h';        // 'h2h': face each other · 'team': side by side against a computer pair
      this.lineup = [[null], [null]];   // player index for each figure at the near (0) and far (1) end; null = the computer
      this.figs = [];           // the figures on court: { end, slot, side, idx, home, pos, vel, goal, ... }
      this.note = [];           // per figure: { text, at } for the phones
      this._buildFigs();
      this.camEnd = 0;          // the end the camera sits behind
      this.flipView = false;    // change ends (the camera) before the next point
      this.splitOn = true;      // two people facing each other: half the screen each, from behind their own player
      this.serveSlot = [0, 0];  // doubles: which partner serves next, per end
      this.lastHit = [null, null];   // the figure that last hit for each end
      this.matches = 0;
      this.score = new Score(TO_GAMES);
      this.state = 'idle'; this.timer = 0; this.over = false; this.started = false;
      this.ball = null;         // { flight, t0, hitter (end), hitterFig, kind: 'serve'|'shot', next: event index }
      this.toss = null;         // { hand, t0, contactT }
      this.expect = null;       // who must hit next: { end, fig, T (ideal moment, s), p, forehand, early }
      this.faults = 0;          // faults on this point
      this.cpuSwing = null;     // { fig, at, power }
      this.armed = false;
      this.lastShot = null;     // { kmh, kind }
      this._buildHud(hud);
      this.last = performance.now(); this.movedTo = now();
      requestAnimationFrame(x => this._tick(x));
    }

    // ---------- who's on court ----------
    _buildFigs() {
      this.figs = [];
      this.lineup.forEach((ids, end) => ids.forEach((idx, slot) => this.figs.push(this._fig(end, slot, idx, ids.length))));
      this.note = this.figs.map(() => null);
    }
    _fig(end, slot, idx, n) {
      const side = end === 0 ? -1 : 1, x = n === 2 ? (slot ? HALF : -HALF) : 0, z = side * (COURT.L + 0.8);
      return { end, slot, side, idx, home: x, pos: { x, z }, vel: { x: 0, z: 0 }, goal: { x, z }, next: null, hist: [], swingAt: -10, swingKind: 'fh', tossAt: -10, mood: null, moodAt: 0 };
    }
    get doubles() { return this.lineup[0].length === 2; }
    get court() { return [this.lineup[0][0], this.lineup[1][0]]; }   // the first player at each end (older callers)
    get server() { return this.score.server; }   // the serving end (0 near, 1 far)
    _endFigs(end) { const r = []; this.figs.forEach((f, i) => { if (f.end === end) r.push(i); }); return r; }
    serverFig() { const ids = this._endFigs(this.score.server); return ids[this.doubles ? this.serveSlot[this.score.server] : 0]; }
    isCpu(fi) { const f = this.figs[fi]; return !f || f.idx === null; }
    // steering their own player by tilting the phone (instead of running automatically)
    isTilt(fi) { const f = this.figs[fi]; return !!(f && f.idx !== null && this.players[f.idx] && this.players[f.idx].tilt); }
    isLefty(fi) { const f = this.figs[fi]; return !!(f && f.idx !== null && this.players[f.idx] && this.players[f.idx].lefty); }
    figWho(fi) { const f = this.figs[fi]; return f && f.idx !== null && this.players[f.idx] ? this.players[f.idx] : CPU; }
    figOf(idx) { return idx === null || idx === undefined ? -1 : this.figs.findIndex(f => f.idx === idx); }
    endOf(idx) { const f = this.figOf(idx); return f < 0 ? -1 : this.figs[f].end; }
    // one end of the court: a name ("Ana", or partners "Ana & Ben") and a colour
    who(end) {
      const ids = this.lineup[end] || [], people = ids.filter(i => i !== null && this.players[i]).map(i => this.players[i]);
      if (!people.length) return CPU;
      return { name: ids.length === 2 ? ids.map(i => (i === null ? 'CPU' : this.players[i].name)).join(' & ') : people[0].name, color: people[0].color };
    }
    _nm(end) { return this.who(end).name; }
    _humansOnCourt() { return this.figs.filter(f => f.idx !== null).map(f => f.idx); }
    _humanEnds() { return [0, 1].filter(e => this.lineup[e].some(i => i !== null)); }
    _bothHuman() { return this._humanEnds().length === 2; }
    get split() { return this.splitOn && this._bothHuman(); }
    // which half of the split screen each end gets (false: the near end on the left)
    swapSplit() { this.splitSwap = !this.splitSwap; if (this.split) { const L = this._nm(this.splitSwap ? 1 : 0); this._flash(`${L.toUpperCase()} ON THE LEFT`, 'info'); } this._emit(); return true; }
    toggleSplit() { this.splitOn = !this.splitOn; if (this._bothHuman()) this._flash(this.splitOn ? 'SPLIT SCREEN' : `ONE VIEW · BEHIND ${this._nm(this.camEnd).toUpperCase()}`, 'info'); this._emit(); return true; }

    // ---------- players ----------
    canJoinNow() { return this.players.length < 6; }
    addPlayer(name) {
      if (this.players.length >= 6) return -1;
      const i = this.players.length;
      this.players.push({ name: name || 'Player ' + (i + 1), color: COLORS[i % COLORS.length], wins: 0, bias: 0, played: -1 });
      // a newcomer takes the computer's place straight away (the other end, or the computer partner), with a fresh match
      const open = this.mode === 'team' ? (this.lineup[0][1] === null ? [0, 1] : null) : (this.lineup[1][0] === null ? [1, 0] : null);
      if (!this._humansOnCourt().length) this.newGame();
      else if (open) { this.lineup[open[0]][open[1]] = i; this._newMatch(); }
      this._renderBoard(); this._emit();
      return i;
    }
    // left- or right-handed: from the switch on the player's phone, any time
    setHand(i, lefty) {
      const p = this.players[i];
      if (!p || !!p.lefty === !!lefty) return;
      p.lefty = !!lefty;
      this._flash(`${p.name.toUpperCase()}: ${p.lefty ? 'LEFT' : 'RIGHT'}-HANDED`, 'info');
      this._emit();
    }
    renamePlayer(i, n) { if (this.players[i] && n) { this.players[i].name = String(n).slice(0, 14); this._renderBoard(); this._emit(); } }
    removePlayer(i) {
      if (!this.players[i]) return;
      this.players.splice(i, 1);
      const fix = c => (c === null ? null : c === i ? undefined : c > i ? c - 1 : c);
      const lineup = this.lineup.map(ids => ids.map(fix));
      if (!this.players.length) { this.lineup = this.mode === 'team' ? [[null, null], [null, null]] : [[null], [null]]; this._newMatch(); }
      else if (lineup.some(ids => ids.includes(undefined))) {
        // someone on court left: the rest stay on, the next in line steps in (or the computer)
        this._pickLineup(lineup.flat().filter(c => c !== null && c !== undefined));
        this._newMatch();
      } else { this.lineup = lineup; for (const f of this.figs) f.idx = fix(f.idx); }
      this._renderBoard(); this._emit();
    }
    isPlaying() { return this.state !== 'idle'; }

    // people who've waited longest play next (never played: in the order they joined)
    _byTurn() { return this.players.map((p, k) => k).sort((a, b) => (this.players[a].played - this.players[b].played) || a - b); }
    _pickLineup(first = []) {
      const order = [...first, ...this._byTurn().filter(k => !first.includes(k))], at = k => (order[k] === undefined ? null : order[k]);
      this.lineup = this.mode === 'team' ? [[at(0), at(1)], [null, null]] : [[at(0)], [at(1)]];
    }
    // switch between playing each other and teaming up against the computer (starts a fresh match)
    setMode(m) {
      if (!MODES[m] || m === this.mode) return false;
      this.mode = m;
      this._pickLineup(this._humansOnCourt());
      this._newMatch();
      this._renderBoard(); this._emit();
      return true;
    }
    toggleMode() { return this.setMode(this.mode === 'team' ? 'h2h' : 'team'); }
    // put the camera behind the other end (when people are at both ends)
    toggleView() { if (!this._bothHuman()) return false; this.camEnd = 1 - this.camEnd; this._flash(`VIEW: BEHIND ${this._nm(this.camEnd).toUpperCase()}`, 'info'); this._emit(); return true; }

    newGame() {
      this._pickLineup();
      this.over = false; this.started = false;
      this._newMatch();
    }
    _newMatch() {
      this.score = new Score(TO_GAMES); this.faults = 0; this.serveSlot = [0, 0]; this.lastHit = [null, null];
      this.over = false;
      this._buildFigs();
      this.ball = null; this.toss = null; this.expect = null; this.cpuSwing = null;
      if (!this._humansOnCourt().length) { this.state = 'idle'; this._renderBoard(); this._renderTop(); return; }
      // the camera: behind the people; head to head it keeps taking turns
      let delay = 2.2;
      if (this._bothHuman()) { if (this.flipView) { this.camEnd = 1 - this.camEnd; delay = 3.2; } }
      else this.camEnd = this._humanEnds()[0];
      this.flipView = false;
      this._flash(`${this._nm(0).toUpperCase()} VS ${this._nm(1).toUpperCase()}`, 'info');
      this._startPoint(delay);
      this._renderBoard(); this._emit();
    }

    info() {
      const s = this.score, X = this.expect, serving = this.state === 'serve' || this.state === 'toss';
      const sf = this.figs.length ? this.serverFig() : null;
      return {
        state: this.state, over: this.over, started: this.started, mode: this.mode, doubles: this.doubles,
        players: this.players.map(q => ({ name: q.name, color: q.color, wins: q.wins, lefty: !!q.lefty, tilt: !!q.tilt })),
        lineup: this.lineup.map(a => a.slice()), court: this.court, server: s.server, serverFig: sf,
        games: s.games.slice(), points: [s.label(0), s.label(1)], camEnd: this.camEnd, split: this.split, splitSwap: !!this.splitSwap,
        cur: X ? this.figs[X.fig].idx : serving && sf !== null ? this.figs[sf].idx : null,
        hitting: X ? X.end : null, hittingFig: X ? X.fig : null, winner: s.winner,
      };
    }

    // ---------- input ----------
    input(idx, m) {
      if (m.t === 'swapsplit') return this.swapSplit();   // either player can swap halves
      if (m.t === 'mode') return this.setMode(m.mode);   // anyone in the room can switch how you play
      if (m.t === 'move') { const p = this.players[idx]; if (p && !!p.tilt !== !!m.tilt) { p.tilt = !!m.tilt; this._emit(); } return true; }   // run automatically, or steer by tilting
      const fi = this.figOf(idx);
      if (fi < 0) return false;
      if (m.t === 'steer') { const F = this.figs[fi]; F.steer = clamp(+m.x || 0, -1, 1); F.steerAt = now(); return true; }
      if (m.t === 'arm') { if (fi === this.serverFig() && this.state === 'serve') this.armed = true; return true; }
      if (m.t === 'swing') {
        const at = m.at ? m.at / 1000 : now() - 0.06;
        this._swing(fi, at, Math.max(0, Math.min(1, +m.power || 0)), false);
        return true;
      }
      return false;
    }

    _lag(fi) { const p = this.players[this.figs[fi].idx]; return p ? Math.max(-BIAS_MAX, Math.min(BIAS_MAX, p.bias)) : 0; }
    _learn(fi, raw) { const p = this.players[this.figs[fi].idx]; if (p && Math.abs(raw - this._lag(fi)) < 0.45) p.bias = p.bias * 0.7 + raw * 0.3; }
    _note(fi, text) { this.note[fi] = { text, at: Date.now() }; }

    // a swing from figure `fi`, peaking at `at` (s, this clock)
    _swing(fi, at, power, cpu) {
      const F = this.figs[fi], tNow = now();
      if (!F) return;
      if (this.sfx && !cpu) this.sfx.unlock();
      // the serve
      if (this.state === 'toss' && fi === this.serverFig()) {
        const raw = at - (this.toss.t0 + this.toss.contactT), dt = raw - (cpu ? 0 : this._lag(fi));
        if (dt < -WINDOW) { F.swingAt = cpu ? at : tNow + SWING_LEAD; F.swingKind = 'serve'; this._note(fi, 'Too early: let the ball come down'); return; }
        F.swingAt = cpu ? at : tNow + SWING_LEAD; F.swingKind = 'serve';
        if (!cpu) this._learn(fi, raw);
        const from = tossAt(this.toss.hand, Math.max(0, at - this.toss.t0));
        const second = this.faults === 1;
        const toHuman = this._endFigs(1 - F.end).some(k => !this.isCpu(k));
        if (cpu) power = second ? 0.3 + Math.random() * 0.3 : 0.35 + Math.random() * 0.4;
        const sv = serve({ dt, power, from, side: F.side, deuce: this.score.deuceSide, second, ease: toHuman ? SERVE_EASE : 1 });
        if (!sv) { this._note(fi, dt > 0 ? 'Too late: hit it as it falls' : 'Too early'); return; }   // a whiff: the toss just drops
        this.toss = null; this.started = true;
        this._launch(fi, from, sv, at, 'serve');
        if (!cpu) this._note(fi, this._timingText(dt));
        return;
      }
      // a rally shot
      const X = this.expect;
      if (this.state !== 'rally' || !X || X.fig !== fi || X.done) return;
      const raw = at - X.T, onRet = !cpu && this.ball && this.ball.kind === 'serve';
      let dt = raw - (cpu ? 0 : this._lag(fi));
      if (onRet) dt *= RETURN_SLACK;   // returning serve: a wider window
      if (dt < -WINDOW) { if (!X.early) X.early = { at }; F.swingAt = cpu ? at : tNow + SWING_LEAD; F.swingKind = X.forehand ? 'fh' : 'bh'; return; }   // way early: a better one may follow
      F.swingAt = cpu ? at : tNow + SWING_LEAD;
      if (!cpu) this._learn(fi, raw);
      if (dt > WINDOW) { X.done = true; if (!cpu) this._note(fi, `Missed: late by ${Math.round(dt * 1000)} ms`); return; }
      // too far away to get a racket on it (a wide, fast ball): a clean winner
      this._moveTo(tNow);   // players are moved up to this moment (a message can land between frames)
      const P = this._posAt(fi, at), tilt = this.isTilt(fi);
      if (tilt) X.forehand = Math.abs(P.x - X.fhX) <= Math.abs(P.x - X.bhX) + 0.3;   // steering: you play the side you got to
      const far = Math.hypot(P.x - (tilt ? (X.forehand ? X.fhX : X.bhX) : F.goal.x), P.z - F.goal.z);
      if (far > (onRet ? REACH_RETURN : tilt ? REACH_TILT : REACH)) { X.done = true; if (!cpu) this._note(fi, 'Couldn’t reach that one'); return; }
      // a stretch or a fast ball makes it harder to play well
      const inKmh = this.lastShot ? this.lastShot.kmh : 80, onServe = this.lastShot && this.lastShot.kind === 'serve';
      const pace = onServe ? (cpu ? 0.3 : 0.12) * clamp((inKmh - 110) / 60, 0, 1) : 0.45 * clamp((inKmh - 95) / 70, 0, 1);   // (a returner expects a fast serve)
      const pressure = clamp(0.8 * Math.max(0, far - 0.4) / ((tilt ? REACH_TILT : REACH) - 0.4) + pace, 0, 1);
      const from = this._ballAt(at) || X.p;
      if (cpu) power = this._cpuPower(pressure, inKmh, X.p);
      F.swingKind = X.forehand ? 'fh' : 'bh';
      const sh = stroke({ dt, power, from, side: F.side, forehand: X.forehand, lefty: this.isLefty(fi), pressure,
        aimX: cpu ? this._cpuAim(F.end, pressure) : null, lean: this._openX(1 - F.end) });   // good timing finds the open court
      X.done = true;
      this.started = true;
      this._launch(fi, from, sh, at, 'shot');
      if (!cpu) this._note(fi, this._timingText(dt));
    }
    // where the open court is at `end`: away from a lone player, or the widest gap around a pair
    _openX(end) {
      const xs = this._endFigs(end).map(i => this.figs[i].pos.x).sort((a, b) => a - b);
      if (xs.length < 2) return clamp(-(xs[0] || 0) * 1.5, -2.2, 2.2);
      const edge = COURT.DW - 0.7, pts = [-edge, ...xs, edge];
      let best = -1, at = 0;
      for (let k = 1; k < pts.length; k++) if (pts[k] - pts[k - 1] > best) { best = pts[k] - pts[k - 1]; at = (pts[k] + pts[k - 1]) / 2; }
      return clamp(at, -3.6, 3.6);
    }
    // the computer: how hard to hit it, and where (away from the other side)
    _cpuPower(pressure, inKmh, p) {
      if (pressure > 0.55) return 0.3 + Math.random() * 0.25;                   // stretched: just get it back
      if (Math.abs(p.z) < COURT.L - 1.6 || inKmh < 70) return 0.82 + Math.random() * 0.13;   // a short or slow ball: go after it
      return 0.5 + Math.random() * 0.32;
    }
    // the computer eases off a little when it is games ahead, and tightens up when behind
    _cpuSd(end) { const g = this.score.games; return clamp(CPU_SD + (this.doubles ? 0.02 : 0) + 0.03 * (g[end] - g[1 - end]), 0.07, 0.16); }   // (a computer pair is a little looser)
    _cpuAim(end, pressure) {
      if (pressure > 0.6) return (Math.random() - 0.5) * 2;                     // under pressure: anywhere in
      if (this.doubles) return Math.random() < 0.3 ? (Math.random() - 0.5) * 1.6 : this._openX(1 - end) + (Math.random() - 0.5) * 1.2;   // down the middle, or into the gap
      if (Math.random() < 0.35) return (Math.random() - 0.5) * 1.6;             // a neutral ball
      const ox = this.figs[this._endFigs(1 - end)[0]].goal.x, away = ox > 0.3 ? -1 : ox < -0.3 ? 1 : Math.random() < 0.5 ? -1 : 1;
      return away * (1.9 + Math.random() * 1.1);
    }
    _timingText(dt) { const ms = Math.round(dt * 1000); return Math.abs(ms) < 40 ? 'Perfect timing!' : ms < 0 ? `Early by ${-ms} ms` : `Late by ${ms} ms`; }

    // which partner takes a ball at `end` heading for point p: whoever's half it's in; down the middle,
    // whoever didn't hit their side's last ball (so partners share the middle)
    _receiver(end, p) {
      const ids = this._endFigs(end);
      if (ids.length < 2) return ids[0];
      const [a, b] = ids, A = this.figs[a];
      if (this.isTilt(a) || this.isTilt(b)) {   // someone steering themselves: whoever's nearer takes it
        const da = Math.abs(A.pos.x - p.x), db = Math.abs(this.figs[b].pos.x - p.x);
        if (Math.abs(da - db) > 1.2) return da < db ? a : b;
      }
      if (Math.abs(p.x) > 0.9) return Math.sign(p.x) === Math.sign(A.home) ? a : b;
      return this.lastHit[end] === a ? b : a;
    }

    // the ball leaves figure `fi`'s racket at time `at`
    _launch(fi, from, sh, at, kind) {
      const H = this.figs[fi], end = H.end, dbl = this.doubles;
      this.lastHit[end] = fi;
      const flight = fly(from, sh.v, sh.spin);
      this.ball = { flight, t0: at, hitter: end, hitterFig: fi, kind, next: 0 };
      this.lastShot = { kmh: Math.round(Math.hypot(sh.v.x, sh.v.y, sh.v.z) * 3.6), kind };
      this.state = 'rally';
      this.cpuSwing = null;
      if (this.sfx) this.sfx.pock(0.6 + 0.4 * (sh.quality || 0.5));
      // the other end now has to get there and hit it
      const to = 1 - end, side = to === 0 ? -1 : 1;
      const hp = kind === 'serve' ? (this._serveIn(flight) ? hitPoint(flight, side, dbl) : null) : hitPoint(flight, side, dbl);
      this.expect = null;
      if (hp) {
        const ri = this._receiver(to, hp.p), R = this.figs[ri];
        const right = side === -1 ? 1 : -1, P = R.pos, hand = this.isLefty(ri) ? -1 : 1;   // the racket side
        const fhX = hp.p.x - 0.75 * right * hand, bhX = hp.p.x + 0.75 * right * hand;
        const forehand = Math.abs(fhX - P.x) <= Math.abs(bhX - P.x) + 0.6;   // forehands are preferred
        this.expect = { end: to, fig: ri, T: at + hp.t, p: hp.p, forehand, i: hp.i, fhX, bhX };
        // doubles: a ball down the middle makes partners hesitate over who takes it
        const seam = dbl && Math.abs(hp.p.x) < 0.9 ? SEAM_PAUSE : 0;
        R.next = { goal: { x: forehand ? fhX : bhX, z: hp.p.z + side * 0.45 }, at: at + (kind === 'serve' ? REACT_SERVE : REACT) + seam };
        if (this.isCpu(ri)) this.cpuSwing = { fig: ri, at: this.expect.T + gauss() * this._cpuSd(to), power: 0.6 };
      }
      // in doubles the partner of whoever's chasing it covers their own half
      if (dbl) for (const k of this._endFigs(to)) if (!this.expect || k !== this.expect.fig) { const F = this.figs[k]; F.next = { goal: { x: F.home, z: F.side * (COURT.L + 0.7) }, at: at + REACT }; }
      // the hitter heads back: to the middle of the baseline, or (doubles) to the middle of their half
      H.goal = { x: dbl ? H.home : clamp((hp ? hp.p.x : 0) * 0.35, -1.5, 1.5), z: H.side * (COURT.L + 0.7) };
      if (dbl) for (const k of this._endFigs(end)) if (k !== fi) { const F = this.figs[k]; F.goal = { x: F.home, z: F.side * (COURT.L + 0.7) }; }
      this._renderTop(); this._emit();
    }

    _serveIn(flight) {
      const b = flight.events.find(e => e.type === 'bounce');
      return !!b && inBox(b.x, b.z, serviceBox(this.server === 0 ? -1 : 1, this.score.deuceSide));
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
      // head to head, change ends (the camera swings round) after each game
      if (this.flipView && this._bothHuman()) { this.camEnd = 1 - this.camEnd; delay += 1.2; this._flash(`CHANGE ENDS · VIEW BEHIND ${this._nm(this.camEnd).toUpperCase()}`, 'info'); }
      this.flipView = false;
      this.state = 'serve'; this.timer = delay; this.idle = 0; this.armed = false;
      this.ball = null; this.toss = null; this.expect = null; this.cpuSwing = null;
      const box = serviceBox(srv === 0 ? -1 : 1, deuce), bx = (box.x0 + box.x1) / 2, bs = bx > 0 ? 1 : -1;   // the target box, on the receiving end
      const si = this.serverFig(), S = this.figs[si], rec = this._endFigs(1 - srv);
      // the returner covers both the T and the wide serve (a second serve comes in slower and shorter)
      const ret = F => ({ x: bx * (this.faults ? 1.2 : 1.45), z: F.side * (COURT.L + (this.faults ? 0.4 : 0.9)) });
      if (!this.doubles) {
        S.goal = { x: -bs * 0.75, z: S.side * (COURT.L + 0.25) };   // stand on the half opposite the target box
        this.figs[rec[0]].goal = ret(this.figs[rec[0]]);
      } else {
        // serve from beside the centre mark, diagonal to the box; the partner takes the other half.
        // The returner (one for each court) stands where the serve is going; their partner takes the other half.
        S.home = -bs * HALF; S.goal = { x: -bs * 1.6, z: S.side * (COURT.L + 0.25) };
        for (const k of this._endFigs(srv)) if (k !== si) { const F = this.figs[k]; F.home = bs * HALF; F.goal = { x: F.home, z: F.side * (COURT.L + 0.4) }; }
        const ri = rec.find(k => this.figs[k].slot === (deuce ? 0 : 1));
        for (const k of rec) { const F = this.figs[k]; F.home = (k === ri ? bs : -bs) * HALF; F.goal = k === ri ? ret(F) : { x: F.home, z: F.side * (COURT.L + 0.6) }; }
      }
      for (const F of this.figs) { F.mood = null; F.next = null; }
      this._renderTop(); this._emit();
    }

    _pointTo(end, text, kind) {
      const srvEnd = this.score.server;
      const res = this.score.point(end);
      this.faults = 0;   // the next point starts with a first serve
      if (res !== 'point') { if (this.doubles) this.serveSlot[srvEnd] ^= 1; if (this._bothHuman() && !this.split) this.flipView = true; }
      this.state = 'point'; this.timer = res === 'match' ? 6 : 2.4;
      this.expect = null; this.cpuSwing = null; this.toss = null;
      const t = now();
      for (const F of this.figs) { F.moodAt = t; F.mood = F.end === end ? (res === 'point' ? 'yes' : 'win') : res === 'point' ? null : 'lose'; }
      let msg = text;
      if (res === 'game') msg = `GAME · ${this._nm(end).toUpperCase()}`;
      if (res === 'match') {
        msg = `${this._nm(end).toUpperCase()} ${this.lineup[end].length === 2 ? 'WIN' : 'WINS'}!`;
        this.over = true;
        for (const k of this.lineup[end]) if (k !== null && this.players[k]) this.players[k].wins++;
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
      // match over. Head to head: the winner stays on if others are waiting, the loser goes to the back of the
      // line. As a team: one partner swaps out for the next person waiting.
      this.matches++;
      const on = this._humansOnCourt();
      for (const k of on) this.players[k].played = this.matches;
      const waiting = this._byTurn().filter(k => !on.includes(k));
      if (this.mode === 'team') { if (waiting.length && on.length === 2) this.lineup = [[on[1], waiting[0]], [null, null]]; }
      else {
        const s = this.score, win = this.lineup[s.winner][0], lose = this.lineup[1 - s.winner][0];
        if (win === null) this.lineup = [[lose], [null]];
        else if (waiting.length) this.lineup = [[win], [waiting[0]]];
      }
      this._newMatch();
    }

    // events on the ball's path as time catches up with them
    _events(t) {
      const B = this.ball; if (!B) return;
      const ev = B.flight.events, X = this.expect;
      while (B.next < ev.length && ev[B.next].i / HZ <= t - B.t0) {
        const e = ev[B.next++];
        const hitter = B.hitter, other = 1 - hitter, side = other === 0 ? -1 : 1;
        if (e.type === 'net') { if (this.sfx) this.sfx.net(); continue; }
        if (this.sfx) this.sfx.bounce();
        const bounces = ev.filter((q, k) => k < B.next && q.type === 'bounce');
        if (bounces.length === 1) {
          // first bounce decides serves and outs
          if (B.kind === 'serve') {
            const box = serviceBox(hitter === 0 ? -1 : 1, this.score.deuceSide), inb = inBox(e.x, e.z, box);
            const netted = ev.some(q => q.type === 'net' && q.i < e.i);
            if (inb && netted && ev.find(q => q.type === 'net').cord) { this._let(); return; }
            if (!inb || e.side !== side) { this._fault(netted ? 'NET' : 'FAULT'); return; }
            continue;
          }
          if (e.side !== side) { this._pointTo(other, 'NET'); return; }
          if (!inCourt(e.x, e.z, side, this.doubles)) { this._pointTo(other, 'OUT'); return; }
          continue;
        }
        // a second bounce on the receiver's side: they didn't get it back (unless a swing is still on its way)
        if (e.side === side) {
          if (X && !X.done && t < X.T + GRACE) { B.next--; return; }   // wait a moment for a late message
          this._pointTo(hitter, B.kind === 'serve' ? 'ACE!' : 'WINNER!');
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
        const si = this.serverFig();
        if (this.timer <= 0 && (this.armed || this.idle > (this.isCpu(si) ? 1.4 : 5))) {   // people tilt their phone up (or tap) to toss
          // toss it up
          const S = this.figs[si], right = S.side === -1 ? 1 : -1, racket = this.isLefty(si) ? -1 : 1;
          const hand = { x: S.pos.x + 0.28 * right * racket, y: T.TOSS.from, z: S.pos.z - S.side * 0.25 };   // up in front of the racket shoulder
          this.toss = { hand, t0: t, contactT: tossContactT(hand) };
          S.tossAt = t;
          this.state = 'toss';
          if (this.isCpu(si)) this.cpuSwing = { fig: si, at: t + this.toss.contactT + gauss() * 0.07, power: 0.7 };
          this._renderTop(); this._emit();
        }
      } else if (this.state === 'toss') {
        // nobody hit it: catch it and toss again (no fault)
        if (t - this.toss.t0 > this.toss.contactT + WINDOW + 0.35) { this.toss = null; this.state = 'serve'; this.timer = 0.6; this.idle = 9; this.cpuSwing = null; this._renderTop(); }
      } else if (this.state === 'rally') {
        this._events(t);
        // an early swing that wasn't followed by a better one: it was a miss
        const X = this.expect;
        if (X && !X.done && X.early && t > X.T + 0.2) { X.done = true; if (!this.isCpu(X.fig)) this._note(X.fig, `Missed: early by ${Math.round((X.T - X.early.at) * 1000)} ms`); }
        // the ball flew off without a second bounce (a winner that left the court, or a ball nobody reached)
        if (this.state === 'rally' && this.ball && (t - this.ball.t0) * HZ > this.ball.flight.pts.length + HZ * 0.2) {
          const b = this.ball, ev = b.flight.events.filter(e => e.type === 'bounce');
          if (!ev.length) this._pointTo(1 - b.hitter, 'OUT'); else this._pointTo(b.hitter, b.kind === 'serve' ? 'ACE!' : 'WINNER!');
        }
      } else if (this.state === 'point') {
        this.timer -= dt;
        if (this.timer <= 0) this._afterPoint();
      }
      if (this.cpuSwing && t >= this.cpuSwing.at) { const c = this.cpuSwing; this.cpuSwing = null; this._swing(c.fig, c.at, c.power, true); }
      this._moveTo(t);
      if (this.view) this.view.render(this, dt, t);
    }

    // where figure fi was at time t (a swing message arrives a little after the swing)
    _posAt(fi, t) { const F = this.figs[fi], h = F.hist; for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i]; return h[0] || F.pos; }
    // Players run on their own, in small steps of real time, so a slow frame rate doesn't leave
    // them behind a ball that flies in real time.
    _moveTo(t) { const dt = Math.max(0, Math.min(1.5, t - this.movedTo)); this.movedTo = Math.max(this.movedTo, t); this._move(dt, t); }
    _move(dt, t) {
      if (!(dt > 0)) return;
      const n = Math.ceil(dt * 120), h = dt / n, vmax = this.state === 'rally' || this.state === 'toss' ? SPEED : JOG;
      const X = this.expect;
      for (let k = 1; k <= n; k++) {
        const tk = t - dt + k * h;
        for (let fi = 0; fi < this.figs.length; fi++) {
          const E = this.figs[fi];
          if (E.next && tk >= E.next.at) { E.goal = E.next.goal; E.next = null; }
          const dx = E.goal.x - E.pos.x, dz = E.goal.z - E.pos.z, d = Math.hypot(dx, dz);
          // speed we'd like: enough to arrive, easing in at the end
          const want = Math.min(vmax, d * 4);
          let tx = d > 1e-3 ? dx / d * want : 0, tz = d > 1e-3 ? dz / d * want : 0, acc = ACCEL;
          // steering by tilt, in a rally: left and right as you see them on the big screen (front to back
          // stays automatic). In the last moment before your ball you drift the rest of the way into range.
          if (this.state === 'rally' && this.isTilt(fi)) {
            const scr = (this.split ? E.end : this.camEnd) === 0 ? 1 : -1, steer = tk - (E.steerAt || -9) < 1 ? E.steer || 0 : 0;
            tx = steer * SPEED * scr;
            if (X && X.fig === fi && !X.done && tk > X.T - 0.35) {
              const gx = Math.abs(E.pos.x - X.fhX) <= Math.abs(E.pos.x - X.bhX) + 0.3 ? X.fhX : X.bhX;
              tx = tx * 0.5 + clamp((gx - E.pos.x) * 6, -TILT_HELP, TILT_HELP);
            }
            tz = clamp(dz * 4, -SPEED, SPEED);
            if (Math.abs(E.pos.x) > COURT.DW + 3 && Math.sign(tx) === Math.sign(E.pos.x)) tx = 0;   // the stands are in the way
            acc = ACCEL_TILT;
          }
          const ax = tx - E.vel.x, az = tz - E.vel.z, a = Math.hypot(ax, az), f = a > acc * h ? acc * h / a : 1;
          E.vel.x += ax * f; E.vel.z += az * f;
          E.pos.x += E.vel.x * h; E.pos.z += E.vel.z * h;
          if (k === n || k % 4 === 0) E.hist.push({ t: tk, x: E.pos.x, z: E.pos.z });
        }
      }
      for (const E of this.figs) while (E.hist.length > 2 && E.hist[0].t < t - 1.5) E.hist.shift();
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
        this.el.score.innerHTML = `<table class="tennis">${row(0)}${row(1)}</table><small>${MODES[this.mode]} · first to ${TO_GAMES} games</small>`;
      }
      const ls = this.lastShot;
      this.el.info.innerHTML = ls ? `${ls.kind === 'serve' ? 'Serve' : 'Last shot'}<br><b>${ls.kmh}</b> km/h` : '';
      this.el.info.parentElement.hidden = !ls;
      let turn = '';
      const si = this.figs.length ? this.serverFig() : null;
      if (this.state === 'serve' || this.state === 'toss') turn = this.isCpu(si) ? 'CPU to serve' : this.state === 'serve' ? `${esc(this.figWho(si).name)} to serve · tilt your phone up to toss` : `${esc(this.figWho(si).name)}: swing as the ball comes down`;
      else if (this.state === 'rally' && this.expect && !this.isCpu(this.expect.fig)) turn = `${esc(this.figWho(this.expect.fig).name)}: swing when the ring closes`;
      else if (this.state === 'idle') turn = 'Join on your phone to play';
      this.el.turn.innerHTML = turn;
    }
    _renderBoard() {
      if (this.players.length < 3) { this.el.board.innerHTML = ''; return; }
      let h = '<table><thead><tr><th></th><th>Wins</th><th></th></tr></thead><tbody>';
      const on = this._humansOnCourt();
      this.players.forEach((p, i) => { const e = on.includes(i); h += `<tr class="${e ? 'active' : ''}"><td class="name"><i style="background:${p.color}"></i>${esc(p.name)}</td><td class="total">${p.wins}</td><td>${e ? 'on court' : 'next up'}</td></tr>`; });
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
  T.MODES = MODES;
})(self);
