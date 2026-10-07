/* Nasdaq Signal Board: the in-browser engine.

   The same two signals as ndx10.py and ndx10_live.py, computed in the viewer's browser from Hyperliquid's
   public API, so the page needs no server of its own and can be hosted as plain files. It hands the page the
   same snapshot and ticks as the Python server's /snapshot and /events, and the page draws them the same way.

   History: two days of 1-minute candles per market (about 750 of the 1200 request weight Hyperliquid allows
   an IP per minute), kept in localStorage so a reload only fetches what is new. Live: Hyperliquid's 1-minute
   candle stream. A minute closes 1.5 s after the exchange moves past it (any market trading in a later minute),
   so the viewer's clock doesn't matter; a quiet minute becomes a flat bar, as on the exchange. If the stream
   drops, everything is rebuilt from the exchange's candles, as the server does.

   Safety nets, because a stream can also stay connected yet stop sending (pings still answered): if no market
   updates for 2 minutes it is reconnected and rebuilt; every 3 minutes the newest bars are compared with the
   official candles and corrected; and a reload always fetches the last 3 hours again, plus any long run of
   minutes without trades, so a stuck stream's flat bars never survive in the cache. */
(() => {
'use strict';
const API = 'https://api.hyperliquid.xyz/info', WS_URL = 'wss://api.hyperliquid.xyz/ws';
const BENCH = 'xyz:XYZ100';  // Hyperliquid's Nasdaq-100 perp: both price charts, and the NAS100 series
const DAY = 86400000, MIN = 60000;
const HISTORY_MINUTES = 2 * 1440;
const GRACE = 1500;      // how long past a minute's end to wait for its last updates (hl/live.py BAR_GRACE_MS)
const LULL = 10000;      // no market traded since: minutes close by the viewer's clock, with this extra margin
const SILENCE = 15000;   // nothing heard for this long while the page is visible: the connection is dead
const STALL = 120000;    // connected, but no market has updated for this long: the stream is stuck
const RECHECK = 3 * 60000, RECHECK_SPAN = 20;  // every 3 minutes, the last 20 closed minutes against the official candles
const REFETCH = 180;     // minutes always fetched again on a reload or a reconnect
const KEEP_BARS = 5000, KEEP_MINUTES = 7200;
const TIMEFRAMES = { 3: 'ema', 5: 'macd', 7: 'macd', 15: 'macd' };  // minutes -> what runs on it
const NAS100_TIMEFRAMES = { ...TIMEFRAMES, 1: 'macd' };             // plus a 1m MACD shown for information
const CACHE = 'nsb.candles.v2.';  // v1 caches can hold flat bars from a stuck stream: they are not read

// ---- the signal: a line-for-line port of ndx10.py ----------------------------------------------
const bucket = (t, minutes) => {  // [start, end] of the bar containing t; bars restart at 00:00 UTC each day
  const day0 = t - t % DAY, size = minutes * MIN, start = day0 + Math.floor((t - day0) / size) * size;
  return [start, Math.min(start + size, day0 + DAY)];
};

class Ema {
  constructor(length) { this.alpha = 2 / (length + 1); this.value = null; }
  update(x) { this.value = this.peek(x); return this.value; }
  peek(x) { return this.value === null ? x : this.value + this.alpha * (x - this.value); }  // as if x were the next close
  peek2(x1, x2) { const v = this.peek(x1); return v + this.alpha * (x2 - v); }              // after x1 then x2
}

class Macd {
  constructor() { this.fast = new Ema(12); this.slow = new Ema(26); this.signal = new Ema(9); }
  update(close) { const line = this.fast.update(close) - this.slow.update(close); return [line, this.signal.update(line)]; }
  peek(close) { const line = this.fast.peek(close) - this.slow.peek(close); return [line, this.signal.peek(line)]; }
  peek2(first, close) {
    const line1 = this.fast.peek(first) - this.slow.peek(first);
    const line2 = this.fast.peek2(first, close) - this.slow.peek2(first, close);
    return [line2, this.signal.peek2(line1, line2)];
  }
}

class Timeframe {  // bars of one size: closed bars with their indicators, plus the forming bar
  constructor(minutes, kind) {
    this.minutes = minutes; this.kind = kind;
    this.macd = kind === 'macd' ? new Macd() : null;
    this.ema8 = kind === 'ema' ? new Ema(8) : null;
    this.ema21 = kind === 'ema' ? new Ema(21) : null;
    this.bars = [];
    this.partial = null;  // the bar being filled by finished minutes
  }
  addMinute(start, open, high, low, close) {
    const [bStart, bEnd] = bucket(start, this.minutes);
    if (this.partial && this.partial.time !== bStart) this.close();  // its last minute never arrived
    if (!this.partial) this.partial = { time: bStart, open, high, low, close };
    else { const p = this.partial; p.high = Math.max(p.high, high); p.low = Math.min(p.low, low); p.close = close; }
    if (start + MIN >= bEnd) this.close();
  }
  close() {
    const bar = this.partial;
    this.partial = null;
    Object.assign(bar, this.indicators(bar.close, true));
    this.bars.push(bar);
    if (this.bars.length > KEEP_BARS + 500) this.bars.splice(0, 500);
  }
  indicators(close, commit) {
    if (this.macd) { const [line, signal] = commit ? this.macd.update(close) : this.macd.peek(close); return { macd: line, signal, hist: line - signal }; }
    return commit ? { ema8: this.ema8.update(close), ema21: this.ema21.update(close) }
                  : { ema8: this.ema8.peek(close), ema21: this.ema21.peek(close) };
  }
  indicatorsAfter(first, close) {  // a bar closing at `close`, right after one closing at `first`
    if (this.macd) { const [line, signal] = this.macd.peek2(first, close); return { macd: line, signal, hist: line - signal }; }
    return { ema8: this.ema8.peek2(first, close), ema21: this.ema21.peek2(first, close) };
  }
  // The forming bar priced at `price`. Just after a boundary the old bar's last minute is still on its way; its
  // time is up, so it closes provisionally at estimate(its last minute) and the new bar forms after it.
  forming(price, now, estimate) {
    const last = this.bars[this.bars.length - 1];
    const start = this.partial ? this.partial.time : last ? bucket(last.time, this.minutes)[1] : 0;
    const end = start ? bucket(start, this.minutes)[1] : 0;
    if (now != null && start && now >= end) {
      let first = estimate ? estimate(end - MIN) : undefined;
      if (first == null) first = this.partial ? this.partial.close : last.close;
      return Object.assign({ time: end, open: first, high: Math.max(first, price), low: Math.min(first, price), close: price },
                           this.indicatorsAfter(first, price));
    }
    let bar;
    if (this.partial) bar = { ...this.partial, high: Math.max(this.partial.high, price), low: Math.min(this.partial.low, price) };
    else { const prev = last ? last.close : price; bar = { time: start, open: prev, high: Math.max(prev, price), low: Math.min(prev, price) }; }
    bar.close = price;
    return Object.assign(bar, this.indicators(price, false));
  }
}

class TrendSignal {  // members' 1-minute closes combined (sum of coef * close), the timeframes, and the signal
  constructor(coef, timeframes = TIMEFRAMES) {
    this.coef = coef; this.coins = Object.keys(coef);
    this.tfs = {};
    for (const m of Object.keys(timeframes).map(Number).sort((a, b) => a - b)) this.tfs[m] = new Timeframe(m, timeframes[m]);
    this.pending = new Map(); this.lastMinute = null; this.lastClose = null;
    this.extremes = new Map();   // live highs/lows sampled within each minute
    this.seenAtEnd = new Map();  // the last live value sampled in each recent minute
    this.history = [];           // [minute, signal state at that minute's close]
  }
  onMemberBar(coin, start, close) {
    if (this.lastMinute !== null && start <= this.lastMinute) return;
    let slot = this.pending.get(start);
    if (!slot) this.pending.set(start, slot = new Map());
    slot.set(coin, close);
    if (slot.size < this.coins.length) return;
    this.pending.delete(start);
    if (this.lastMinute === null || start !== this.lastMinute + MIN) {
      for (const m of [...this.pending.keys()]) if (m < start) this.pending.delete(m);  // minutes some member never had
    }
    let value = 0;
    for (const [c, px] of slot) value += this.coef[c] * px;
    this.finishMinute(start, value);
  }
  finishMinute(start, close) {
    const open = this.lastClose !== null ? this.lastClose : close;
    let high = Math.max(open, close), low = Math.min(open, close);
    if (this.extremes.has(start)) {  // live minutes also know the in-between highs and lows
      const [hi, lo] = this.extremes.get(start);
      this.extremes.delete(start);
      high = Math.max(high, hi); low = Math.min(low, lo);
    }
    for (const m of [...this.extremes.keys()]) if (m < start) this.extremes.delete(m);
    if (this.ready) {  // evaluated before the minute is added: exactly what the live check showed at that moment
      this.history.push([start, this.evaluate(close).state]);
      if (this.history.length > KEEP_MINUTES + 500) this.history.splice(0, 500);
    }
    this.lastMinute = start; this.lastClose = close;
    for (const tf of Object.values(this.tfs)) tf.addMinute(start, open, high, low, close);
  }
  value(prices) {
    let v = 0;
    for (const c of this.coins) { if (!(prices[c] > 0)) return null; v += this.coef[c] * prices[c]; }
    return v;
  }
  sample(now, value) {
    const minute = now - now % MIN, [hi, lo] = this.extremes.get(minute) || [value, value];
    this.extremes.set(minute, [Math.max(hi, value), Math.min(lo, value)]);
    this.seenAtEnd.set(minute, value);
    for (const m of [...this.seenAtEnd.keys()]) if (m < minute - 600000) this.seenAtEnd.delete(m);
  }
  get ready() {  // enough closed bars everywhere for the MACD (26 + 9) and the EMA 21 to have settled
    return Object.values(this.tfs).every(tf => tf.bars.length >= (tf.kind === 'macd' ? 35 : 21));
  }
  started(state, fallback) {  // when the current run of `state` began
    let start = fallback;
    for (let i = this.history.length - 1; i >= 0; i--) { const [m, s] = this.history[i]; if (s !== state) break; start = m; }
    return start;
  }
  historyRuns() {  // [first minute, last minute, state] runs
    const runs = [];
    for (const [m, s] of this.history) {
      const r = runs[runs.length - 1];
      if (r && r[2] === s && r[1] === m - MIN) r[1] = m; else runs.push([m, m, s]);
    }
    return runs;
  }
  evaluate(value, now) {  // the signal with `value` as the close of every forming bar
    const f = {};
    for (const [m, tf] of Object.entries(this.tfs)) f[m] = tf.forming(value, now, k => this.seenAtEnd.get(k));
    const checks = {
      '15m MACD vs signal': f[15].macd - f[15].signal,
      '7m MACD vs 0': f[7].macd,
      '5m MACD vs 0': f[5].macd,
      '3m EMA8 vs EMA21': f[3].ema8 - f[3].ema21,
    };
    const v = Object.values(checks);
    const state = v.every(x => x > 0) ? 'BULLISH' : v.every(x => x < 0) ? 'BEARISH' : 'NEUTRAL';
    return { value, state, checks, forming: f };
  }
}

class Tracker {  // the live state; reports a change once it has held for `debounce` seconds (ndx10_live.py Signal)
  constructor(debounce) { this.debounce = debounce * 1000; this.state = null; this.since = 0; this.alerted = null; }
  update(state, now, started) {
    if (state !== this.state) { this.since = this.state === null && started != null ? started : now; this.state = state; }
    if (this.alerted === null) this.alerted = state;  // the state at startup is not news
    else if (state !== this.alerted && now - this.since >= this.debounce) { this.alerted = state; return state; }
    return null;
  }
}

// ---- Hyperliquid ------------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function info(body, onWait) {  // one request to the info endpoint, retried with backoff when busy or unreachable
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) return await res.json();
      status = res.status;
    } catch (e) { /* offline, or blocked */ }
    if (attempt >= 7) throw new Error(status ? `Hyperliquid answered ${status}` : 'Hyperliquid could not be reached');
    const wait = Math.min(30000, 2000 * 2 ** attempt);
    if (onWait) onWait(status, wait);
    await sleep(wait);
  }
}
const candleRows = (coin, interval, startTime, endTime, onWait) =>
  info({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } }, onWait);
const toBar = r => ({ t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v, n: r.n });
const flat = (t, px) => ({ t, o: px, h: px, l: px, c: px, v: 0, n: 0 });  // a minute without trades
const priceBar = b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });

function contiguous(bars) {  // one bar per minute: missing minutes become flat bars at the previous close
  const out = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    if (prev) for (let t = prev.t + MIN; t < b.t; t += MIN) out.push(flat(t, prev.c));
    out.push(b);
  }
  return out;
}
function quietRunStart(bars, len) {  // the first minute of the last run of `len` or more minutes without trades
  let found = null, start = null, run = 0;
  for (const b of bars) {
    if (b.n === 0) { if (run === 0) start = b.t; run += 1; if (run >= len) found = start; } else run = 0;
  }
  return found;
}
function loadCache(coin) {
  try {
    const rows = JSON.parse(localStorage.getItem(CACHE + coin));
    return Array.isArray(rows) ? rows.map(([t, o, h, l, c, v, n]) => ({ t, o, h, l, c, v, n })) : [];
  } catch (e) { return []; }
}
function saveCache(coin, bars) {
  try { localStorage.setItem(CACHE + coin, JSON.stringify(bars.map(b => [b.t, b.o, b.h, b.l, b.c, b.v, b.n]))); } catch (e) {}
}
function referenceCloseMs(asOf) {  // 16:00 New York on the basket's as-of date (the US cash close), in UTC ms
  const [m, d, y] = asOf.split('/').map(Number);
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
  for (const utc of [20, 21]) { const t = Date.UTC(y, m - 1, d, utc); if (Number(hour.format(t)) === 16) return t; }
  return Date.UTC(y, m - 1, d, 20);
}
const fixed = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---- the engine -------------------------------------------------------------------------------
class Engine {
  constructor(basket, { progress } = {}) {
    this.basket = basket;
    this.members = Object.keys(basket.members);
    this.coins = [...this.members, BENCH];
    this.coef = Object.fromEntries(this.members.map(c => [c, basket.base * basket.members[c].weight / basket.members[c].ref_price]));
    this.refCloseMs = referenceCloseMs(basket.as_of);
    this.benchRef = null;
    this.boot = Math.floor(Date.now() / 1000);
    this.gen = 0; this.seq = 0; this.lastTick = null;
    this.handlers = { tick: [], status: [], alert: [] };
    this.waiters = [];
    this.progress = progress || (() => {});
    this.markets = Object.fromEntries(this.coins.map(c => [c, { closed: [], cur: null }]));
    this.trackers = { ndx10: new Tracker(3), nas100: new Tracker(3) };  // they outlive rebuilds, as on the server
    this.sections = null;
    this.building = true; this.buffer = []; this.gap = null; this.retryAt = 0;
    this.ws = null; this.connects = 0; this.lastHeard = 0; this.nextTick = 0;
    this.exMinute = 0; this.exSince = 0;  // the newest minute any market has traded in, and when we first saw it
    this.lastCandleAt = 0; this.lastUnstick = 0; this.nextRecheck = 0; this.rechecking = false;
  }

  on(event, fn) { this.handlers[event].push(fn); }
  whenReady() { return this.lastTick && !this.building ? Promise.resolve() : new Promise(r => this.waiters.push(r)); }
  publish(event, data) {
    if (event === 'tick') {
      this.seq += 1;
      data = { ...data, boot: this.boot, gen: this.gen, seq: this.seq };
      this.lastTick = data;
      for (const r of this.waiters.splice(0)) r();
    }
    const copy = JSON.parse(JSON.stringify(data));  // the page gets its own copy, as if it came over the wire
    for (const fn of this.handlers[event]) fn(copy);
  }
  snapshot() {
    if (!this.lastTick) return { loading: true };
    return JSON.parse(JSON.stringify({
      boot: this.boot, gen: this.gen, basket: this.basket, bench: BENCH, price: this.priceBars, tick: this.lastTick,
      sections: Object.fromEntries(this.sections.map(s => [s.key, {
        bars: Object.fromEntries(Object.entries(s.signal.tfs).map(([m, tf]) => [m, tf.bars])),
        signal: s.signal.historyRuns(),
      }])),
    }));
  }

  async start() {
    this.connect();  // first: its updates wait in `buffer` while the history loads, so nothing falls in between
    await this.load(false);
    setInterval(() => this.step(), 250);
    setInterval(() => { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send('{"method":"ping"}'); }, 5000);
    setInterval(() => this.saveCaches(), 5 * MIN);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.saveCaches(); });
    window.addEventListener('pagehide', () => this.saveCaches());
  }

  // Closed 1-minute bars from Hyperliquid's candles (only what the cache lacks), then signals rebuilt from them.
  async load(recovering) {
    this.building = true;
    const now = Date.now(), oldest = now - HISTORY_MINUTES * MIN;
    let done = 0;
    const busy = (status, wait) => this.progress(status === 429 ? `Hyperliquid is busy. Retrying in ${Math.round(wait / 1000)} s…`
                                                               : `Can't reach Hyperliquid. Retrying in ${Math.round(wait / 1000)} s…`);
    if (!recovering) this.progress(`Loading two days of Hyperliquid history (0 of ${this.coins.length} markets)…`);
    await Promise.all(this.coins.map(async coin => {
      const mk = this.markets[coin];
      const have = (recovering ? mk.closed : loadCache(coin)).filter(b => b.t >= oldest);
      // fetched again: the last 3 hours (bars closed from the live stream are replaced by the official candles), and
      // any long run of minutes without trades, which may be a stream that got stuck rather than a quiet market
      let from = oldest;
      if (have.length && have[0].t <= oldest + 60 * MIN) {
        from = Math.max(oldest, Math.min(have[have.length - 1].t - 30 * MIN, now - REFETCH * MIN));
        const quiet = quietRunStart(have, 15);
        if (quiet !== null) from = Math.max(oldest, Math.min(from, quiet));
      }
      const rows = (await candleRows(coin, '1m', from, now, busy)).map(toBar);
      for (const b of rows) if (b.n > 0 && b.t > this.exMinute) { this.exMinute = b.t; this.exSince = Date.now(); }
      const byMinute = new Map(have.map(b => [b.t, b]));
      for (const b of rows) byMinute.set(b.t, b);
      const bars = contiguous([...byMinute.values()].sort((a, b) => a.t - b.t));
      const last = bars[bars.length - 1];
      mk.cur = last && last.t + MIN + GRACE > Date.now() ? bars.pop() : last ? flat(last.t + MIN, last.c) : null;
      mk.closed = bars;
      done += 1;
      if (!recovering) this.progress(`Loading two days of Hyperliquid history (${done} of ${this.coins.length} markets)…`);
    }));
    if (this.benchRef === null) await this.loadBenchRef(busy);
    for (const d of this.buffer.splice(0)) this.onCandle(d, true);  // updates that came in meanwhile
    this.rebuild();
    this.lastCandleAt = Date.now();
    this.nextRecheck = Date.now() + RECHECK;
    this.building = false;
  }
  async loadBenchRef(busy) {  // XYZ100 at the basket's reference close: its 1-minute bar, else the hour ending then
    const bar = this.markets[BENCH].closed.find(b => b.t === this.refCloseMs - MIN);
    if (bar) { this.benchRef = bar.c; return; }
    try {
      const rows = await candleRows(BENCH, '1h', this.refCloseMs - 3600000, this.refCloseMs - 1, busy);
      const hour = rows.find(r => r.t === this.refCloseMs - 3600000);
      if (hour) this.benchRef = +hour.c;
    } catch (e) { /* the change since the reference close is simply not shown */ }
  }
  rebuild() {  // fresh signals from every closed bar, minute by minute, as they would have arrived live
    const ndx = new TrendSignal(this.coef), nas = new TrendSignal({ [BENCH]: 1 }, NAS100_TIMEFRAMES);
    this.sections = [
      { key: 'ndx10', name: 'NDX10', digits: 2, signal: ndx, tracker: this.trackers.ndx10, ref: this.basket.base },
      { key: 'nas100', name: 'NAS100', digits: 1, signal: nas, tracker: this.trackers.nas100, ref: this.benchRef },
    ];
    this.priceBars = [];
    const at = Object.fromEntries(this.coins.map(c => [c, 0]));
    const first = Math.min(...this.coins.map(c => this.markets[c].closed.length ? this.markets[c].closed[0].t : Infinity));
    const last = Math.max(...this.coins.map(c => { const a = this.markets[c].closed; return a.length ? a[a.length - 1].t : -Infinity; }));
    for (let t = first; t <= last; t += MIN) {
      for (const c of this.coins) {
        const a = this.markets[c].closed;
        while (at[c] < a.length && a[at[c]].t < t) at[c] += 1;
        if (at[c] < a.length && a[at[c]].t === t) this.emit(c, a[at[c]]);
      }
    }
    this.gen += 1;
  }
  emit(coin, b) {  // a closed 1-minute bar reaches the signals
    if (coin === BENCH) {
      this.priceBars.push(priceBar(b));
      if (this.priceBars.length > KEEP_MINUTES + 500) this.priceBars.splice(0, 500);
      this.sections[1].signal.onMemberBar(coin, b.t, b.c);
    } else this.sections[0].signal.onMemberBar(coin, b.t, b.c);
  }

  connect() {
    const ws = this.ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      this.connects += 1;
      this.lastHeard = this.lastCandleAt = Date.now();
      for (const coin of this.coins) ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin, interval: '1m' } }));
      if (this.connects > 1) this.gap = 'reconnected';  // updates during the outage are missing: rebuild from candles
    };
    ws.onmessage = e => {
      this.lastHeard = Date.now();
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.channel !== 'candle' || !m.data) return;
      this.lastCandleAt = Date.now();
      if (m.data.t > this.exMinute) { this.exMinute = m.data.t; this.exSince = Date.now(); }
      if (this.building) this.buffer.push(m.data); else this.onCandle(m.data, false);
    };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; setTimeout(() => this.connect(), 2000); } };
    ws.onerror = () => ws.close();
  }
  onCandle(d, replay) {  // the exchange's current candle for one market: newer minutes close the older ones
    const mk = this.markets[d.s];
    if (!mk) return;
    const b = toBar(d);
    if (!mk.cur || b.t > mk.cur.t) {
      if (mk.cur) this.closeThrough(d.s, b.t, !replay);
      mk.cur = b;
    } else if (b.t === mk.cur.t && b.n >= mk.cur.n) mk.cur = b;  // never back to an older state of the minute
    // an update for a minute already closed comes too late, and is dropped (hl/live.py drops late trades the same way)
  }
  closeThrough(coin, t, live = true) {  // close the market's bars of minutes before t
    const mk = this.markets[coin];
    while (mk.cur && mk.cur.t < t) {
      const done = mk.cur;
      mk.closed.push(done);
      if (mk.closed.length > HISTORY_MINUTES + 600) mk.closed.splice(0, 600);
      if (live) this.emit(coin, done);
      mk.cur = flat(done.t + MIN, done.c);  // the next minute starts flat until it trades
    }
  }

  step() {  // 4 times a second: close finished minutes; once a second: the live check
    const now = Date.now();
    if (this.building || now < this.retryAt) return;
    if (this.gap) { this.recover(); return; }
    const open = this.ws && this.ws.readyState === WebSocket.OPEN;
    if (document.visibilityState === 'visible' && open && now - this.lastHeard > SILENCE) {
      this.ws.close();  // silent: reconnect, which counts as a gap
      return;
    }
    if (open && now - this.lastCandleAt > STALL && now - this.lastUnstick > 5 * MIN) {
      this.lastUnstick = now;  // connected, yet nothing for 2 minutes: stuck. Reconnect and rebuild (at most every 5 min,
      this.ws.close();         // in case the market is only very quiet)
      return;
    }
    // Minutes before the exchange's newest one are over once its first update is 1.5 s old. Only in a true lull, with
    // no update from any market for 10 s, does the viewer's clock decide (a fast clock must not close minutes the
    // exchange is still filling). A stalled connection closes nothing: its silence must not look like a quiet market.
    let upTo = this.exMinute && now - this.exSince >= GRACE ? this.exMinute : 0;
    if (now - this.lastHeard <= SILENCE && now - this.lastCandleAt > LULL) upTo = Math.max(upTo, Math.floor((now - LULL) / MIN) * MIN);
    for (const c of this.coins) { const mk = this.markets[c]; if (mk.cur && mk.cur.t < upTo) this.closeThrough(c, upTo); }
    if (now >= this.nextTick) { this.nextTick = now + 1000; this.tick(now); }
    if (now >= this.nextRecheck) this.recheck();
  }
  // The newest closed bars against Hyperliquid's official candles. Whatever differs (an update the stream never
  // delivered) is replaced and the signals rebuilt; if the stream showed a minute as quiet that in fact traded, it
  // skipped a market, so it is reconnected as well.
  async recheck() {
    if (this.rechecking) return;
    this.rechecking = true;
    this.nextRecheck = Date.now() + RECHECK;
    try {
      const now = Date.now(), fixes = [];
      await Promise.all(this.coins.map(async coin => {
        const rows = (await candleRows(coin, '1m', now - RECHECK_SPAN * MIN, now)).map(toBar);
        const mine = new Map(this.markets[coin].closed.slice(-(RECHECK_SPAN + 5)).map(b => [b.t, b]));
        for (const r of rows) {
          const b = mine.get(r.t);
          if (b && (b.o !== r.o || b.h !== r.h || b.l !== r.l || b.c !== r.c)) fixes.push([coin, r, b]);
        }
      }));
      if (!fixes.length || this.building) return;
      for (const [coin, r] of fixes) {
        const a = this.markets[coin].closed, i = a.findIndex(b => b.t === r.t);
        if (i >= 0) a[i] = r;
      }
      this.rebuild();  // a new generation: the page reloads everything from the corrected bars
      if (fixes.some(([, r, b]) => r.n > 0 && b.n === 0) && this.ws) this.ws.close();
    } catch (e) {
      /* tried again next time */
    } finally {
      this.rechecking = false;
    }
  }
  async recover() {
    if (this.recovering) return;
    this.recovering = true;
    this.publish('status', { text: 'Connection to Hyperliquid dropped. Rebuilding from official candles…' });
    try {
      await this.load(true);
      this.gap = null;
    } catch (e) {
      this.building = false;
      this.retryAt = Date.now() + 15000;
    } finally {
      this.recovering = false;
    }
  }
  saveCaches() { if (!this.building) for (const c of this.coins) saveCache(c, this.markets[c].closed.slice(-HISTORY_MINUTES)); }

  tick(now) {  // ndx10_live.py tick(): evaluate both signals on the live values and publish them
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const px = {};
    for (const c of this.coins) { const mk = this.markets[c]; if (mk.cur) px[c] = mk.cur.c; }
    const values = this.sections.map(s => s.signal.value(px));
    if (values.some(v => v == null) || !this.sections.every(s => s.signal.ready)) return;
    const evs = {}, changes = [];
    this.sections.forEach((s, i) => {
      s.signal.sample(now, values[i]);
      const ev = evs[s.key] = s.signal.evaluate(values[i], now);
      const started = s.tracker.state === null ? s.signal.started(ev.state, now) : null;
      const change = s.tracker.update(ev.state, now, started);
      if (change) changes.push([s, change, ev]);
    });
    const forming = this.markets[BENCH].cur;
    this.publish('tick', {
      time: now,
      members: Object.fromEntries(this.members.map(c => [c, px[c] ?? null])),
      // the last few bars, not just the newest: bars that close late still reach the page
      price: { last: px[BENCH] ?? null, tail: this.priceBars.slice(-3).concat(forming ? [priceBar(forming)] : []) },
      sections: Object.fromEntries(this.sections.map(s => [s.key, {
        time: now, value: evs[s.key].value, state: evs[s.key].state, since: s.tracker.since, checks: evs[s.key].checks,
        ref: s.ref, ref_label: `since the ${this.basket.as_of} close`,
        tf: Object.fromEntries(Object.entries(s.signal.tfs).map(([m, tf]) => [m, tf.bars.slice(-2).concat([evs[s.key].forming[m]])])),
        history_tail: s.signal.history.slice(-3),
      }])),
    });
    for (const [s, change, ev] of changes) {
      const body = `${s.name} ${fixed(ev.value, s.digits)}. `
        + Object.entries(ev.checks).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(3)}`).join('; ');
      this.publish('alert', { name: s.name, state: change, time: now, body });
    }
  }
}

window.NdxEngine = Engine;
window.NdxEngine.internals = { bucket, Ema, Macd, Timeframe, TrendSignal, Tracker, referenceCloseMs };  // for checking against Python
})();
