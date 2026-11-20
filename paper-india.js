// India options paper: the Paper tab's India view, and the MCX view (paper-mcx.html). Layout G (owner 18/11/2026, "Build G
// as a preview"): Open now = an equal card per open trade with its chart (IN / TGT / SL / NOW) and four tiles; Today's
// trades = a card per closed trade with a small chart and "Open chart"; Calendar = the month, a tapped day's trades beside it.
// PAPER ONLY - no real money. It reads the VPS's paper-only feed (india_publisher.py / mcx_publisher.py): its address is in
// data/india_paper_feed.json {"url": ".../india/state.json"} (read again while the feed fails, so a new address needs no
// code change). Next to it: days.json (every earlier day's trades, fetched again when the feed says it changed: days_at),
// candles.json?day=D (the options' 1-minute candles for the charts; today's fetched again when candles_at changes) and
// (18/11/2026, owner 17/11: "make it realtime") live.json?v=N: while a trade is open, the open trades' price as it trades
// (a long poll: the VPS answers when the price moves, up to 4 times a second), so the price, the P&L and the chart's NOW
// move tick by tick; the state is still polled every 3 s (30 s while the tab is hidden); when the feed is down the page
// keeps the last data, greyed, says since when and keeps retrying (3 s, then 15 s, then 30 s). A request that gets no
// answer in 8 s counts as down too. Times in India (IST). Nothing is stored in the browser.
(function () {
  'use strict';
  const SCALE_STOP_TARGET = false;   // the owner's call: true = the open trade's chart always has its stop and target lines in view
  // paper-mcx.html (<html data-market="mcx">, owner 15/11/2026): the same view for the MCX mini crude / natgas / gold / silver
  // options paper bot (the India rules; its own feed, MCX hours 09:00-23:55 IST)
  const MCX = document.documentElement.dataset.market === 'mcx';
  const EXCH = MCX ? 'MCX' : 'NSE', OPEN_AT = MCX ? '09:00' : '09:15', CLOSE_AT = MCX ? '23:54' : '15:29';
  const POLL_MS = 3000, HIDDEN_MS = 30000, FETCH_MS = 8000, FEED_FILE = MCX ? 'data/mcx_paper_feed.json' : 'data/india_paper_feed.json';
  const LIVE_MS = 250, LIVE_FETCH_MS = 30000;   // live.json: at most 4 a second; a long poll is answered within 20 s
  const KIND = 'rdx-india-paper-public', KIND_DAYS = 'rdx-india-paper-days', KIND_C = 'rdx-india-paper-candles', KIND_LIVE = 'rdx-india-paper-live';
  const IST = 19800, M = '−';
  const $ = id => document.getElementById(id);
  const ok = v => typeof v === 'number' && isFinite(v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const rs = (v, sign) => ok(v) ? (sign && Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? M : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '–';
  const r2 = v => ok(v) ? '₹' + v.toFixed(2) : '–';
  const p2 = v => ok(v) ? v.toFixed(2) : '–';
  const pc = v => ok(v) ? (v >= 0 ? '+' : M) + Math.abs(v).toFixed(1) + '%' : '–';
  const hm = t => ok(t) ? new Date((t + IST) * 1000).toISOString().slice(11, 16) : '–';
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const dfmt = (d, o) => isDate(d) ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o)) : '–';
  const dlabel = d => dfmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
  const dshort = d => dfmt(d, { day: 'numeric', month: 'short' });
  const cls = v => ok(v) ? (Math.round(v) > 0 ? 'up' : Math.round(v) < 0 ? 'down' : '') : '';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
  const pctTxt = v => String(+(+v).toFixed(1));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let fIST;
  try { fIST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); } catch (e) { fIST = null; }
  const istNow = ms => fIST ? fIST.format(ms) : new Date(ms + IST * 1000).toISOString().slice(11, 16);
  const NAME = MCX ? { CRUDEOILM: 'Crude oil mini', NATGASMINI: 'Natural gas mini', GOLDM: 'Gold mini', SILVERM: 'Silver mini' }   // + gold / silver (owner 16/11/2026)
    : { NIFTY: 'NIFTY 50', BANKNIFTY: 'NIFTY BANK', HDFCBANK: 'HDFC Bank', ICICIBANK: 'ICICI Bank', RELIANCE: 'Reliance', BHARTIARTL: 'Airtel', LT: 'L&T',
        KOTAKBANK: 'Kotak Bank', AXISBANK: 'Axis Bank', SBIN: 'SBI' };   // + Bank Nifty's other 3 (owner 16/11/2026)
  const nameOf = u => NAME[u] || u;
  const isStock = u => !MCX && !/NIFTY/.test(u);

  let feedUrl = null, doc = null, lastOk = 0, lastGen = null, lastGenAt = 0, fails = 0, firstFail = 0, timer = 0, busy = false;
  let daysDoc = null, daysBusy = null;
  const CAND = new Map();          // day -> { doc, ver, busy, tries }
  let HOW = {}, OPEN = [], CLOSED = [], TR = new Map(), exitAt = CLOSE_AT, RULES = { sp: '6', tp: '4' };
  const LIVE = new Map();          // sym -> the newest live.json price of an open trade { px, t (ms), gross, net_if_closed, pct, bar }
  let liveVer = 0, liveBusy = false, liveAt = 0, liveOkAt = 0, liveStream = false, stateAt = Date.now();

  // ---------------------------------------------------------------- the feed
  async function getJson(url, opts, ms) {   // the answer AND its body within ms (FETCH_MS), else it throws (AbortError)
    const c = typeof AbortController === 'function' ? new AbortController() : null;
    const t = c ? setTimeout(() => c.abort(), ms || FETCH_MS) : 0;
    try {
      const r = await fetch(url, c ? Object.assign({}, opts, { signal: c.signal }) : opts);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function readFeed() {
    try {
      const j = await getJson(FEED_FILE, { cache: 'no-store' });
      return j && typeof j.url === 'string' && /^https:\/\/[^\s/@]+(:\d+)?\/[^\s]*$|^http:\/\/127\.0\.0\.1:\d+\/[^\s]*$/.test(j.url) ? j.url : null;
    } catch (e) { return null; }
  }
  const FEED_OPTS = { cache: 'no-cache', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' };
  const sibling = f => feedUrl && /state\.json(\?|$)/.test(feedUrl) ? feedUrl.replace(/state\.json(?=\?|$)/, f) : null;
  async function poll() {
    if (busy) return;   // a request is still waiting: it schedules the next one itself
    busy = true; clearTimeout(timer);
    try {
      if (!feedUrl || (fails && fails % 6 === 0)) feedUrl = (await readFeed()) || feedUrl;
      if (feedUrl) {
        try {
          const j = await getJson(feedUrl, FEED_OPTS);
          if (!j || j.kind !== KIND || j.paper_only !== true) throw new Error('not the paper feed');
          fails = 0; firstFail = 0; lastOk = Date.now();
          if (j.generated !== lastGen) { lastGen = j.generated; lastGenAt = Date.now(); }
          const changed = !doc || j.generated !== doc.generated;
          doc = j;
          if (changed) render();
        } catch (e) { fails++; if (!firstFail) firstFail = Date.now(); }   // refused, HTTP error, no answer in 8 s, bad JSON
      } else { fails++; if (!firstFail) firstFail = Date.now(); }
    } finally { busy = false; }
    timer = setTimeout(poll, document.hidden ? HIDDEN_MS : fails < 6 ? POLL_MS : fails < 20 ? 15000 : 30000);
    paint();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); liveLoop(); } });

  // the open trades' price as it trades (live.json, a long poll); the state (above) still says which trades are open
  async function liveLoop() {
    if (liveBusy) return;
    liveBusy = true;
    let miss = 0;
    try {
      while (OPEN.length && !document.hidden && sibling('live.json') && !(doc && doc.withheld)) {
        const wait = LIVE_MS - (Date.now() - liveAt);
        if (wait > 0) await sleep(wait);
        liveAt = Date.now();
        let j = null;
        try { j = await getJson(sibling('live.json') + '?v=' + liveVer, FEED_OPTS, LIVE_FETCH_MS); miss = 0; }
        catch (e) { miss++; await sleep(Math.min(10000, 1000 * miss)); continue; }   // the 3 s state poll carries on meanwhile
        if (!j || j.kind !== KIND_LIVE || j.paper_only !== true || j.withheld || !ok(j.ver)) { await sleep(2000); continue; }
        if (j.ver === liveVer) continue;   // the long poll ran out with nothing new: ask again
        liveVer = j.ver; liveOkAt = Date.now();
        applyLive(j);
      }
    } finally { liveBusy = false; tick(); }
  }
  const openSig = ts => ts.map(t => t.sym + '@' + t.tin).sort().join();
  function applyLive(j) {
    const tr = j.trades && typeof j.trades === 'object' ? j.trades : {};
    liveStream = false;
    for (const [sym, x] of Object.entries(tr)) {
      if (!x || !ok(x.px) || !ok(x.t) || x.px <= 0) continue;
      const prev = LIVE.get(sym);
      if (!prev || x.t >= prev.t) LIVE.set(sym, x);
      if (x.src === 'stream') liveStream = true;
    }
    for (const t of OPEN) if (mergeLive(t)) updateCard(t);
    renderSummary();
    tick();
    // a trade opened or closed on the VPS: the state now, not in up to 3 s
    if (Array.isArray(j.open) && j.open.map(o => o[0] + '@' + o[1]).sort().join() !== openSig(OPEN)) { clearTimeout(timer); poll(); }
  }
  function mergeLive(t) {   // the newer of the state's price and live.json's -> the trade (true: changed)
    const x = LIVE.get(t.sym);
    if (!x || (ok(t.ltp_t) && x.t / 1000 < t.ltp_t)) return false;
    const same = t.ltp === x.px && t.gross === x.gross && (!x.bar || String(t.bar) === String(x.bar));
    t.ltp = x.px; t.ltp_t = Math.floor(x.t / 1000); t.gross = x.gross; t.net_if_closed = x.net_if_closed; t.pct = x.pct;
    if (Array.isArray(x.bar)) t.bar = x.bar;
    return !same;
  }
  function tick() { $('g-tick').hidden = !(OPEN.length && liveStream && Date.now() - liveOkAt < 10000); }

  function fetchDays() {
    if (daysBusy) return daysBusy;
    const u = sibling('days.json');
    if (!u) return Promise.resolve();
    daysBusy = (async () => {
      try {
        const j = await getJson(u, FEED_OPTS);
        if (j && j.kind === KIND_DAYS && j.paper_only === true && !j.withheld && Array.isArray(j.days)) daysDoc = Object.assign(j, { at: doc && doc.days_at });
      } catch (e) { /* tried again at the next feed change */ } finally { daysBusy = null; }
    })();
    return daysBusy;
  }
  // the option candles of a day (today's again when the feed's candles_at moves; a day still being read: again in 3 s)
  function candles(day, ver) {
    let c = CAND.get(day);
    if (!c) { c = { doc: null, ver: null, busy: false, tries: 0 }; CAND.set(day, c); }
    const want = ver === undefined ? (c.doc ? c.ver : 'x') : ver;
    if (c.busy || (c.doc && c.ver === want && !c.doc.pending)) return c;
    const u = sibling('candles.json');
    if (!u) return c;
    c.busy = true;
    (async () => {
      let again = false;
      try {
        const j = await getJson(u + '?day=' + encodeURIComponent(day), FEED_OPTS);
        if (j && j.kind === KIND_C && j.paper_only === true && !j.withheld && j.options) {
          c.doc = j; c.ver = want; c.tries = 0; c.n = (c.n || 0) + 1;
          again = !!j.pending;
        } else again = true;
      } catch (e) { again = true; }
      c.busy = false;
      if (again && ++c.tries < 40) setTimeout(() => { candles(day, ver); }, 3000);
      if (c.doc) redrawCharts(day);
    })();
    return c;
  }
  const rowsOf = (t) => { const c = CAND.get(t.day); return c && c.doc && Array.isArray(c.doc.options[t.sym]) ? c.doc.options[t.sym] : null; };

  // ---------------------------------------------------------------- the state dot, the time, the alert
  function paint() {
    const dot = $('dot'), upd = $('upd'), al = $('alert'), now = Date.now();
    let state = 'live', word = 'Live', msg = '', klass = '';
    const down = fails > 0 && (!doc || now - lastOk > 12000);
    const e = (doc && doc.engine) || {};
    if (down) {
      state = 'down'; word = doc ? `Not live · last ${ago(now - lastOk)} ago` : 'Not live'; klass = 'down';
      msg = doc ? `The feed from the VPS is down since ${istNow(firstFail)} IST. Showing the last data it sent; retrying.`
        : (feedUrl ? 'Waiting for the feed from the VPS: it does not answer yet (its publisher may be off). Retrying.' : 'The feed address is not set yet. Retrying.');
    } else if (!doc) { state = ''; word = 'Connecting…'; }
    else if (doc.withheld) {
      state = 'stale'; word = 'Held back';
      msg = 'The VPS held this update back (its safety check found something that must not be public). Nothing new is shown until the next clean one.';
    } else if (now - lastGenAt > 30000) {
      state = 'stale'; word = 'Not updating'; msg = `The feed answers but has not changed for ${ago(now - lastGenAt)}.`;
    } else if (Date.parse(doc.generated) && now - Date.parse(doc.generated) > 600000) {
      state = 'stale'; word = 'Old data';   // 10 min: far above any clock difference between this device and the VPS
      msg = `The newest data from the VPS is ${ago(now - Date.parse(doc.generated))} old. If that looks wrong, check this device's clock.`;
    } else if (e.state === 'quiet') {
      state = 'stale'; word = 'Engine quiet';
      msg = `The paper engine has not written since ${esc(e.updated || '–')} IST. The numbers below are from then.`;
    } else if (e.state === 'missing') {
      state = 'stale'; word = 'Engine off';
      msg = doc.why === 'not run' ? 'The paper engine did not run today: no trade was taken.'
        : `The paper engine has not started today (it starts at ${MCX ? '08:55' : '09:00'} IST): no trade is being taken.`;
    } else if (doc.status === 'reconnecting') {
      state = 'stale'; word = 'Reconnecting';
      msg = `The paper engine lost the live stream${e.last_msg ? ` (last message ${e.last_msg} IST)` : ''} and is reconnecting. Open trades are checked on their 1-minute candles once it is back.`;
    } else if (doc.status === 'waiting') { state = ''; word = 'Before the open'; }
    else if (doc.status === 'starting') { state = ''; word = 'Starting'; }
    else if (doc.status === 'closed') { state = ''; word = 'Market closed'; }
    else if (doc.status === 'no session') { state = ''; word = 'No session'; }
    dot.className = 'lv ' + state; dot.lastChild.textContent = word;
    const at = doc && !doc.withheld ? (e.updated || String(doc.now || '').slice(11)) : '';
    upd.textContent = at ? at.slice(0, 5) + ' IST' : '';
    al.hidden = !msg; al.textContent = msg; al.className = 'alert ' + klass;
    $('main').classList.toggle('old', down || !!(doc && doc.withheld));
    setBar();
    tick();
    for (const t of OPEN) { const el = document.querySelector(`.g-card[data-k="${CSS.escape(t.key)}"] .g-meta`); if (el) el.textContent = cardMeta(t); }
  }
  let barH = 0;
  function setBar() {   // the top bar can wrap to two rows on a phone: the band stays under it
    const h = $('bar').offsetHeight;
    if (h !== barH) { barH = h; document.documentElement.style.setProperty('--bar-h', h + 'px'); }
  }
  setInterval(paint, 1000);
  window.addEventListener('resize', setBar);

  // ---------------------------------------------------------------- the trades
  function T(x, day) {
    return Object.assign({}, x, { day, key: `${day}|${x.sym}|${x.tin}`, name: nameOf(x.u), side: x.side === 'CE' ? 'CALL' : 'PUT',
      opt: `${ok(x.strike) ? +x.strike : '–'} ${x.side === 'PE' ? 'PE' : 'CE'}`, exp: x.expiry });
  }
  function setRules(r) {
    r = r || {};
    const sp = ok(r.stop_pct) ? pctTxt(r.stop_pct) : '6', tp = ok(r.target_pct) ? pctTxt(r.target_pct) : '4';
    RULES = { sp, tp };
    HOW = { target: 'Target', stop: 'Stop', 'logic exit': '1m MACD back', '30 s exit': '30 s exit', [CLOSE_AT + ' close']: `${esc(r.exit || CLOSE_AT)} close`,
            'index exit': 'Index exit', other: 'Exit' };
    return r.exit || CLOSE_AT;
  }
  // how a closed trade was sold, in words (the card's footer)
  function soldText(t) {
    const px = ok(t.exit) ? ' · ' + p2(t.exit) : '';
    if (t.how === 'target') return 'Sold at the target' + px;
    if (t.how === 'stop') return 'Sold at the stop loss' + px;
    if (t.how === 'logic exit') return 'Sold on the 1m MACD back' + px;
    if (t.how === '30 s exit') return 'Sold on the 30 s exit' + px;
    if (t.how === 'index exit') return 'Sold on the index exit' + px;
    if (t.how === CLOSE_AT + ' close') return `Sold at the ${exitAt} close` + px;
    return 'Sold' + px;
  }
  const SETUP_ORDER = MCX ? ['US crude', 'US natgas', 'US gold', 'US silver'] : ['Nifty', 'Bank Nifty'];
  const WHY = { kind_open: 'a trade of the same kind was still open', after_exit: 'seen after the exit time', no_price: 'no option price yet', other: 'not traded' };
  const MISS = { not_running: 'the paper engine was not running yet', late: 'seen too late, after a gap in the live data', other: 'not traded' };
  function skipText(skips) {
    const g = new Map();
    for (const s of skips || []) { const k = s.status + '|' + s.why; if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
    const out = [];
    for (const [k, ss] of g) {
      const [st, why] = k.split('|');
      const one = new Map();   // the same entry from both of a stock's setups (Nifty and Bank Nifty) in the same minute: one item
      for (const s of ss) {
        const id = `${s.u}|${s.kind}|${s.signal}`;
        if (!one.has(id)) one.set(id, { s, setups: [] });
        if (s.setup && !one.get(id).setups.includes(s.setup)) one.get(id).setups.push(s.setup);
      }
      const list = [...one.values()].map(({ s, setups }) => `${nameOf(s.u)} ${ok(s.kind) ? s.kind : '–'}m at ${s.signal || '–'}` +
        (setups.length > 1 ? ` (${setups.sort((a, b) => SETUP_ORDER.indexOf(a) - SETUP_ORDER.indexOf(b)).join(' + ')} setups)` : '')).join(', ');   // set as text, not HTML
      const reason = st === 'skipped' && why === 'open' ? (ss.every(s => isStock(s.u)) ? 'that stock already had an open trade' : 'it already had an open trade')
        : ((st === 'missed' ? MISS : WHY)[why] || 'not traded');
      out.push(`${st === 'missed' ? 'Missed' : 'Not taken'}: ${list} (${reason}).`);
    }
    return out.join(' ');
  }
  function gapText(gaps) {
    if (!gaps || !gaps.length) return '';
    const g = gaps.map(x => `${x.from}–${x.to} (${ok(x.secs) && x.secs >= 90 ? Math.round(x.secs / 60) + ' min' : (ok(x.secs) ? x.secs : '–') + ' s'})`).join(', ');
    return `Gap${gaps.length > 1 ? 's' : ''} in the live data: ${g}; open trades were checked on their 1-minute candles.`;
  }
  const pill = t => `<span class="g-pill ${t.side === 'CALL' ? 'call' : 'put'}">${t.side === 'CALL' ? 'Call' : 'Put'}</span>`;
  const heldTxt = m => ok(m) ? (m < 1 ? '<1 min' : `${Math.round(m)} min`) : '–';

  // ---------------------------------------------------------------- the option chart (lightweight-charts)
  // an open trade's: from 30 min before its entry to now (its forming minute live), green from the entry up to the target,
  // red down to the stop, a dashed line at the entry's minute, the IN / TGT / SL / NOW lines; a closed trade's: its whole
  // day, opened on it, with its in / out marks
  function liveBar(o, lastT) {
    const b = o.bar;
    if (!Array.isArray(b) || b.length < 5 || (lastT != null && b[0] + IST < lastT)) return null;
    let [t, op, h, l, c] = b;
    if (ok(o.ltp) && ok(o.ltp_t) && o.ltp_t >= t) { c = o.ltp; h = Math.max(h, c); l = Math.min(l, c); }
    return { time: t + IST, open: op, high: h, low: l, close: c };
  }
  class Zones {   // a series primitive: the two zones and the entry's dashed line, drawn under the candles
    constructor(t, at) { this.t = t; this.at = at; this.s = null; this.c = null; }
    attached(p) { this.s = p.series; this.c = p.chart; }
    detached() { this.s = null; this.c = null; }
    updateAllViews() {}
    paneViews() {
      const self = this;
      return [{ zOrder: () => 'bottom', renderer: () => ({ draw: target => self.draw(target) }) }];
    }
    draw(target) {
      const s = this.s, c = this.c, t = this.t;
      if (!s || !c) return;
      target.useBitmapCoordinateSpace(sc => {
        const ctx = sc.context, vr = sc.verticalPixelRatio, hr = sc.horizontalPixelRatio, W = sc.bitmapSize.width, H = sc.bitmapSize.height;
        const y = p => { const v = ok(p) ? s.priceToCoordinate(p) : null; return v == null ? null : v * vr; };
        const ye = y(t.entry), yt = y(t.target), ys = y(t.stop);
        const up = css('--up-rgb'), dn = css('--down-rgb');
        if (ye != null && yt != null) { ctx.fillStyle = `rgba(${up}, .13)`; ctx.fillRect(0, Math.min(ye, yt), W, Math.abs(yt - ye)); }
        if (ye != null && ys != null) { ctx.fillStyle = `rgba(${dn}, .13)`; ctx.fillRect(0, Math.min(ye, ys), W, Math.abs(ys - ye)); }
        const x = this.at != null ? c.timeScale().timeToCoordinate(this.at) : null;
        if (x != null) {
          ctx.save(); ctx.strokeStyle = css('--accent'); ctx.lineWidth = Math.max(1, Math.round(hr)); ctx.setLineDash([3 * hr, 3 * hr]);
          const X = Math.round(x * hr) + 0.5; ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, H); ctx.stroke(); ctx.restore();
          // its word at the top (the chart's logo sits at the bottom left)
          ctx.fillStyle = css('--accent'); ctx.font = `${11 * vr}px "IBM Plex Mono", ui-monospace, monospace`; ctx.textBaseline = 'top';
          const txt = 'Bought ' + hm(t.tin), w = ctx.measureText(txt).width;
          ctx.fillText(txt, Math.min(Math.max(2 * hr, X + 4 * hr), W - w - 2 * hr), 4 * vr);
        }
      });
    }
  }
  function chart(el, t, o) {
    o = o || {};
    if (el._chart) { el._chart.remove(); el._chart = null; }
    const nc = el.querySelector('.g-nc'); if (nc) nc.remove();
    if (!window.LightweightCharts) return null;
    const src = rowsOf(t);
    const up = css('--up'), dn = css('--down'), ac = css('--accent'), tx = css('--text');
    const c = LightweightCharts.createChart(el, { autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: css('--muted'), fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
      rightPriceScale: { borderColor: css('--line'), scaleMargins: { top: 0.14, bottom: 0.12 } },
      timeScale: { borderColor: css('--line'), timeVisible: true, secondsVisible: false, rightOffset: o.live ? 5 : 2, fixLeftEdge: true },
      crosshair: { mode: 0 }, handleScroll: { vertTouchDrag: false } });
    const s = c.addCandlestickSeries(Object.assign({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn, borderVisible: false,
      lastValueVisible: false, priceLineVisible: false }, o.live && SCALE_STOP_TARGET && ok(t.stop) && ok(t.target) ? {
      autoscaleInfoProvider: orig => {   // the price scale reaches the stop and the target as well as the candles
        const r = orig(), lo = Math.min(t.stop, t.target), hi = Math.max(t.stop, t.target);
        if (!r || !r.priceRange) return { priceRange: { minValue: lo, maxValue: hi } };
        return Object.assign({}, r, { priceRange: { minValue: Math.min(r.priceRange.minValue, lo), maxValue: Math.max(r.priceRange.maxValue, hi) } });
      } } : {}));
    const from = o.live ? t.tin - 30 * 60 : -Infinity;
    const rows = (src || []).filter(r => r[0] >= from && r[3] > 0);
    const data = rows.map(r => ({ time: r[0] + IST, open: r[1], high: r[2], low: r[3], close: r[4] }));
    if (o.live) { const lb = liveBar(t, data.length ? data[data.length - 1].time : null); if (lb) { if (data.length && data[data.length - 1].time === lb.time) data.pop(); data.push(lb); } }
    s.setData(data);
    const line = (p, col, title, style) => ok(p) ? s.createPriceLine({ price: p, color: col, lineWidth: 1, lineStyle: style == null ? 2 : style, axisLabelVisible: true, title }) : null;
    line(t.target, up, 'TGT'); line(t.entry, ac, 'IN'); line(t.stop, dn, 'SL');
    const nowLine = o.live ? line(t.ltp, tx, 'NOW', 0) : null;
    let at = null;
    if (data.length) {
      at = (tt => data.reduce((a, r) => (r.time <= tt + IST ? r.time : a), data[0].time))(t.tin);
      if (o.live) {
        s.attachPrimitive(new Zones(t, at));
        c.timeScale().setVisibleLogicalRange({ from: -0.5, to: data.length + 4 });
      } else {
        const atx = tt => data.reduce((a, r) => (r.time <= tt + IST ? r.time : a), data[0].time);
        const mk = [{ time: atx(t.tin), position: 'belowBar', color: ac, shape: 'arrowUp', text: 'in ' + p2(t.entry) }];
        if (ok(t.tout)) mk.push({ time: atx(t.tout), position: 'aboveBar', color: t.net >= 0 ? up : dn, shape: 'arrowDown', text: 'out ' + p2(t.exit) });
        s.setMarkers(mk);
        const ix = tt => { let k = 0; data.forEach((r, i) => { if (r.time <= tt + IST) k = i; }); return k; };
        c.timeScale().setVisibleLogicalRange({ from: Math.max(0, ix(t.tin - 30 * 60)) - 0.5, to: Math.min(data.length - 1, ix(t.tout + 30 * 60)) + 0.5 });
      }
    } else {
      const n = document.createElement('span'); n.className = 'g-nc';
      n.textContent = src ? 'no option candles for this trade' : 'loading the option\'s candles…';
      el.appendChild(n);
    }
    el._chart = c;
    return { c, s, nowLine, last: data.length ? data[data.length - 1].time : null };
  }
  // a closed trade's small chart (an SVG, no chart library): its 1-minute closes from 10 minutes before the entry to 3 after the
  // exit, the TGT / IN / SL lines, the entry and the exit
  function mini(t) {
    const src = rowsOf(t);
    if (!src) return `<div class="g-mini-nc">loading the option's candles…</div>`;
    const rows = src.filter(r => r[0] >= t.tin - 600 && r[0] <= (ok(t.tout) ? t.tout : t.tin) + 180 && r[4] > 0);
    if (!rows.length) return `<div class="g-mini-nc">no option candles for this trade</div>`;
    const W = 420, H = 110, L = 8, R = 330, top = 10, bot = 100;
    const vals = rows.map(r => r[4]).concat([t.entry, t.target, t.stop, t.exit].filter(ok));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const t0 = rows[0][0], t1 = Math.max(rows[rows.length - 1][0], t0 + 60);
    const X = tt => L + (R - L) * (Math.min(Math.max(tt, t0), t1) - t0) / (t1 - t0), Y = p => bot - (bot - top) * (p - lo) / (hi - lo);
    const ln = (p, col) => ok(p) ? `<line x1="0" y1="${Y(p).toFixed(1)}" x2="${R + 4}" y2="${Y(p).toFixed(1)}" stroke="${col}" stroke-width="1"/>` : '';
    const pts = rows.map(r => `${X(r[0]).toFixed(1)},${Y(r[4]).toFixed(1)}`).join(' ');
    const up = 'var(--up)', dn = 'var(--down)', ac = 'var(--accent)';
    const dot = (tt, p, col) => ok(tt) && ok(p) ? `<circle cx="${X(tt).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="5" fill="${col}"/>` : '';
    // labels apart: the three lines' words never on top of each other
    const L3 = [[t.target, up, 'TGT'], [t.entry, ac, 'IN'], [t.stop, dn, 'SL']].filter(x => ok(x[0])).sort((a, b) => Y(a[0]) - Y(b[0]));
    let last = -Infinity;
    const labs = L3.map(([p, col, w]) => { const yy = Math.max(Y(p) + 4, last + 12); last = yy; return `<text x="${R + 8}" y="${yy.toFixed(1)}" fill="${col}">${w} ${p2(p)}</text>`; }).join('');
    return `<svg class="g-mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Small chart of the trade: bought at ${p2(t.entry)}, sold at ${p2(t.exit)}`)}">
      ${ln(t.target, up)}${ln(t.entry, ac)}${ln(t.stop, dn)}
      <polyline points="${pts}" fill="none" stroke="var(--text)" stroke-width="2"/>
      ${dot(t.tin, t.entry, ac)}${dot(t.tout, t.exit, t.net >= 0 ? up : dn)}
      <g font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" font-weight="600">${labs}</g></svg>`;
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!doc || doc.withheld) return;
    exitAt = setRules(doc.rules);
    stateAt = Date.now();
    TR = new Map();
    OPEN = (doc.open || []).map(x => T(x, doc.day));
    CLOSED = (doc.closed || []).map(x => T(x, doc.day)).sort((a, b) => a.tin - b.tin);
    for (const s of [...LIVE.keys()]) if (!OPEN.some(t => t.sym === s)) LIVE.delete(s);
    for (const t of OPEN) mergeLive(t);
    for (const t of OPEN.concat(CLOSED)) TR.set(t.key, t);
    if (daysDoc) for (const d of daysDoc.days) for (const x of d.trades || []) { const t = T(x, d.day); TR.set(t.key, t); }
    // today's candles: fetched again when the feed says they changed, while a chart of today needs them
    const c = CAND.get(doc.day);
    if ((OPEN.length || CLOSED.length || calSel === doc.day || (c && c.doc)) && (!c || c.ver !== doc.candles_at)) candles(doc.day, doc.candles_at);
    renderSummary();
    renderOpen();
    renderToday();
    if ((!daysDoc || daysDoc.at !== doc.days_at) && !daysBusy) fetchDays().then(() => { if (doc && !doc.withheld) render(); });
    renderCal();
    if (OPEN.length) liveLoop();
  }

  // the head: the section links with their counts, today / since the start / won-lost
  function renderSummary() {
    const tot = doc.total || {}, td = doc.today || {};
    const n = ok(tot.trades) ? tot.trades : 0, won = ok(tot.wins) ? tot.wins : 0;
    $('g-j-open').textContent = `Open now · ${OPEN.length}`;
    $('g-j-today').textContent = `Today's trades · ${CLOSED.length}`;
    const og = OPEN.reduce((a, t) => a + (ok(t.gross) ? t.gross : 0), 0);
    const todayNet = ok(td.net) ? td.net : 0;
    $('g-sum').innerHTML = (doc.status === 'no session' ? `<span><span class="l">Today</span><span class="v">no session</span></span>`
      : `<span><span class="l">Today</span><span class="v big ${cls(todayNet)}">${rs(todayNet, 1)}</span><span class="l">closed</span>` +
        (OPEN.length ? `<span class="v ${cls(og)}" title="the open trades' P&amp;L now, before charges">${rs(og, 1)}</span><span class="l">open</span>` : '') +
        (missedOf(CLOSED).n ? `<span class="l" title="missed live while the data feed was broken; counted as if taken">incl. ${missedOf(CLOSED).n} missed ${rs(missedOf(CLOSED).net, 1)}</span>` : '') + '</span>') +
      `<span><span class="l">${tot.first_day ? 'Since ' + dshort(tot.first_day) : 'Since the start'}</span><span class="v ${cls(tot.net)}">${rs(ok(tot.net) ? tot.net : 0, 1)}</span></span>` +
      `<span><span class="l">Won / lost</span><span class="v"><span class="up">${won}</span> <span class="l">/</span> <span class="down">${n - won}</span></span></span>`;
  }

  // Open now: one equal card per open trade
  function emptyText() {
    const s = doc.status;
    if (s === 'waiting') return `No open trade: entries start at ${OPEN_AT} IST.`;
    if (s === 'closed') return 'No open trade: the session is over.';
    if (s === 'no session') return doc.why === 'weekend' ? `No ${EXCH} session today (weekend).` : doc.why === 'holiday' ? `No ${EXCH} session today (${esc(doc.holiday || 'holiday')}).` : `No ${EXCH} session today.`;
    return 'No open trade right now.';
  }
  const CARDS = new Map();   // key -> { el, ver, chart }
  // (open for: the engine's minutes when the state came, counted on from then - this device's clock may be off)
  const cardMeta = t => `Bought ${hm(t.tin)} · lot ${ok(t.lot) ? t.lot : '–'} · ${t.setup || '–'} setup · exp ${dshort(t.exp)} · open ${heldTxt(ok(t.mins) ? t.mins + (Date.now() - stateAt) / 60000 : null)}`;
  function renderOpen() {
    const box = $('g-cards');
    $('g-open-sub').textContent = OPEN.length ? `${plural(OPEN.length, 'trade')} · each the same space · stop ${M}${RULES.sp}% / target +${RULES.tp}% of the entry price` : '';
    if (!OPEN.length) {
      for (const [, x] of CARDS) if (x.chart && x.chart.c) x.chart.c.remove();
      CARDS.clear();
      box.className = 'g-cards one';
      box.innerHTML = `<div class="g-empty">${emptyText()}</div>`;
      return;
    }
    box.className = 'g-cards' + (OPEN.length === 1 ? ' one' : '');
    if (box.querySelector('.g-empty')) box.innerHTML = '';
    for (const [k, x] of [...CARDS]) if (!OPEN.some(t => t.key === k)) { if (x.chart && x.chart.c) x.chart.c.remove(); x.el.remove(); CARDS.delete(k); }
    for (const t of OPEN) {
      let x = CARDS.get(t.key);
      if (!x) {
        const el = document.createElement('article');
        el.className = 'g-card'; el.dataset.k = t.key; el.setAttribute('aria-label', `${t.name} ${t.opt}`);
        el.innerHTML = `<div class="g-ch"><div><div class="g-ttl"><b>${esc(t.name)} ${esc(t.opt)}</b>${pill(t)}<span class="g-tag">${t.kind}m entry</span></div>
            <div class="g-meta"></div></div><div class="g-pl" title="P&amp;L before charges"><span class="v"></span><span class="s"></span></div></div>
          <div class="g-cv"></div>
          <div class="g-tiles"><div class="g-tile"><span class="l in">Entry price</span><span class="v">${r2(t.entry)}</span></div>
            <div class="g-tile"><span class="l">Live price</span><span class="v g-now"></span></div>
            <div class="g-tile"><span class="l tg">Target +${RULES.tp}%</span><span class="v">${r2(t.target)}</span></div>
            <div class="g-tile"><span class="l sl">Stop loss ${M}${RULES.sp}%</span><span class="v">${r2(t.stop)}</span></div></div>`;
        box.appendChild(el);
        x = { el, ver: null, chart: null };
        CARDS.set(t.key, x);
      }
      box.appendChild(x.el);   // in the feed's order
      updateCard(t);
    }
  }
  function updateCard(t) {
    const x = CARDS.get(t.key);
    if (!x) return;
    const q = s => x.el.querySelector(s);
    q('.g-meta').textContent = cardMeta(t);
    q('.g-pl .v').className = 'v ' + cls(t.gross); q('.g-pl .v').textContent = rs(t.gross, 1);
    q('.g-pl .s').className = 's ' + cls(t.gross); q('.g-pl .s').textContent = pc(t.pct);
    q('.g-pl').title = `P&L before charges${ok(t.net_if_closed) ? ` · after charges if sold now: ${rs(t.net_if_closed, 1)}` : ''}`;
    q('.g-now').textContent = r2(t.ltp);
    const c = CAND.get(t.day), ver = c && c.doc ? c.n : null;   // every new candles document redraws the chart
    if (x.ver !== ver || !x.chart) { x.chart = chart(q('.g-cv'), t, { live: true }); x.ver = ver; return; }
    if (x.chart && x.chart.s) {                                // the forming minute and the NOW line, live
      if (x.chart.nowLine && ok(t.ltp)) x.chart.nowLine.applyOptions({ price: t.ltp });
      const lb = liveBar(t, x.chart.last);
      if (lb && (x.chart.last == null || lb.time >= x.chart.last)) { try { x.chart.s.update(lb); x.chart.last = lb.time; } catch (e) { /* redrawn with the next candles */ } }
    }
  }

  // Today's trades: a card per closed trade
  let todaySig = null;
  // 20/11/2026 (owner): missed trades (the feed problem) are shown and counted as if taken; the lines say how many
  const missedOf = ts => { const m = ts.filter(t => t.replayed); return { n: m.length, net: m.reduce((x, t) => x + t.net, 0) }; };
  const missedTxt = ts => { const m = missedOf(ts); return m.n ? ` (incl. ${m.n} missed: feed problem, ${rs(m.net, 1)})` : ''; };
  function renderToday() {
    $('g-today-sub').textContent = `${dlabel(doc.day)} · ${plural(CLOSED.length, 'closed trade')}${missedTxt(CLOSED)} · each with its own chart · times in India (IST)`;
    const c = CAND.get(doc.day);
    const sig = JSON.stringify([doc.day, doc.status, CLOSED.map(t => [t.key, t.net, t.how, t.exit]), doc.skipped, doc.gaps, c && c.n]);
    if (sig === todaySig) return;
    todaySig = sig;
    $('g-tcards').innerHTML = CLOSED.length ? CLOSED.map(t => `<article class="g-tc" aria-label="${esc(t.name)} ${esc(t.opt)}">
        <div class="g-tch"><div><b>${esc(t.name)} ${esc(t.opt)}</b>${t.replayed ? '<span class="g-rep" title="Missed live while the data feed was broken; shown as the bot would have traded it (replayed on the recorded prices and books)">missed (feed problem)</span>' : ''}<span class="t">${hm(t.tin)} → ${hm(t.tout)} · ${heldTxt(t.mins)}</span></div>
          <div class="g-pl"><span class="v ${cls(t.net)}">${rs(t.net, 1)}</span><span class="s ${cls(t.net)}">${pc(t.pct)}</span></div></div>
        ${mini(t)}
        <div class="g-tf"><span class="w ${cls(t.net)}">${esc(soldText(t))}</span><button type="button" class="g-btn" data-k="${esc(t.key)}">Open chart</button></div></article>`).join('')
      : `<div class="g-empty">${doc.status === 'no session' ? 'No trade today.' : 'No closed trade yet today.'}</div>`;
    $('g-skip').textContent = skipText(doc.skipped);
    $('g-gaps').textContent = gapText(doc.gaps);
  }
  $('g-tcards').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) openBig(b.dataset.k); });

  // Calendar: the month's weekdays; a day with trades is a button; the tapped day's trades beside it
  let calMonth = null, calSel = null, calSig = null;
  function allDays() {
    const out = (daysDoc ? daysDoc.days : []).filter(d => isDate(d.day) && d.day < doc.day)
      .map(d => ({ day: d.day, trades: (d.trades || []).map(x => T(x, d.day)).sort((a, b) => a.tin - b.tin), skipped: d.skipped || [], gaps: d.gaps || [] }));
    if (doc.status !== 'no session') out.push({ day: doc.day, trades: CLOSED, skipped: doc.skipped || [], gaps: doc.gaps || [], today: true });
    return out;
  }
  const dayNet = d => d.trades.reduce((a, t) => a + t.net, 0);
  const mkey = d => d.slice(0, 7);
  const mshift = (m, k) => { const [y, mo] = m.split('-').map(Number), d = new Date(Date.UTC(y, mo - 1 + k, 1)); return d.toISOString().slice(0, 7); };
  const mname = m => MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
  function renderCal() {
    const days = allDays(), by = new Map(days.map(d => [d.day, d]));
    const firstM = days.length ? mkey(days[0].day) : mkey(doc.day), lastM = mkey(doc.day);
    if (!calMonth || calMonth < firstM || calMonth > lastM) calMonth = lastM;
    if (!calSel || !by.has(calSel)) { const w = [...days].reverse().find(d => d.trades.length); calSel = w ? w.day : (days.length ? days[days.length - 1].day : null); }
    const sig = JSON.stringify([calMonth, calSel, doc.day, days.map(d => [d.day, d.trades.map(t => [t.key, t.net]), d.skipped, d.gaps]), OPEN.length, HOW]);
    if (sig === calSig) return;
    calSig = sig;
    const pm = mshift(calMonth, -1), nm = mshift(calMonth, 1);
    $('g-prev').textContent = MONTHS[+pm.slice(5, 7) - 1]; $('g-prev').disabled = pm < firstM;
    $('g-next').textContent = MONTHS[+nm.slice(5, 7) - 1]; $('g-next').disabled = nm > lastM;
    $('g-month').textContent = mname(calMonth);
    // the month's weekdays, Monday first; days before the 1st's weekday left empty
    const [y, mo] = calMonth.split('-').map(Number), cells = [];
    const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    let lead = true;
    for (let d = 1; d <= n; d++) {
      const dt = new Date(Date.UTC(y, mo - 1, d)), w = dt.getUTCDay();
      if (w === 0 || w === 6) continue;
      if (lead) { for (let k = 1; k < w; k++) cells.push('<span class="g-dc pad" aria-hidden="true"></span>'); lead = false; }
      const key = dt.toISOString().slice(0, 10), x = by.get(key);
      if (x) {
        const net = dayNet(x), k = x.trades.length, w2 = x.trades.filter(t => t.net > 0).length;
        const sub = x.today ? `${k} closed${OPEN.length ? ` · ${OPEN.length} open` : ''}` : k ? `${plural(k, 'trade')} · ${w2} won` : 'no trade';
        cells.push(`<button type="button" class="g-dc has ${k ? (net >= 0 ? 'up' : 'down') : ''}${key === calSel ? ' sel' : ''}" data-d="${key}" aria-pressed="${key === calSel}" aria-label="${esc(dlabel(key))}: ${esc(k ? rs(net, 1) : 'no trade')}">
          <span class="top"><span>${d}</span>${x.today ? '<span class="td">Today</span>' : ''}</span>
          <span class="bot"><span class="n ${k ? cls(net) : ''}">${k ? rs(net, 1) : '—'}</span><span class="c">${sub}</span></span></button>`);
      } else cells.push(`<span class="g-dc${key > doc.day ? ' fut' : ''}">${d}</span>`);
    }
    $('g-grid').innerHTML = cells.join('');
    const inM = days.filter(d => mkey(d.day) === calMonth), mt = inM.reduce((a, d) => a + d.trades.length, 0);
    const tot = doc.total || {};
    $('g-msum').textContent = inM.length ? `Month so far: ${rs(inM.reduce((a, d) => a + dayNet(d), 0), 1)} · ${plural(mt, 'closed trade')}` +
      (tot.first_day && mkey(tot.first_day) === calMonth ? ` · the paper count starts on ${dshort(tot.first_day)}` : '') : 'No paper trading this month.';
    // the tapped day
    const d = calSel && by.get(calSel);
    $('g-dayp').hidden = !d;
    if (!d) return;
    const k = d.trades.length, w = d.trades.filter(t => t.net > 0).length;
    $('g-day-t').textContent = dlabel(d.day) + (d.today ? ' · today' : '');
    $('g-day-s').textContent = k ? `${plural(k, 'trade')}${missedTxt(d.trades)} · ${w} won, ${k - w} lost · tap a trade for its chart` : 'no trade';
    const net = dayNet(d);
    $('g-day-n').className = 'g-dpn ' + cls(net); $('g-day-n').textContent = k ? rs(net, 1) : '';
    $('g-drows').innerHTML = k ? d.trades.map(t => `<button type="button" class="g-dr" data-k="${esc(t.key)}"><span class="tm">${hm(t.tin)}</span>
        <span>${esc(t.name)} ${esc(t.opt)}${t.replayed ? '<span class="g-rep" title="Missed live while the data feed was broken; shown as the bot would have traded it (replayed on the recorded prices and books)">missed (feed problem)</span>' : ''}</span><span class="w">${HOW[t.how] || esc(t.how)}</span><span class="n ${cls(t.net)}">${rs(t.net, 1)}</span></button>`).join('')
      : '<div class="g-dempty">No trade this day.</div>';
    $('g-day-skip').textContent = skipText(d.skipped);
    $('g-day-gaps').textContent = gapText(d.gaps);
  }
  $('g-grid').addEventListener('click', e => { const b = e.target.closest('button[data-d]'); if (!b || !doc) return; calSel = b.dataset.d; calSig = null; renderCal(); });
  $('g-prev').addEventListener('click', () => { if (calMonth) { calMonth = mshift(calMonth, -1); calSig = null; renderCal(); } });
  $('g-next').addEventListener('click', () => { if (calMonth) { calMonth = mshift(calMonth, 1); calSig = null; renderCal(); } });
  $('g-drows').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) openBig(b.dataset.k); });

  // a closed trade's chart, big
  let bigKey = null, bigFrom = null;
  function openBig(key) {
    const t = TR.get(key); if (!t) return;
    bigKey = key; bigFrom = document.activeElement;
    $('g-big-t').textContent = `${t.name} ${t.opt} · ${t.side === 'CALL' ? 'call' : 'put'} · ${t.kind}m entry` + (t.replayed ? ' · missed (feed problem)' : '');
    $('g-big-s').textContent = `${dlabel(t.day)} · ${hm(t.tin)} → ${hm(t.tout)} · ${heldTxt(t.mins)} · ${soldText(t)}`;
    $('g-big-d').innerHTML = `<span>exp <b>${dshort(t.exp)}</b></span><span>lot <b>${ok(t.lot) ? t.lot : '–'}</b></span><span>${esc(t.setup || '–')} setup</span>
      <span>in <b>${p2(t.entry)}</b></span><span>out <b>${p2(t.exit)}</b></span><span>gross <b class="${cls(t.gross)}">${rs(t.gross, 1)}</b></span>
      <span>charges <b>${rs(t.charges)}</b></span><span>net <b class="${cls(t.net)}">${rs(t.net, 1)}</b></span><span>${esc(t.name)} at entry <b>${ok(t.upx) ? t.upx.toLocaleString('en-IN') : '–'}</b></span>`;
    $('g-big').hidden = false;
    if (!rowsOf(t)) candles(t.day, doc && t.day === doc.day ? doc.candles_at : undefined);
    chart($('g-big-v'), t, {});
    $('g-big-x').focus();
  }
  function closeBig() {
    const v = $('g-big-v'); if (v._chart) { v._chart.remove(); v._chart = null; }
    $('g-big').hidden = true; bigKey = null;
    if (bigFrom && bigFrom.focus) try { bigFrom.focus(); } catch (e) { /* gone */ }
  }
  $('g-big-x').addEventListener('click', closeBig);
  $('g-big').addEventListener('click', e => { if (e.target === $('g-big')) closeBig(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('g-big').hidden) closeBig(); });

  function redrawCharts(day) {
    if (doc && day === doc.day) { for (const t of OPEN) updateCard(t); todaySig = null; renderToday(); }
    if (bigKey) { const t = TR.get(bigKey); if (t && t.day === day) chart($('g-big-v'), t, {}); }
  }

  poll();
})();
