/* Swing Sports — shared phone-controller logic: the swing button, sensors and small helpers. */
(function (root) {
  'use strict';
  const { SwingDetector } = root.SB;

  // Press-and-hold auto-repeat for small buttons (position, club).
  function repeatButton(btn, fn) {
    let timer = null, delay = null;
    const stop = () => { clearTimeout(delay); clearInterval(timer); timer = delay = null; };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      fn();
      delay = setTimeout(() => { timer = setInterval(fn, 70); }, 280);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => btn.addEventListener(t, stop));
  }

  /*
   * The big swing button + motion sensors, for every game.
   *
   * opts: {
   *   mode: 'release' (bowling: hold, swing, let go)
   *       | 'impact'  (golf: hold, swing; the hit fires itself at the fastest point of the forward swing)
   *       | 'auto'    (baseball: no holding; every fast swing on your turn is sent; the button means "ready"),
   *   button, meter, minPeak, fullPeak,
   *   canSwing()        is it this player's turn?
   *   onArm(on)         button down/up (release, impact) or ready tap (auto)
   *   onSwing(result)   release: { speed, spin, steer, steerDeg }  impact/auto: { power, peakT, twist, dirDeg, tap }
   *   onBlocked?(result) auto: a swing came while it wasn't this player's turn
   *   onHint(text)
   *   isOver?(), onNewGame?()   when the game is over the button becomes "new game"
   *   labels?: { hold, sub, tapHold, tapSub, over, overSub }
   * }
   */
  function makeSwingPad(opts) {
    const mode = opts.mode || 'release';
    const btn = opts.button, meter = opts.meter;
    const label = btn.querySelector('.lbl'), sub = btn.querySelector('small');
    const L = Object.assign({
      hold: 'HOLD & SWING', sub: mode === 'release' ? 'let go to throw' : 'swing through',
      tapHold: 'HOLD', tapSub: mode === 'release' ? 'release to throw · slide to spin' : 'release to swing · slide to curve',
      over: 'NEW GAME', overSub: 'tap to play again',
    }, opts.labels || {});
    let tapMode = false, down = false, pressT = 0, startX = 0, curX = 0, raf = 0;

    const det = new SwingDetector({
      mode, minPeak: opts.minPeak, fullPeak: opts.fullPeak,
      onImpact: r => {
        if (mode === 'auto') { if (opts.canSwing()) opts.onSwing(r); else if (opts.onBlocked) opts.onBlocked(r); return; }
        if (!down) return;
        finish();
        opts.onSwing(r);
      },
    });

    const isOver = () => !!(opts.isOver && opts.isOver());
    function setLabels() {
      if (isOver()) { label.textContent = L.over; sub.textContent = L.overSub; return; }
      label.textContent = tapMode ? L.tapHold : L.hold;
      sub.textContent = tapMode ? L.tapSub : L.sub;
    }

    async function enable() {
      const perm = await SwingDetector.requestPermission();
      det.start();
      if (mode === 'auto') det.begin();   // always listening for swings
      setTimeout(() => {
        if (det.available) return;
        tapMode = true; setLabels();
        opts.onHint(perm === 'denied'
          ? 'Motion access was denied, so you’re in tap mode. To swing for real: Settings › Safari › Motion & Orientation Access, then reload.'
          : 'No motion sensors found, so you’re in tap mode.');
      }, 1500);
      setLabels();
      if (mode === 'auto') meterLoop();
    }

    // Live swing-speed bar: while the button is held, or all the time in auto mode.
    function meterLoop() {
      cancelAnimationFrame(raf);
      const tick = () => {
        let v = 0;
        if (tapMode) v = down ? Math.min(1, (performance.now() - pressT) / 1400) : 0;
        else if (down || mode === 'auto') v = Math.min(1, det.live / (det.fullPeak || 900));
        meter.style.width = (v * 100).toFixed(0) + '%';
        if (down || mode === 'auto') raf = requestAnimationFrame(tick);
      };
      tick();
    }

    function finish() {
      down = false;
      btn.classList.remove('down');
      if (mode !== 'auto') det.end();
      if (opts.onArm && mode !== 'auto') opts.onArm(false);
    }

    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (isOver()) { if (opts.onNewGame) opts.onNewGame(); return; }
      if (!opts.canSwing()) return;
      if (mode === 'auto' && !tapMode) { if (opts.onArm) opts.onArm(true); btn.classList.add('down'); setTimeout(() => btn.classList.remove('down'), 150); return; }
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      down = true; pressT = performance.now(); startX = curX = e.clientX;
      btn.classList.add('down');
      if (mode !== 'auto') det.begin();
      if (opts.onArm) opts.onArm(true);
      meterLoop();
    });
    btn.addEventListener('pointermove', e => { if (down) curX = e.clientX; });

    const up = () => {
      if (!down) return;
      const held = performance.now() - pressT, slide = curX - startX;
      if (tapMode) {
        finish();
        const p = Math.min(1, held / 1400);
        if (mode !== 'auto' && p < 0.08) { opts.onHint('Hold a little longer.'); return; }
        if (mode === 'release') opts.onSwing({ ok: true, speed: 3 + p * 7.5, spin: Math.max(-1, Math.min(1, -slide / 110)), steer: 0, steerDeg: null, tap: true });
        else opts.onSwing({ power: mode === 'auto' ? 0.85 : p, peakT: performance.now(), twist: -slide / 110 * 60, dirDeg: null, tap: true });
        return;
      }
      if (mode === 'release') {
        finish();
        const res = det.release();
        if (res.ok) opts.onSwing(res);
        else opts.onHint(res.reason === 'weak' ? 'Swing your arm harder, then let go during the swing.' : 'No motion data yet. Give it a second, or check Motion & Orientation access.');
        return;
      }
      // impact: a forward-only swing still counts when the button comes up
      if (det.flush()) return;
      finish();
      opts.onHint('Take the club back, then swing through while holding the button.');
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);

    // Keep iOS from scrolling / zooming while swinging.
    document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());

    return {
      det, enable, setLabels,
      setThresholds: (min, full) => det.setThresholds(min, full),
      get tapMode() { return tapMode; },
    };
  }

  async function keepAwake() {
    try {
      if (!navigator.wakeLock) return;
      await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { try { await navigator.wakeLock.request('screen'); } catch (e) {} } });
    } catch (e) {}
  }

  /*
   * iOS "Shake to Undo": once someone has typed into a text field, shaking the
   * phone (i.e. swinging it!) pops up an "Undo Typing" dialog. The undo history
   * belongs to those input elements, so swap each typed-in field for a fresh
   * copy (same value) and drop focus; with nothing to undo, iOS shows nothing.
   */
  // iPhones offer "Undo Typing" when shaken after typing, and swinging a phone is a big shake. The
  // typing history belongs to the page, so once someone has typed (a name, a room code) the page
  // reloads itself fresh, with no history, at `url` (which rejoins straight away). Returns true if
  // it's leaving. Nothing typed: just drops the keyboard.
  let typed = false;
  if (root.document) document.addEventListener('input', e => {
    const el = e.target;
    if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'))) typed = true;
  }, true);
  function clearUndo(container, url) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (!typed || !url) return false;
    location.replace(url);
    return true;
  }


  const store = {
    get(k, d) { try { const v = localStorage.getItem('sb-' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sb-' + k, v); } catch (e) {} },
  };

  /*
   * Moving between games: the big screen tells every phone { t: 'switch', game, room } and goes to
   * the new game; each phone follows to that game's controller and rejoins the same room code.
   */
  const GAMES = { bowling: 'Bowling', golf: 'Golf', baseball: 'Baseball', tennis: 'Tennis' };
  const SITE = (document.currentScript && document.currentScript.src || '').replace(/js\/pad\.js.*$/, '');   // where the games live
  const HERE = (() => { const s = location.pathname.split('/').filter(Boolean); return /controller\.html$/.test(s[s.length - 1] || '') ? s[s.length - 2] : 'hub'; })();
  let following = false;
  function followSwitch(m) {
    if (!m || !(GAMES[m.game] || m.game === 'hub') || !/^[A-Z]{4}$/.test(m.room || '')) return false;
    if (m.game === HERE || following) return false;   // already there
    following = true;
    location.replace(new URL(`${m.game === 'hub' ? 'join.html' : m.game + '/controller.html'}?room=${m.room}&join=1`, SITE || location.href).href);
    return true;
  }
  // Arrived from a switch: join right away (the big screen is expecting us), and ask for one tap,
  // which phones need before they share motion data.
  function autoJoin({ connect, enable, title }) {
    const q = new URLSearchParams(location.search);
    if (q.get('join') !== '1' || !/^[A-Z]{4}$/.test(q.get('room') || '')) return false;
    history.replaceState(null, '', location.pathname + '?room=' + q.get('room'));   // a reload shouldn't auto-join again
    connect(q.get('room'));
    const ov = document.createElement('div');
    ov.className = 'tapgo';
    ov.innerHTML = `<button type="button"><span>▶</span><b>${esc(title)}</b><small>Tap to start</small></button>`;
    document.body.appendChild(ov);
    ov.querySelector('button').addEventListener('click', async () => { ov.remove(); await enable(); });
    return true;
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /*
   * Left- or right-handed: one tap, any time, remembered in every game. The big screen mirrors your
   * player. (Swings need no flipping: a left-hander's mirrored swing already reads as mirrored.)
   * button: the switch. client: an SB.Client, or null (one phone, no big screen). onChange(lefty).
   * Call sync(state) with each state message, so the big screen catches up after joining, a
   * reconnect or a game switch.
   */
  function handSwitch({ button, client, onChange }) {
    let lefty = store.get('hand', 'R') === 'L', sentAt = 0;
    const show = () => {
      button.textContent = lefty ? '🤚 Lefty' : '✋ Righty';
      button.classList.toggle('on', lefty);
      button.setAttribute('aria-pressed', String(lefty));
      button.title = lefty ? 'Playing left-handed: tap for right-handed' : 'Playing right-handed: tap for left-handed';
    };
    const send = () => { if (client && client.open) { sentAt = Date.now(); client.send({ t: 'hand', lefty }); } };
    button.addEventListener('click', () => { lefty = !lefty; store.set('hand', lefty ? 'L' : 'R'); show(); send(); if (onChange) onChange(lefty); });
    show();
    return {
      get lefty() { return lefty; },
      sync(st) {
        const me = st && st.players && st.you !== null && st.you !== undefined ? st.players[st.you] : null;
        if (me && !!me.lefty !== lefty && Date.now() - sentAt > 1500) send();
      },
    };
  }

  /*
   * Tilt up: raising the phone's top end (the way you'd lift your arm to toss a ball) fires onTilt once.
   * Set .on while it should listen. It fires when the top end rises at least 35° within 0.7 s and ends
   * up at least 50° above flat. Uses the phone's orientation, or gravity when there's no orientation.
   */
  function tiltUp({ onTilt }) {
    let on = false, hist = [], last = 0, orientAt = 0;
    const D = Math.PI / 180;
    const feed = (t, el) => {
      if (!on) return;
      hist.push({ t, el }); while (hist.length && hist[0].t < t - 700) hist.shift();
      let lo = el; for (const h of hist) lo = Math.min(lo, h.el);
      if (el >= 50 && el - lo >= 35 && t - last > 1500) { last = t; hist = []; onTilt(); }
    };
    root.addEventListener('deviceorientation', e => {
      if (e.beta === null || e.beta === undefined) return;
      orientAt = performance.now();
      feed(orientAt, Math.asin(Math.sin(e.beta * D)) / D);   // how far the top end points above flat
    });
    root.addEventListener('devicemotion', e => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.y === null || performance.now() - orientAt < 1000) return;   // (orientation is better when there is one)
      feed(performance.now(), Math.asin(Math.max(-1, Math.min(1, g.y / 9.81))) / D);
    });
    return { get on() { return on; }, set on(v) { if (!!v !== on) hist = []; on = !!v; } };
  }

  /*
   * Tilt to steer: tip the phone left or right, like a steering wheel. onSteer(x) gets -1 (full left) … 1
   * (full right) up to 12 times a second while .on (only when it changes, and every 0.4 s to say it's still
   * there). onValue(x) gets every update, for drawing. A swing (the phone spinning fast) reads as straight
   * ahead for a moment, so hitting the ball doesn't send your player off sideways.
   */
  function tiltSteer({ onSteer, onValue, dead = 0.1, full = 0.45 }) {
    let on = false, raw = 0, val = 0, sent = 0, sentAt = 0, busyUntil = 0, orientAt = 0, lastT = performance.now();
    const D = Math.PI / 180;
    // side: how far the right edge points down (1 = straight down). It reads the same held flat or upright.
    const feed = side => { const a = Math.abs(side); raw = a < dead ? 0 : Math.sign(side) * Math.min(1, (a - dead) / (full - dead)); };
    root.addEventListener('deviceorientation', e => {
      if (e.beta === null || e.beta === undefined || e.gamma === null || e.gamma === undefined) return;
      orientAt = performance.now();
      feed(Math.sin(e.gamma * D) * Math.cos(e.beta * D));
    });
    root.addEventListener('devicemotion', e => {
      const t = performance.now(), r = e.rotationRate;
      if (r && Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) > 250) busyUntil = t + 450;   // a swing
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null || t - orientAt < 1000) return;   // (orientation is better when there is one)
      feed(Math.max(-1, Math.min(1, -g.x / 9.81)));
    });
    setInterval(() => {
      const t = performance.now(), dt = Math.min(0.25, (t - lastT) / 1000); lastT = t;
      if (t < busyUntil) val = 0; else val += (raw - val) * (1 - Math.exp(-dt / 0.07));   // (a swing stops you at once)
      if (Math.abs(val) < 0.01) val = 0;
      if (onValue) onValue(val);
      if (on && (Math.abs(val - sent) > 0.05 || t - sentAt > 400)) { sent = val; sentAt = t; onSteer(Math.round(val * 100) / 100); }
    }, 80);
    return { get on() { return on; }, set on(v) { if (!!v !== on) sentAt = 0; on = !!v; }, get value() { return val; } };
  }

  /*
   * Live tilt: while .on, the big screen is told how the phone is being held, up to 10 times a second
   * (only when it changes), so the player on screen moves with you before the swing: the bat follows your
   * hands, the golf club goes back as you take it back, the bowling arm swings back.
   * onLive({ x, y }): x = how far the right edge tips down (-1..1), y = how far the top end points up (-1..1).
   */
  function liveTilt({ onLive }) {
    let on = false, x = 0, y = 0, sx = 0, sy = 0, sent = null, sentAt = 0, orientAt = 0, got = false;
    const D = Math.PI / 180;
    root.addEventListener('deviceorientation', e => {
      if (e.beta === null || e.beta === undefined || e.gamma === null || e.gamma === undefined) return;
      orientAt = performance.now(); got = true;
      x = Math.sin(e.gamma * D) * Math.cos(e.beta * D); y = Math.sin(e.beta * D);
    });
    root.addEventListener('devicemotion', e => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null || performance.now() - orientAt < 1000) return;
      got = true; x = Math.max(-1, Math.min(1, -g.x / 9.81)); y = Math.max(-1, Math.min(1, g.y / 9.81));
    });
    setInterval(() => {
      sx += (x - sx) * 0.55; sy += (y - sy) * 0.55;
      if (!on || !got) return;
      const t = performance.now();
      if (!sent || Math.abs(sx - sent.x) > 0.06 || Math.abs(sy - sent.y) > 0.06 || t - sentAt > 700) {
        sent = { x: Math.round(sx * 100) / 100, y: Math.round(sy * 100) / 100 }; sentAt = t; onLive(sent);
      }
    }, 100);
    return { get on() { return on; }, set on(v) { if (!!v && !on) sent = null; on = !!v; } };
  }

  root.SB = Object.assign(root.SB || {}, { liveTilt, repeatButton, makeSwingPad, keepAwake, store, clearUndo, esc, followSwitch, autoJoin, GAMES, handSwitch, tiltUp, tiltSteer });
})(self);
