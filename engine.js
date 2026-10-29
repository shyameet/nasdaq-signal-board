/* Indra Quant Signal Board: the in-browser engine.

   The gate, computed in the viewer's browser from Hyperliquid's public API, so the page needs no server of its own
   and can be hosted as plain files. For each series (the 10 stocks combined, and the index itself), the RDX WIP trend
   (owner 28/10/2026: Rahul's RDX WIP Trend v1.1, "we are not gonna change anything of our own"):
     LONG (state BULLISH)      the 5m, 9m and 11m waves all up (on each, EMA 8 - EMA 47 and EMA 21 - EMA 47 both above
                               0), and the 5m EMA 21 above the EMA 47
     SHORT (state BEARISH)     all three waves down (both below 0), and the 5m EMA 21 below the EMA 47
     NO TRADE (state NEUTRAL)  anything else
   checked at each minute's close on the bars CLOSED by then (owner 28/10/2026: "candle close"; until then the MACD gate
   read the bars still forming). With two or more stocks picked, the stocks' gate is LONG only when
   every picked stock's own gate is LONG (each on its own candles), SHORT only when every one is SHORT, NO TRADE
   otherwise; the composite's own conditions are still worked out and shown, but don't decide it. The page's gate (option `gate`): 'stocks', the stocks' own gate
   (the Signals page), or 'both' (the default, Divergence): LONG only when both series are LONG and SHORT only when both
   are SHORT. Its changes are the alerts. (The local Python server, ndx10_live.py, still runs the old four-rule signal.)

   The stocks' composite is a series of its own, with candles at every size: each stock counts equally, so each
   minute's close is 1000 times the average of the stocks' closes over their reference closes (the sum of scaled
   member closes), its open the previous minute's close, its high and low the larger and smaller of the
   two (live minutes also know the values sampled in between), and its volume the members' dollar volume.

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
const KEEP = { bars: KEEP_BARS, minutes: KEEP_MINUTES };  // raised when older days are added from our archive (extendBack)
const TIMEFRAMES = { 5: 'ema', 9: 'ema', 11: 'ema' };  // the gate: minutes -> what runs on it (EMA 8, 21 and 47: the waves)
// what the pages also need, beyond the gate: the 1m and 2m MACD (entries E2 and E1), the 3m waves (entry E4) and the 3m
// MACD (Entry pane only, owner 29/10/2026)
const SHOWN = { ...TIMEFRAMES, 1: 'macd', 2: 'macd', 3: 'both' };
const CACHE = 'nsb.candles.v2.';  // v1 caches can hold flat bars from a stuck stream: they are not read, and start() removes them
const OLD_CACHE = 'nsb.candles.v1.';  // ~1.65M characters left in Safari's 5 MB, which every shyameet.github.io page shares: v2 failed to save

// ---- the signal: a line-for-line port of ndx10.py ----------------------------------------------
// [start, end] of the bar containing t; bars restart at 00:00 UTC each day, or `origin` ms after it (a market's session
// open, e.g. 03:45 UTC for NSE's 09:15 IST, so bars line up with the exchange's as on TradingView), or with origin 'cme'
// at the CME open, 17:00 Chicago, whichever clock Chicago is on (cme.js)
const bucket = (t, minutes, origin = 0) => {
  const cme = origin === 'cme', day0 = cme ? NsbCme.day0(t) : t - ((t - origin) % DAY + DAY) % DAY, size = minutes * MIN;
  const start = day0 + Math.floor((t - day0) / size) * size;
  return [start, Math.min(start + size, cme ? NsbCme.dayEnd(t) : day0 + DAY)];
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
  constructor(minutes, kind, origin = 0) {  // kind: 'macd', 'ema' (EMA 8 and 21) or 'both'
    this.minutes = minutes; this.kind = kind; this.origin = origin;
    this.macd = kind !== 'ema' ? new Macd() : null;
    this.ema8 = kind !== 'macd' ? new Ema(8) : null;
    this.ema21 = kind !== 'macd' ? new Ema(21) : null;
    this.ema47 = kind !== 'macd' ? new Ema(47) : null;
    this.bars = [];
    this.partial = null;  // the bar being filled by finished minutes
  }
  addMinute(start, open, high, low, close, volume = 0) {
    if (!(start >= this.bs && start < this.be)) [this.bs, this.be] = bucket(start, this.minutes, this.origin);  // a new bar's span, once per bar
    const bStart = this.bs, bEnd = this.be;
    if (this.partial && this.partial.time !== bStart) this.close();  // its last minute never arrived
    if (!this.partial) this.partial = { time: bStart, open, high, low, close, volume };
    else { const p = this.partial; p.high = Math.max(p.high, high); p.low = Math.min(p.low, low); p.close = close; p.volume += volume; }
    if (start + MIN >= bEnd) this.close();
  }
  close() {
    const bar = this.partial;
    this.partial = null;
    Object.assign(bar, this.indicators(bar.close, true));
    this.bars.push(bar);
    if (this.bars.length > KEEP.bars + 500) this.bars.splice(0, 500);
  }
  indicators(close, commit) {
    const out = {};
    if (this.macd) { const [line, signal] = commit ? this.macd.update(close) : this.macd.peek(close); Object.assign(out, { macd: line, signal, hist: line - signal }); }
    if (this.ema8) Object.assign(out, commit ? { ema8: this.ema8.update(close), ema21: this.ema21.update(close), ema47: this.ema47.update(close) }
                                             : { ema8: this.ema8.peek(close), ema21: this.ema21.peek(close), ema47: this.ema47.peek(close) });
    return out;
  }
  indicatorsAfter(first, close) {  // a bar closing at `close`, right after one closing at `first`
    const out = {};
    if (this.macd) { const [line, signal] = this.macd.peek2(first, close); Object.assign(out, { macd: line, signal, hist: line - signal }); }
    if (this.ema8) Object.assign(out, { ema8: this.ema8.peek2(first, close), ema21: this.ema21.peek2(first, close), ema47: this.ema47.peek2(first, close) });
    return out;
  }
  // The forming bar priced at `price`. Just after a boundary the old bar's last minute is still on its way; its
  // time is up, so it closes provisionally at estimate(its last minute) and the new bar forms after it.
  forming(price, now, estimate) {
    const last = this.bars[this.bars.length - 1];
    const start = this.partial ? this.partial.time : last ? bucket(last.time, this.minutes, this.origin)[1] : 0;
    const end = start ? bucket(start, this.minutes, this.origin)[1] : 0;
    if (now != null && start && now >= end) {
      let first = estimate ? estimate(end - MIN) : undefined;
      if (first == null) first = this.partial ? this.partial.close : last.close;
      return Object.assign({ time: end, open: first, high: Math.max(first, price), low: Math.min(first, price), close: price, volume: 0 },
                           this.indicatorsAfter(first, price));
    }
    let bar;
    if (this.partial) bar = { ...this.partial, high: Math.max(this.partial.high, price), low: Math.min(this.partial.low, price) };
    else { const prev = last ? last.close : price; bar = { time: start, open: prev, high: Math.max(prev, price), low: Math.min(prev, price), volume: 0 }; }
    bar.close = price;
    return Object.assign(bar, this.indicators(price, false));
  }
}

// ---- the RDX WIP trend (owner 28/10/2026, Rahul's RDX WIP Trend v1.1) ----------------------------------------------
const ok = v => v !== null && v !== undefined && isFinite(v);
// one timeframe's waves (his RDX MTF EMA Waves B and C): +1 when EMA 8 - EMA 47 and EMA 21 - EMA 47 are both above 0,
// -1 when both are below, 0 when mixed (the Trend pane's yellow); NaN before its EMAs exist
function waveRow(b) {
  if (!b || !ok(b.ema8) || !ok(b.ema21) || !ok(b.ema47)) return NaN;
  const p = b.ema8 - b.ema47, q = b.ema21 - b.ema47;
  return p > 0 && q > 0 ? 1 : p < 0 && q < 0 ? -1 : 0;
}
// the gate's four conditions from each timeframe's last CLOSED bar: LONG when all are above 0, SHORT when all below
const gateChecks = b => ({
  '5m waves': waveRow(b[5]), '9m waves': waveRow(b[9]), '11m waves': waveRow(b[11]),
  '5m EMA21 vs EMA47': b[5] && ok(b[5].ema21) && ok(b[5].ema47) ? b[5].ema21 - b[5].ema47 : NaN,
});

class TrendSignal {  // members' 1-minute closes combined (sum of coef * close), the timeframes, and the signal
  constructor(coef, timeframes = TIMEFRAMES, origin = 0) {
    this.coef = coef; this.coins = Object.keys(coef);
    // two or more members: each one's own gate, from its own closes; the series' gate is where they all agree
    this.parts = this.coins.length > 1 ? Object.fromEntries(this.coins.map(c => [c, new TrendSignal({ [c]: 1 }, TIMEFRAMES, origin)])) : null;
    if (this.parts) for (const p of Object.values(this.parts)) p.trace = null;  // only their gates count
    this.prices = null;
    this.tfs = {};
    for (const m of Object.keys(timeframes).map(Number).sort((a, b) => a - b)) this.tfs[m] = new Timeframe(m, timeframes[m], origin);
    this.tfList = Object.entries(this.tfs); this.partList = this.parts ? Object.values(this.parts) : null;  // walked every minute
    this.pending = new Map(); this.lastMinute = null; this.lastClose = null;
    this.extremes = new Map();   // live highs/lows sampled within each minute
    this.seenAtEnd = new Map();  // the last live value sampled in each recent minute
    this.history = [];           // [minute, signal state at that minute's close]
    this.trace = [];             // { t: minute, b: { minutes: its last closed bar }, state } at each minute's close (wipSignals)
  }
  onMemberBar(coin, start, close, volume = 0) {  // volume: the member's 1-minute volume, in its own units
    if (this.parts) this.parts[coin].onMemberBar(coin, start, close, volume);  // first: the composite closes the minute last
    if (this.lastMinute !== null && start <= this.lastMinute) return;
    if (this.coins.length === 1) { this.finishMinute(start, this.coef[coin] * close, volume * close); return; }  // one market: nobody to wait for
    let slot = this.pending.get(start);
    if (!slot) this.pending.set(start, slot = new Map());
    slot.set(coin, [close, volume]);
    if (slot.size < this.coins.length) return;
    this.pending.delete(start);
    if (this.lastMinute === null || start !== this.lastMinute + MIN) {
      for (const m of [...this.pending.keys()]) if (m < start) this.pending.delete(m);  // minutes some member never had
    }
    let value = 0, dollars = 0;
    for (const [c, [px, vol]] of slot) { value += this.coef[c] * px; dollars += vol * px; }
    this.finishMinute(start, value, dollars);
  }
  finishMinute(start, close, volume = 0) {
    const open = this.lastClose !== null ? this.lastClose : close;
    let high = Math.max(open, close), low = Math.min(open, close);
    if (this.extremes.size) {
      if (this.extremes.has(start)) {  // live minutes also know the in-between highs and lows
        const [hi, lo] = this.extremes.get(start);
        this.extremes.delete(start);
        high = Math.max(high, hi); low = Math.min(low, lo);
      }
      for (const m of [...this.extremes.keys()]) if (m < start) this.extremes.delete(m);
    }
    this.lastMinute = start; this.lastClose = close;
    for (const [, tf] of this.tfList) tf.addMinute(start, open, high, low, close, volume);
    // the gate at this minute's close, from the bars closed by then: a higher-timeframe bar counts from the minute that
    // closes it (owner 28/10/2026: "candle close", as Rahul's RDX WIP Trend reads its timeframes)
    let state = null;
    if (this.ready) {
      const ev = this.evaluate(close);
      this.closedChecks = ev.checks;  // the four conditions as of this close (the live board shows these, owner 25/10)
      state = this.parts ? this.partsState(start) : ev.state;
      this.history.push([start, state]);
      if (this.history.length > KEEP.minutes + 500) this.history.splice(0, 500);
    }
    if (this.trace) {
      const b = {};
      for (const [m, tf] of this.tfList) b[m] = tf.bars[tf.bars.length - 1] || null;
      this.trace.push({ t: start, b, state });
      if (this.trace.length > KEEP.minutes + 500) this.trace.splice(0, 500);
    }
  }
  partsState(start) {  // the members' gates at the close of minute `start` (each has already closed it): all agree, or NO TRADE
    let state = null;
    for (const p of this.partList) {
      let s = 'NEUTRAL';  // live, a member can already be a minute or two further on
      for (let i = p.history.length - 1; i >= 0 && p.history[i][0] >= start; i--) if (p.history[i][0] === start) { s = p.history[i][1]; break; }
      state = state === null ? s : combine(state, s);
    }
    return state;
  }
  value(prices) {
    this.prices = prices;  // the members' live prices, for their own gates
    let v = 0;
    for (const c of this.coins) { if (!(prices[c] > 0)) return null; v += this.coef[c] * prices[c]; }
    return v;
  }
  sample(now, value) {
    const minute = now - now % MIN, [hi, lo] = this.extremes.get(minute) || [value, value];
    this.extremes.set(minute, [Math.max(hi, value), Math.min(lo, value)]);
    this.seenAtEnd.set(minute, value);
    for (const m of [...this.seenAtEnd.keys()]) if (m < minute - 600000) this.seenAtEnd.delete(m);
    if (this.parts && this.prices) for (const [c, p] of Object.entries(this.parts)) p.sample(now, this.prices[c]);
  }
  get ready() {  // enough closed bars everywhere for the MACD (26 + 9) and the EMA 47 to have started; once so, for good
    if (this.isReady) return true;  // (bars are only added, and trimmed far above these counts)
    return this.isReady = this.tfList.every(([, tf]) => tf.bars.length >= Math.max(tf.macd ? 35 : 0, tf.ema47 ? 47 : 0))
      && (!this.parts || this.partList.every(p => p.ready));
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
  evaluate(value, now) {  // the gate from the bars closed so far; live (now given), also the bars forming at `value`
    const f = {}, t = this.tfs, end = tf => tf.bars[tf.bars.length - 1];
    if (now != null) for (const [m, tf] of this.tfList) f[m] = tf.forming(value, now, k => this.seenAtEnd.get(k));
    const checks = gateChecks({ 5: end(t[5]), 9: end(t[9]), 11: end(t[11]) });
    const v = [checks['5m waves'], checks['9m waves'], checks['11m waves'], checks['5m EMA21 vs EMA47']];
    let state = v.every(x => x > 0) ? 'BULLISH' : v.every(x => x < 0) ? 'BEARISH' : 'NEUTRAL';
    if (this.parts && now != null && this.prices) {  // live: every member's own gate on its own price
      state = null;
      for (const [c, p] of Object.entries(this.parts)) {
        const s = this.prices[c] > 0 ? p.evaluate(this.prices[c], now).state : 'NEUTRAL';
        state = state === null ? s : combine(state, s);
      }
    }
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

const WORD = { BULLISH: 'LONG', BEARISH: 'SHORT', NEUTRAL: 'NO TRADE' };
const combine = (a, b) => a === b ? a : 'NEUTRAL';  // the combined gate of two series' states
function combinedStart(h1, h2, state, fallback) {  // when the combined gate's current run of `state` began
  let start = fallback, i = h1.length - 1, j = h2.length - 1;
  while (i >= 0 && j >= 0) {
    if (h1[i][0] > h2[j][0]) { i--; continue; }
    if (h2[j][0] > h1[i][0]) { j--; continue; }
    if (combine(h1[i][1], h2[j][1]) !== state) break;
    start = h1[i][0]; i--; j--;
  }
  return start;
}

// ---- RDX WIP's four entries (owner 28/10/2026: Rahul's RDX WIP Trend v1.1, all four on the board) --------------------
// On one market's minutes (TrendSignal.trace), each read at the minute's close:
//   E1  the 2m MACD(12,26) crosses its zero line the trend's way (at the close of its 2m bar)
//   E2  the same on the 1m MACD
//       One trade at a time each; a trade ends when its MACD is back through zero against it, or at a flat minute. A
//       cross while a trade is open, or on the minute one ends, is skipped. No entry on a flat minute.
//   E3  the 9m and 11m waves both up, the 5m EMA 21 above the 47, and the 5m EMA 8 crossing back above the 21 (the 5m
//       8/47 wave back over the 21/47); SHORT the mirror. Entries only: no exit was given.
//   E4  E3 on the 3m (its own EMA 21 vs 47 and 8 vs 21)
// trend(i): the trend E1/E2 need at trace minute i ('BULLISH' / 'BEARISH'; anything else: none). side(i, dir): what
// else E3/E4 need there (true on the Nasdaq pages; India and Commodities: step 1). isFlat(t): a minute with no entries
// that ends any E1/E2 trade (16:58 and 16:59 New York, or a market's last minute of the session).
// -> [{ e: 1-4, dir, k: minute, t: its close (ms), exit: true on an E1/E2 exit, of: the exit's entry }], in time order
const WIP = {  // each entry's colours on his indicator: BUY, SELL, exit
  1: { tf: 2, name: '2m MACD', buy: '#00C853', sell: '#FF1744', exit: '#B0BEC5' },
  2: { tf: 1, name: '1m MACD', buy: '#00E5FF', sell: '#FF9100', exit: '#80DEEA' },
  3: { tf: 5, name: '5m wave', buy: '#2979FF', sell: '#E040FB' },
  4: { tf: 3, name: '3m wave', buy: '#FFFFFF', sell: '#FF80AB' },
};
const nyFlat = t => { const m = (t - NsbCme.day0(t)) / MIN; return m === 1378 || m === 1379; };  // 16:58 and 16:59 New York (the CME day opens 18:00 New York)
function wipSignals(trace, { trend, side = () => true, isFlat = nyFlat }) {
  const out = [], cross = (x, prev) => !ok(x) || !ok(prev) ? null : x > 0 && prev <= 0 ? 'BULLISH' : x < 0 && prev >= 0 ? 'BEARISH' : null;
  for (const e of [1, 2]) {  // the MACD entries, one trade at a time each
    const tf = WIP[e].tf;
    let pos = null, prev = null;
    trace.forEach((x, i) => {
      const m = x.b[tf] ? x.b[tf].macd : null, fl = isFlat(x.t);
      let ended = false;
      if (pos && i > pos.i && ((ok(m) && m * (pos.dir === 'BULLISH' ? 1 : -1) < 0) || fl)) {
        out.push({ e, dir: pos.dir, k: x.t, t: x.t + MIN, exit: true, of: pos.sig });
        pos = null; ended = true;
      }
      const dir = cross(m, prev);
      if (dir && !pos && !ended && !fl && trend(i) === dir) {
        const sig = { e, dir, k: x.t, t: x.t + MIN };
        out.push(sig); pos = { dir, i, sig };
      }
      prev = m;
    });
  }
  for (const e of [3, 4]) {  // the waves' 8 back over their 21, with the 9m and 11m waves agreeing
    const tf = WIP[e].tf;
    let prev = null;
    trace.forEach((x, i) => {
      const b = x.b[tf], g = b && ok(b.ema8) && ok(b.ema21) ? b.ema8 - b.ema21 : null, dir = cross(g, prev);
      prev = g;
      if (!dir || isFlat(x.t) || !ok(b.ema47)) return;
      const up = dir === 'BULLISH', r9 = waveRow(x.b[9]), r11 = waveRow(x.b[11]);
      if ((up ? r9 === 1 && r11 === 1 && b.ema21 > b.ema47 : r9 === -1 && r11 === -1 && b.ema21 < b.ema47) && side(i, dir))
        out.push({ e, dir, k: x.t, t: x.t + MIN });
    });
  }
  return out.sort((a, b) => a.k - b.k || a.e - b.e);
}
const wipMarker = (s, time) => s.exit  // a chart marker for one of them (an exit: a small dot with ×, above the candle)
  ? { time, position: 'aboveBar', color: WIP[s.e].exit, shape: 'circle', size: 0.5, text: '×' }
  : s.dir === 'BULLISH' ? { time, position: 'belowBar', color: WIP[s.e].buy, shape: 'arrowUp', text: `E${s.e}` }
  : { time, position: 'aboveBar', color: WIP[s.e].sell, shape: 'arrowDown', text: `E${s.e}` };

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
  constructor(basket, { progress, selection, gate = 'both' } = {}) {
    this.gateOf = gate;  // 'stocks': the stocks' own gate; 'both': LONG/SHORT only when both series agree
    this.basket = basket;
    this.members = Object.keys(basket.members);  // every stock loaded and streamed, whether or not it is in the composite
    this.coins = [...this.members, BENCH];
    this.setActive(selection);
    this.refCloseMs = referenceCloseMs(basket.as_of);
    this.benchRef = null;
    this.boot = Math.floor(Date.now() / 1000);
    this.gen = 0; this.seq = 0; this.lastTick = null;
    this.handlers = { tick: [], status: [], alert: [] };
    this.waiters = [];
    this.progress = progress || (() => {});
    this.markets = Object.fromEntries(this.coins.map(c => [c, { closed: [], cur: null }]));
    this.trackers = { ndx10: new Tracker(3), nas100: new Tracker(3), gate: new Tracker(3) };  // they outlive rebuilds
    this.sections = null;
    this.building = true; this.buffer = []; this.gap = null; this.retryAt = 0;
    this.ws = null; this.connects = 0; this.lastHeard = 0; this.nextTick = 0;
    this.exMinute = 0; this.exSince = 0;  // the newest minute any market has traded in, and when we first saw it
    this.lastCandleAt = 0; this.lastUnstick = 0; this.nextRecheck = 0; this.rechecking = false;
  }

  // The stocks the composite is made of: a subset of the basket (its default list when `selection` is missing or empty).
  // Each counts equally (1/N), so the composite is 1000 at the reference close.
  setActive(selection) {
    const pick = Array.isArray(selection) ? this.members.filter(c => selection.includes(c)) : [];
    const fallback = (this.basket.default || this.members).filter(c => this.members.includes(c));
    this.active = pick.length ? pick : fallback;
    this.coef = Object.fromEntries(this.active.map(c =>
      [c, this.basket.base / this.active.length / this.basket.members[c].ref_price]));
  }
  // Switch the composite to another subset, with no new requests: every stock's candles are already loaded. The signal
  // is rebuilt from them at once (a new generation, so the page reloads its snapshot) and its alert tracker starts over,
  // so a change of stocks is never announced as a change of signal.
  setSelection(selection) {
    const before = this.active.join();
    this.setActive(selection);
    if (this.active.join() === before) return false;
    this.trackers.ndx10 = new Tracker(3);
    this.trackers.gate = new Tracker(3);
    if (!this.building) {
      this.rebuild();
      this.lastTick = null;  // a snapshot waits for a tick of the new composite
      this.nextTick = 0;
    }
    return true;
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
  snapshot() {  // with the stocks' own gate, only their section: the Stocks page reads neither NAS100 nor `price`, and each copy is half the size
    if (!this.lastTick) return { loading: true };
    const stocksOnly = this.gateOf === 'stocks';
    return JSON.parse(JSON.stringify({
      boot: this.boot, gen: this.gen, basket: this.basket, selection: this.active, bench: BENCH, price: stocksOnly ? undefined : this.priceBars, tick: this.lastTick,
      sections: Object.fromEntries(this.sections.filter(s => !stocksOnly || s.key === 'ndx10').map(s => [s.key, {
        bars: Object.fromEntries(Object.entries(s.signal.tfs).map(([m, tf]) => [m, tf.bars])),
        signal: s.signal.historyRuns(),
      }])),
    }));
  }

  async start() {
    try {  // the keys first, then the removals: once the count changes, the key order may too (WebKit rehashes), and a walk skips some
      const old = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(OLD_CACHE)) old.push(k); }
      for (const k of old) localStorage.removeItem(k);
    } catch (e) {}
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
    const cached = recovering ? null : Object.fromEntries(this.coins.map(c => [c, loadCache(c).filter(b => b.t >= oldest)]));
    const seed = recovering ? {} : await this.archiveSeed(cached, oldest, now);
    await Promise.all(this.coins.map(async coin => {
      const mk = this.markets[coin];
      let have = recovering ? mk.closed.slice() : cached[coin];  // a rebuild keeps older days added from the archive
      if (seed[coin]) {  // the archive's minutes win over the cache's (a cached minute can come from the live stream)
        const byT = new Map(have.map(b => [b.t, b]));
        for (const b of seed[coin]) if (b.t >= oldest) byT.set(b.t, b);
        have = [...byT.values()].sort((a, b) => a.t - b.t);
      }
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
  // The whole UTC days before today from the site's own archive (data/1m: one file per day for every market, saved by
  // the VPS and served by GitHub's CDN), so a first visit asks Hyperliquid only for today's minutes (owner 24/10/2026:
  // faster loading). Skipped when this browser's cache already holds the two days.
  async archiveSeed(cached, oldest, now) {
    const out = {};
    const need = this.coins.some(c => { const h = cached[c]; return !h.length || h[0].t > oldest + 60 * MIN || h[h.length - 1].t < now - (REFETCH + 60) * MIN; });
    if (!need) return out;
    try {
      const j = await (await fetch('data/1m/index.json', { cache: 'no-cache' })).json();
      const saved = new Set((Array.isArray(j) ? j : j.dates || []).map(String)), keys = [];
      for (let d = Math.floor(oldest / DAY) * DAY; d < Math.floor(now / DAY) * DAY; d += DAY) {
        const key = new Date(d).toISOString().slice(0, 10);
        if (saved.has(key)) keys.push(key);
      }
      const days = await Promise.all(keys.map(key => fetch(`data/1m/${key}.json`).then(r => r.ok ? r.json() : null).catch(() => null)));
      for (const day of days) if (day && day.coins) for (const c of this.coins) if (day.coins[c])
        (out[c] = out[c] || []).push(...day.coins[c].map(([t, o, h, l, cl, v, n]) => ({ t, o, h, l, c: cl, v, n })));
    } catch (e) { /* Hyperliquid alone, as before */ }
    return out;
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
    const ndx = new TrendSignal(this.coef, SHOWN), nas = new TrendSignal({ [BENCH]: 1 }, SHOWN);
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
      if (this.priceBars.length > KEEP.minutes + 500) this.priceBars.splice(0, 500);
      this.sections[1].signal.onMemberBar(coin, b.t, b.c, b.v);
    } else if (this.coef[coin] !== undefined) this.sections[0].signal.onMemberBar(coin, b.t, b.c, b.v);  // unticked stocks only keep loading
  }

  // Older days from our own archive (data/1m, written by the VPS): rows = { coin: [toBar objects] }. They go in front of
  // the candles already loaded, everything is rebuilt from them (a new generation: the page reloads its snapshot), and
  // the limits that trim old bars are raised so they stay. Hyperliquid itself keeps only ~3.5 days of 1-minute candles.
  extendBack(rows) {
    if (this.building) return false;
    let added = 0;
    for (const c of this.coins) {
      const mk = this.markets[c], first = mk.closed.length ? mk.closed[0].t : Infinity;
      const older = (rows[c] || []).filter(b => b.t < first);
      if (!older.length) continue;
      added += older.length;
      mk.closed = contiguous([...older, ...mk.closed].sort((a, b) => a.t - b.t));
    }
    if (!added) return false;
    const span = Math.max(...this.coins.map(c => this.markets[c].closed.length));
    KEEP.minutes = Math.max(KEEP.minutes, span + 1440); KEEP.bars = Math.max(KEEP.bars, span + 1440);
    this.rebuild();
    this.lastTick = null; this.nextTick = 0;  // a snapshot waits for a tick of the rebuilt signals
    return true;
  }
  firstMinute() { const a = this.markets[BENCH].closed; return a.length ? a[0].t : null; }  // the oldest candle loaded

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
  // A silent or stuck socket is dropped and replaced at once: on a dead connection the browser fires onclose only when
  // its closing handshake times out (about 60 s in Chrome). The new socket's onopen marks the gap, as any reconnect does.
  reconnect() {
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch (e) {} }
    this.connect();
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
      if (mk.closed.length > Math.max(HISTORY_MINUTES, KEEP.minutes) + 600) mk.closed.splice(0, 600);
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
      this.reconnect();  // silent: reconnect, which counts as a gap
      return;
    }
    if (open && now - this.lastCandleAt > STALL && now - this.lastUnstick > 5 * MIN) {
      this.lastUnstick = now;  // connected, yet nothing for 2 minutes: stuck. Reconnect and rebuild (at most every 5 min,
      this.reconnect();        // in case the market is only very quiet)
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
    const evs = {};
    this.sections.forEach((s, i) => {
      s.signal.sample(now, values[i]);
      const ev = evs[s.key] = s.signal.evaluate(values[i], now);
      // the gate and its conditions change only when a minute closes (owner 25/10/2026: "only at candle close"); the
      // price and the forming bars still move live
      const h = s.signal.history;
      ev.state = h.length ? h[h.length - 1][1] : 'NEUTRAL';
      if (s.signal.closedChecks) ev.checks = s.signal.closedChecks;
      const started = s.tracker.state === null ? s.signal.started(ev.state, now) : null;
      s.tracker.update(ev.state, now, started);
    });
    // the combined gate: LONG only when both series are, SHORT only when both are
    const stocksOnly = this.gateOf === 'stocks', gt = this.trackers.gate;
    const gate = stocksOnly ? evs.ndx10.state : combine(evs.ndx10.state, evs.nas100.state);
    const started = gt.state !== null ? null : stocksOnly ? this.sections[0].signal.started(gate, now)
      : combinedStart(this.sections[0].signal.history, this.sections[1].signal.history, gate, now);
    const change = gt.update(gate, now, started);
    const forming = this.markets[BENCH].cur;
    this.publish('tick', {
      time: now,
      gate: { state: gate, since: gt.since },
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
    if (change) {
      const body = this.sections.filter(s => !stocksOnly || s.key === 'ndx10').map(s => `${s.name} ${WORD[evs[s.key].state]}: `
        + Object.entries(evs[s.key].checks).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(3)}`).join('; ')).join('\n');
      this.publish('alert', { name: 'Gate', state: change, time: now, body });
    }
  }
}

window.NdxEngine = Engine;
// keep(n): bars and gate minutes each series keeps, at least n (Infinity: all). The replay pages run every loaded day
// through one TrendSignal, so they keep everything; the live board raises it as older days are added (extendBack).
const keep = n => { KEEP.minutes = Math.max(KEEP.minutes, n); KEEP.bars = Math.max(KEEP.bars, n); };
window.NdxEngine.internals = { keep, bucket, Ema, Macd, Timeframe, TrendSignal, Tracker, referenceCloseMs, combine,
                              SHOWN, contiguous, toBar, flat, candleRows, BENCH,  // for checking against Python
                              WIP, waveRow, wipSignals, wipMarker, nyFlat };
})();
