// Drives the SwingDetector with synthetic gyro streams and checks when (and whether) a hit fires.
const { SwingDetector } = require('../js/motion.js');
const assert = require('assert');
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// segments: [{ ms, axis:[x,y,z] (unit), peak (deg/s) }] — bell-shaped speed per segment; noise in deg/s
function stream(segments, noise = 8, hz = 100) {
  const out = []; let t = 1000;
  for (const s of segments) {
    const n = Math.round(s.ms * hz / 1000);
    for (let i = 0; i < n; i++) {
      const k = s.peak * Math.sin(Math.PI * (i + 0.5) / n);
      const v = s.axis.map(a => a * k + (rnd() - 0.5) * 2 * noise);
      out.push({ t, beta: v[0], gamma: v[1], alpha: v[2] });
      t += 1000 / hz;
    }
  }
  return out;
}
function run(mode, min, full, segs, opts = {}) {
  const hits = [];
  const d = new SwingDetector({ mode, minPeak: min, fullPeak: full, onImpact: r => hits.push(r) });
  d.begin();
  const ev = stream(segs, opts.noise);
  for (const e of ev) d.feed(e.t, e.alpha, e.beta, e.gamma);
  if (opts.flush) d.flush();
  return { hits, ev };
}
const X = [1, 0, 0], NX = [-1, 0, 0], Z = [0, 0, 1], TILT = [0.8, 0.2, 0.56];
const NT = TILT.map(v => -v);
const rest = ms => ({ ms, axis: X, peak: 0 });

// 1) golf: backswing 320 deg/s, a long pause at the top, downswing 950 deg/s
let r = run('impact', 150, 900, [rest(200), { ms: 550, axis: TILT, peak: 320 }, rest(450), { ms: 260, axis: NT, peak: 950 }, { ms: 300, axis: NT, peak: 120 }]);
assert.strictEqual(r.hits.length, 1, 'golf: exactly one hit');
const downStart = 1000 + (200 + 550 + 450) * 1;
assert(r.hits[0].peakT > downStart && r.hits[0].peak > 800, 'golf: hit comes from the downswing, not the top of the backswing');
console.log('golf full swing      -> 1 hit, peak', r.hits[0].peak.toFixed(0), 'deg/s, power', r.hits[0].power.toFixed(2), ', at', (r.hits[0].peakT - downStart).toFixed(0), 'ms into the downswing');

// 2) putt: back 55 deg/s, forward 120 deg/s
r = run('impact', 30, 380, [rest(150), { ms: 450, axis: NX, peak: 55 }, rest(120), { ms: 380, axis: X, peak: 120 }, rest(300)], { noise: 3 });
assert.strictEqual(r.hits.length, 1, 'putt: one hit'); assert(r.hits[0].peak > 100 && r.hits[0].power < 0.35);
console.log('putt                 -> 1 hit, power', r.hits[0].power.toFixed(2));

// 3) forward-only swing (no backswing), then the button comes up -> flush counts it
r = run('impact', 150, 900, [rest(150), { ms: 300, axis: X, peak: 700 }, rest(200)], { flush: true });
assert.strictEqual(r.hits.length, 1, 'forward-only swing counts on release'); console.log('forward-only + let go -> 1 hit, power', r.hits[0].power.toFixed(2));

// 4) golf: only a backswing, then the button is held still -> no hit
r = run('impact', 150, 900, [rest(150), { ms: 500, axis: TILT, peak: 400 }, rest(800)]);
assert.strictEqual(r.hits.length, 0, 'a backswing alone is not a hit'); console.log('backswing only       -> no hit');

// 5) baseball auto: fidgeting in the stance (<= 200 deg/s), a bat swing (1000), more fidgeting, a second swing
r = run('auto', 350, 900, [rest(300), { ms: 400, axis: X, peak: 150 }, { ms: 300, axis: NX, peak: 200 }, rest(200), { ms: 220, axis: Z, peak: 1000 }, { ms: 250, axis: Z, peak: 150 }, rest(900), { ms: 400, axis: X, peak: 180 }, { ms: 200, axis: Z, peak: 850 }, rest(300)]);
assert.strictEqual(r.hits.length, 2, 'baseball: two swings, two hits');
const sw1 = 1000 + 300 + 400 + 300 + 200 + 110;   // centre of the first swing
assert(Math.abs(r.hits[0].peakT - sw1) < 25, 'baseball: timestamp is the swing peak');
console.log('bat swings           -> 2 hits, first timestamp off by', Math.abs(r.hits[0].peakT - sw1).toFixed(0), 'ms; powers', r.hits.map(h => h.power.toFixed(2)).join(', '));

// 6) baseball: slow lift into the stance up to 300 deg/s -> nothing
r = run('auto', 350, 900, [rest(100), { ms: 600, axis: X, peak: 300 }, rest(400)]);
assert.strictEqual(r.hits.length, 0); console.log('lifting into stance  -> no hit');
console.log('detector OK');
