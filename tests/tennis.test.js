const T = require('../js/tennis-engine.js');
const assert = require('assert');
const { COURT } = T;
let seed = 7; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const firstBounce = f => f.events.find(e => e.type === 'bounce');

// a solved shot lands where it was aimed and clears the net
for (const [speed, spin] of [[30, 'top'], [20, 'flat'], [12, 'slice'], [9, 'slice']]) {
  const from = { x: 1, y: 0.95, z: -12.3 };
  const v = T.aim(from, -2, 9.5, speed, spin);
  const f = T.fly(from, v, spin), b = firstBounce(f);
  assert(!f.events.some(e => e.type === 'net'), `${spin} ${speed} m/s hit the net`);
  assert(Math.hypot(b.x + 2, b.z - 9.5) < 0.1, `${spin} landed at ${b.x.toFixed(2)},${b.z.toFixed(2)}`);
}
console.log('aimed shots land on target and clear the net: ok');

// the receiver meets the ball after one bounce at a comfortable height
{
  const from = { x: 0, y: 0.95, z: -12 };
  const f = T.fly(from, T.aim(from, 2, 9, 26, 'top'), 'top');
  const h = T.hitPoint(f, 1);
  assert(h && h.p.y > 0.4 && h.p.y < 1.3 && h.p.z > 9 && h.p.z < COURT.L + 2.5, JSON.stringify(h && h.p));
  console.log('hit point after the bounce:', h.p.x.toFixed(2), h.p.y.toFixed(2), h.p.z.toFixed(2), 'at', h.t.toFixed(2), 's: ok');
  // a ball that goes out gives nothing to hit
  const out = T.fly(from, T.aim(from, 0, 13.5, 26, 'flat'), 'flat');
  assert.strictEqual(T.hitPoint(out, 1), null);
}

// strokes: good timing stays in, bad timing sprays, way off is a whiff; timing steers
{
  const from = { x: 0, y: 0.95, z: -12 };
  const rate = (dt, n = 300) => { let ins = 0; for (let k = 0; k < n; k++) { const s = T.stroke({ dt, power: 0.7, from, side: -1, forehand: true, rng }); const b = firstBounce(T.fly(from, s.v, s.spin)); if (b && b.side === 1 && T.inCourt(b.x, b.z, 1)) ins++; } return ins / n; };
  const good = rate(0), meh = rate(0.15), bad = rate(-0.27);
  console.log('in-court rate: perfect', good.toFixed(2), '| 150 ms late', meh.toFixed(2), '| 270 ms early', bad.toFixed(2));
  assert(good > 0.88 && meh > 0.6 && meh < good && bad < 0.5, 'in-court rates');
  // a left-hander's early forehand goes the other way
  const pullX = lefty => { let x = 0; for (let k = 0; k < 200; k++) x += T.stroke({ dt: -0.12, power: 0.6, from, side: -1, forehand: true, lefty, rng }).target.x; return x / 200; };
  const rx = pullX(false), lx = pullX(true);
  console.log('early forehand lands at x', rx.toFixed(2), '(righty)', lx.toFixed(2), '(lefty)');
  assert(rx < -1 && lx > 1, 'lefties pull the other way');
  // a hard ball or a stretch makes it harder to keep in
  const pr = p => { let ins = 0; for (let k = 0; k < 400; k++) { const s = T.stroke({ dt: 0, power: 0.7, from, side: -1, forehand: true, pressure: p, rng }); const b = firstBounce(T.fly(from, s.v, s.spin)); if (b && b.side === 1 && T.inCourt(b.x, b.z, 1)) ins++; } return ins / 400; };
  const calm = pr(0), stretched = pr(1);
  console.log('in-court rate: calm', calm.toFixed(2), '| under pressure', stretched.toFixed(2));
  assert(stretched < calm - 0.08, 'pressure sprays the shot');
  // the computer names its spot
  let ax = 0; for (let k = 0; k < 200; k++) ax += T.stroke({ dt: 0, power: 0.6, from, side: -1, forehand: true, aimX: -2.5, rng }).target.x;
  assert(Math.abs(ax / 200 + 2.5) < 0.3, 'aimX places the ball');
  // a netted ball really finds the net
  let nets = 0; for (let k = 0; k < 400 && nets < 20; k++) { const s = T.stroke({ dt: 0.2, power: 0.9, from, side: -1, forehand: true, rng }); if (s.error === 'net') { nets++; const f = T.fly(from, s.v, s.spin); assert(f.events[0] && f.events[0].type === 'net', 'net error into the net'); } }
  assert(nets >= 5, 'mistimed big swings find the net sometimes');
  assert.strictEqual(T.stroke({ dt: 0.35, power: 0.7, from, side: -1, forehand: true, rng }), null);
  const avgX = dt => { let s = 0; for (let k = 0; k < 200; k++) s += T.stroke({ dt, power: 0.7, from, side: -1, forehand: true, rng }).target.x; return s / 200; };
  assert(avgX(-0.12) < -1 && avgX(0.12) > 1, 'early forehand pulls to the left (-x) for the near player, late goes right');
  // the far player's early forehand pulls to their left, which is +x
  let s = 0; for (let k = 0; k < 200; k++) s += T.stroke({ dt: -0.12, power: 0.7, from: { x: 0, y: 0.95, z: 12 }, side: 1, forehand: true, rng }).target.x;
  assert(s / 200 > 1, 'far player pull');
  console.log('timing steers the ball, whiffs past the window: ok');
}

// serves: well timed ones land in the right box
{
  for (const [side, deuce] of [[-1, true], [-1, false], [1, true], [1, false]]) {
    const box = T.serviceBox(side, deuce);
    const from = { x: side === -1 ? (deuce ? 0.8 : -0.8) : (deuce ? -0.8 : 0.8), y: T.TOSS.contactY, z: side * (COURT.L + 0.3) };
    const inRate = second => { let ins = 0; for (let k = 0; k < 300; k++) { const s = T.serve({ dt: 0.02, power: 0.8, from, side, deuce, second, rng }); const f = T.fly(from, s.v, s.spin), b = firstBounce(f); if (b && T.inBox(b.x, b.z, box) && !f.events.some(e => e.type === 'net' && e.i < b.i)) ins++; } return ins / 300; };
    const first = inRate(false), second = inRate(true);
    console.log(`serve from ${side < 0 ? 'near' : 'far'} ${deuce ? 'deuce' : 'ad'} side: first ${(first * 100).toFixed(0)}% in, second ${(second * 100).toFixed(0)}% in`);
    assert(first > 0.6 && first < 0.92 && second > 0.9, 'first serves risk it, second serves are safe');
  }
  const t = T.tossContactT({ x: 0, y: T.TOSS.from, z: 0 });
  assert(Math.abs(T.tossAt({ x: 0, y: T.TOSS.from, z: 0 }, t).y - T.TOSS.contactY) < 1e-6 && t > 0.8 && t < 1.4);
  console.log('toss reaches contact height after', t.toFixed(2), 's: ok');
}

// scoring
{
  const s = new T.Score(3);
  for (let i = 0; i < 3; i++) s.point(0);
  assert.strictEqual(s.label(0), '40'); assert(s.gamePointFor(0));
  assert.strictEqual(s.point(0), 'game'); assert.deepStrictEqual(s.games, [1, 0]); assert.strictEqual(s.server, 1);
  for (let i = 0; i < 3; i++) { s.point(0); s.point(1); }
  assert.strictEqual(s.call().text, 'Deuce');
  s.point(1); assert.strictEqual(s.call().text, 'Advantage'); assert.strictEqual(s.label(1), 'AD');
  s.point(0); assert.strictEqual(s.call().text, 'Deuce');
  s.point(0); assert.strictEqual(s.point(0), 'game'); assert.deepStrictEqual(s.games, [2, 0]);
  for (let i = 0; i < 3; i++) s.point(0);
  assert(s.matchPointFor(0));
  assert.strictEqual(s.point(0), 'match'); assert.strictEqual(s.winner, 0);
  console.log('scoring (deuce, advantage, games, match): ok');
}
console.log('tennis OK');
