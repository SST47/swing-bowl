/*
 * Swing Golf — course, ball physics and scoring (no DOM, testable in Node).
 * World units: metres. x = east, y = north, z = up. Each hole's tee is near
 * (0, 0) and play goes roughly north.
 */
(function (root) {
  'use strict';

  const D2R = Math.PI / 180;
  const G = 9.81;
  const CUP_R = 0.054;
  const BALL_R = 0.0214;

  // ---------------- course ----------------
  const HOLES = [
    {
      name: 'The Opener', par: 4,
      tee: { x: 0, y: 0 }, pin: { x: 15, y: 325 },
      fairway: [{ x: 0, y: 8, w: 30 }, { x: 5, y: 150, w: 36 }, { x: 12, y: 250, w: 34 }, { x: 15, y: 308, w: 26 }],
      green: { x: 15, y: 325, r: 14, slope: { x: -0.10, y: 0.05 } },
      bunkers: [{ x: -22, y: 235, rx: 9, ry: 6, rot: 20 }, { x: 34, y: 212, rx: 8, ry: 5, rot: -15 }, { x: -2, y: 330, rx: 6, ry: 4, rot: 70 }, { x: 31, y: 318, rx: 4, ry: 6, rot: 0 }],
      water: [],
      trees: treeLine(-62, 20, 320, 22, 1).concat(treeLine(78, 20, 320, 22, 2)),
      bounds: { x0: -75, x1: 90, y0: -25, y1: 365 },
    },
    {
      name: 'Over the Pond', par: 3,
      tee: { x: 0, y: 0 }, pin: { x: -8, y: 145 },
      fairway: [{ x: -2, y: 112, w: 20 }, { x: -7, y: 128, w: 22 }],
      green: { x: -8, y: 145, r: 13, slope: { x: 0.14, y: -0.08 } },
      bunkers: [{ x: 9, y: 153, rx: 6, ry: 4, rot: -30 }, { x: -24, y: 140, rx: 4.5, ry: 7, rot: 10 }],
      water: [{ x: -4, y: 72, rx: 32, ry: 30, rot: 10 }],
      trees: treeLine(-48, 0, 175, 25, 3).concat(treeLine(46, 0, 175, 25, 4)),
      bounds: { x0: -60, x1: 60, y0: -25, y1: 185 },
    },
    {
      name: 'Lakeside Dogleg', par: 4,
      tee: { x: 0, y: 0 }, pin: { x: -40, y: 370 },
      fairway: [{ x: 0, y: 8, w: 32 }, { x: 4, y: 175, w: 36 }, { x: -14, y: 268, w: 30 }, { x: -36, y: 350, w: 26 }],
      green: { x: -40, y: 370, r: 15, slope: { x: 0.08, y: 0.10 } },
      bunkers: [{ x: -26, y: 190, rx: 8, ry: 6, rot: 30 }, { x: -20, y: 356, rx: 5, ry: 4, rot: -40 }, { x: -57, y: 364, rx: 4, ry: 6, rot: 0 }],
      water: [{ x: 46, y: 232, rx: 19, ry: 62, rot: -8 }],
      trees: treeLine(-95, 30, 380, 26, 5).concat(treeLine(78, 20, 140, 24, 6)).concat(treeLine(10, 330, 400, 18, 7)),
      bounds: { x0: -110, x1: 90, y0: -25, y1: 410 },
    },
  ];

  function treeLine(x, y0, y1, step, seed) {
    const out = [];
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let y = y0; y <= y1; y += step) out.push({ x: x + (rnd() - 0.5) * 14, y: y + (rnd() - 0.5) * 8, r: 4 + rnd() * 3.5 });
    return out;
  }

  // ---------------- surfaces ----------------
  const SURF = {
    tee:     { e: 0.32, keep: 0.62, roll: 1.2 },
    fairway: { e: 0.32, keep: 0.62, roll: 1.2 },
    fringe:  { e: 0.28, keep: 0.55, roll: 1.6 },
    green:   { e: 0.22, keep: 0.55, roll: 0.62 },
    rough:   { e: 0.18, keep: 0.38, roll: 3.4 },
    sand:    { e: 0.04, keep: 0.12, roll: 9 },
  };

  function inEllipse(p, el) {
    const c = Math.cos(-el.rot * D2R), s = Math.sin(-el.rot * D2R);
    const dx = p.x - el.x, dy = p.y - el.y;
    const u = dx * c - dy * s, v = dx * s + dy * c;
    return (u * u) / (el.rx * el.rx) + (v * v) / (el.ry * el.ry) <= 1;
  }

  function nearFairway(p, fw) {
    for (let i = 0; i < fw.length - 1; i++) {
      const a = fw[i], b = fw[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)));
      const qx = a.x + abx * t, qy = a.y + aby * t;
      const w = a.w + (b.w - a.w) * t;
      if (Math.hypot(p.x - qx, p.y - qy) <= w / 2) return true;
    }
    return false;
  }

  function surfaceAt(hole, p) {
    const b = hole.bounds;
    if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) return 'oob';
    for (const w of hole.water) if (inEllipse(p, w)) return 'water';
    for (const s of hole.bunkers) if (inEllipse(p, s)) return 'sand';
    const dg = Math.hypot(p.x - hole.green.x, p.y - hole.green.y);
    if (dg <= hole.green.r) return 'green';
    if (dg <= hole.green.r + 2.5) return 'fringe';
    if (Math.abs(p.x - hole.tee.x) < 6 && Math.abs(p.y - hole.tee.y) < 4) return 'tee';
    if (nearFairway(p, hole.fairway)) return 'fairway';
    return 'rough';
  }

  // ---------------- clubs ----------------
  // target: full-power total distance (carry + roll) on flat fairway, no wind.
  const CLUBS = [
    { id: 'D',  name: 'Driver',     target: 235, loft: 11, lift: 0.0026 },
    { id: '3W', name: '3 Wood',     target: 210, loft: 14, lift: 0.0028 },
    { id: '5I', name: '5 Iron',     target: 170, loft: 20, lift: 0.0030 },
    { id: '7I', name: '7 Iron',     target: 145, loft: 27, lift: 0.0031 },
    { id: '9I', name: '9 Iron',     target: 120, loft: 36, lift: 0.0031 },
    { id: 'PW', name: 'Wedge',      target: 95,  loft: 44, lift: 0.0030 },
    { id: 'SW', name: 'Sand Wedge', target: 65,  loft: 55, lift: 0.0026 },
    { id: 'P',  name: 'Putter',     target: 30,  loft: 0,  lift: 0, putter: true },
  ];
  const DRAG = 0.0042;  // per metre, i.e. a = DRAG * |v| * v

  // lie penalties: how much of the swing makes it to the ball
  const LIE = { tee: 1, fairway: 1, fringe: 0.97, green: 1, rough: 0.82, sand: 0.6 };

  function speedFor(club, power) {
    const p = Math.max(0.03, Math.min(1, power));
    if (club.putter) return 0.35 + Math.pow(p, 1.1) * 7.2;
    return club.vmax * Math.pow(p, 0.75);
  }

  /*
   * Simulate one shot. Returns { path: [{x,y,z}], end: {x,y}, result, carry, total, maxZ }
   * result: 'stop' | 'holed' | 'water' | 'oob'
   * opts: { hole, from:{x,y}, heading (rad, CCW from +x), club, power, side (-1..1, + curves left), wind:{x,y}, lie }
   */
  function simulate(opts) {
    const { hole, from, club } = opts;
    const lie = opts.lie || 'fairway';
    const v0 = speedFor(club, opts.power) * (club.putter ? 1 : (LIE[lie] ?? 1));
    const loft = (club.putter ? 0 : club.loft + (lie === 'sand' ? 6 : 0)) * D2R;
    const hx = Math.cos(opts.heading), hy = Math.sin(opts.heading);
    let x = from.x, y = from.y, z = club.putter ? 0 : 0.02;
    let vx = hx * v0 * Math.cos(loft), vy = hy * v0 * Math.cos(loft), vz = v0 * Math.sin(loft);
    const side = Math.max(-1, Math.min(1, opts.side || 0));
    const wind = opts.wind || { x: 0, y: 0 };
    const dt = 1 / 240;
    const path = [{ x, y, z }];
    let t = 0, flying = vz > 0, landed = club.putter, carry = 0, maxZ = 0, spinLife = 1;
    // A ball lying under a tree is played out from under its branches, so that tree can't block
    // this shot (it used to stop every swing dead: 0 m, whatever you did).
    const under = new Set(hole.trees.filter(tr => Math.hypot(from.x - tr.x, from.y - tr.y) < tr.r + 0.5));
    let treeHit = false;
    let result = 'stop';
    for (let step = 0; step < 240 * 40; step++) {
      t += dt;
      if (flying) {
        const ax0 = vx - wind.x, ay0 = vy - wind.y;
        const sp = Math.hypot(ax0, ay0, vz) || 1e-6;
        const vh = Math.hypot(vx, vy) || 1e-6;
        spinLife *= Math.exp(-dt / 7);
        // drag, lift (perpendicular to velocity, vertical plane), sidespin curve
        let ax = -DRAG * sp * ax0, ay = -DRAG * sp * ay0, az = -DRAG * sp * vz - G;
        const L = club.lift * spinLife * sp;
        ax += L * (-vz) * (vx / vh); ay += L * (-vz) * (vy / vh); az += L * vh;
        const C = side * 0.0017 * spinLife * sp * vh;
        ax += C * (-vy / vh); ay += C * (vx / vh);
        vx += ax * dt; vy += ay * dt; vz += az * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        maxZ = Math.max(maxZ, z);
        // trees
        for (const tr of hole.trees) {
          if (under.has(tr)) continue;
          // the canopy starts about 2.2 m up; below that only the trunk is in the way
          const d = Math.hypot(x - tr.x, y - tr.y);
          if (z < tr.r * 1.9 + 3 && (d < 0.4 || (d < tr.r && z > 2.2))) {
            vx *= -0.15; vy *= -0.15; vz = Math.min(vz, 0) * 0.3;
            x += vx * dt * 4; y += vy * dt * 4;
            treeHit = true;
            break;
          }
        }
        if (z <= 0) {
          z = 0;
          const s = surfaceAt(hole, { x, y });
          let first = false;
          if (!landed) { landed = true; first = true; carry = Math.hypot(x - from.x, y - from.y); }
          if (s === 'water' || s === 'oob') { result = s; break; }
          const sf = SURF[s];
          // drops straight in?
          if (s === 'green' && Math.hypot(x - hole.pin.x, y - hole.pin.y) < CUP_R && Math.hypot(vx, vy) < 3) { result = 'holed'; x = hole.pin.x; y = hole.pin.y; break; }
          vz = -vz * sf.e;
          vx *= sf.keep; vy *= sf.keep;
          if (first) { const check = Math.max(0.35, Math.min(1, 1 - (club.loft - 15) / 60)); vx *= check; vy *= check; }   // lofted clubs bite
          if (vz < 0.9) { vz = 0; flying = false; }
        }
      } else {
        // rolling
        const s = surfaceAt(hole, { x, y });
        if (s === 'water' || s === 'oob') { result = s; break; }
        const sf = SURF[s];
        let sp = Math.hypot(vx, vy);
        let ax = 0, ay = 0;
        if (s === 'green' || s === 'fringe') { ax += hole.green.slope.x; ay += hole.green.slope.y; }
        if (sp > 1e-6) { ax -= sf.roll * vx / sp; ay -= sf.roll * vy / sp; }
        const nvx = vx + ax * dt, nvy = vy + ay * dt;
        // friction can't reverse the ball: if it would, it has stopped (unless the slope is steeper than friction)
        if (sp > 1e-6 && nvx * vx + nvy * vy <= 0 && Math.hypot(hole.green.slope.x, hole.green.slope.y) < sf.roll) { vx = vy = 0; }
        else { vx = nvx; vy = nvy; }
        x += vx * dt; y += vy * dt;
        sp = Math.hypot(vx, vy);
        const dc = Math.hypot(x - hole.pin.x, y - hole.pin.y);
        if (s === 'green' && dc < CUP_R + BALL_R * 0.5) {
          if (sp < 1.25) { result = 'holed'; x = hole.pin.x; y = hole.pin.y; break; }
          // lip: a fast ball gets knocked off line a little
          const k = 0.25 * (1 - dc / (CUP_R + BALL_R));
          const nx = (x - hole.pin.x) / (dc || 1), ny = (y - hole.pin.y) / (dc || 1);
          vx += nx * k * sp; vy += ny * k * sp;
        }
        if (sp < 0.02) break;
      }
      if (step % 4 === 0) path.push({ x, y, z });
    }
    path.push({ x, y, z: 0 });
    if (!carry) carry = Math.hypot(x - from.x, y - from.y);
    return { path, end: { x, y }, result, carry, total: Math.hypot(x - from.x, y - from.y), maxZ, time: t, treeHit };
  }

  // Tune each club's full-power ball speed so it reaches its target distance.
  (function calibrate() {
    const flat = { trees: [], water: [], bunkers: [], fairway: [{ x: 0, y: -50, w: 400 }, { x: 0, y: 2000, w: 400 }], green: { x: 0, y: -9999, r: 1, slope: { x: 0, y: 0 } }, tee: { x: 0, y: -9999 }, pin: { x: 0, y: -9999 }, bounds: { x0: -1e4, x1: 1e4, y0: -1e4, y1: 1e4 } };
    for (const c of CLUBS) {
      if (c.putter) continue;
      let lo = 5, hi = 120;
      for (let i = 0; i < 30; i++) {
        c.vmax = (lo + hi) / 2;
        const r = simulate({ hole: flat, from: { x: 0, y: 0 }, heading: Math.PI / 2, club: c, power: 1 });
        if (r.total < c.target) lo = c.vmax; else hi = c.vmax;
      }
    }
  })();

  // Best club for a distance from a given lie.
  function suggestClub(dist, lie) {
    if (lie === 'green' || (lie === 'fringe' && dist < 18)) return CLUBS.length - 1;
    for (let i = CLUBS.length - 2; i >= 0; i--) if (CLUBS[i].target * (LIE[lie] ?? 1) >= dist * 0.96) return i;
    return 0;
  }

  function scoreName(strokes, par) {
    if (strokes === 1) return 'HOLE IN ONE!';
    const d = strokes - par;
    return ({ '-3': 'ALBATROSS!', '-2': 'EAGLE!', '-1': 'BIRDIE!', '0': 'PAR', '1': 'BOGEY', '2': 'DOUBLE BOGEY', '3': 'TRIPLE BOGEY' })[d] || `+${d}`;
  }

  /*
   * Where to aim from `ball` with `club`: straight at the pin, unless trees block that line. Then
   * the aim swings out, a few degrees at a time either side, to the nearest line a full swing
   * gets through cleanly (punching out of the trees, as a golfer would).
   */
  function clearAim(hole, ball, club) {
    const direct = Math.atan2(hole.pin.y - ball.y, hole.pin.x - ball.x);
    if (club.putter || !hole.trees.length) return direct;
    const lie = surfaceAt(hole, ball);
    const clear = a => { const r = simulate({ hole, from: ball, heading: a, club, power: 1, lie }); return !r.treeHit && r.result !== 'water' && r.result !== 'oob'; };
    if (clear(direct)) return direct;
    for (let d = 5; d <= 85; d += 5) for (const s of [1, -1]) { const a = direct + s * d * D2R; if (clear(a)) return a; }
    return direct;
  }

  const api = { HOLES, CLUBS, SURF, surfaceAt, simulate, suggestClub, scoreName, CUP_R, speedFor, clearAim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GOLF = api;
})(typeof self !== 'undefined' ? self : this);
