/*
 * Shared big-screen room logic for the newer games (golf, baseball):
 * opens a room, shows the QR/lobby, maps phones to players, queues late
 * joiners, and pushes each phone its own view of the game state.
 */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  class Room {
    /*
     * opts: {
     *   namespace, storageKey,
     *   game: { addPlayer(name)->idx, renamePlayer(i,name), canJoinNow(), info(), input(idx,msg), newGame() },
     *   stateFor(idx, info) -> extra fields for that phone's state message,
     *   onCommand(idx, msg) optional pre-handler (return true if handled)
     *   hideOn: message types that close the lobby (default ['swing'])
     * }
     * The game must also offer removePlayer(idx) for kicking players.
     * Expects elements: code, cornerCode, joinurl, status, qr, players, lobby, start, newgame
     */
    constructor(opts) {
      this.o = opts;
      this.conns = new Map();
      this.byClient = new Map();
      this.queue = [];
      this.kicked = new Set();   // controller ids removed by the host; they only come back via "Join again"
      this.hideOn = opts.hideOn || ['swing'];
      this.host = new root.SB.Host({
        namespace: opts.namespace,
        onStatus: (k, t) => this._status(k, t),
        onJoin: id => { this.conns.set(id, { cid: null, idx: null }); this.host.send(id, { t: 'who' }); },
        onLeave: id => { this.conns.delete(id); this.renderLobby(); },
        onMessage: (id, m) => this._msg(id, m),
      });
    }

    start() {
      let pref = null; try { pref = sessionStorage.getItem(this.o.storageKey); } catch (e) {}
      this.host.start(pref);
      setInterval(() => this.push(), root.SB.HEARTBEAT);
      $('start').onclick = () => { const g = this.o.game; if (!g.info().players.length) g.addPlayer('Player 1'); if (g.info().over) this.newGame(); this.hide(); };
      $('newgame').onclick = () => { this.newGame(); this.hide(); };
      if ($('showLobby')) $('showLobby').onclick = () => { $('lobby').hidden = false; this.renderLobby(); };
      $('lobby').addEventListener('click', e => { if (e.target === $('lobby') && this.o.game.info().players.length) this.hide(); });
      // ✕ on a player chip: first tap asks, second tap removes
      $('players').addEventListener('click', e => {
        const b = e.target.closest('button[data-kick]');
        if (!b) return;
        e.stopPropagation();
        if (!b.classList.contains('confirm')) {
          b.classList.add('confirm'); b.textContent = 'Remove?';
          setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.textContent = '✕'; } }, 3000);
          return;
        }
        const [kind, key] = b.dataset.kick.split(':');
        if (kind === 'p') this.kick(+key); else this.kickQueued(key);
      });
      this.renderLobby();
    }

    hide() { $('lobby').hidden = true; }
    show() { $('lobby').hidden = false; this.renderLobby(); }

    _status(kind, text) {
      const st = $('status');
      st.classList.toggle('err', kind === 'error' || kind === 'offline');
      if (kind === 'open') {
        try { sessionStorage.setItem(this.o.storageKey, text); } catch (e) {}
        $('code').textContent = text; $('cornerCode').textContent = text;
        const url = new URL('controller.html', location.href); url.search = '?room=' + text; url.hash = '';
        $('joinurl').textContent = url.href;
        const el = $('qr'); el.innerHTML = '';
        if (typeof root.QRCode === 'function') new root.QRCode(el, { text: url.href, width: 220, height: 220, correctLevel: root.QRCode.CorrectLevel.M });
        else el.textContent = 'Open the link below on your phone';
        st.textContent = 'Room open. Waiting for players…';
      } else st.textContent = text;
      if (kind === 'offline') $('qr').textContent = 'Phone controllers need an internet connection. You can still play with the keyboard.';
    }

    _msg(id, m) {
      const c = this.conns.get(id); if (!c || !m) return;
      const g = this.o.game;
      if (m.t === 'hello') {
        const name = String(m.name || '').trim().slice(0, 14);
        c.cid = String(m.id || id);
        if (this.kicked.has(c.cid)) {
          if (!m.rejoin) { c.idx = null; this.host.send(id, { t: 'kicked' }); return; }
          this.kicked.delete(c.cid);
        }
        if (this.byClient.has(c.cid)) { c.idx = this.byClient.get(c.cid); if (name) g.renamePlayer(c.idx, name); }
        else if (g.canJoinNow()) { c.idx = g.addPlayer(name); this.byClient.set(c.cid, c.idx); }
        else if (!this.queue.find(q => q.cid === c.cid)) this.queue.push({ cid: c.cid, name });
        this.renderLobby(); this.push();
        return;
      }
      if (c.cid && this.kicked.has(c.cid)) { this.host.send(id, { t: 'kicked' }); return; }
      if (m.t === 'name' && c.idx !== null) { g.renamePlayer(c.idx, m.name); return; }
      if (m.t === 'newgame') { if (g.info().over || !g.info().started) { this.newGame(); this.hide(); } return; }
      if (c.idx === null || c.idx < 0) return;
      if (this.o.onCommand && this.o.onCommand(c.idx, m)) return;
      if (g.input(c.idx, m) && this.hideOn.includes(m.t)) this.hide();
    }

    // Remove a player from the game (works mid-round). Their phone is told and
    // can't rejoin by accident; it has to tap "Join again".
    kick(idx) {
      const g = this.o.game;
      if (!g.info().players[idx]) return;
      for (const [cid, i] of [...this.byClient]) if (i === idx) { this.kicked.add(cid); this.byClient.delete(cid); }
      for (const [id, c] of this.conns) {
        if (c.idx === idx) { c.idx = null; this.host.send(id, { t: 'kicked' }); }
        else if (c.idx !== null && c.idx > idx) c.idx--;
      }
      for (const [cid, i] of this.byClient) if (i > idx) this.byClient.set(cid, i - 1);
      g.removePlayer(idx);
      this.renderLobby(); this.push();
    }
    kickQueued(cid) {
      this.queue = this.queue.filter(q => q.cid !== cid);
      this.kicked.add(cid);
      for (const [id, c] of this.conns) if (c.cid === cid) this.host.send(id, { t: 'kicked' });
      this.renderLobby();
    }

    newGame() {
      const g = this.o.game;
      while (this.queue.length) {
        const q = this.queue.shift();
        const i = g.addPlayer(q.name);
        if (i >= 0) { this.byClient.set(q.cid, i); for (const c of this.conns.values()) if (c.cid === q.cid) c.idx = i; }
      }
      g.newGame();
      this.renderLobby();
    }

    push() {
      const info = this.o.game.info();
      this.host.broadcast(id => {
        const c = this.conns.get(id) || {};
        if (c.cid && this.kicked.has(c.cid)) return { t: 'kicked' };
        const idx = c.idx ?? null;
        const queued = !!(c.cid && this.queue.find(q => q.cid === c.cid));
        return Object.assign({ t: 'state', you: idx, queued, over: info.over, started: info.started, players: info.players, cur: info.cur }, this.o.stateFor(idx, info));
      });
    }

    renderLobby() {
      const info = this.o.game.info();
      const online = new Set([...this.conns.values()].map(c => c.idx));
      $('players').innerHTML = info.players.map((p, i) => `<span class="chip ${online.has(i) ? '' : 'off'}"><i style="background:${p.color}"></i>${esc(p.name)}<button class="kick" data-kick="p:${i}" title="Remove ${esc(p.name)}">✕</button></span>`).join('')
        + this.queue.map(q => `<span class="chip off">${esc(q.name || 'Player')} · next game<button class="kick" data-kick="q:${esc(q.cid)}" title="Remove">✕</button></span>`).join('');
      $('start').hidden = info.started && !info.over;
      $('start').textContent = info.over ? 'Play again' : info.players.length ? 'Start game' : 'Play with keyboard';
      $('newgame').hidden = !(this.queue.length && info.started && !info.over);
      $('newgame').textContent = 'Restart with new players';
    }
  }

  root.SB = Object.assign(root.SB || {}, { Room, esc });
})(self);
