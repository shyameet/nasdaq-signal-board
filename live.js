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
// { state: 'live' | 'quiet' | 'locked' | 'reconnecting' | 'down', last: ms of the last message, price: ms of the last
// price (optional) }.
//
// The password for live prices (owner 27/10/2026, "9b": one shared password; the saved days stay public): asked only when
// the VPS has one set, in a small box beside the dot, and kept in this browser (localStorage) until it is wrong or
// forgotten (the key button beside the dot: change or forget it). It is sent as the first message on the open socket,
// over wss:// only, never in a URL. The stream's answer to a socket without the right one: an empty "snapshot" with
// login: 'needed' | 'wrong' | 'wait' (retry: s), then it closes the socket (a stream with no password set ignores it).
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
    .lv.reconnecting i, .lv.quiet i, .lv.locked i { background: #f2b33d; }
    .lv.down { color: #f0555f; } .lv.down i { background: #f0555f; }
    .lvk { display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--line, #1c2430);
           border-radius: 6px; background: transparent; color: var(--muted, #8d99ab); cursor: pointer; }
    .lvk:hover { color: var(--text, #e8eef6); border-color: var(--line-strong, #283240); }
    .lvpw { display: inline-flex; align-items: center; gap: 6px; color: var(--muted, #8d99ab); font-size: 12px; white-space: nowrap; }
    .lvpw.warn .lvpw-msg { color: var(--warn, #f2b33d); }
    .lvpw input { width: 150px; padding: 3px 7px; border: 1px solid var(--line-strong, #283240); border-radius: 7px;
                  background: var(--bg, #0a0d12); color: var(--text, #e8eef6); font: inherit; }
    .lvpw button { padding: 3px 9px; border: 1px solid var(--line, #1c2430); border-radius: 7px; background: transparent;
                   color: var(--muted, #8d99ab); cursor: pointer; font-size: 12px; }
    .lvpw button:hover { color: var(--text, #e8eef6); border-color: var(--line-strong, #283240); }
    .lvpw .go { border-color: var(--accent, #5b8cff); background: var(--accent, #5b8cff); color: #fff; font-weight: 600; }
    .lvpw[hidden], .lvk[hidden], .lvpw button[hidden] { display: none; }`;
  const ago = ms => { const s = Math.round(ms / 1000); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
  function paint() {
    if (!dot || !feeds.length) return;
    const now = Date.now(), all = feeds.map(f => ({ name: f.name, ...f.fn() }));
    const rank = { live: 0, quiet: 1, locked: 2, reconnecting: 2, down: 3 }, worst = all.reduce((a, b) => rank[b.state] > rank[a.state] ? b : a);
    dot.className = 'lv ' + worst.state;
    dot.lastChild.textContent = worst.state === 'live' ? 'Live' : worst.state === 'quiet' ? 'Connected · no prices'
      : worst.state === 'locked' ? 'Password needed'
      : worst.state === 'reconnecting' ? 'Reconnecting…' : `Not live${worst.last ? ` · last ${ago(now - worst.last)} ago` : ''}`;
    dot.title = all.map(f => `${f.name}: ${f.state === 'live' ? 'live' : f.state === 'quiet' ? 'connected, no prices'
      : f.state === 'locked' ? 'needs the password for live prices'
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
    paint(); pwShow();
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
  let dials = 0, dialT = 0;  // connect() calls so far (only the newest one opens a socket), the timer of the next one
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
    if (m.type === 'snapshot' && m.login) { refused(m); return; }  // no prices: the stream wants the password (below)
    lastMsg = Date.now(); failingSince = 0;
    if ((m.type === 'bar' || m.type === 'form' || m.type === 'tick') && m.s) priceAt[m.s] = lastMsg;  // a price, not the heartbeat
    if (m.type === 'snapshot') {
      if (ask) { ask = null; pwShow(); }  // let in
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
    const my = ++dials; clearTimeout(dialT);
    let url = null;
    try { url = (await (await fetch('data/live.json', { cache: 'no-store' })).json()).ws; } catch (e) { /* retried below */ }
    if (my !== dials) return;  // dialled again meanwhile (a password typed)
    if (!url) { if (!failingSince) failingSince = Date.now(); dialT = setTimeout(connect, 5000); return; }
    const sock = ws = new WebSocket(url);
    sock.onopen = () => {
      openedAt = Date.now(); sentPw = null;
      const p = pw.get();  // the first message, over TLS only: never in the URL (a stream with no password set ignores it)
      if (p && safeForPw(url)) { sentPw = p; try { sock.send(JSON.stringify({ pw: p })); } catch (e) { /* closing */ } }
    };
    sock.onmessage = e => { if (ws !== sock) return; try { handle(JSON.parse(e.data)); } catch (x) { /* not JSON */ } };  // (a socket replaced by a redial: no more)
    sock.onclose = () => {  // re-reads the address: it may have changed; asked/waiting: a slow poll, so the page notices
      if (ws !== sock) return; ws = null; if (!failingSince) failingSince = Date.now();   // the login being switched off or the wait ending (L5)
      let delay = 3000;
      if (ask === 'wait') delay = Math.min(900000, Math.max(1000, waitUntil - Date.now()));
      else if (ask) delay = 15000;  // 'needed' / 'wrong', no password to send: poll to see the login switched off
      dialT = setTimeout(connect, delay);
    };
    sock.onerror = () => sock.close();
  }
  // the password goes out only over TLS, or to this machine for a test; never with a userinfo (user:pass@) part (L7)
  function safeForPw(url) {
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    if (u.username || u.password) return false;
    if (u.protocol === 'wss:') return true;
    return u.protocol === 'ws:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  }
  function redial() {  // a password typed or forgotten: a fresh socket at once
    const s = ws; ws = null;
    if (s) s.close();  // its onclose sees ws !== sock: nothing more
    connect();
  }

  // ---- the password for live prices (owner 27/10/2026, "9b"; see the top) ----
  const PW_KEY = 'nsb.livePw';
  let pwMem = null, noStore = false;  // also kept here: a browser that keeps no localStorage asks once a page
  const pw = {
    get() { if (noStore) return pwMem; try { return localStorage.getItem(PW_KEY) || null; } catch (e) { return pwMem; } },
    set(v) { pwMem = v || null; try { if (v) localStorage.setItem(PW_KEY, v); else localStorage.removeItem(PW_KEY); noStore = false; } catch (e) { noStore = true; } },
  };
  let ask = null, waitUntil = 0, sentPw = null, ui = null;  // ask: why the stream wants it ('needed' | 'wrong' | 'wait'), null while it doesn't
  function refused(m) {  // the stream's empty snapshot with login: no prices on this socket, which it closes
    const why = m.login === 'wrong' || m.login === 'wait' ? m.login : 'needed', s = ws;
    if (why === 'wrong' && sentPw && pw.get() === sentPw) pw.set(null);  // wrong: forgotten here (mistyped, or changed on the VPS)
    const haveUnsent = !sentPw && pw.get() && safeForPw(s ? s.url : '');  // a password stored in another tab since this socket opened
    ask = (why === 'needed' && haveUnsent) ? null : why;                  // dial again with it rather than ask
    if (why === 'wait') waitUntil = Date.now() + 1000 * Math.min(900, Math.max(1, +m.retry || 60));  // one more try when it says (clamped)
    pwShow();
    if (s) s.close();  // onclose schedules the next connect (L5): 'wait' at waitUntil, 'needed'/'wrong' a slow poll, else 3 s
  }
  function pwShow() {  // the box while the stream asks or the key button opened it; the key button while a password is kept
    if (!started || !dot || (!ui && !ask && !pw.get())) return;
    if (!ui) {
      const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
      ui = { key: el('button', 'lvk'), box: el('span', 'lvpw'), msg: el('span', 'lvpw-msg'), input: el('input', ''),
             go: el('button', 'go', 'OK'), forget: el('button', 'forget', 'Forget'), close: el('button', 'close', '×'), open: false };
      const { key, box, msg, input, go, forget, close } = ui;
      for (const b of [key, go, forget, close]) b.type = 'button';
      key.title = 'Password for live prices: change or forget it'; key.setAttribute('aria-label', key.title);
      key.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" '
        + 'stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="11" r="3"/><path d="M7.2 8.8 14 2M11.5 4.5l2 2M9.5 6.5l1.5 1.5"/></svg>';
      box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Password for live prices');
      input.type = 'password'; input.setAttribute('autocomplete', 'current-password'); input.setAttribute('maxlength', '200');
      input.setAttribute('aria-label', 'Password for live prices'); input.spellcheck = false;
      forget.title = 'Forget it on this device'; close.title = 'Close';
      box.append(msg, input, go, forget, close);
      dot.after(key, box);
      const done = () => { input.value = ''; ui.open = false; pwShow(); };
      const enter = () => {
        const v = input.value.trim();
        if (!v) { input.focus(); return; }
        pw.set(v); ask = null; done(); redial();
      };
      go.addEventListener('click', enter);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); enter(); } else if (e.key === 'Escape' && !ask) done(); });
      forget.addEventListener('click', () => { pw.set(null); done(); redial(); });  // the stream asks again if it has a password set
      close.addEventListener('click', done);
      key.addEventListener('click', () => { ui.open = !ui.open; pwShow(); if (ui.open) input.focus(); });
    }
    const open = !!ask || ui.open, kept = !!pw.get();
    ui.box.hidden = !open; ui.key.hidden = open || !kept; ui.forget.hidden = !kept; ui.close.hidden = !!ask;
    ui.box.className = 'lvpw' + (ask === 'wrong' || ask === 'wait' ? ' warn' : '');
    ui.msg.textContent = ask === 'wrong' ? 'Wrong password · try again'
      : ask === 'wait' ? `Too many wrong passwords · try again in ${Math.max(1, Math.ceil((waitUntil - Date.now()) / MIN))} min`
      : 'Password for live prices';
  }
  try {  // typed in another tab of this site while this one asks: in with it
    window.addEventListener('storage', e => { if (e.key === PW_KEY && e.newValue && ask) { ask = null; pwShow(); redial(); } });
  } catch (e) { /* no window events */ }
  setInterval(() => {  // a stream that went silent (no heartbeat for 20 s) is dropped and dialled again
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - Math.max(lastMsg, openedAt) > 20000) ws.close();
  }, 5000);
  window.NsbLive = {
    start(name = 'VPS live stream', markets = null) {  // markets(): the instruments the page shows, for its dot (all of them when not given)
      if (started) return; started = true;
      connect();
      NsbStatus.add(name, () => {
        if (ask) return { state: 'locked', last: lastMsg };  // no prices until the password is typed
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
