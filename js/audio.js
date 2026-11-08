/* Swing Bowl — tiny synthesized sound effects (no audio files needed). */
(function (root) {
  'use strict';

  class Sfx {
    constructor() { this.ctx = null; this.lastHit = 0; this.lastClack = 0; this.muted = false; }

    // Browsers only allow audio after a user gesture: call this from one.
    unlock() {
      try {
        if (!this.ctx) {
          const AC = root.AudioContext || root.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          const len = this.ctx.sampleRate * 2;
          this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const d = this.noise.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.8;
          this.master.connect(this.ctx.destination);
          // continuous rolling rumble
          const src = this.ctx.createBufferSource();
          src.buffer = this.noise; src.loop = true;
          const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
          this.rollGain = this.ctx.createGain(); this.rollGain.gain.value = 0;
          src.connect(lp); lp.connect(this.rollGain); this.rollGain.connect(this.master);
          src.start();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { /* audio is optional */ }
    }

    get ready() { return !!this.ctx && this.ctx.state === 'running' && !this.muted; }

    roll(level) {
      if (!this.ctx) return;
      const g = this.muted ? 0 : Math.max(0, Math.min(1, level)) * 0.5;
      this.rollGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
    }

    _burst(freq, q, gain, dur) {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource(); src.buffer = this.noise;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t, Math.random()); src.stop(t + dur + 0.05);
    }

    _tone(freq, type, gain, dur, delay = 0) {
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }

    hit(strength) {
      if (!this.ready) return;
      const now = performance.now();
      if (now - this.lastHit < 25) return;
      this.lastHit = now;
      const s = Math.min(1, strength / 4);
      this._burst(1600 + Math.random() * 900, 1.2, 0.25 + 0.6 * s, 0.18);
      this._tone(180, 'triangle', 0.25 * s + 0.05, 0.12);
    }

    clack(strength) {
      if (!this.ready) return;
      const now = performance.now();
      if (now - this.lastClack < 18) return;
      this.lastClack = now;
      const s = Math.min(1, strength / 2.5);
      const f = 1100 + Math.random() * 700;
      this._tone(f, 'square', 0.04 + 0.12 * s, 0.06);
      this._burst(f * 1.6, 4, 0.1 + 0.25 * s, 0.07);
    }

    thud() { if (this.ready) this._tone(70, 'sine', 0.4, 0.35); }

    // tennis: racket on ball, ball on court, ball into the net, the crowd
    pock(strength = 0.7) {
      if (!this.ready) return;
      const s = Math.max(0.2, Math.min(1, strength));
      this._tone(520 + Math.random() * 60, 'sine', 0.22 * s + 0.08, 0.07);
      this._burst(2400, 2.5, 0.18 + 0.3 * s, 0.05);
    }
    bounce() { if (this.ready) { this._tone(230, 'sine', 0.14, 0.08); this._burst(900, 2, 0.08, 0.05); } }
    net() { if (this.ready) this._burst(300, 0.8, 0.25, 0.25); }
    crowd(level = 0.7) {
      if (!this.ready) return;
      const t = this.ctx.currentTime, dur = 1.6 + level;
      const src = this.ctx.createBufferSource(); src.buffer = this.noise;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 + 0.18 * level, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // clapping: a fast flutter on the noise
      const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(); lfo.frequency.value = 11; lg.gain.value = 0.5;
      const amp = this.ctx.createGain(); amp.gain.value = 0.6;
      lfo.connect(lg); lg.connect(amp.gain);
      src.connect(bp); bp.connect(amp); amp.connect(g); g.connect(this.master);
      src.start(t, Math.random()); src.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
    }

    fanfare(kind) {
      if (!this.ready) return;
      const notes = kind === 'strike' ? [523, 659, 784, 1047] : kind === 'spare' ? [523, 784, 1047] : [];
      notes.forEach((f, i) => this._tone(f, 'square', 0.08, 0.18, i * 0.09));
    }

    sad() { if (this.ready) [392, 330].forEach((f, i) => this._tone(f, 'triangle', 0.12, 0.3, i * 0.22)); }
  }

  root.SB = Object.assign(root.SB || {}, { Sfx });
})(self);
