/*
 * Swing Bowl — phone <-> screen link.
 *
 * Messages are relayed through free public MQTT brokers over secure
 * WebSockets (wss://). Unlike a direct WebRTC link this works on any network
 * that can browse the web: no NAT traversal, no router "hairpinning", and it
 * doesn't matter whether the phone is on Wi-Fi or cellular.
 *
 * Topics:  swingbowl/v1/<ROOM>/up           phone  -> screen  {from, msg}
 *          swingbowl/v1/<ROOM>/down/<cid>   screen -> one phone
 *
 * The screen listens on every broker in BROKERS at once; a phone uses the
 * first one it can reach, so one broker being down doesn't break the game.
 */
(function (root) {
  'use strict';

  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ];
  const DEFAULT_NS = 'swingbowl/v1/';
  const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
  const PEER_TIMEOUT = 12000;   // ms without a message before someone counts as gone
  const HEARTBEAT = 3000;

  const randomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  const libLoaded = () => !!(root.mqtt && typeof root.mqtt.connect === 'function');
  const randId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clean = s => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const decode = p => (typeof p === 'string' ? p : new TextDecoder().decode(p));

  function connectBroker(url) {
    return root.mqtt.connect(url, {
      clientId: 'sb_' + randId(),
      keepalive: 20,
      reconnectPeriod: 2500,
      connectTimeout: 8000,
      clean: true,
    });
  }

  // ---------------- big screen ----------------
  class Host {
    constructor({ onStatus, onJoin, onMessage, onLeave, namespace }) {
      this.base = namespace || DEFAULT_NS;
      this.onStatus = onStatus || (() => {});
      this.onJoin = onJoin || (() => {});
      this.onMessage = onMessage || (() => {});
      this.onLeave = onLeave || (() => {});
      this.peers = new Map();     // cid -> { broker, seen }
      this.clients = [];
      this.code = null;
    }

    start(preferred) {
      if (!libLoaded()) { this.onStatus('offline', 'Could not load the connection library. Keyboard play still works.'); return; }
      this.code = /^[A-Z]{4}$/.test(preferred || '') ? preferred : randomCode();
      this.onStatus('connecting', 'Opening room…');
      let anyOpen = false, failures = 0;
      BROKERS.forEach((url, bi) => {
        const c = connectBroker(url);
        this.clients[bi] = c;
        c.on('connect', () => {
          c.subscribe(this.base + this.code + '/up', { qos: 0 });
          if (!anyOpen) { anyOpen = true; this.onStatus('open', this.code); }
        });
        c.on('message', (topic, payload) => {
          let m; try { m = JSON.parse(decode(payload)); } catch (e) { return; }
          const cid = clean(m && m.from);
          if (!cid || !m.msg) return;
          const known = this.peers.get(cid);
          this.peers.set(cid, { broker: bi, seen: Date.now() });
          if (!known) this.onJoin(cid);
          if (m.msg.t === 'sync') { this.send(cid, { t: 'sync', c: m.msg.c, h: performance.now() }); return; }   // clock sync for timing games
          if (m.msg.t !== 'ping') this.onMessage(cid, m.msg);
        });
        c.on('error', () => {
          if (!anyOpen && ++failures === BROKERS.length) this.onStatus('error', 'Can’t reach the relay servers. Check this computer’s internet connection. Keyboard play still works.');
        });
      });
      // forget phones that went quiet (closed tab, lost signal)
      setInterval(() => {
        const now = Date.now();
        for (const [cid, p] of this.peers) if (now - p.seen > PEER_TIMEOUT) { this.peers.delete(cid); this.onLeave(cid); }
      }, 2000);
    }

    send(cid, msg) {
      const p = this.peers.get(cid);
      const c = p && this.clients[p.broker];
      if (c && c.connected) c.publish(this.base + this.code + '/down/' + cid, JSON.stringify(msg), { qos: 0 });
    }
    broadcast(fn) { for (const cid of this.peers.keys()) this.send(cid, fn(cid)); }
  }

  // ---------------- phone ----------------
  class Client {
    constructor({ onStatus, onMessage, id, namespace }) {
      this.base = namespace || DEFAULT_NS;
      this.syncs = [];
      this.offset = 0;
      this.onStatus = onStatus || (() => {});
      this.onMessage = onMessage || (() => {});
      this.cid = clean(id) || randId();
      this.c = null;
      this.open = false;
      this.lastSeen = 0;
    }

    connect(code, hello) {
      if (!libLoaded()) { this.onStatus('error', 'Could not load the connection library. Check your internet connection and reload.'); return; }
      this.code = code; this.hello = hello;
      this.open = false;
      this._teardown();
      this.onStatus('connecting', 'Connecting to ' + code + '…');
      this._tryBroker(0);
    }

    _teardown() {
      clearInterval(this.helloTimer); clearInterval(this.beat); clearTimeout(this.giveUp); clearTimeout(this.brokerTimer);
      if (this.c) { try { this.c.end(true); } catch (e) {} this.c = null; }
    }

    _tryBroker(i) {
      if (i >= BROKERS.length) { this.onStatus('error', 'Can’t reach the relay servers. Check the phone’s internet connection (Wi-Fi or cellular) and try again.'); return; }
      const c = connectBroker(BROKERS[i]);
      this.c = c;
      let connected = false;
      const next = () => { if (connected || this.c !== c) return; try { c.end(true); } catch (e) {} this._tryBroker(i + 1); };
      this.brokerTimer = setTimeout(next, 7000);
      c.on('error', next);
      c.on('connect', () => {
        if (this.c !== c) return;
        const first = !connected;
        connected = true;
        clearTimeout(this.brokerTimer);
        c.subscribe(this.base + this.code + '/down/' + this.cid, { qos: 0 }, () => { if (first) this._handshake(); else this.send(this.hello); });
      });
      c.on('message', (topic, payload) => {
        let m; try { m = JSON.parse(decode(payload)); } catch (e) { return; }
        this.lastSeen = Date.now();
        if (!this.open) {
          this.open = true;
          clearInterval(this.helloTimer); clearTimeout(this.giveUp);
          this.onStatus('open', this.code);
        }
        if (m && m.t === 'who') { this._pub(this.hello); return; }
        if (m && m.t === 'sync') { this._onSync(m); return; }
        this.onMessage(m);
      });
      c.on('offline', () => { if (this.open && this.c === c) this.onStatus('connecting', 'Reconnecting…'); });
    }

    _handshake() {
      this._pub(this.hello);
      this.helloTimer = setInterval(() => this._pub(this.hello), 1500);
      this.giveUp = setTimeout(() => {
        if (this.open) return;
        clearInterval(this.helloTimer);
        this.onStatus('error', `No game found with code ${this.code}. Make sure the big screen is open and showing that code.`);
      }, 9000);
      // heartbeat so the screen knows we're still here; watch the screen's heartbeat too
      this.beat = setInterval(() => {
        this._pub({ t: 'ping' });
        if (this.open && Date.now() - this.lastSeen > PEER_TIMEOUT) { this.open = false; this.onStatus('closed', 'Lost contact with the big screen. Is it still open?'); }
      }, HEARTBEAT);
    }

    // ---- clock sync: estimate (screen clock - phone clock) from round trips ----
    startSync() {
      clearInterval(this.syncTimer);
      let n = 0;
      const ping = () => this.send({ t: 'sync', c: performance.now() });
      const burst = setInterval(() => { ping(); if (++n >= 8) clearInterval(burst); }, 200);
      this.syncTimer = setInterval(ping, 2500);
    }
    _onSync(m) {
      const now = performance.now(), rtt = now - m.c;
      if (rtt < 0 || rtt > 3000) return;
      this.syncs.push({ rtt, off: m.h + rtt / 2 - now });
      if (this.syncs.length > 12) this.syncs.shift();
      // trust the fastest round trips: least queuing delay, least asymmetry
      const best = [...this.syncs].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
      this.offset = best.reduce((a, s) => a + s.off, 0) / best.length;
      this.rtt = best[0].rtt;
      this.synced = this.syncs.length >= 3;
    }
    hostTime(local) { return (local ?? performance.now()) + this.offset; }

    _pub(msg) { if (this.c && this.c.connected) this.c.publish(this.base + this.code + '/up', JSON.stringify({ from: this.cid, msg }), { qos: 0 }); }
    send(msg) { if (this.open) this._pub(msg); }
  }

  root.SB = Object.assign(root.SB || {}, { Host, Client, randomCode, BROKERS, HEARTBEAT });
})(self);
