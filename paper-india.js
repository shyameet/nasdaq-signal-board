// India options paper: the Paper tab's India view (owner 11/11/2026: design B - the open trade is the hero with a big
// live option chart; the four numbers and today's trades in a right column; every day as one strip under the hero).
// PAPER ONLY - no real money. It reads the VPS's paper-only feed (india_publisher.py): its address is in
// data/india_paper_feed.json {"url": ".../india/state.json"} (read again while the feed fails, so a new address needs no
// code change). Next to it: days.json (every earlier day's trades, fetched again when the feed says it changed: days_at)
// and candles.json?day=D (the options' 1-minute candles for the charts; today's fetched again when candles_at changes).
// Polled every 3 s (30 s while the tab is hidden); when the feed is down the page keeps the last data, greyed, says since
// when and keeps retrying (3 s, then 15 s, then 30 s). A request that gets no answer in 8 s counts as down too. One
// request at a time. Times in India (IST). Nothing is stored in the browser.
(function () {
  'use strict';
  const SCALE_STOP_TARGET = false;   // the owner's call: true = the open trade's chart always has its stop and target lines in view
  const POLL_MS = 3000, HIDDEN_MS = 30000, FETCH_MS = 8000, FEED_FILE = 'data/india_paper_feed.json';
  const KIND = 'rdx-india-paper-public', KIND_DAYS = 'rdx-india-paper-days', KIND_C = 'rdx-india-paper-candles';
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
  const wday = d => dfmt(d, { weekday: 'short' });
  const cls = v => ok(v) ? (Math.round(v) > 0 ? 'up' : Math.round(v) < 0 ? 'down' : '') : '';
  const clamp = v => Math.max(0, Math.min(1, v));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
  const pctTxt = v => String(+(+v).toFixed(1));
  let fIST;
  try { fIST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); } catch (e) { fIST = null; }
  const istNow = ms => fIST ? fIST.format(ms) : new Date(ms + IST * 1000).toISOString().slice(11, 16);
  const NAME = { NIFTY: 'NIFTY 50', BANKNIFTY: 'NIFTY BANK', HDFCBANK: 'HDFC Bank', ICICIBANK: 'ICICI Bank', RELIANCE: 'Reliance', BHARTIARTL: 'Airtel', LT: 'L&T' };
  const nameOf = u => NAME[u] || u;
  const isStock = u => !/NIFTY/.test(u);

  let feedUrl = null, doc = null, lastOk = 0, lastGen = null, lastGenAt = 0, fails = 0, firstFail = 0, timer = 0, busy = false;
  let daysDoc = null, daysBusy = null;
  const CAND = new Map();          // day -> { doc, ver, busy, tries }
  let HOW = {}, OPEN = [], CLOSED = [], TR = new Map();
  let selKey = null, heroKey = null, heroVer = null, heroSeries = null, heroLast = null;
  let todaySig = null, daysSig = null, selDay = null, panelSig = null;
  const expanded = { 'b-today': null, 'b-dayl': null };   // the opened trade (its key) of each list

  // ---------------------------------------------------------------- the feed
  async function getJson(url, opts) {   // the answer AND its body within FETCH_MS, else it throws (AbortError)
    const c = typeof AbortController === 'function' ? new AbortController() : null;
    const t = c ? setTimeout(() => c.abort(), FETCH_MS) : 0;
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

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
        : 'The paper engine has not started today (it starts at 09:00 IST): no trade is being taken.';
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
    HOW = { target: `target +${tp}%`, stop: `stop ${M}${sp}%`, 'logic exit': '1m MACD back', '30 s exit': '30 s exit', '15:29 close': `${esc(r.exit || '15:29')} close`, other: 'exit' };
    $('b-rule').textContent = `live price from the stream · stop ${M}${sp}% / target +${tp}% of the entry price`;
    return r.exit || '15:29';
  }
  const SETUP_ORDER = ['Nifty', 'Bank Nifty'];
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
  const pill = t => `<span class="b-pill ${t.side === 'CALL' ? 'call' : 'put'}">${t.side}</span>`;

  // ---------------------------------------------------------------- the option chart
  // the open trade: from 30 min before its entry to now (its forming minute live); a closed trade: its whole day, opened on it
  function liveBar(o, lastT) {
    const b = o.bar;
    if (!Array.isArray(b) || b.length < 5 || (lastT != null && b[0] + IST < lastT)) return null;
    let [t, op, h, l, c] = b;
    if (ok(o.ltp) && ok(o.ltp_t) && o.ltp_t >= t) { c = o.ltp; h = Math.max(h, c); l = Math.min(l, c); }
    return { time: t + IST, open: op, high: h, low: l, close: c };
  }
  function chart(el, t, o) {
    o = o || {};
    if (el._chart) { el._chart.remove(); el._chart = null; }
    const nc = el.querySelector('.b-nc'); if (nc) nc.remove();
    if (!window.LightweightCharts) return null;
    const src = rowsOf(t);
    const up = css('--up'), dn = css('--down'), ac = css('--accent');
    const c = LightweightCharts.createChart(el, { autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: css('--muted'), fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
      rightPriceScale: { borderColor: css('--line'), scaleMargins: { top: 0.14, bottom: 0.12 } },
      timeScale: { borderColor: css('--line'), timeVisible: true, secondsVisible: false, rightOffset: o.live ? 5 : 2, fixLeftEdge: true },
      crosshair: { mode: 0 }, handleScroll: { vertTouchDrag: false } });
    const s = c.addCandlestickSeries(Object.assign({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn, borderVisible: false,
      lastValueVisible: !!o.live, priceLineVisible: false }, o.live && SCALE_STOP_TARGET && ok(t.stop) && ok(t.target) ? {
      autoscaleInfoProvider: orig => {   // the price scale reaches the stop and the target as well as the candles
        const r = orig(), lo = Math.min(t.stop, t.target), hi = Math.max(t.stop, t.target);
        if (!r || !r.priceRange) return { priceRange: { minValue: lo, maxValue: hi } };
        return Object.assign({}, r, { priceRange: { minValue: Math.min(r.priceRange.minValue, lo), maxValue: Math.max(r.priceRange.maxValue, hi) } });
      } } : {}));
    const from = o.live ? t.tin - 30 * 60 : -Infinity;
    const rows = (src || []).filter(r => r[0] >= from && r[3] > 0);
    const data = rows.map(r => ({ time: r[0] + IST, open: r[1], high: r[2], low: r[3], close: r[4] }));
    if (o.live) { const lb = liveBar(o.trade, data.length ? data[data.length - 1].time : null); if (lb) { if (data.length && data[data.length - 1].time === lb.time) data.pop(); data.push(lb); } }
    s.setData(data);
    const line = (p, col, title) => { if (ok(p)) s.createPriceLine({ price: p, color: col, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: el.clientWidth > 520 ? title : '' }); };
    line(t.target, up, 'target'); line(t.entry, ac, 'entry'); line(t.stop, dn, 'stop');
    if (data.length) {
      const at = tt => data.reduce((a, r) => (r.time <= tt + IST ? r.time : a), data[0].time);
      const mk = [{ time: at(t.tin), position: 'belowBar', color: ac, shape: 'arrowUp', text: 'in ' + p2(t.entry) }];
      if (!o.live && ok(t.tout)) mk.push({ time: at(t.tout), position: 'aboveBar', color: t.net >= 0 ? up : dn, shape: 'arrowDown', text: 'out ' + p2(t.exit) });
      s.setMarkers(mk);
      if (o.live) c.timeScale().setVisibleLogicalRange({ from: -0.5, to: data.length + 4 });
      else {
        const ix = tt => { let k = 0; data.forEach((r, i) => { if (r.time <= tt + IST) k = i; }); return k; };
        c.timeScale().setVisibleLogicalRange({ from: Math.max(0, ix(t.tin - 30 * 60)) - 0.5, to: Math.min(data.length - 1, ix(t.tout + 30 * 60)) + 0.5 });
      }
    } else {
      const n = document.createElement('span'); n.className = 'b-nc';
      n.textContent = src ? 'no option candles for this trade' : 'loading the option\'s candles…';
      el.appendChild(n);
    }
    el._chart = c;
    return { c, s, last: data.length ? data[data.length - 1].time : null };
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!doc || doc.withheld) return;
    const exitAt = setRules(doc.rules);
    TR = new Map();
    OPEN = (doc.open || []).map(x => T(x, doc.day));
    CLOSED = (doc.closed || []).map(x => T(x, doc.day));
    for (const t of OPEN.concat(CLOSED)) TR.set(t.key, t);
    if (daysDoc) for (const d of daysDoc.days) for (const x of d.trades || []) { const t = T(x, d.day); TR.set(t.key, t); }
    $('main').classList.toggle('none', !OPEN.length);
    renderKpis();
    // today's candles: fetched again when the feed says they changed, while a chart of today needs them
    const c = CAND.get(doc.day);
    if ((OPEN.length || expanded['b-today'] || selDay === doc.day || (c && c.doc)) && (!c || c.ver !== doc.candles_at)) candles(doc.day, doc.candles_at);
    renderHero(exitAt);
    renderToday();
    if ((!daysDoc || daysDoc.at !== doc.days_at) && !daysBusy) fetchDays().then(() => { if (doc && !doc.withheld) render(); });
    renderDays();
  }

  // the 4 numbers
  function renderKpis() {
    const tot = doc.total || {}, td = doc.today || {};
    const n = ok(tot.trades) ? tot.trades : 0, won = ok(tot.wins) ? tot.wins : 0;
    const inIt = OPEN.reduce((a, o) => a + (ok(o.entry) && ok(o.lot) ? o.entry * o.lot : 0), 0);
    const tsub = doc.status === 'no session' ? 'no session today'
      : `${ok(td.closed) ? td.closed : 0} closed` + (OPEN.length ? ` · open trade${OPEN.length > 1 ? 's' : ''} <span class="${cls(td.open_gross)}">${rs(td.open_gross, 1)}</span>` : '');
    const K = [
      { l: 'Net since start', v: rs(ok(tot.net) ? tot.net : 0, 1), c: cls(tot.net), s: n ? `${plural(n, 'closed trade')} · since ${dshort(tot.first_day)} · 1 lot each` : 'no closed trade yet · 1 lot each' },
      { l: 'Today', v: rs(ok(td.net) ? td.net : 0, 1), c: cls(td.net), s: tsub },
      { l: 'Open now', v: String(OPEN.length), c: '', s: OPEN.length ? `${rs(inIt)} in it` : 'no open trade' }];
    $('b-kpis').innerHTML = K.map(k => `<div class="b-k"><span class="l">${k.l}</span><span class="v ${k.c}">${k.v}</span><span class="s">${k.s}</span></div>`).join('') +
      `<div class="b-k"><span class="l">Trades</span><span class="v">${won} <small>won</small> · ${n - won} <small>lost</small></span><span class="s">${n ? Math.round(100 * won / n) : 0}% won · after charges</span></div>`;
  }

  // the hero: one open trade, big; several: a chip for each above it
  function emptyText() {
    const s = doc.status;
    if (s === 'waiting') return 'No open trade: entries start at 09:15 IST.';
    if (s === 'closed') return 'No open trade: the session is over.';
    if (s === 'no session') return doc.why === 'weekend' ? 'No NSE session today (weekend).' : doc.why === 'holiday' ? `No NSE session today (${esc(doc.holiday || 'holiday')}).` : 'No NSE session today.';
    return 'No open trade right now.';
  }
  function renderHero(exitAt) {
    const ch = $('b-chips');
    if (!OPEN.length) {
      if (heroKey !== null || !$('b-hero').querySelector('.b-empty')) { const cv = $('b-cv'); if (cv && cv._chart) cv._chart.remove(); }
      heroKey = null; heroSeries = null; ch.hidden = true; ch.innerHTML = ''; ch._html = '';
      $('b-hero').innerHTML = `<div class="b-empty">${emptyText()}</div>`;
      return;
    }
    if (!OPEN.some(o => o.key === selKey)) selKey = OPEN[0].key;
    const o = OPEN.find(x => x.key === selKey);
    ch.hidden = OPEN.length < 2;
    const chips = OPEN.length < 2 ? '' : OPEN.map(x => `<button type="button" aria-pressed="${x.key === selKey}" data-k="${esc(x.key)}">${esc(x.name)} ${esc(x.opt)}<b class="${cls(x.gross)}">${rs(x.gross, 1)}</b></button>`).join('');
    if (chips !== ch._html) { ch.innerHTML = chips; ch._html = chips; }   // unchanged: kept (a focused chip stays focused)
    if (heroKey !== o.key) {
      const cv = $('b-cv'); if (cv && cv._chart) cv._chart.remove();
      $('b-hero').innerHTML = `<article class="b-hero" aria-label="${esc(o.name)} ${esc(o.opt)}"><div class="b-hh" id="b-hh"></div>
        <div class="b-hb"><div class="b-cv" id="b-cv"></div><div class="b-stats" id="b-stats"></div></div></article>`;
      heroKey = o.key; heroVer = null; heroSeries = null;
    }
    $('b-hh').innerHTML = `<div><div class="b-ttl"><span class="o">${esc(o.name)} ${esc(o.opt)}</span>${pill(o)}<span class="tagx">${o.kind}m entry</span></div>
        <div class="b-meta">${esc(o.setup || '–')} setup · in at <b>${hm(o.tin)}</b> IST · exp <b>${dshort(o.exp)}</b> · lot <b>${ok(o.lot) ? o.lot : '–'}</b></div></div>
      <div class="b-pl"><span class="l">P&amp;L before charges</span><span class="v ${cls(o.gross)}">${rs(o.gross, 1)}</span><span class="s ${cls(o.gross)}">${pc(o.pct)}</span></div>`;
    const toT = ok(o.ltp) && o.target > o.entry ? clamp((o.ltp - o.entry) / (o.target - o.entry)) : 0;
    const toS = ok(o.ltp) && o.entry > o.stop ? clamp((o.entry - o.ltp) / (o.entry - o.stop)) : 0;
    $('b-stats').innerHTML = `<div class="b-st"><span class="l">Now</span><span class="v ${cls(o.ltp - o.entry)}">${r2(o.ltp)}</span><span class="s">${ok(o.ltp_t) ? hm(o.ltp_t) + ' IST' : '–'}</span></div>
        <div class="b-st"><span class="l">Entry</span><span class="v">${r2(o.entry)}</span><span class="s">${esc(o.name)} at ${ok(o.upx) ? o.upx.toLocaleString('en-IN') : '–'}</span></div>
        <div class="b-st"><span class="l">Open for</span><span class="v">${ok(o.mins) ? Math.round(o.mins) : '–'} min</span><span class="s">exits by ${esc(exitAt)}</span></div>
        <div class="b-bars">
          <div class="b-bar"><div class="t"><span>to target</span><b>${r2(o.target)}</b></div><span class="k"><i style="width:${(toT * 100).toFixed(0)}%"></i></span></div>
          <div class="b-bar stop"><div class="t"><span>to stop</span><b>${r2(o.stop)}</b></div><span class="k"><i style="width:${(toS * 100).toFixed(0)}%"></i></span></div>
        </div>`;
    const c = CAND.get(o.day), ver = c && c.doc ? c.n : null;   // every new candles document redraws the chart
    if (heroVer !== ver || !heroSeries) {
      const r = chart($('b-cv'), o, { live: true, trade: o });
      heroSeries = r; heroVer = ver;
    } else if (heroSeries && heroSeries.s) {            // the forming minute, live
      const lb = liveBar(o, heroSeries.last);
      if (lb && (heroSeries.last == null || lb.time >= heroSeries.last)) { try { heroSeries.s.update(lb); heroSeries.last = lb.time; } catch (e) { /* redrawn with the next candles */ } }
    }
  }
  $('b-chips').addEventListener('click', e => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    selKey = b.dataset.k; renderHero(setRules(doc.rules));
  });

  // trade rows: tap one for its option chart
  const HEAD = `<div class="b-row th" aria-hidden="true"><span class="b-in">In</span><span class="b-out">Out</span><span class="b-id"><span class="nm">Market</span><span class="o">Option</span><span class="b-pill">Side</span><span class="ek">Entry</span></span>
  <span class="b-mt"><span class="set">Setup</span><span class="lot r">Lot</span><span class="en r">Entry ₹</span><span class="ex r">Exit ₹</span><span class="how">Exit</span></span><span class="b-net r">Net ₹</span><span class="b-pct r">%</span></div>`;
  function rows(el, ts, skipEl, skips, gapEl, gaps) {
    el.innerHTML = HEAD + ts.map(t => `<div class="b-row" role="button" tabindex="0" aria-expanded="false" data-k="${esc(t.key)}">
    <span class="b-in">${hm(t.tin)}</span><span class="b-out">${hm(t.tout)}</span>
    <span class="b-id"><span class="nm">${esc(t.name)}</span><span class="o">${esc(t.opt)}</span>${pill(t)}<span class="ek">${t.kind}m</span></span>
    <span class="b-mt"><span class="set">${esc(t.setup || '–')}</span><span class="lot"><span class="nw">lot </span><span class="num">${ok(t.lot) ? t.lot : '–'}</span></span><span class="en num">${p2(t.entry)}</span><span class="ex num">${p2(t.exit)}</span><span class="how">${HOW[t.how] || esc(t.how)}</span></span>
    <span class="b-net ${cls(t.net)}">${rs(t.net, 1)}</span><span class="b-pct ${cls(t.net)}">${pc(t.pct)}</span></div>`).join('');
    if (!ts.length) el.innerHTML = `<div class="b-empty" style="border:0">${doc.status === 'no session' && el.id === 'b-today' ? 'No trade today.' : 'No closed trade yet.'}</div>`;
    skipEl.textContent = skipText(skips);
    gapEl.textContent = gapText(gaps);
    const k = expanded[el.id];
    if (k) { const r = el.querySelector(`.b-row[data-k="${CSS.escape(k)}"]`); if (r) openRow(el, r, true); else expanded[el.id] = null; }
  }
  function openRow(el, r, keep) {
    const was = r.classList.contains('sel');
    el.querySelectorAll('.b-det').forEach(x => { const d = x.querySelector('.b-dc'); if (d && d._chart) d._chart.remove(); x.remove(); });
    el.querySelectorAll('.b-row.sel').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-expanded', 'false'); });
    if (was && !keep) { expanded[el.id] = null; return; }
    const t = TR.get(r.dataset.k); if (!t) return;
    expanded[el.id] = t.key;
    r.classList.add('sel'); r.setAttribute('aria-expanded', 'true');
    const d = document.createElement('div'); d.className = 'b-det';
    d.innerHTML = `<div class="b-dl"><span>${esc(t.name)} ${esc(t.opt)} · exp ${dshort(t.exp)}</span><span>gross <b class="${cls(t.gross)}">${rs(t.gross, 1)}</b></span>
      <span>charges <b>${rs(t.charges)}</b></span><span>net <b class="${cls(t.net)}">${rs(t.net, 1)}</b></span><span>${esc(t.name)} at entry <b>${ok(t.upx) ? t.upx.toLocaleString('en-IN') : '–'}</b></span></div><div class="b-dc"></div>`;
    r.after(d);
    if (!rowsOf(t)) candles(t.day, doc && t.day === doc.day ? doc.candles_at : undefined);
    chart(d.querySelector('.b-dc'), t, {});
  }
  function redrawCharts(day) {
    if (doc && day === doc.day && OPEN.length) renderHero(setRules(doc.rules));
    for (const id of ['b-today', 'b-dayl']) {
      const k = expanded[id], t = k && TR.get(k);
      if (!t || t.day !== day) continue;
      const det = $(id).querySelector('.b-row.sel + .b-det .b-dc');
      if (det) chart(det, t, {});
    }
  }
  for (const id of ['b-today', 'b-dayl']) {
    const el = $(id);
    el.addEventListener('click', e => { const r = e.target.closest('.b-row[data-k]'); if (r) openRow(el, r); });
    el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.b-row[data-k]')) { e.preventDefault(); openRow(el, e.target); } });
  }
  function renderToday() {
    $('b-today-sub').textContent = `${dlabel(doc.day)} · times in India (IST) · tap a trade for its option chart`;
    const sig = JSON.stringify([doc.day, doc.status, CLOSED.map(t => [t.key, t.net, t.how]), doc.skipped, doc.gaps, HOW]);
    if (sig === todaySig) return;
    todaySig = sig;
    rows($('b-today'), CLOSED, $('b-skip'), doc.skipped, $('b-gaps'), doc.gaps);
  }

  // every day: the days before today from days.json, today from the feed (a day without a session is left out)
  function allDays() {
    const out = (daysDoc ? daysDoc.days : []).filter(d => isDate(d.day) && d.day < doc.day)
      .map(d => ({ day: d.day, trades: (d.trades || []).map(x => T(x, d.day)), skipped: d.skipped || [], gaps: d.gaps || [] }));
    if (doc.status !== 'no session') out.push({ day: doc.day, trades: CLOSED, skipped: doc.skipped || [], gaps: doc.gaps || [] });
    return out;
  }
  const dayNet = d => d.trades.reduce((a, t) => a + t.net, 0);
  function renderDays() {
    const days = allDays();
    const sig = JSON.stringify(days.map(d => [d.day, d.trades.length, Math.round(dayNet(d))]));
    if (sig !== daysSig) {
      daysSig = sig;
      $('b-days').innerHTML = days.map(d => {
        const n = dayNet(d), k = d.trades.length;
        return `<button type="button" class="b-dy ${k ? (n >= 0 ? 'up' : 'down') : ''}${d.day === selDay ? ' sel' : ''}" data-d="${d.day}"><span class="dt"><span class="w">${wday(d.day)}</span><span class="d">${dshort(d.day)}</span></span>
    <span class="n ${k ? cls(n) : 'muted'}">${k ? rs(n, 1) : '—'}</span><span class="c">${plural(k, 'trade')}</span></button>`;
      }).join('');
    }
    if (selDay) {
      const d = days.find(x => x.day === selDay);
      if (!d) { closeDay(); return; }
      const psig = JSON.stringify([d.day, d.trades.map(t => [t.key, t.net]), d.skipped, d.gaps, HOW]);
      if (psig !== panelSig) { panelSig = psig; showDay(d); }
    }
  }
  function showDay(d) {
    $('b-day-t').textContent = dlabel(d.day);
    $('b-day-s').textContent = d.trades.length ? `${plural(d.trades.length, 'trade')} · net ${rs(dayNet(d), 1)}` : 'no trade';
    rows($('b-dayl'), d.trades, $('b-day-skip'), d.skipped, $('b-day-gaps'), d.gaps);
    $('b-day').hidden = false;
  }
  function closeDay() {
    $('b-day').hidden = true; selDay = null; panelSig = null; expanded['b-dayl'] = null;
    $('b-dayl').querySelectorAll('.b-dc').forEach(x => { if (x._chart) x._chart.remove(); });
    document.querySelectorAll('.b-dy').forEach(x => x.classList.remove('sel'));
  }
  $('b-days').addEventListener('click', e => {
    const b = e.target.closest('.b-dy'); if (!b || !doc) return;
    if (b.classList.contains('sel')) { closeDay(); return; }
    document.querySelectorAll('.b-dy').forEach(x => x.classList.toggle('sel', x === b));
    selDay = b.dataset.d; panelSig = null; expanded['b-dayl'] = null;
    renderDays();
  });
  $('b-day-x').addEventListener('click', closeDay);

  poll();
})();
