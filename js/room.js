/*
 * Shared big-screen room logic for the newer games (golf, baseball):
 * opens a room, shows the QR/lobby, maps phones to players, queues late
 * joiners, and pushes each phone its own view of the game state.
 */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GAMES = [
    { id: 'bowling', icon: '🎳', name: 'Bowling', sub: 'Swing and let go' },
    { id: 'golf', icon: '⛳', name: 'Golf', sub: 'Three holes' },
    { id: 'baseball', icon: '⚾', name: 'Home Run Derby', sub: 'Swing at the pitch' },
    { id: 'tennis', icon: '🎾', name: 'Tennis', sub: 'Two players, or vs the computer' },
  ];
  const HUB = { id: 'hub', icon: '🏟️', name: 'All games', sub: 'Back to the menu' };

  class Room {
    /*
     * opts: {
     *   namespace, storageKey,
     *   game: { addPlayer(name)->idx, renamePlayer(i,name), canJoinNow(), info(), input(idx,msg), newGame(), setHand?(idx, lefty) },
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
        onStatus: (k, t) => this._status(k, t),
        onJoin: id => { this.conns.set(id, { cid: null, idx: null }); this.host.send(id, { t: 'who' }); },
        onLeave: id => { this.conns.delete(id); this.renderLobby(); },
        onMessage: (id, m) => this._msg(id, m),
      });
    }

    start() {
      let pref = null; try { pref = sessionStorage.getItem('sb-room'); } catch (e) {}   // one code for the whole visit, whatever the game
      // coming from another game: same room code, same players (their phones are on their way)
      const handoff = this._handoff();
      if (handoff) pref = handoff.room;
      this.host.start(pref);
      if (handoff) this._adopt(handoff.players);
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
          setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.textContent = '✕'; } }, 5000);
          return;
        }
        const [kind, key] = b.dataset.kick.split(':');
        if (kind === 'p') this.kick(+key); else this.kickQueued(key);
      });
      if (!this.o.noSwitcher) this._switcher();
      this.renderLobby();
      if (handoff) this.hide();
    }

    // ---------- switching games mid-match ----------
    _handoff() {
      try {
        const h = JSON.parse(sessionStorage.getItem('sb-handoff') || 'null');
        sessionStorage.removeItem('sb-handoff');
        if (h && h.to === this.o.gameId && Date.now() - h.at < 120000 && /^[A-Z]{4}$/.test(h.room)) return h;
      } catch (e) {}
      return null;
    }
    _adopt(players) {
      const g = this.o.game;
      for (const p of (players || []).slice(0, 6)) {
        const i = g.addPlayer(String(p.name || '').slice(0, 14));
        if (i >= 0 && p.cid) this.byClient.set(String(p.cid), i);
      }
    }
    _switcher() {
      const id = this.o.gameId;
      if (!id) return;
      const ov = document.createElement('div');
      ov.className = 'switcher'; ov.hidden = true;
      ov.innerHTML = `<div class="card"><h2>Switch game</h2><p>Everyone's phone comes along: the room code stays the same in every game. This game ends here.</p>
        <div class="games">${GAMES.concat(HUB).map(g => `<button type="button" data-game="${g.id}" class="${g.id === id ? 'now' : ''}"><span>${g.icon}</span>${g.name}<small>${g.id === id ? 'playing now' : g.sub}</small></button>`).join('')}</div>
        <button type="button" class="btn ghost" data-close>Keep playing</button></div>`;
      ov.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (e.target === ov || (b && b.hasAttribute('data-close'))) { ov.hidden = true; return; }
        if (b && b.dataset.game && b.dataset.game !== id) this.switchTo(b.dataset.game);
      });
      document.body.appendChild(ov);
      this.switcherEl = ov;
      const corner = $('corner');
      if (corner) { const b = document.createElement('button'); b.textContent = 'Switch game'; b.onclick = () => { ov.hidden = false; }; corner.insertBefore(b, $('mute') || null); }
      const card = $('lobby') && $('lobby').querySelector('.lobby > div:last-child');
      if (card) {
        const row = document.createElement('div'); row.className = 'switchrow';
        row.innerHTML = '<span>Or play:</span>' + GAMES.filter(g => g.id !== id).map(g => `<button type="button" class="btn ghost" data-game="${g.id}">${g.icon} ${g.name}</button>`).join('');
        row.addEventListener('click', e => { const b = e.target.closest('button[data-game]'); if (b) this.switchTo(b.dataset.game); });
        card.insertBefore(row, card.querySelector('.keys'));
      }
      addEventListener('keydown', e => { if (e.code === 'KeyG' && !e.repeat) ov.hidden = !ov.hidden; });
    }
    // Go to another game, taking everyone along: the phones are told to follow, and the new page
    // opens the same room code with the same players in the same order.
    switchTo(id) {
      if (this.switching) return;
      this.switching = true;
      const info = this.o.game.info(), code = this.host.code;
      const owner = i => { for (const [cid, k] of this.byClient) if (k === i) return cid; return null; };
      const players = info.players.map((p, i) => ({ name: p.name, cid: owner(i) })).concat(this.queue.map(q => ({ name: q.name, cid: q.cid })));
      try { sessionStorage.setItem('sb-handoff', JSON.stringify({ to: id, room: code, players, at: Date.now() })); } catch (e) {}
      const msg = { t: 'switch', game: id, room: code };
      if (code) { this.host.shout(msg); setTimeout(() => this.host.shout(msg), 250); }
      if (this.switcherEl) this.switcherEl.querySelector('p').textContent = 'Switching… phones are following along.';
      setTimeout(() => { location.href = new URL(`${this.o.root || '../'}${id === 'hub' ? '' : id + '/'}`, location.href).href; }, code ? 600 : 0);
    }

    hide() { $('lobby').hidden = true; }
    show() { $('lobby').hidden = false; this.renderLobby(); }

    _status(kind, text) {
      const st = $('status');
      st.classList.toggle('err', kind === 'error' || kind === 'offline');
      if (kind === 'open') {
        try { sessionStorage.setItem('sb-room', text); } catch (e) {}
        // phones still on another game's controller (the big screen came here some other way): bring them along
        const here = { t: 'switch', game: this.o.gameId, room: text };
        if (this.o.gameId) [0, 1200, 3500].forEach(ms => setTimeout(() => this.host.shout(here), ms));
        $('code').textContent = text; $('cornerCode').textContent = text;
        const url = new URL(this.o.joinPage || 'controller.html', location.href); url.search = '?room=' + text; url.hash = '';
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
        // a phone on another game's controller, with the right room code: send it here
        if (m.g && this.o.gameId && m.g !== this.o.gameId) { this.host.send(id, { t: 'switch', game: this.o.gameId, room: this.host.code }); return; }
        const name = String(m.name || '').trim().slice(0, 14);
        c.cid = String(m.id || id);
        if (this.kicked.has(c.cid)) {
          if (!m.rejoin) { c.idx = null; this.host.send(id, { t: 'kicked' }); return; }
          this.kicked.delete(c.cid);
        }
        const owned = new Set(this.byClient.values());
        const spare = g.info().players.findIndex((p, i) => !owned.has(i));
        if (this.byClient.has(c.cid)) { c.idx = this.byClient.get(c.cid); if (name) g.renamePlayer(c.idx, name); }
        // a player made from the keyboard or the Start button, with no phone yet: this phone takes it over
        else if (spare >= 0 && !g.info().started) { c.idx = spare; this.byClient.set(c.cid, spare); g.renamePlayer(spare, name || g.info().players[spare].name); }
        else if (g.canJoinNow()) { c.idx = g.addPlayer(name); this.byClient.set(c.cid, c.idx); }
        else if (!this.queue.find(q => q.cid === c.cid)) this.queue.push({ cid: c.cid, name });
        this.renderLobby(); this.push();
        return;
      }
      if (c.cid && this.kicked.has(c.cid)) { this.host.send(id, { t: 'kicked' }); return; }
      if (m.t === 'name' && c.idx !== null) { g.renamePlayer(c.idx, m.name); return; }
      if (m.t === 'newgame') { if (g.info().over || !g.info().started) { this.newGame(); this.hide(); } return; }
      if (c.idx === null || c.idx < 0) return;
      if (m.t === 'live') { g.live = { idx: c.idx, x: Math.max(-1, Math.min(1, +m.x || 0)), y: Math.max(-1, Math.min(1, +m.y || 0)), at: performance.now() }; return; }   // the phone's tilt, live: the player on screen follows it
      if (m.t === 'hand') { if (g.setHand) g.setHand(c.idx, !!m.lefty); return; }   // the lefty / righty switch on the phone
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

  root.SB = Object.assign(root.SB || {}, { Room, esc, GAME_LIST: GAMES });
})(self);
