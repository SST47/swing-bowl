/*
 * Swing Bowl — physics + scoring engine (no DOM, so it can be tested in Node).
 * World units are metres. x runs across the lane (negative = left, from the
 * bowler's view), z runs down the lane from the foul line (z = 0).
 */
(function (root) {
  'use strict';

  const C = {
    LANE_HALF: 0.527,          // half of a 41.5" lane
    GUTTER_W: 0.235,
    HEAD_PIN_Z: 18.288,        // 60 ft foul line -> head pin
    PIN_SPACING: 0.3048,       // 12"
    BALL_R: 0.108,
    BALL_M: 7.0,
    PIN_R: 0.0605,
    PIN_M: 1.53,
    PIN_H: 0.381,
    DECK_Z: 17.6,
    PIT_Z: 19.35,
    BALL_END_Z: 19.7,
    KICKBACK_X: 0.527 + 0.235,
    HOOK: 0.95,                // lateral accel (m/s^2) at full spin, after the oil
    BALL_DECEL: 0.12,
    MAX_START_X: 0.42,
    MAX_AIM: 0.085,            // ~4.9 degrees
    MIN_SPEED: 2.5,
    MAX_SPEED: 11,
  };
  C.ROW_DZ = C.PIN_SPACING * Math.sqrt(3) / 2;
  C.GUTTER_X = C.LANE_HALF + C.GUTTER_W / 2;

  // Pin spots, numbered 1-10 the standard way (row 1 = head pin).
  const SPOTS = [];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i <= r; i++) {
      SPOTS.push({ x: (i - r / 2) * C.PIN_SPACING, z: C.HEAD_PIN_Z + r * C.ROW_DZ });
    }
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  class Lane {
    constructor(rng) {
      this.rng = rng || Math.random;
      this.events = [];
      this.ball = null;
      this.acc = 0;
      this.resetPins();
    }

    resetPins() {
      this.pins = SPOTS.map((s, i) => ({
        n: i + 1, x: s.x, z: s.z, vx: 0, vz: 0, rx: s.x, rz: s.z,
        fallen: false, tilt: 0, dir: Math.PI / 2, gone: false, wob: 0,
      }));
      this.standingAtStart = this.pins.length;
    }

    // Remove knocked pins, re-spot the standing ones where they are.
    sweep() {
      this.pins = this.pins.filter(p => !p.fallen && !p.gone);
      for (const p of this.pins) { p.vx = p.vz = 0; p.rx = p.x; p.rz = p.z; p.wob = 0; }
    }

    standing() { return this.pins.filter(p => !p.fallen && !p.gone); }

    throwBall({ x = 0, aim = 0, speed = 7, spin = 0 }) {
      speed = clamp(speed, C.MIN_SPEED, C.MAX_SPEED);
      aim = clamp(aim, -C.MAX_AIM, C.MAX_AIM);
      this.ball = {
        x: clamp(x, -C.MAX_START_X, C.MAX_START_X), z: 0.15,
        vx: Math.sin(aim) * speed, vz: Math.cos(aim) * speed,
        spin: clamp(spin, -1, 1), gutter: false, done: false, dist: 0, hitPins: false,
      };
      this.standingAtStart = this.standing().length;
      this.rollTime = 0;
      this.quiet = 0;
      this.settled = false;
      this.acc = 0;
    }

    // Advance by real elapsed time using fixed sub-steps.
    update(elapsed) {
      this.acc += Math.min(elapsed, 0.1);
      const dt = 1 / 240;
      while (this.acc >= dt) { this.step(dt); this.acc -= dt; }
    }

    _topple(p, dirX, dirZ) {
      if (p.fallen) return;
      p.fallen = true;
      let d = Math.atan2(dirZ, dirX);
      if (!isFinite(d) || (dirX === 0 && dirZ === 0)) d = Math.PI / 2;
      p.dir = d + (this.rng() - 0.5) * 0.6;
      this.events.push({ type: 'fall', n: p.n });
    }

    _collide(a, b, ma, mb, rsum, e) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rsum * rsum || d2 < 1e-12) return 0;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
      const im = 1 / ma + 1 / mb;
      const pen = rsum - d;
      a.x -= nx * pen * (1 / ma) / im; a.z -= nz * pen * (1 / ma) / im;
      b.x += nx * pen * (1 / mb) / im; b.z += nz * pen * (1 / mb) / im;
      const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vn >= 0) return 0;
      const j = -(1 + e) * vn / im;
      a.vx -= j / ma * nx; a.vz -= j / ma * nz;
      b.vx += j / mb * nx; b.vz += j / mb * nz;
      return -vn;
    }

    _scatter(p, amount) {
      // Real pins tumble unpredictably; nudge their direction a little.
      const ang = (this.rng() - 0.5) * amount;
      const c = Math.cos(ang), s = Math.sin(ang);
      const vx = p.vx * c - p.vz * s, vz = p.vx * s + p.vz * c;
      p.vx = vx; p.vz = vz;
    }

    _pinR(p) { return C.PIN_R + (p.fallen ? 0.03 * Math.min(1, p.tilt) : 0); }

    step(dt) {
      const b = this.ball;
      if (b && !b.done) {
        if (!b.gutter) b.vx += -b.spin * C.HOOK * smoothstep(5.5, 14, b.z) * dt;
        let sp = Math.hypot(b.vx, b.vz);
        if (sp > 0) {
          const ns = Math.max(0, sp - C.BALL_DECEL * dt);
          b.vx *= ns / sp; b.vz *= ns / sp; sp = ns;
        }
        b.x += b.vx * dt; b.z += b.vz * dt; b.dist += sp * dt;

        if (!b.gutter && Math.abs(b.x) > C.LANE_HALF + 0.015 && b.z < C.PIT_Z) {
          b.gutter = true;
          this.events.push({ type: 'gutter', beforePins: !b.hitPins });
        }
        if (b.gutter) {
          const tx = Math.sign(b.x) * C.GUTTER_X;
          b.x += (tx - b.x) * Math.min(1, dt * 12);
          b.vx = 0;
          if (b.vz < 1.5) b.vz = 1.5;
        }
        if (b.z > C.BALL_END_Z) { b.done = true; this.events.push({ type: 'pit' }); }
        if (sp < 0.15) b.done = true;
      }

      for (const p of this.pins) {
        if (p.gone) continue;
        p.x += p.vx * dt; p.z += p.vz * dt;
        const damp = p.fallen ? Math.exp(-1.1 * dt) : Math.exp(-7 * dt);
        p.vx *= damp; p.vz *= damp;
        if (p.fallen && p.tilt < 1) p.tilt = Math.min(1, p.tilt + dt * 4.5);
        if (p.wob > 0) p.wob = Math.max(0, p.wob - dt * 2.5);
        if (!p.fallen) {
          const mx = p.x - p.rx, mz = p.z - p.rz;
          if (mx * mx + mz * mz > 0.035 * 0.035) this._topple(p, mx, mz);
          if (Math.abs(p.x) > C.LANE_HALF + 0.02) this._topple(p, p.x, 0);
        } else if (Math.abs(p.x) > C.KICKBACK_X - 0.04) {
          p.x = Math.sign(p.x) * (C.KICKBACK_X - 0.04);
          p.vx = -p.vx * 0.55;
        }
        if (p.z > C.PIT_Z || p.z < C.DECK_Z - 1) { p.gone = true; p.fallen = true; p.tilt = 1; }
      }

      if (b && !b.done && !b.gutter) {
        for (const p of this.pins) {
          if (p.gone) continue;
          const imp = this._collide(b, p, C.BALL_M, C.PIN_M, C.BALL_R + this._pinR(p), 0.55);
          if (imp > 0) {
            b.hitPins = true;
            this._scatter(p, 0.5);
            this.events.push({ type: 'hit', strength: imp });
            if (imp > 0.2) this._topple(p, p.vx, p.vz); else p.wob = 1;
          }
        }
      }

      const ps = this.pins;
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        if (a.gone) continue;
        for (let j = i + 1; j < ps.length; j++) {
          const c = ps[j];
          if (c.gone) continue;
          const imp = this._collide(a, c, C.PIN_M, C.PIN_M, this._pinR(a) + this._pinR(c), 0.75);
          if (imp > 0) {
            this._scatter(a, 0.35); this._scatter(c, 0.35);
            if (imp > 0.08) this.events.push({ type: 'clack', strength: imp });
            if (imp > 0.22) {
              if (!a.fallen) this._topple(a, a.vx, a.vz);
              if (!c.fallen) this._topple(c, c.vx, c.vz);
            } else { a.wob = Math.max(a.wob, 0.6); c.wob = Math.max(c.wob, 0.6); }
          }
        }
      }

      if (b && !this.settled) {
        this.rollTime += dt;
        const ballClear = b.done || b.z > C.PIT_Z;
        let maxV = 0;
        for (const p of this.pins) if (!p.gone) maxV = Math.max(maxV, Math.hypot(p.vx, p.vz));
        if (ballClear && maxV < 0.06) this.quiet += dt; else this.quiet = 0;
        const reachedPins = b.z > C.HEAD_PIN_Z - 0.3 || b.done;
        if ((reachedPins && this.quiet > 0.7) || this.rollTime > 14) {
          this.settled = true;
          const knocked = this.standingAtStart - this.standing().length;
          this.events.push({ type: 'settled', knocked, gutter: b.gutter && !b.hitPins });
        }
      }
    }

    drainEvents() { const e = this.events; this.events = []; return e; }
  }

  // ---------- Scoring ----------
  const mark = v => (v === 0 ? '-' : String(v));

  function frameMarks(fr, tenth) {
    if (!fr || !fr.length) return tenth ? ['', '', ''] : ['', ''];
    if (!tenth) {
      if (fr[0] === 10) return ['', 'X'];
      return [mark(fr[0]), fr.length > 1 ? (fr[0] + fr[1] === 10 ? '/' : mark(fr[1])) : ''];
    }
    const out = ['', '', ''];
    let fresh = true, prev = 0;
    fr.forEach((v, i) => {
      if (fresh) { out[i] = v === 10 ? 'X' : mark(v); fresh = v === 10; prev = v; }
      else { const sp = prev + v === 10; out[i] = sp ? '/' : mark(v); fresh = sp; prev = v; }
    });
    return out;
  }

  // frames: array (<=10) of arrays of pin counts. Returns per-frame marks + running totals.
  function scoreCard(frames) {
    const rolls = [];
    frames.forEach(f => f && rolls.push(...f));
    const out = [];
    let total = 0, known = true, ri = 0;
    for (let f = 0; f < 10; f++) {
      const fr = frames[f] || [];
      const marks = frameMarks(fr, f === 9);
      let value = null;
      if (fr.length) {
        if (f < 9) {
          if (fr[0] === 10) {
            if (rolls.length > ri + 2) value = 10 + rolls[ri + 1] + rolls[ri + 2];
            ri += 1;
          } else if (fr.length >= 2) {
            if (fr[0] + fr[1] === 10) { if (rolls.length > ri + 2) value = 10 + rolls[ri + 2]; }
            else value = fr[0] + fr[1];
            ri += 2;
          } else ri += fr.length;
        } else {
          const done = fr.length === 3 || (fr.length === 2 && fr[0] + fr[1] < 10);
          if (done) value = fr.reduce((a, b) => a + b, 0);
        }
      }
      if (value === null) known = false;
      if (known) total += value;
      out.push({ marks, total: known ? total : null });
    }
    let best = 0;
    for (const o of out) if (o.total !== null) best = o.total;
    return { frames: out, total: best };
  }

  // ---------- Turn / match bookkeeping ----------
  class Match {
    constructor() { this.players = []; this.reset(); }
    reset() {
      this.cur = 0; this.frame = 0; this.over = false; this.started = false;
      for (const p of this.players) { p.frames = []; p.streak = 0; }
    }
    addPlayer(name, color) {
      const p = { name, color, frames: [], streak: 0, startX: 0, aim: 0 };
      this.players.push(p);
      return this.players.length - 1;
    }
    current() { return this.players[this.cur]; }
    ballInFrame() { const fr = this.current().frames[this.frame]; return fr ? fr.length : 0; }

    // Record a roll. Returns { message, resetPins, endTurn }.
    record(knocked, gutter) {
      this.started = true;
      const p = this.current();
      const fr = p.frames[this.frame] || (p.frames[this.frame] = []);
      fr.push(knocked);
      const n = fr.length;
      let msg = gutter ? 'GUTTER BALL' : (knocked === 0 ? 'MISS' : knocked + (knocked === 1 ? ' PIN' : ' PINS'));
      let reset = false, end = false, kind = 'count';
      const strikeMsg = () => {
        p.streak++;
        kind = 'strike';
        msg = p.streak >= 3 ? (p.streak === 3 ? 'TURKEY!' : p.streak + ' IN A ROW!') : (p.streak === 2 ? 'DOUBLE!' : 'STRIKE!');
      };
      const spareMsg = () => { p.streak = 0; kind = 'spare'; msg = 'SPARE!'; };

      if (this.frame < 9) {
        if (n === 1 && knocked === 10) { strikeMsg(); end = true; }
        else if (n === 1) { if (knocked < 10) p.streak = 0; }
        else { if (fr[0] + fr[1] === 10) spareMsg(); else p.streak = 0; end = true; }
      } else {
        if (n === 1) { if (knocked === 10) { strikeMsg(); reset = true; } else p.streak = 0; }
        else if (n === 2) {
          if (fr[0] === 10) { if (knocked === 10) { strikeMsg(); reset = true; } else p.streak = 0; }
          else if (fr[0] + knocked === 10) { spareMsg(); reset = true; }
          else end = true;
        } else {
          const prevFresh = (fr[0] === 10 && fr[1] === 10) || (fr[0] !== 10 && fr[0] + fr[1] === 10);
          if (knocked === 10 && prevFresh) strikeMsg();
          else if (fr[0] === 10 && fr[1] !== 10 && fr[1] + knocked === 10) spareMsg();
          end = true;
        }
      }
      if (end) {
        reset = true;
        this.cur++;
        if (this.cur >= this.players.length) {
          this.cur = 0; this.frame++;
          if (this.frame >= 10) this.over = true;
        }
      }
      return { message: msg, kind, resetPins: reset, endTurn: end };
    }
  }

  const api = { C, SPOTS, Lane, Match, scoreCard, frameMarks, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SB = Object.assign(root.SB || {}, api);
})(typeof self !== 'undefined' ? self : this);
