/* Swing Bowl — shared touch-controller logic for the phone pages. */
(function (root) {
  'use strict';
  const { SwingDetector, FULL_PEAK } = root.SB;

  // Press-and-hold auto-repeat for the position / aim buttons.
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
   * Wire up the big HOLD button.
   * opts: { button, meter, canThrow(), onHold(on), onThrow({speed, spin, ...}), onHint(text), onNewGame?() }
   */
  function setupHold(opts) {
    const det = new SwingDetector();
    let tapMode = false, down = false, pressT = 0, startX = 0, curX = 0, raf = 0;
    const btn = opts.button, meter = opts.meter;
    const label = btn.querySelector('.lbl'), sub = btn.querySelector('small');

    function setLabels() {
      if (opts.isOver && opts.isOver()) { label.textContent = 'NEW GAME'; sub.textContent = 'tap to play again'; return; }
      label.textContent = tapMode ? 'HOLD' : 'HOLD & SWING';
      sub.textContent = tapMode ? 'release to throw · slide to spin' : 'let go to throw';
    }

    async function enable() {
      const perm = await SwingDetector.requestPermission();
      det.start();
      setTimeout(() => {
        if (!det.available) {
          tapMode = true;
          setLabels();
          opts.onHint(perm === 'denied'
            ? 'Motion access was denied, so you’re in tap mode. To swing for real: Settings › Safari › Motion & Orientation Access, then reload.'
            : 'No motion sensors found, so you’re in tap mode: hold to charge, release to throw.');
        }
      }, 1500);
      setLabels();
      return perm;
    }

    function loop() {
      if (!down) { meter.style.width = '0%'; return; }
      let v;
      if (tapMode) v = Math.min(1, (performance.now() - pressT) / 1400);
      else v = Math.min(1, det.live / FULL_PEAK);
      meter.style.width = (v * 100).toFixed(0) + '%';
      raf = requestAnimationFrame(loop);
    }

    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (opts.isOver && opts.isOver()) { if (opts.onNewGame) opts.onNewGame(); return; }
      if (!opts.canThrow()) return;
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      down = true; pressT = performance.now(); startX = curX = e.clientX;
      btn.classList.add('down');
      det.hold();
      opts.onHold(true);
      cancelAnimationFrame(raf); loop();
    });
    btn.addEventListener('pointermove', e => { if (down) curX = e.clientX; });

    const finish = (cancelled) => {
      if (!down) return;
      down = false;
      btn.classList.remove('down');
      opts.onHold(false);
      if (cancelled) { det.holding = false; return; }
      let res;
      if (tapMode) {
        const p = Math.min(1, (performance.now() - pressT) / 1400);
        res = { ok: p > 0.08, reason: 'weak', speed: 3 + p * 7.5, spin: Math.max(-1, Math.min(1, -(curX - startX) / 110)) };
      } else res = det.release();
      if (res.ok) opts.onThrow(res);
      else if (res.reason === 'weak') opts.onHint(tapMode ? 'Hold a little longer.' : 'Swing your arm harder, then let go during the swing.');
      else opts.onHint('No motion data yet. Give it a second, or check Motion & Orientation access.');
    };
    btn.addEventListener('pointerup', () => finish(false));
    btn.addEventListener('pointercancel', () => finish(false));

    // Keep iOS from scrolling / zooming while swinging.
    document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());

    return { det, enable, setLabels, get tapMode() { return tapMode; } };
  }

  async function keepAwake() {
    try { if (navigator.wakeLock) { let l = await navigator.wakeLock.request('screen'); document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { try { l = await navigator.wakeLock.request('screen'); } catch (e) {} } }); } } catch (e) {}
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

  root.SB = Object.assign(root.SB || {}, { repeatButton, setupHold, keepAwake, store, clearUndo });
})(self);
