/*
 * Swing Bowl — phone <-> screen link over WebRTC, using PeerJS and its free
 * public signalling server. After the handshake, messages go device-to-device.
 */
(function (root) {
  'use strict';

  const PREFIX = 'swingbowl-v1-';
  const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

  const randomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  const peerAvailable = () => typeof root.Peer === 'function';

  // The big screen. Controllers connect to it by room code.
  class Host {
    constructor({ onStatus, onJoin, onMessage, onLeave }) {
      this.onStatus = onStatus || (() => {});
      this.onJoin = onJoin || (() => {});
      this.onMessage = onMessage || (() => {});
      this.onLeave = onLeave || (() => {});
      this.conns = new Map();
      this.code = null;
      this.tries = 0;
    }

    start(preferred) {
      if (!peerAvailable()) { this.onStatus('offline', 'Could not load the connection library (PeerJS). Keyboard play still works.'); return; }
      const code = preferred || randomCode();
      this.onStatus('connecting', 'Opening room…');
      const peer = new root.Peer(PREFIX + code, { debug: 1 });
      this.peer = peer;
      peer.on('open', () => { this.code = code; this.tries = 0; this.onStatus('open', code); });
      peer.on('connection', conn => this._wire(conn));
      peer.on('disconnected', () => { if (!peer.destroyed) { this.onStatus('connecting', 'Reconnecting…'); try { peer.reconnect(); } catch (e) {} } });
      peer.on('error', err => {
        if (err.type === 'unavailable-id' && this.tries++ < 5) { peer.destroy(); this.start(); return; }
        if (err.type === 'peer-unavailable') return;
        this.onStatus('error', 'Connection problem: ' + (err.type || err.message));
      });
    }

    _wire(conn) {
      conn.on('open', () => { this.conns.set(conn.peer, conn); this.onJoin(conn.peer); });
      conn.on('data', d => { try { this.onMessage(conn.peer, typeof d === 'string' ? JSON.parse(d) : d); } catch (e) {} });
      const gone = () => { if (this.conns.delete(conn.peer)) this.onLeave(conn.peer); };
      conn.on('close', gone);
      conn.on('error', gone);
    }

    send(id, msg) { const c = this.conns.get(id); if (c && c.open) c.send(msg); }
    broadcast(fn) { for (const id of this.conns.keys()) this.send(id, fn(id)); }
  }

  // The phone.
  class Client {
    constructor({ onStatus, onMessage }) {
      this.onStatus = onStatus || (() => {});
      this.onMessage = onMessage || (() => {});
      this.conn = null;
    }

    connect(code, hello) {
      if (!peerAvailable()) { this.onStatus('error', 'Could not load the connection library. Check your internet connection.'); return; }
      this.code = code; this.hello = hello;
      this.onStatus('connecting', 'Connecting to ' + code + '…');
      if (!this.peer || this.peer.destroyed) {
        this.peer = new root.Peer({ debug: 1 });
        this.peer.on('open', () => this._dial());
        this.peer.on('error', err => {
          const why = err.type === 'peer-unavailable' ? `No game found with code ${this.code}. Check the code on the big screen.` : 'Connection problem: ' + (err.type || err.message);
          this.onStatus('error', why);
        });
        this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) {} });
      } else if (this.peer.open) this._dial();
    }

    _dial() {
      if (this.conn) { try { this.conn.close(); } catch (e) {} }
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.conn = conn;
      const timer = setTimeout(() => { if (!conn.open) this.onStatus('error', 'Timed out. Are both devices online? Try again.'); }, 12000);
      conn.on('open', () => { clearTimeout(timer); this.onStatus('open', this.code); this.send(this.hello); });
      conn.on('data', d => this.onMessage(d));
      conn.on('close', () => { if (this.conn === conn) this.onStatus('closed', 'Disconnected from the big screen.'); });
    }

    send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }
    get open() { return !!(this.conn && this.conn.open); }
  }

  root.SB = Object.assign(root.SB || {}, { Host, Client, randomCode, peerAvailable });
})(self);
