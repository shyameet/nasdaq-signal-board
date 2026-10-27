// Live prices for the tabs that don't come from Hyperliquid (owner 25/10/2026: "real time", no lag): the VPS's stream
// of NIFTY, BANKNIFTY, GIFTNIFTY, RELIANCE, HDFCBANK (Dhan), CRUDEOILM, NATGASMINI (Dhan, MCX) and MNQ, MCL, NG
// (NinjaTrader, CME). Its address is in data/live.json (the VPS rewrites it when its tunnel restarts). Messages, times
// in ms UTC: "snapshot" (today's UTC 1-minute candles so far + the forming one), "form" {s, t, o, h, l, c, v, x, r}
// the forming minute, at most 4 a second (it replaced "tick" {s, p, x: exchange time} on 25/10; both are read),
// "bar" {s, t, o, h, l, c, v} when a minute closes, "hb" every 5 s.
//
// Also the live-status dot every page shows in its top bar (owner 25/10/2026: show it and reconnect): green Live,
// amber Reconnecting, red Not live with the time of the last price; amber "Connected · no prices" when the stream answers
// but no price of the page's own markets came for 2 minutes (owner 27/10: its 5 s heartbeat alone kept the dot green with
// a feed down, or every market shut; and one feed's prices, MNQ's say, kept it green on a page whose feed was down).
// NsbStatus.add(name, fn) adds a feed; fn() returns
// { state: 'live' | 'quiet' | 'reconnecting' | 'down', last: ms of the last message, price: ms of the last price (optional) }.
(function () {
  const MIN = 60000;
  const ok = v => typeof v === 'number' && isFinite(v);

  // ---- the status dot ----
  const feeds = [];
  let dot = null;
  const css = `
    .lv { display: inline-flex; align-items: center; gap: 6px; font: 600 11.5px/1 inherit; color: var(--muted, #8d99ab); white-space: nowrap; }
    .lv i { width: 8px; height: 8px; border-radius: 50%; background: #5c6879; }
    .lv.live i { background: #2bb68a; box-shadow: 0 0 0 3px rgba(43, 182, 138, .18); }
    .lv.reconnecting i, .lv.quiet i { background: #f2b33d; }
    .lv.down { color: #f0555f; } .lv.down i { background: #f0555f; }`;
  const ago = ms => { const s = Math.round(ms / 1000); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
  function paint() {
    if (!dot || !feeds.length) return;
    const now = Date.now(), all = feeds.map(f => ({ name: f.name, ...f.fn() }));
    const rank = { live: 0, quiet: 1, reconnecting: 2, down: 3 }, worst = all.reduce((a, b) => rank[b.state] > rank[a.state] ? b : a);
    dot.className = 'lv ' + worst.state;
    dot.lastChild.textContent = worst.state === 'live' ? 'Live' : worst.state === 'quiet' ? 'Connected · no prices'
      : worst.state === 'reconnecting' ? 'Reconnecting…' : `Not live${worst.last ? ` · last ${ago(now - worst.last)} ago` : ''}`;
    dot.title = all.map(f => `${f.name}: ${f.state === 'live' ? 'live' : f.state === 'quiet' ? 'connected, no prices'
      : f.state === 'reconnecting' ? 'reconnecting' : 'not live'}`
      + (f.last ? ` (last message ${ago(now - f.last)} ago${f.price ? `, last price ${ago(now - f.price)} ago` : ''})` : '')).join('\n');
  }
  function mount() {
    const bar = document.querySelector('.topbar');
    if (!bar || dot) return;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    dot = document.createElement('span'); dot.className = 'lv'; dot.innerHTML = '<i></i><span>Connecting…</span>';
    const labels = bar.querySelector('.lb-btn');  // just before the Labels button
    if (labels) labels.before(dot); else bar.appendChild(dot);
    paint();
  }
  setInterval(paint, 1000);
  window.NsbStatus = {
    add(name, fn) { feeds.push({ name, fn }); if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); paint(); },
  };

  // ---- the VPS stream ----
  const store = {};  // instrument -> { bars: closed 1-minute candles {t, o, h, l, c, v} oldest first, cur: the forming one }
  const listeners = [];
  const priceAt = {};  // instrument -> ms of its last price (a bar, form or tick: not the heartbeat)
  let ws = null, lastMsg = 0, openedAt = 0, failingSince = 0, started = false;
  const S = s => store[s] || (store[s] = { bars: [], cur: null });
  const forming = x => x.cur && (!x.bars.length || x.cur.t > x.bars[x.bars.length - 1].t) ? x.cur : null;  // cur, unless its minute has closed since
  const row = r => Array.isArray(r) ? { t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] || 0 }
    : r && ok(+r.t) ? { t: +r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v || 0 } : null;
  function upsert(a, b) {
    if (!b || !ok(b.t) || !ok(b.c)) return;
    const n = a.length;
    if (n && a[n - 1].t === b.t) a[n - 1] = b;
    else if (!n || b.t > a[n - 1].t) a.push(b);
    else { const i = a.findIndex(x => x.t >= b.t); if (a[i].t === b.t) a[i] = b; else a.splice(i, 0, b); }
  }
  const tell = (kind, s) => { for (const fn of listeners) try { fn(kind, s); } catch (e) { /* one page's bug stays its own */ } };
  function handle(m) {
    lastMsg = Date.now(); failingSince = 0;
    if ((m.type === 'bar' || m.type === 'form' || m.type === 'tick') && m.s) priceAt[m.s] = lastMsg;  // a price, not the heartbeat
    if (m.type === 'snapshot') {
      for (const [s, rows] of Object.entries(m.candles || {})) { const x = S(s); for (const r of rows || []) upsert(x.bars, row(r)); }
      for (const [s, r] of Object.entries(m.forming || {})) {  // null clears a forming minute kept from before a reconnect (owner 27/10: its price stuck on the closed candle)
        const b = row(r); S(s).cur = b;
        if (b) priceAt[s] = lastMsg;
      }
      tell('snapshot');
    } else if (m.type === 'bar' && m.s) {
      const x = S(m.s), b = row(m);
      upsert(x.bars, b);
      if (x.cur && b && x.cur.t <= b.t) x.cur = null;
      tell('bar', m.s);
    } else if (m.type === 'tick' && m.s && ok(+m.p)) {
      const x = S(m.s), p = +m.p, t = Math.floor((ok(+m.x) ? +m.x : Date.now()) / MIN) * MIN;
      const last = x.bars[x.bars.length - 1];
      if (last && t <= last.t) return;  // a late tick of a minute already closed
      if (!x.cur || x.cur.t !== t) x.cur = { t, o: p, h: p, l: p, c: p, v: 0 };
      else { x.cur.c = p; x.cur.h = Math.max(x.cur.h, p); x.cur.l = Math.min(x.cur.l, p); }
      tell('tick', m.s);
    } else if (m.type === 'form' && m.s) {  // the forming minute as the stream has it (since 25/10, in place of "tick")
      const x = S(m.s), b = row(m), last = x.bars[x.bars.length - 1];
      if (!b || !ok(b.c) || (last && b.t <= last.t)) return;  // a minute already closed
      x.cur = b;
      tell('tick', m.s);  // the pages move their newest candle on 'tick'
    }
  }
  async function connect() {
    let url = null;
    try { url = (await (await fetch('data/live.json', { cache: 'no-store' })).json()).ws; } catch (e) { /* retried below */ }
    if (!url) { if (!failingSince) failingSince = Date.now(); setTimeout(connect, 5000); return; }
    const sock = ws = new WebSocket(url);
    sock.onopen = () => { openedAt = Date.now(); };
    sock.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (x) { /* not JSON */ } };
    sock.onclose = () => { if (ws !== sock) return; ws = null; if (!failingSince) failingSince = Date.now(); setTimeout(connect, 3000); };  // re-reads the address: it may have changed
    sock.onerror = () => sock.close();
  }
  setInterval(() => {  // a stream that went silent (no heartbeat for 20 s) is dropped and dialled again
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - Math.max(lastMsg, openedAt) > 20000) ws.close();
  }, 5000);
  window.NsbLive = {
    start(name = 'VPS live stream', markets = null) {  // markets(): the instruments the page shows, for its dot (all of them when not given)
      if (started) return; started = true;
      connect();
      NsbStatus.add(name, () => {
        const fresh = ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMsg < 15000;
        const price = Math.max(0, ...(markets ? markets() : Object.keys(priceAt)).map(s => priceAt[s] || 0));
        return { state: fresh ? (Date.now() - price < 2 * MIN ? 'live' : 'quiet')  // Live only while the page's prices come
                       : failingSince && Date.now() - failingSince > 60000 ? 'down' : 'reconnecting', last: lastMsg, price };
      });
    },
    on(fn) { listeners.push(fn); },  // fn(kind: 'snapshot' | 'bar' | 'tick' (the forming minute moved), instrument)
    bars(s) { const x = store[s]; return x ? x.bars.concat(forming(x) ? [x.cur] : []) : []; },  // closed + forming
    cur(s) { return store[s] ? forming(store[s]) : null; },
    has(s) { return !!(store[s] && (store[s].bars.length || store[s].cur)); },
  };
})();
