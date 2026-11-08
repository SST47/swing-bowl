/* Swing Baseball — Home Run Derby: game flow, timing judge and HUD. Drawing is done by a view (the 3D ballpark). */
(function (root) {
  'use strict';
  const B = root.BASEBALL;
  const { makePitch, pitchPos, contact, flight } = B;
  const COLORS = ['#3fa9f5', '#ff5a5f', '#ffd23f', '#3ddc97', '#c77dff', '#ff9f1c'];
  const SWINGS = 10;
  const WINDUP = 1.15;         // s from the pitcher's first move to release
  const GRACE = 1.2;           // s after the ball crosses the plate that we still wait for a (delayed) swing message
  const EARLY_CALL = 0.7;      // s after the plate to call an early swing a miss, if no better swing came in
  const BIAS_MAX = 0.25;       // s of systematic lag (TV delay, clock-sync skew, late swingers) we learn and take out
  const HIT_SPEED = 1.15;      // replay speed of a batted ball
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => performance.now() / 1000;

  class BaseballGame {
    /* opts: { hud, sfx, onUpdate, view } — view: { render(game, dt, nowSeconds) } */
    constructor({ hud, sfx, onUpdate, view }) {
      this.view = view || null;
      this.sfx = sfx; this.onUpdate = onUpdate || (() => {});
      this.players = []; this.cur = 0; this.over = false; this.started = false;
      this.state = 'wait'; this.timer = 2.5; this.idle = 0;
      this.pitch = null; this.hit = null; this.armed = false; this.lefty = false;
      this.swingAt = -10;       // peak of the batter's last swing (s): the bat meets the ball here
      this.windupStart = 0;     // when the pitcher started the windup (s)
      this.lastBall = null;     // where the last batted ball ended up
      this.lastOutcome = null;  // { type, at, dist }
      this.bias = 0;            // learned average lateness of swings in this room (s)
      this.note = null;         // { text, at } what happened to the last swing, shown on the batter's phone
      this.WINDUP = WINDUP;
      this._buildHud(hud);
      this.last = performance.now();
      requestAnimationFrame(t => this._tick(t));
    }

    // ---------- players ----------
    canJoinNow() { return !this.started && this.players.length < 6; }
    addPlayer(name) {
      if (this.players.length >= 6) return -1;
      const i = this.players.length;
      this.players.push({ name: name || 'Player ' + (i + 1), color: COLORS[i % COLORS.length], swings: 0, hrs: 0, longest: 0 });
      this._renderBoard(); this._emit();
      return i;
    }
    renamePlayer(i, n) { if (this.players[i] && n) { this.players[i].name = String(n).slice(0, 14); this._renderBoard(); this._emit(); } }

    // Kick a player, even mid-derby. If they were batting, the next batter steps in.
    removePlayer(i) {
      if (!this.players[i]) return;
      const wasCur = i === this.cur;
      this.players.splice(i, 1);
      if (!this.players.length) { this.cur = 0; this.newGame(); return; }
      if (i < this.cur) this.cur--;
      else if (wasCur && !this.over) {
        this.pitch = null; this.hit = null; this.armed = false; this.lastBall = null;
        if (this.cur >= this.players.length) {
          this.cur = this.players.length - 1;
          this._finishDerby();
        } else {
          this.state = 'wait'; this.timer = 2.2; this.idle = 0;
          this._flash(`NOW BATTING: ${this.players[this.cur].name.toUpperCase()}`, 'info');
        }
      }
      this._renderBoard(); this._renderTop(); this._emit();
    }

    newGame() {
      for (const p of this.players) { p.swings = 0; p.hrs = 0; p.longest = 0; }
      this.cur = 0; this.over = false; this.started = false; this.state = 'wait'; this.timer = 2; this.pitch = null; this.hit = null; this.lastBall = null;
      this._flash('PLAY BALL!', 'info'); this._renderBoard(); this._emit();
    }

    info() {
      const p = this.players[this.cur];
      return {
        state: this.state, over: this.over, started: this.started, cur: this.cur,
        players: this.players.map(q => ({ name: q.name, color: q.color, hrs: q.hrs, longest: Math.round(q.longest) })),
        swingsLeft: p ? SWINGS - p.swings : SWINGS, hrs: p ? p.hrs : 0,
        pitching: this.state === 'windup' || this.state === 'pitch',
        note: this.note,
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

    _note(text) { this.note = { text, at: Date.now() }; this._emit(); }

    _swing(at, power) {
      const tNow = now(), pt = this.pitch;
      // When the swing actually peaked, on this clock. The view times the bat's contact pose to it, so
      // the swing on screen lines up with the ball even though the message arrives a little later.
      this.swingAt = Math.max(tNow - 0.25, Math.min(tNow, at));
      if (this.sfx) this.sfx.unlock();
      if (this.state !== 'pitch' || !pt || pt.judged) {
        if (this.state === 'wait' || this.state === 'windup') { this._flash('WAIT FOR THE PITCH', 'info'); this._note('Too early: wait for the pitch'); }
        return;
      }
      if (at < pt.releaseT) { this._flash('TOO EARLY · WAIT FOR THE PITCH', 'info'); this._note('Too early: the pitch wasn’t thrown yet'); return; }
      const raw = at - pt.plateT, dt = raw - this._lag();
      // Way early (a practice swing, or winding up)? Don't spend the pitch on it yet: a better-timed
      // swing can still come. If none does, it's called a miss shortly after the ball goes by.
      if (dt < -B.FOUL_WINDOW) { if (!pt.early || raw > pt.early.raw) pt.early = { raw, power, at }; return; }
      this._judge(raw, power, at);
    }

    // The room's systematic lateness (TV picture delay, clock-sync skew, how this group swings),
    // learned from recent swings and taken out so a swing that looks on time on screen is on time.
    _lag() { return Math.max(-BIAS_MAX, Math.min(BIAS_MAX, this.bias)); }

    _judge(raw, power, at) {
      const pt = this.pitch, p = this.players[this.cur], tNow = now();
      const dt = raw - this._lag();
      pt.judged = true;
      this.started = true;
      p.swings++;
      if (Math.abs(dt) < 0.45) this.bias = this.bias * 0.7 + raw * 0.3;   // learn only from swings somewhere near the ball
      const c = contact(dt, power, pt.p, this.lefty);
      this.lastTiming = dt;
      const ms = Math.round(dt * 1000), how = Math.abs(ms) < 40 ? 'perfect timing' : ms < 0 ? `early by ${-ms} ms` : `late by ${ms} ms`;
      if (c.kind === 'miss') {
        this._note(`Missed: ${how}`);
        this._result(dt < 0 ? 'SWING AND A MISS · EARLY' : 'SWING AND A MISS · LATE', 'info', 1.3);
        return;
      }
      this._note(`${c.kind === 'foul' ? 'Foul' : 'Hit'}: ${how}`);
      const u = Math.max(0.85, Math.min(1.05, (at - pt.releaseT) / pt.p.dur));
      const start = pitchPos(pt.p, u);
      const f = flight(start, c.ev, c.la, c.spray);
      this.hit = { f, i: (tNow - this.swingAt) * 60 * HIT_SPEED, c, dt, at: tNow };   // the ball left the bat at the swing's peak
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
      let msg, kind = 'info', secs = 1.8;
      if (f.outcome === 'hr') {
        p.hrs++; p.longest = Math.max(p.longest, f.dist);
        msg = `HOME RUN! ${d} M`; kind = 'strike'; secs = 3.2;
        if (this.sfx) this.sfx.fanfare('strike');
      } else if (f.outcome === 'wall') msg = `OFF THE WALL · ${d} M`;
      else if (f.outcome === 'foul' || c.kind === 'foul') msg = 'FOUL BALL';
      else if (f.outcome === 'ground') msg = `GROUNDER · ${timing}`;
      else msg = `FLY OUT · ${d} M`;
      this.lastBall = f.path[f.path.length - 1];
      this.lastOutcome = { type: f.outcome, at: now(), dist: f.dist };
      this.hit = null;
      this._result(msg, kind, secs);
    }

    _finishDerby() {
      this.over = true; this.state = 'over';
      const r = [...this.players].sort((a, b) => b.hrs - a.hrs || b.longest - a.longest);
      this._flash(r.length > 1 ? `${r[0].name} WINS · ${r[0].hrs} HR` : `DERBY OVER · ${r[0].hrs} HR`, 'over', true);
    }

    _nextBatterOrPitch() {
      const p = this.players[this.cur];
      this.lastBall = null;
      if (p && p.swings >= SWINGS) {
        if (this.cur + 1 < this.players.length) {
          this.cur++;
          this._flash(`NOW BATTING: ${this.players[this.cur].name.toUpperCase()}`, 'info');
          this.state = 'wait'; this.timer = 2.6; this.armed = false;
        } else this._finishDerby();
      } else { this.state = 'wait'; this.timer = 1.3; }
      this.idle = 0;
      this._renderBoard(); this._renderTop(); this._emit();
    }

    // Where the ball is right now (engine coords), or null.
    ballNow(t = now()) {
      if (this.hit) { const path = this.hit.f.path; return path[Math.min(path.length - 1, Math.floor(this.hit.i))]; }
      if (this.pitch && (this.state === 'pitch' || (this.state === 'result' && !this.lastBall))) {
        const u = (t - this.pitch.releaseT) / this.pitch.p.dur;
        if (u >= 0 && u <= 1.3) return pitchPos(this.pitch.p, u);
      }
      return null;
    }

    // ---------- loop ----------
    _tick(ms) {
      requestAnimationFrame(x => this._tick(x));   // next frame first, so one bad frame can't stop the game
      const dt = Math.min(0.05, (ms - this.last) / 1000); this.last = ms;
      const t = now();
      if (this.players.length && !this.over) {
        if (this.state === 'wait') {
          this.timer -= dt; this.idle += dt;
          if (this.timer <= 0 && (this.armed || this.idle > 3.2)) { this.state = 'windup'; this.timer = WINDUP; this.windupStart = t; this._emit(); }
        } else if (this.state === 'windup') {
          this.timer -= dt;
          if (this.timer <= 0) {
            const p = makePitch();
            this.pitch = { p, releaseT: t, plateT: t + p.dur, judged: false };
            this.state = 'pitch';
            this._renderTop(); this._emit();
          }
        } else if (this.state === 'pitch') {
          // Call the pitch only on the second frame past the grace period, so a swing message
          // that queued up behind a slow frame still gets processed first.
          const pt = this.pitch;
          if (!pt.judged && pt.early && t > pt.plateT + EARLY_CALL) this._judge(pt.early.raw, pt.early.power, pt.early.at);
          else if (!pt.judged && t > pt.plateT + GRACE) {
            if (this.pitch.expiring) {
              this.pitch.judged = true;
              this._note('No swing reached the screen for that pitch');
              this._result(this.pitch.p.inZone ? 'STRIKE' : 'BALL', 'info', 0.9);
            } else this.pitch.expiring = true;
          }
        } else if (this.state === 'hit' && this.hit) {
          this.hit.i += dt * 60 * HIT_SPEED;   // path points are 60 per simulated second
          if (this.hit.i >= this.hit.f.path.length - 1) { this.hit.i = this.hit.f.path.length - 1; this._finishHit(); }
        } else if (this.state === 'result') {
          this.timer -= dt;
          if (this.timer <= 0) { this.pitch = null; this._nextBatterOrPitch(); }
        }
      }
      if (this.view) this.view.render(this, dt, t);
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
      if (this.lastTiming !== undefined && this.state !== 'pitch') {
        const ms = Math.round(this.lastTiming * 1000);
        const pos = Math.max(0, Math.min(100, 50 + ms / 300 * 50));
        s += `<div class="tbar"><i style="left:${pos}%"></i></div><small>${Math.abs(ms) < 40 ? 'perfect!' : ms < 0 ? 'early ' + -ms + ' ms' : 'late ' + ms + ' ms'}</small>`;
      }
      this.el.pitch.innerHTML = s;
      this.el.turn.innerHTML = this.over ? 'Derby over' : p ? (this.state === 'wait' && !this.armed ? 'Tap READY on your phone, then swing it like a bat' : this.state === 'windup' ? 'Here comes the pitch…' : '') : '';
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
  B.SWINGS = SWINGS;
})(self);
