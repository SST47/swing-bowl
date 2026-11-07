/*
 * Swing Bowl — turns iPhone/Android motion sensors into a bowling throw.
 *
 * Hold the on-screen button, swing your arm, let go at the bottom of the swing.
 *  - Power: how fast the phone is rotating just before release
 *    (orientation-independent, so any grip works).
 *  - Spin (hook): wrist twist around the phone's long axis in the last
 *    ~0.35 s before release.
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

  class SwingDetector {
    constructor() {
      this.samples = [];
      this.oSamples = [];
      this.holding = false;
      this.available = false;
      this.orientationAvailable = false;
      this.live = 0;
      this.flipSpin = false;
      this.steerLevel = 'normal';
      this.flipSteer = false;
      this._prevR = null; this._prevT = 0;
      this._onMotion = this._onMotion.bind(this);
      this._onOrient = this._onOrient.bind(this);
    }

    // Must be called from a tap/click on iOS (Safari asks the user).
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

    start() {
      root.addEventListener('devicemotion', this._onMotion);
      root.addEventListener('deviceorientation', this._onOrient);
    }
    stop() {
      root.removeEventListener('devicemotion', this._onMotion);
      root.removeEventListener('deviceorientation', this._onOrient);
    }

    _onMotion(e) {
      const r = e.rotationRate;
      if (!r || r.alpha === null || r.alpha === undefined) return;
      this.available = true;
      const a = r.alpha || 0, b = r.beta || 0, g = r.gamma || 0;
      const mag = Math.sqrt(a * a + b * b + g * g);
      this.live = this.live * 0.6 + mag * 0.4;
      if (!this.holding) return;
      const t = performance.now();
      this.samples.push({ t, g, mag });
      while (this.samples.length && t - this.samples[0].t > 2500) this.samples.shift();
      this._checkImpact(t, mag);
    }

    _onOrient(e) {
      if (e.beta === null || e.beta === undefined) return;
      this.orientationAvailable = true;
      const t = performance.now();
      const R = orientationMatrix(e.alpha, e.beta, e.gamma);
      const P = this._prevR, dt = (t - this._prevT) / 1000;
      this._prevR = R; this._prevT = t;
      if (!P || dt <= 0.002 || dt > 0.2 || !this.holding) return;
      this.oSamples.push(rateSample(t, R, P, dt));
      while (this.oSamples.length && t - this.oSamples[0].t > 2500) this.oSamples.shift();
    }

    hold() { this.holding = true; this.samples = []; this.oSamples = []; this._ipeak = 0; this._ifired = false; }

    /*
     * Impact mode (golf, baseball): while the button is held, the hit happens by
     * itself at the fastest point of the swing — no need to let go on time.
     * opts: { minPeak (deg/s), fullPeak (deg/s), onImpact(result) }
     * result: { power 0..1, peak, peakT (performance.now ms), twist (deg), dirDeg|null }
     */
    watchImpact(opts) { this.impact = opts; }

    _checkImpact(t, mag) {
      const o = this.impact;
      if (!o || this._ifired || !this.holding) return;
      if (mag > this._ipeak) { this._ipeak = mag; this._ipeakT = t; }
      if (this._ipeak >= o.minPeak && mag < this._ipeak * 0.55) {
        this._ifired = true;
        const peak = this._ipeak, peakT = this._ipeakT;
        let twist = 0;
        const s = this.samples;
        for (let i = 1; i < s.length; i++) if (s[i].t >= peakT - 250) twist += s[i].g * (s[i].t - s[i - 1].t) / 1000;
        const dir = swingDirection(this.oSamples, t);
        const power = Math.max(0, Math.min(1, (peak - o.minPeak) / (o.fullPeak - o.minPeak)));
        o.onImpact({ power, peak, peakT, twist, dirDeg: dir.ok ? dir.deg : null });
      }
    }

    // Returns { ok, speed (m/s), spin (-1..1), steer (rad), steerDeg, peak, twist } or { ok:false, reason }
    release() {
      this.holding = false;
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
