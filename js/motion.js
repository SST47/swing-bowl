/*
 * Swing Sports — turns iPhone/Android motion sensors into swings.
 *
 * One SwingDetector, three ways a swing can end:
 *  - 'release' (bowling): hold the button, swing, let go to throw. The throw is
 *    read from the last ~0.6 s before the button comes up.
 *  - 'impact'  (golf): hold the button, take the club back, swing through. The
 *    hit fires by itself at the fastest point of the FORWARD swing, i.e. the
 *    first fast rotation that goes the opposite way to the backswing. (A pause
 *    at the top of the backswing never counts as the hit.)
 *  - 'auto'    (baseball): no button at all. The first fast rotation is the
 *    swing, timestamped at its peak; then it re-arms for the next pitch.
 *
 * What a swing measures:
 *  - Power: peak rotation speed (orientation-independent, so any grip works).
 *  - Spin / curve: wrist twist around the phone's long axis near the peak.
 *  - Direction: which way the arm swings. We compare the swing plane of the
 *    forward swing with the backswing, measured in world coordinates. Swing
 *    straight back and through and the ball follows your aim arrow; pull the
 *    forward swing across your body and it goes left or right.
 *    Direction is computed from the fused device *orientation* stream
 *    (alpha/beta/gamma → rotation matrices), not from raw gyro axes, so it
 *    doesn't depend on how a browser labels its rotationRate axes. A twist of
 *    the wrist rotates about the (near-vertical) arm and so doesn't disturb the
 *    swing-plane measurement.
 */
(function (root) {
  'use strict';

  const WINDOW_MS = 600;
  const TWIST_MS = 350;
  const MIN_PEAK = 90;    // deg/s — anything gentler doesn't count as a swing
  const FULL_PEAK = 720;  // deg/s — a hard swing
  const D2R = Math.PI / 180;

  // W3C DeviceOrientation: device -> world rotation, R = Rz(alpha) Rx(beta) Ry(gamma).
  function orientationMatrix(alpha, beta, gamma) {
    const a = (alpha || 0) * D2R, b = (beta || 0) * D2R, c = (gamma || 0) * D2R;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    return [
      [ca * cc - sa * sb * sc, -sa * cb, ca * sc + sa * sb * cc],
      [sa * cc + ca * sb * sc, ca * cb, sa * sc - ca * sb * cc],
      [-cb * sc, sb, cb * cc],
    ];
  }

  // World-frame angular velocity (deg/s) between two orientation matrices.
  function worldRate(R, P, dt) {
    // M = R * P^T
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] = R[i][0] * P[j][0] + R[i][1] * P[j][1] + R[i][2] * P[j][2];
    let x = (M[2][1] - M[1][2]) / 2, y = (M[0][2] - M[2][0]) / 2, z = (M[1][0] - M[0][1]) / 2;
    const s = Math.hypot(x, y, z);
    const cos = Math.max(-1, Math.min(1, (M[0][0] + M[1][1] + M[2][2] - 1) / 2));
    const ang = Math.atan2(s, cos);                 // exact rotation angle
    const k = s > 1e-9 ? ang / s / dt / D2R : 0;    // -> deg/s along the axis
    return { x: x * k, y: y * k, z: z * k };
  }

  // One sample: world angular velocity, plus the same with wrist twist (rotation
  // about the phone's long axis) removed, so a hook release can't fake a direction.
  function rateSample(t, R, P, dt) {
    const w = worldRate(R, P, dt);
    const yx = R[0][1], yy = R[1][1], yz = R[2][1];   // phone's long axis in world coords
    const d = w.x * yx + w.y * yy + w.z * yz;
    return { t, x: w.x, y: w.y, z: w.z, nx: w.x - d * yx, ny: w.y - d * yy };
  }

  /*
   * samples: [{ t (ms), x, y, z, nx, ny }] world angular velocity (deg/s), oldest first.
   * Returns { ok, deg } where deg > 0 means the forward swing was pulled to the
   * LEFT of the backswing line (counter-clockwise seen from above).
   */
  function swingDirection(samples, now) {
    if (samples.length < 6) return { ok: false, deg: 0, why: 'few' };
    const mag = s => Math.hypot(s.x, s.y, s.z);
    let pf = -1, best = 0;
    for (let i = 0; i < samples.length; i++) {
      if (now - samples[i].t > WINDOW_MS) continue;
      const m = mag(samples[i]);
      if (m > best) { best = m; pf = i; }
    }
    if (pf < 0 || best < MIN_PEAK) return { ok: false, deg: 0, why: 'weak' };
    const tf = samples[pf].t;
    const plane = (kx, ky) => {
      let fx = 0, fy = 0, rfx = 0, rfy = 0;
      for (const s of samples) if (Math.abs(s.t - tf) <= 100) { fx += s[kx]; fy += s[ky]; rfx += s.x; rfy += s.y; }
      return { fx, fy, ok: Math.hypot(fx, fy) > 0.4 * Math.hypot(rfx, rfy) };
    };
    // prefer twist-free rates; with a sideways grip the swing itself is about the
    // phone's long axis, so fall back to the raw rates there
    let kx = 'nx', ky = 'ny';
    let fp = plane(kx, ky);
    if (!fp.ok || samples[0].nx === undefined) { kx = 'x'; ky = 'y'; fp = plane(kx, ky); }
    const fx = fp.fx, fy = fp.fy;

    // apex = slowest moment between backswing and forward swing
    let ap = -1, low = Infinity;
    for (let i = 0; i < pf; i++) {
      if (tf - samples[i].t > 900) continue;
      const m = mag(samples[i]);
      if (m < low) { low = m; ap = i; }
    }
    if (ap < 0) return { ok: false, deg: 0, why: 'nobackswing' };
    const ta = samples[ap].t;
    let bx = 0, by = 0, bpeak = 0;
    for (const s of samples) if (s.t <= ta && ta - s.t <= 600) { bx += s[kx]; by += s[ky]; bpeak = Math.max(bpeak, Math.hypot(s.x, s.y)); }
    if (bpeak < 50 || Math.hypot(bx, by) < 1e-6 || Math.hypot(fx, fy) < 1e-6) return { ok: false, deg: 0, why: 'nobackswing' };

    // angle from the reversed backswing axis to the forward-swing axis
    const rx = -bx, ry = -by;
    const deg = Math.atan2(rx * fy - ry * fx, rx * fx + ry * fy) / D2R;
    return { ok: true, deg };
  }

  // Map a swing angle (deg) to an aim offset (radians) for the ball.
  const STEER_GAIN = { off: 0, low: 0.12, normal: 0.2, high: 0.32 };
  function steerFromDeg(deg, level, flip) {
    const k = STEER_GAIN[level] ?? STEER_GAIN.normal;
    const dz = 2.5;
    if (!k || Math.abs(deg) <= dz) return 0;
    const d = Math.sign(deg) * Math.min(35, Math.abs(deg) - dz);
    let steer = -d * k * D2R;          // left (deg > 0) -> negative x
    if (flip) steer = -steer;
    return Math.max(-0.09, Math.min(0.09, steer));
  }

  const AUTO_COOLDOWN_MS = 800;
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  class SwingDetector {
    /*
     * opts: { mode: 'release' | 'impact' | 'auto', minPeak, fullPeak (deg/s), onImpact(result) }
     * impact/auto result: { power 0..1, peak, peakT (performance.now ms), twist (deg), dirDeg | null }
     */
    constructor(opts = {}) {
      this.mode = opts.mode || 'release';
      this.minPeak = opts.minPeak ?? MIN_PEAK;
      this.fullPeak = opts.fullPeak ?? FULL_PEAK;
      this.onImpact = opts.onImpact || null;
      this.flipSpin = false; this.steerLevel = 'normal'; this.flipSteer = false;
      this.available = false; this.orientationAvailable = false;
      this.live = 0;
      this.recording = false;
      this._prevR = null; this._prevT = 0;
      this._reset();
      this._onMotion = this._onMotion.bind(this);
      this._onOrient = this._onOrient.bind(this);
    }

    // Must be called from a tap/click on iOS (Safari asks the user once for both).
    static async requestPermission() {
      if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
      let res = 'granted';
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try { res = await DeviceMotionEvent.requestPermission(); } catch (e) { res = 'denied'; }
      }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch (e) { /* same permission on iOS */ }
      }
      return res;
    }

    start() { root.addEventListener('devicemotion', this._onMotion); root.addEventListener('deviceorientation', this._onOrient); }
    stop() { root.removeEventListener('devicemotion', this._onMotion); root.removeEventListener('deviceorientation', this._onOrient); }
    setThresholds(minPeak, fullPeak) { this.minPeak = minPeak; this.fullPeak = fullPeak; }

    // Start / stop recording a swing.
    begin() { this._reset(); this.recording = true; }
    end() { this.recording = false; }

    _reset() {
      this.samples = []; this.oSamples = [];
      this.seg = { axis: null, acc: [0, 0, 0], n: 0, list: [], cur: null };
      this.auto = { peak: 0, peakT: 0 };
      this.fired = false;
      this.cooldownUntil = 0;
    }

    // ---------- sensor input ----------
    _onMotion(e) {
      const r = e.rotationRate;
      if (!r || r.alpha === null || r.alpha === undefined) return;
      this.feed(performance.now(), r.alpha || 0, r.beta || 0, r.gamma || 0);
    }

    // One gyro sample (deg/s around the device's z, x, y axes). Public so tests can drive it.
    feed(t, alpha, beta, gamma) {
      this.available = true;
      const v = [beta, gamma, alpha];   // device x, y, z
      const mag = Math.hypot(v[0], v[1], v[2]);
      this.live = this.live * 0.6 + mag * 0.4;
      if (!this.recording) return;
      const s = { t, v, mag, g: gamma, r: mag };
      this.samples.push(s);
      while (this.samples.length && t - this.samples[0].t > 2500) this.samples.shift();
      if (this.mode === 'impact') { this._segment(s); this._detectImpact(s); }
      else if (this.mode === 'auto') this._detectAuto(s);
    }

    _onOrient(e) {
      if (e.beta === null || e.beta === undefined) return;
      this.orientationAvailable = true;
      const t = performance.now();
      const R = orientationMatrix(e.alpha, e.beta, e.gamma);
      const P = this._prevR, dt = (t - this._prevT) / 1000;
      this._prevR = R; this._prevT = t;
      if (!P || dt <= 0.002 || dt > 0.2 || !this.recording) return;
      this.oSamples.push(rateSample(t, R, P, dt));
      while (this.oSamples.length && t - this.oSamples[0].t > 2500) this.oSamples.shift();
    }

    // ---------- 'impact': split the motion into back / forward segments ----------
    // The first real motion fixes a reference axis (the backswing). Every sample
    // gets a signed rate along it; a sign change starts a new segment.
    _segment(s) {
      const S = this.seg, axisMin = Math.min(60, this.minPeak * 0.6);
      if (!S.axis) {
        if (s.mag < axisMin) return;
        S.acc = [S.acc[0] + s.v[0], S.acc[1] + s.v[1], S.acc[2] + s.v[2]];
        if (++S.n >= 3) S.axis = norm(S.acc);
      }
      s.r = S.axis ? dot(s.v, S.axis) : s.mag;
      const sign = s.r >= 0 ? 1 : -1;
      if (!S.cur) S.cur = { sign: 1, peak: 0, maxMag: 0, peakT: s.t, start: s.t };
      else if (sign !== S.cur.sign && Math.abs(s.r) > Math.max(15, axisMin * 0.4)) {
        S.list.push(S.cur);
        S.cur = { sign, peak: 0, maxMag: 0, peakT: s.t, start: s.t };
      }
      const c = S.cur;
      if (Math.abs(s.r) > c.peak) { c.peak = Math.abs(s.r); c.peakT = s.t; }
      c.maxMag = Math.max(c.maxMag, s.mag);
    }

    _detectImpact(s) {
      if (this.fired) return;
      const S = this.seg, cur = S.cur;
      if (!cur) return;
      const back = S.list[0];
      if (!back) return;                       // still on the backswing
      const forward = c => c && c !== back && c.sign !== back.sign;
      // forward swing peaked and is slowing down...
      if (forward(cur) && cur.peak >= this.minPeak && Math.abs(s.r) < cur.peak * 0.5) return this._fire(cur, s.t);
      // ...or it already reversed again (a quick recoil) before slowing much
      const last = S.list[S.list.length - 1];
      if (cur.start === s.t && forward(last) && last.peak >= this.minPeak) this._fire(last, s.t);
    }

    // Button let go before a hit fired: a forward-only swing (no backswing) still counts.
    flush() {
      if (this.fired || this.mode !== 'impact') return false;
      const segs = this.seg.list.concat(this.seg.cur ? [this.seg.cur] : []);
      let best = null;
      for (const c of segs) if (c.peak >= this.minPeak && (!best || c.maxMag > best.maxMag)) best = c;
      if (!best) return false;
      this._fire(best, performance.now());
      return true;
    }

    // ---------- 'auto': first fast rotation = the swing; re-arm after a cooldown ----------
    _detectAuto(s) {
      if (s.t < this.cooldownUntil) return;
      const A = this.auto;
      if (s.mag > A.peak) { A.peak = s.mag; A.peakT = s.t; }
      if (A.peak >= this.minPeak && s.mag < A.peak * 0.5) {
        this._fire({ maxMag: A.peak, peakT: A.peakT }, s.t);
        this.fired = false;                  // auto mode keeps listening
        this.cooldownUntil = s.t + AUTO_COOLDOWN_MS;
        this.auto = { peak: 0, peakT: 0 };
      } else if (A.peak < this.minPeak && s.t - A.peakT > 400) {
        this.auto = { peak: s.mag, peakT: s.t };   // forget slow fidgeting
      }
    }

    _fire(seg, t) {
      this.fired = true;
      const peak = seg.maxMag, peakT = seg.peakT;
      let twist = 0;
      const S = this.samples;
      for (let i = 1; i < S.length; i++) if (S[i].t >= peakT - 250 && S[i].t <= t) twist += S[i].g * (S[i].t - S[i - 1].t) / 1000;
      const dir = swingDirection(this.oSamples, t);
      const power = Math.max(0, Math.min(1, (peak - this.minPeak) / (this.fullPeak - this.minPeak)));
      if (this.onImpact) this.onImpact({ power, peak, peakT, twist, dirDeg: dir.ok ? dir.deg : null });
    }

    // ---------- 'release' (bowling): read the throw from the moment the button came up ----------
    // Returns { ok, speed (m/s), spin (-1..1), steer (rad), steerDeg, peak, twist } or { ok:false, reason }
    release() {
      this.recording = false;
      const now = performance.now();
      const win = this.samples.filter(s => now - s.t <= WINDOW_MS);
      if (win.length < 3) return { ok: false, reason: 'nodata' };
      let peak = 0;
      for (const s of win) peak = Math.max(peak, s.mag);
      if (peak < MIN_PEAK) return { ok: false, reason: 'weak', peak };
      let twist = 0;
      for (let i = 1; i < win.length; i++) {
        if (now - win[i].t > TWIST_MS) continue;
        twist += win[i].g * (win[i].t - win[i - 1].t) / 1000;
      }
      const dir = swingDirection(this.oSamples, now);
      const steer = dir.ok ? steerFromDeg(dir.deg, this.steerLevel, this.flipSteer) : 0;
      return { ok: true, ...SwingDetector.toThrow(peak, twist, this.flipSpin), steer, steerDeg: dir.ok ? dir.deg : null, peak, twist };
    }

    static toThrow(peak, twist, flip) {
      const p = Math.max(0, Math.min(1, (peak - MIN_PEAK) / (FULL_PEAK - MIN_PEAK)));
      const speed = 3 + Math.pow(p, 0.85) * 7.5;
      const dz = 12;
      let spin = 0;
      if (Math.abs(twist) > dz) spin = Math.max(-1, Math.min(1, -(twist - Math.sign(twist) * dz) / 90));
      if (flip) spin = -spin;
      return { speed, spin };
    }
  }

  const api = { SwingDetector, FULL_PEAK, orientationMatrix, worldRate, rateSample, swingDirection, steerFromDeg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SB = Object.assign(root.SB || {}, api);
})(typeof self !== 'undefined' ? self : this);
