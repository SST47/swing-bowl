/*
 * Swing Tennis — court, ball flight, shots and scoring. No drawing here.
 *
 * Coordinates (metres, seconds): x across the court, y up, z along it. The near baseline is at
 * z = -11.885, the far one at +11.885, the net at z = 0. The near player faces +z with +x on their
 * right; the far player faces -z with -x on their right. side: -1 = near end, +1 = far end.
 */
(function (root) {
  'use strict';

  const G = 9.81;
  const COURT = { L: 11.885, W: 4.115, DW: 5.485, SERVICE: 6.40, NET_H: 0.914, POST_H: 1.07, POST_X: 6.4 };
  const BALL_R = 0.033;
  const HZ = 240;              // flight samples per second
  const HIT_Y = 0.95;          // comfortable contact height after the bounce
  const TOSS = { up: 6.2, from: 1.55, contactY: 2.55 };   // serve toss: launch speed, hand height, contact height (falling)

  const SPIN = {               // extra downward pull while flying (topspin dips, slice floats), and the bounce
    top:   { g: 3.6, e: 0.78, keep: 0.86 },
    flat:  { g: 0.8, e: 0.74, keep: 0.82 },
    slice: { g: -2.2, e: 0.62, keep: 0.88 },
    serve: { g: 1.4, e: 0.72, keep: 0.84 },
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const netHeight = x => COURT.NET_H + (COURT.POST_H - COURT.NET_H) * Math.min(1, Math.abs(x) / COURT.POST_X);
  const sideOf = z => (z < 0 ? -1 : 1);
  // in on `side`'s half; doubles rallies use the tramlines too (serves always use the service boxes)
  const inCourt = (x, z, side, doubles) => Math.abs(x) <= (doubles ? COURT.DW : COURT.W) + 0.03 && side * z >= 0 && side * z <= COURT.L + 0.03;
  // the service box diagonally across from a server on `side` standing on the deuce (or ad) half
  function serviceBox(side, deuce) {
    const s = -side;                          // the receiving end
    // the near server's deuce half is +x (their right) and it serves to -x; the far server mirrors that
    const xSign = (side === -1 ? -1 : 1) * (deuce ? 1 : -1);
    return { x0: xSign > 0 ? 0 : -COURT.W, x1: xSign > 0 ? COURT.W : 0, z0: s > 0 ? 0 : -COURT.SERVICE, z1: s > 0 ? COURT.SERVICE : 0 };
  }
  const inBox = (x, z, b) => x >= b.x0 - 0.03 && x <= b.x1 + 0.03 && z >= b.z0 - 0.03 && z <= b.z1 + 0.03;

  /*
   * Fly a ball from p (contact point) with velocity v. spin: key of SPIN.
   * Returns { pts: [{x,y,z}] at HZ, events: [{ type: 'net'|'bounce', i, x, z, side, cord }], end }
   * The flight stops after the second bounce, when the ball is long gone, or after 7 s.
   */
  function fly(p, v, spin = 'flat') {
    const S = SPIN[spin] || SPIN.flat;
    let x = p.x, y = p.y, z = p.z, vx = v.x, vy = v.y, vz = v.z, g = G + S.g;
    const dt = 1 / HZ, pts = [{ x, y, z }], events = [];
    let bounces = 0, netDone = false, stopAt = 0, rolling = false;
    for (let i = 1; i < HZ * 7; i++) {
      if (stopAt && i >= stopAt) break;
      const pz = z;
      if (rolling) {
        const sp = Math.hypot(vx, vz), k = sp > 0 ? Math.max(0, sp - 2.5 * dt) / sp : 0;
        vx *= k; vz *= k; x += vx * dt; z += vz * dt; y = BALL_R;
      } else {
        vy -= g * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
      }
      // the net
      if (!netDone && pz !== 0 && Math.sign(pz) !== Math.sign(z)) {
        netDone = true;
        const f = pz / (pz - z), yn = y - vy * dt * (1 - f), xn = x - vx * dt * (1 - f), h = netHeight(xn);
        if (yn < h + BALL_R) {
          const cord = yn > h - 0.06;      // clipped the tape
          events.push({ type: 'net', i, x: xn, z: 0, cord });
          if (cord && !rolling && Math.abs(vz) > 6 && ((i * 7919) % 10) < 4) {   // some tape hits trickle over
            vz *= 0.25; vy = Math.abs(vy) * 0.3 + 1.2; vx *= 0.4; y = h + BALL_R + 0.01;
          } else {
            z = pz > 0 ? 0.05 : -0.05; vz = -vz * 0.12; vx *= 0.3; vy = Math.min(vy, 0) * 0.4;
          }
        }
      }
      if (!rolling && y <= BALL_R && vy < 0) {
        y = BALL_R;
        const side = sideOf(z);
        events.push({ type: 'bounce', i, x, z, side });
        bounces++;
        vy = -vy * (bounces === 1 ? S.e : SPIN.flat.e); vx *= S.keep; vz *= S.keep;
        g = G;                              // spin has done its work
        // the second bounce on one side ends the point; keep the ball going a moment for the picture
        if (!stopAt && events.filter(e => e.type === 'bounce' && e.side === side).length >= 2) stopAt = i + HZ * 1.5;
        if (Math.abs(vy) < 0.6) {
          rolling = true; vy = 0;
          // a ball that stops bouncing has bounced its last: that's the second bounce for the point
          if (!stopAt) { events.push({ type: 'bounce', i, x, z, side, roll: true }); stopAt = i + HZ * 1.5; }
        }
      }
      pts.push({ x, y, z });
      if (Math.abs(z) > 24 || Math.abs(x) > 16) break;
    }
    return { pts, events, spin };
  }

  /*
   * Solve a shot from p so its first bounce lands at (tx, tz), moving at about `speed` m/s across
   * the ground, clearing the net by `clear` m. Slows the shot (a higher arc) until it clears.
   */
  function aim(p, tx, tz, speed, spin = 'flat', clear = 0.25) {
    const g = G + (SPIN[spin] || SPIN.flat).g;
    const dx = tx - p.x, dz = tz - p.z, D = Math.hypot(dx, dz);
    let T = D / Math.max(4, speed), v = null;
    for (let k = 0; k < 60; k++) {
      const vx = dx / T, vz = dz / T, vy = (BALL_R - p.y + 0.5 * g * T * T) / T;
      v = { x: vx, y: vy, z: vz };
      if (Math.sign(p.z) === Math.sign(tz)) break;   // no net to clear
      const tn = -p.z / vz, yn = p.y + vy * tn - 0.5 * g * tn * tn, xn = p.x + vx * tn;
      if (yn >= netHeight(xn) + clear) break;
      T *= 1.04;
    }
    return v;
  }

  // Where the hitter on `side` should meet this ball: after it bounces once on their side, as it
  // comes down through a comfortable height (or at the top of a low bounce). null if it never gets
  // there in play (net, out, gone).
  function hitPoint(flight, side, doubles) {
    const { pts, events } = flight;
    // into the net, or out: the point is over at the first bounce, nothing to hit
    const first = events.find(e => e.type === 'bounce');
    if (!first || first.side !== side || !inCourt(first.x, first.z, side, doubles)) return null;
    const second = events.find(e => e.type === 'bounce' && e.i > first.i);
    const end = second ? second.i : pts.length - 1;
    let apex = first.i;
    for (let i = first.i + 1; i < end; i++) if (pts[i].y > pts[apex].y) apex = i;
    let i = apex;
    if (pts[apex].y > HIT_Y) { while (i < end && pts[i].y > HIT_Y) i++; }
    // don't let a deep ball drag the player far behind the baseline: take it on the rise instead
    const deep = COURT.L + 2.2;
    if (side * pts[i].z > deep) { i = first.i; while (i < apex && side * pts[i].z < deep && pts[i].y < HIT_Y) i++; }
    return { i, t: i / HZ, p: pts[i] };
  }

  /*
   * Turn a judged swing into a shot. dt: swing time minus the ideal moment (s, + = late), power 0..1,
   * from: contact point, side: hitter's end, forehand: which stroke. pressure 0..1: how hard the
   * incoming ball was to play (its pace, a stretch to reach it): it sprays the shot and takes pace off.
   * People steer with timing (early pulls, late pushes) and a well-timed ball leans `lean` metres
   * towards the open court; the computer names its spot with aimX instead.
   * Returns { v, spin, target, quality, error } or null for a whiff (error: 'net' for a netted ball).
   */
  const WINDOW = 0.30;
  const gauss = rng => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  function stroke({ dt, power, from, side, forehand, pressure = 0, aimX = null, lean = 0, rng = Math.random }) {
    const a = Math.abs(dt);
    if (a > WINDOW) return null;
    const q = 1 - (a / WINDOW) ** 2;                         // 1 = perfect
    const to = -side;                                         // the far end from the hitter
    const right = side === -1 ? 1 : -1;                       // +x is the near player's right
    const pull = (forehand ? -1 : 1) * right;                 // early: a forehand goes to the hitter's left
    const k = clamp(-dt / 0.2, -1.5, 1.5);
    const press = clamp(pressure, 0, 1), risk = clamp((power - 0.6) / 0.4, 0, 1);
    const wild = (1 - q) * 2.2 + press + risk * 0.5;          // mistimed, stretched or over-hit shots spray
    let tx = (aimX !== null ? aimX : pull * k * 3.2 + lean * q) + gauss(rng) * (0.5 + wild * 0.7);
    const depth = 1.1 + (1 - power) * 3.6 + press * 1.2 + gauss(rng) * (0.55 + wild * 0.9);
    let tz = to * (COURT.L - depth);
    let spin = power > 0.62 ? 'top' : power < 0.25 ? 'slice' : 'flat';
    let speed = (13 + 21 * power * (0.65 + 0.35 * q)) * (1 - 0.25 * press);
    let clear = 0.25 + (1 - q) * 0.2, error = null;
    if (power < 0.18) { spin = 'slice'; speed = 9; tz = to * (COURT.L - 1.5 + gauss(rng) * 0.6); }   // a soft swing lofts a lob
    // into the net: more likely when mistimed, stretched or over-hit
    else if (rng() < 0.03 + (1 - q) * 0.3 + press * 0.1 + risk * 0.03) { tz = to * (0.8 + rng() * 2.5); clear = -(0.12 + rng() * 0.35); error = 'net'; }
    const v = aim(from, tx, tz, speed, spin, clear);
    return { v, spin, target: { x: tx, z: tz }, quality: q, error };
  }

  // Serve from contact point `from` by the server on `side`, on the deuce or ad half. A first serve
  // goes for the lines (out wide or down the T) and can miss; a second serve plays it safe.
  function serve({ dt, power, from, side, deuce, second = false, rng = Math.random }) {
    const a = Math.abs(dt);
    if (a > WINDOW) return null;
    const q = 1 - (a / WINDOW) ** 2;
    const box = serviceBox(side, deuce);
    const xs = box.x0 + box.x1 > 0 ? 1 : -1, zs = box.z0 + box.z1 > 0 ? 1 : -1;
    const wild = (1 - q) * 1.6 + (second ? 0 : clamp(power - 0.55, 0, 1) * 0.9);
    const line = second ? COURT.W * 0.45 : rng() < 0.5 ? 0.55 : COURT.W - 0.6;   // from the centre line
    // late pushes it wider, early drags it in towards the T
    const tx = xs * (line + clamp(dt / 0.2, -1, 1) * 0.9) + gauss(rng) * ((second ? 0.3 : 0.42) + wild * 0.5);
    let tz = zs * (COURT.SERVICE - (second ? 1.6 : 0.85) + gauss(rng) * ((second ? 0.32 : 0.45) + wild * 0.5));
    const speed = second ? 22 + 10 * power * (0.6 + 0.4 * q) : 26 + 20 * power * (0.6 + 0.4 * q);
    let clear = second ? 0.35 : 0.12, error = null;
    if (rng() < (second ? 0.02 : 0.05) + (1 - q) * (second ? 0.15 : 0.3)) { tz = zs * (0.8 + rng() * 2.5); clear = -(0.1 + rng() * 0.3); error = 'net'; }
    const spin = second ? 'top' : 'serve';
    const v = aim(from, tx, tz, speed, spin, clear);
    return { v, spin, target: { x: tx, z: tz }, quality: q, box, error };
  }

  // The serve toss: where the ball is t seconds after it leaves the hand.
  function tossAt(hand, t) { return { x: hand.x, y: hand.y + TOSS.up * t - 0.5 * G * t * t, z: hand.z }; }
  // when the falling toss passes the contact height
  function tossContactT(hand) { const a = 0.5 * G, b = -TOSS.up, c = TOSS.contactY - hand.y; return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); }

  // ---------------- scoring ----------------
  const CALLS = ['0', '15', '30', '40'];
  class Score {
    constructor(toGames = 3) { this.toGames = toGames; this.games = [0, 0]; this.points = [0, 0]; this.server = 0; this.winner = null; this.pointsPlayed = 0; }
    // award a point to player 0 or 1; returns what happened: 'point' | 'game' | 'match'
    point(w) {
      if (this.winner !== null) return 'match';
      const l = 1 - w;
      this.points[w]++; this.pointsPlayed++;
      if (this.points[w] >= 4 && this.points[w] - this.points[l] >= 2) {
        this.games[w]++; this.points = [0, 0]; this.pointsPlayed = 0; this.server = 1 - this.server;
        if (this.games[w] >= this.toGames) { this.winner = w; return 'match'; }
        return 'game';
      }
      return 'point';
    }
    get deuceSide() { return this.pointsPlayed % 2 === 0; }
    // "30–15", "Deuce", "Advantage", from the server's side first
    call() {
      const [a, b] = this.points;
      if (a >= 3 && b >= 3) return a === b ? { text: 'Deuce' } : { text: 'Advantage', to: a > b ? 0 : 1 };
      return { text: `${CALLS[Math.min(3, a)]}–${CALLS[Math.min(3, b)]}` };
    }
    label(i) { const [a, b] = this.points, me = this.points[i], other = this.points[1 - i]; if (a >= 3 && b >= 3) return me > other ? 'AD' : '40'; return CALLS[Math.min(3, me)]; }
    // the next point decides a game / the match for player i
    gamePointFor(i) { const me = this.points[i], o = this.points[1 - i]; return me >= 3 && me > o; }
    matchPointFor(i) { return this.gamePointFor(i) && this.games[i] === this.toGames - 1; }
  }

  const api = { G, COURT, BALL_R, HZ, HIT_Y, TOSS, SPIN, WINDOW, netHeight, sideOf, inCourt, serviceBox, inBox, fly, aim, hitPoint, stroke, serve, tossAt, tossContactT, Score };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TENNIS = api;
})(typeof self !== 'undefined' ? self : this);
