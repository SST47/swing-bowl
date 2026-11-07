/*
 * Swing Bowl — turns iPhone/Android motion sensors into a bowling throw.
 *
 * Hold the on-screen button, swing your arm, let go at the bottom of the swing.
 *  - Power comes from how fast the phone is rotating just before release
 *    (orientation-independent, so any grip works).
 *  - Spin (hook) comes from twisting the wrist around the phone's long axis
 *    in the last ~0.35 s before release.
 */
(function (root) {
  'use strict';

  const WINDOW_MS = 600;
  const TWIST_MS = 350;
  const MIN_PEAK = 90;    // deg/s — anything gentler doesn't count as a swing
  const FULL_PEAK = 720;  // deg/s — a hard swing

  class SwingDetector {
    constructor() {
      this.samples = [];
      this.holding = false;
      this.available = false;
      this.live = 0;
      this.flipSpin = false;
      this._onMotion = this._onMotion.bind(this);
    }

    // Must be called from a tap/click on iOS (Safari asks the user).
    static async requestPermission() {
      if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try { return await DeviceMotionEvent.requestPermission(); }
        catch (e) { return 'denied'; }
      }
      return 'granted';
    }

    start() { root.addEventListener('devicemotion', this._onMotion); }
    stop() { root.removeEventListener('devicemotion', this._onMotion); }

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
    }

    hold() { this.holding = true; this.samples = []; }

    // Returns { ok, speed (m/s), spin (-1..1), peak, twist } or { ok:false, reason }
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
      return { ok: true, ...SwingDetector.toThrow(peak, twist, this.flipSpin), peak, twist };
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

  root.SB = Object.assign(root.SB || {}, { SwingDetector, FULL_PEAK });
})(self);
