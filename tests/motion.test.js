// Synthesizes arm swings as orientation events and checks the swing-direction estimate.
const M = require('../js/motion.js');
const assert = require('assert');
const D = Math.PI / 180;
const mul = (A, B) => A.map((r, i) => [0, 1, 2].map(j => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));
function axisAngle(u, th) { // Rodrigues
  const [x, y, z] = u, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
function toEuler(R) { // inverse of Rz(a)Rx(b)Ry(c), degrees
  const b = Math.asin(Math.max(-1, Math.min(1, R[2][1])));
  return { alpha: Math.atan2(-R[0][1], R[1][1]) / D, beta: b / D, gamma: Math.atan2(-R[2][0], R[2][2]) / D };
}
// simulate: facing `heading` deg; backswing straight; forward swing pulled by `pull` deg (CCW +); optional wrist twist at release
function simulate({ heading = 0, pull = 0, twist = 0, grip = 0 }) {
  const hz = 60, dt = 1 / hz;
  const zAxis = [0, 0, 1];
  const rot = (v, deg) => { const R = axisAngle(zAxis, deg * D); return [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]); };
  const xAxis = rot([1, 0, 0], heading);       // forward-swing axis when facing `heading`
  // phone hanging down in the hand: device y points to the ground, rotated by heading and some grip roll
  let R = mul(axisAngle(zAxis, heading * D), mul(axisAngle([1, 0, 0], -90 * D), axisAngle([0, 1, 0], grip * D)));
  const ev = []; let t = 0;
  const push = () => { ev.push({ t: t * 1000, ...toEuler(R) }); };
  push();
  const phase = (axis, totalDeg, secs, twistDeg = 0) => {
    const n = Math.round(secs * hz);
    for (let i = 0; i < n; i++) {
      const w = Math.sin(Math.PI * (i + 0.5) / n) * Math.PI / 2; // bell-shaped speed
      R = mul(axisAngle(axis, totalDeg * D * w / n * 2 / Math.PI * Math.PI / 2), R);
      if (twistDeg) { const dy = [R[0][1], R[1][1], R[2][1]]; R = mul(axisAngle(dy, twistDeg * D / n), R); }
      t += dt; push();
    }
  };
  phase(xAxis, -55, 0.45);                       // backswing
  phase(xAxis, 0.0001, 0.08);                    // apex pause
  phase(rot(xAxis, pull), 85, 0.35, twist);      // forward swing (+ twist)
  return ev;
}
function run(cfg) {
  const ev = simulate(cfg);
  let P = null, pt = 0; const s = [];
  for (const e of ev) {
    const R = M.orientationMatrix(e.alpha, e.beta, e.gamma);
    if (P) s.push(M.rateSample(e.t, R, P, (e.t - pt) / 1000));
    P = R; pt = e.t;
  }
  return M.swingDirection(s, ev[ev.length - 1].t);
}
const cases = [
  { pull: 0 }, { pull: 15 }, { pull: -12 }, { pull: 25, heading: 137 }, { pull: -20, heading: -70, grip: 40 },
  { pull: 0, twist: 70 }, { pull: 10, twist: -80, heading: 200 }, { pull: -15, twist: 90, grip: -30 },
  { pull: 12, grip: 90 }, { pull: -18, grip: -90, heading: 45 },   // phone held sideways
];
for (const c of cases) {
  const r = run(c);
  console.log(JSON.stringify(c).padEnd(42), '->', r.ok ? r.deg.toFixed(1) + '°' : r.why);
  assert(r.ok, 'direction should be measurable');
  assert(Math.abs(r.deg - c.pull) < 4, `expected ~${c.pull}, got ${r.deg}`);
}
// steering map: left pull -> negative x aim; dead zone; clamps
assert.strictEqual(M.steerFromDeg(1, 'normal'), 0);
assert(M.steerFromDeg(15, 'normal') < 0 && M.steerFromDeg(-15, 'normal') > 0);
assert(M.steerFromDeg(15, 'normal', true) > 0);
assert.strictEqual(M.steerFromDeg(30, 'off'), 0);
assert(Math.abs(M.steerFromDeg(200, 'high')) <= 0.09);
console.log('motion OK');
