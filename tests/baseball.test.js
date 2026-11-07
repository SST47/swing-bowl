const B = require('../js/ball-engine.js');
const assert = require('assert');
const D = Math.PI / 180;
console.log('EV (m/s) x launch angle -> distance / outcome (centre field, fence 122 m):');
for (const ev of [30, 38, 44, 48]) {
  const row = [];
  for (const la of [5, 15, 25, 32, 45]) { const f = B.flight({ x: 0, y: 1, z: 0.3 }, ev, la * D, 0); row.push(`${la}°:${f.dist.toFixed(0)}${f.outcome === 'hr' ? 'HR' : f.outcome[0]}`); }
  console.log('  EV', ev, row.join('  '));
}
const pulled = B.flight({ x: 0, y: 1, z: 0.3 }, 44, 27 * D, -40 * D);
console.log('pulled down the line (fence 100 m):', pulled.dist.toFixed(0), pulled.outcome);
// derby simulation: random timing within +-0.1 s, full power swings
let hr = 0, n = 2000, rng = Math.random;
const outs = {};
for (let i = 0; i < n; i++) {
  const p = B.makePitch(rng);
  const c = B.contact((rng() - 0.5) * 0.24, 0.6 + rng() * 0.4, p, false, rng);
  if (c.kind === 'miss') { outs.miss = (outs.miss || 0) + 1; continue; }
  const f = B.flight(B.pitchPos(p, 1), c.ev, c.la, c.spray);
  outs[f.outcome] = (outs[f.outcome] || 0) + 1;
}
console.log('outcomes of 2000 decent swings (timing within ±0.12 s, 60-100% bat speed):', JSON.stringify(outs), '→ HR rate', (100 * (outs.hr || 0) / n).toFixed(0) + '%');
// perfect timing, hard swing should homer often
let perfect = 0;
for (let i = 0; i < 500; i++) { const p = B.makePitch(); const c = B.contact((Math.random() - 0.5) * 0.03, 1, { inZone: true }, false); const f = B.flight(B.pitchPos(p, 1), c.ev, c.la, c.spray); if (f.outcome === 'hr') perfect++; }
console.log('perfect timing + full power HR rate:', (perfect / 5).toFixed(0) + '%');
assert(perfect > 150);
// early swing pulls (righty -> left field = negative x); late goes opposite
const early = B.contact(-0.08, 1, { inZone: true }, false, () => 0.5), late = B.contact(0.08, 1, { inZone: true }, false, () => 0.5);
assert(early.spray < 0 && late.spray > 0, 'righty: early pulls left, late goes right');
const lEarly = B.contact(-0.08, 1, { inZone: true }, true, () => 0.5);
assert(lEarly.spray > 0, 'lefty pulls right');
assert.strictEqual(B.contact(0.3, 1, null, false).kind, 'miss');
// pitches end on target
const p = B.makePitch(); const end = B.pitchPos(p, 1);
assert(Math.abs(end.x - p.target.x) < 1e-9 && Math.abs(end.y - p.target.y) < 1e-9 && end.z === 0);
console.log('baseball OK');
