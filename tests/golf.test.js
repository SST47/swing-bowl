const G = require('../js/golf-engine.js');
const assert = require('assert');
const flat = G.HOLES[0];
console.log('club calibration (full power, from tee on hole 1, no wind):');
for (const c of G.CLUBS) {
  const r = G.simulate({ hole: flat, from: { x: 0, y: 0 }, heading: Math.PI / 2, club: c, power: 1, lie: 'tee' });
  console.log(' ', c.name.padEnd(11), 'vmax', (c.vmax || 0).toFixed(1).padStart(5), 'carry', r.carry.toFixed(0).padStart(4), 'total', r.total.toFixed(0).padStart(4), 'apex', r.maxZ.toFixed(1).padStart(5), r.result);
}
// half power ~ shorter, draw curves left
const c7 = G.CLUBS[3];
const half = G.simulate({ hole: flat, from: { x: 0, y: 0 }, heading: Math.PI / 2, club: c7, power: 0.5, lie: 'tee' });
const draw = G.simulate({ hole: flat, from: { x: 0, y: 0 }, heading: Math.PI / 2, club: c7, power: 1, side: 1, lie: 'tee' });
const fade = G.simulate({ hole: flat, from: { x: 0, y: 0 }, heading: Math.PI / 2, club: c7, power: 1, side: -1, lie: 'tee' });
console.log('7I half power total', half.total.toFixed(0), '| full draw end x', draw.end.x.toFixed(1), '| fade x', fade.end.x.toFixed(1));
assert(half.total < 110 && half.total > 40);
assert(draw.end.x < -5 && fade.end.x > 5);
// wind
const into = G.simulate({ hole: flat, from: { x: 0, y: 0 }, heading: Math.PI / 2, club: G.CLUBS[0], power: 1, wind: { x: 0, y: -6 }, lie: 'tee' });
console.log('driver into 6 m/s headwind total', into.total.toFixed(0));
// putting: find power that holes a 6 m straight putt on a flat green; check capture
const h = JSON.parse(JSON.stringify(G.HOLES[0])); h.green.slope = { x: 0, y: 0 };
const P = G.CLUBS[G.CLUBS.length - 1];
let holed = 0, dists = [];
for (let p = 0.05; p <= 0.6; p += 0.01) {
  const r = G.simulate({ hole: h, from: { x: h.pin.x, y: h.pin.y - 6 }, heading: Math.PI / 2, club: P, power: p });
  if (r.result === 'holed') holed++;
  dists.push(r.total.toFixed(1));
}
console.log('6 m putt: powers that hole it', holed, '| putt distances by power', dists.filter((_, i) => i % 8 === 0).join(' '));
assert(holed >= 2, 'putts should drop at the right pace');
// water on hole 2 with a weak shot
const w = G.simulate({ hole: G.HOLES[1], from: { x: 0, y: 0 }, heading: Math.PI / 2, club: G.CLUBS[3], power: 0.45, lie: 'tee' });
console.log('hole 2 weak shot ->', w.result); assert.strictEqual(w.result, 'water');
assert.strictEqual(G.scoreName(3, 4), 'BIRDIE!'); assert.strictEqual(G.suggestClub(140, 'fairway'), 3);
console.log('golf OK');

// a ball lying under a tree (in the rough) can be played out: it used to go 0 m whatever the swing
for (const h of G.HOLES) {
  for (const tr of h.trees.slice(0, 6)) {
    for (const from of [{ x: tr.x, y: tr.y }, { x: tr.x + tr.r * 0.8, y: tr.y }]) {
      const lie = G.surfaceAt(h, from);
      if (lie === 'oob' || lie === 'water') continue;
      const heading = G.clearAim(h, from, G.CLUBS[3]);
      const r = G.simulate({ hole: h, from, heading, club: G.CLUBS[3], power: 1, lie });
      assert(r.total > 60 && !r.treeHit, `from under a tree on ${h.name}: ${r.total.toFixed(1)} m`);
    }
  }
}
// in the open the aim is straight at the pin
const tee = G.HOLES[0].tee, pin = G.HOLES[0].pin;
assert(Math.abs(G.clearAim(G.HOLES[0], tee, G.CLUBS[0]) - Math.atan2(pin.y - tee.y, pin.x - tee.x)) < 1e-9);
console.log('shots from under trees get out, aim is straight at the pin in the open: ok');
