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
  function clearUndo(container) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    (container || document).querySelectorAll('input[type=text], input:not([type]), textarea').forEach(el => {
      const fresh = el.cloneNode(true);
      fresh.value = el.value;
      el.replaceWith(fresh);
    });
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
  function followSwitch(m) {
    if (!m || !GAMES[m.game] || !/^[A-Z]{4}$/.test(m.room || '')) return false;
    location.href = new URL(`../${m.game}/controller.html?room=${m.room}&join=1`, location.href).href;
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

  root.SB = Object.assign(root.SB || {}, { repeatButton, makeSwingPad, keepAwake, store, clearUndo, esc, followSwitch, autoJoin, GAMES });
})(self);
