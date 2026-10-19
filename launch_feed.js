/* Read-only PumpPortal launch stream. No wallet, signing or trading APIs. */
(function (root) {
  'use strict';
  const ENDPOINT = 'wss://pumpportal.fun/api/data';
  const LIMIT = 1000;
  function positive(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function parseLaunch(message, now = Date.now()) {
    if (!message || message.txType !== 'create' || typeof message.mint !== 'string' ||
        !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(message.mint)) return null;
    return {mint: message.mint, name: String(message.name || 'Unnamed token').slice(0, 100),
      symbol: String(message.symbol || 'TOKEN').slice(0, 24), receivedAt: now,
      marketCapSol: positive(message.marketCapSol), initialBuy: positive(message.initialBuy),
      image: typeof message.image === 'string' ? message.image.slice(0,2048) : null,
      uri: typeof message.uri === 'string' ? message.uri.slice(0,2048) : null,
      creatorSol: positive(message.solAmount), signature: typeof message.signature === 'string' ? message.signature : null};
  }
  class Store {
    constructor(limit = LIMIT) { this.limit = limit; this.items = []; this.seen = new Set(); this.total = 0; this.arrivals = []; }
    add(message, now) {
      const token = parseLaunch(message, now);
      if (!token || this.seen.has(token.mint)) return null;
      this.seen.add(token.mint);
      // Bound memory without pretending the session is a complete chain archive.
      if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value);
      this.total++;
      this.arrivals.push(token.receivedAt);
      this.arrivals = this.arrivals.filter(t => token.receivedAt - t <= 60000);
      this.items.unshift(token);
      this.items.length = Math.min(this.items.length, this.limit);
      return token;
    }
    recentCount(now = Date.now()) { return this.arrivals.filter(t => now-t <= 60000).length; }
    select({search = '', age = 0, sort = 'newest', now = Date.now()} = {}) {
      const q = search.toLowerCase().trim();
      const result = this.items.filter(t => (!q || `${t.name} ${t.symbol} ${t.mint}`.toLowerCase().includes(q)) &&
        (!age || now - t.receivedAt <= age * 1000));
      if (sort === 'cap') result.sort((a,b) => (b.marketCapSol ?? -1) - (a.marketCapSol ?? -1));
      return result;
    }
  }
  class Connection {
    constructor({onToken, onStatus, WebSocketImpl = root.WebSocket, setTimer = setTimeout, clearTimer = clearTimeout}) {
      Object.assign(this, {onToken, onStatus, WebSocketImpl, setTimer, clearTimer});
      // Browser timer methods require the Window receiver on some engines.
      this.setTimer = (fn, delay) => setTimer.call(root, fn, delay);
      this.clearTimer = id => clearTimer.call(root, id);
      this.stopped = true; this.attempt = 0; this.generation = 0; this.gap = false;
      this.tradeTokens = [];
    }
    start() { if (!this.stopped) return; this.stopped = false; this.open(); }
    open() {
      if (this.stopped) return;
      const generation = ++this.generation;
      this.onStatus({state: 'connecting', gap: this.gap});
      let socket;
      try { socket = this.socket = new this.WebSocketImpl(ENDPOINT); }
      catch (_) { this.retry(); return; }
      socket.onopen = () => {
        if (this.stopped || generation !== this.generation) return;
        socket.send(JSON.stringify({method: 'subscribeNewToken'}));
        if(this.tradeTokens.length)socket.send(JSON.stringify({method:'subscribeTokenTrade',keys:this.tradeTokens}));
        this.attempt = 0;
        this.onStatus({state: 'connected', gap: this.gap});
      };
      socket.onmessage = event => {
        if (this.stopped || generation !== this.generation) return;
        try {
          const message = JSON.parse(event.data);
          if (message.errors || message.error) {
            this.onStatus({state: 'provider_error', gap: true});
            this.stop(false);
            return;
          }
          this.onToken(message);
        } catch (_) { /* Ignore malformed provider messages; never render raw HTML. */ }
      };
      socket.onerror = () => { if (!this.stopped && generation === this.generation) socket.close(); };
      socket.onclose = () => {
        if (this.stopped || generation !== this.generation) return;
        this.retry();
      };
    }
    retry() {
      if (this.stopped) return;
      this.gap = true;
      this.onStatus({state: 'reconnecting', gap: true});
      this.clearTimer(this.timer);
      this.timer = this.setTimer(() => this.open(), Math.min(30000, 1000 * 2 ** this.attempt++));
    }
    stop(announce = true) {
      this.stopped = true; this.gap = true; ++this.generation;
      this.clearTimer(this.timer);
      if (this.socket) this.socket.close();
      if (announce) this.onStatus({state: 'paused', gap: true});
    }
    reconnect() { this.stop(false); this.start(); }
    setTradeTokens(tokens) {
      const next=[...new Set(tokens.filter(t=>typeof t==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)))].slice(0,25);
      const removed=this.tradeTokens.filter(t=>!next.includes(t)), added=next.filter(t=>!this.tradeTokens.includes(t));
      this.tradeTokens=next;
      if(!this.stopped && this.socket?.readyState===1) {
        if(removed.length)this.socket.send(JSON.stringify({method:'unsubscribeTokenTrade',keys:removed}));
        if(added.length)this.socket.send(JSON.stringify({method:'subscribeTokenTrade',keys:added}));
      }
    }
  }
  const api = {parseLaunch, Store, Connection};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PumpLaunchFeed = api;
})(typeof window !== 'undefined' ? window : globalThis);
