/* Indra Quant Signal Board: the MACD panes under a price chart, and the day separators, shared by both pages.

   Two panes (owner 28/10/2026, Rahul's RDX WIP): Entry (the 1m and 2m MACD 12/26: entries E2 and E1; the 3m MACD since 29/10, shown only) above Trend (the
   5m, 9m and 11m waves, EMA 8 - EMA 47 and EMA 21 - EMA 47 on each: the gate's waves, and the 15m waves since 3/11/2026;
   until 28/10 the 5m to 15m MACD with signal lines). Every line is drawn on the price chart's own candles, at its value as of each candle's close
   (never ahead of it; the forming candle live), so a pane lines up bar for bar with the chart above it and scrolls with
   it. Any line can be switched off from its pane's label; the choice is kept in this browser and shared by every page.
   A page can pass shade(i), the state at candle i, to shade the panes by the gate (green LONG, red SHORT); without it
   a pane is shaded where the 10 stocks' lines and the index's lines agree on every line switched on in it. */
(() => {
'use strict';
const DAY = 86400000;
// origin: where each day's bars start, in ms after 00:00 UTC (a market's session open; 0 for the 24/7 perps), or 'cme':
// the CME open, 17:00 Chicago (cme.js)
const bucketEnd = (t, m, origin = 0) => {
  const cme = origin === 'cme', d0 = cme ? NsbCme.day0(t) : t - ((t - origin) % DAY + DAY) % DAY, s = m * 60000;
  return Math.min(d0 + Math.floor((t - d0) / s) * s + s, cme ? NsbCme.dayEnd(t) : d0 + DAY);
};
const ok = v => v !== null && v !== undefined && isFinite(v);
const sgn = (v, d) => ok(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) : '—';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PANES = {
  entry: { title: 'Entry', lines: ['m1', 'm2', 'm3'] },
  trend: { title: 'Trend', lines: ['w5a', 'w5b', 'w7a', 'w7b', 'w9a', 'w9b', 'w11a', 'w11b', 'w15a', 'w15b'] },  // 15m: owner 3/11/2026; 7m: 5/11/2026
};
// one pane with both, the 1m to 15m lines (the MNQ page's three panes, owner 3/11/2026: "all 3 will have same macds with
// values from 1 to 15 min")
PANES.all = { title: 'Lines', lines: [...PANES.entry.lines, ...PANES.trend.lines] };
// Every line drawn: the timeframe it is read on, its label, its value from that timeframe's bar, and two colors of its
// own, one while it is above 0 and one while below, so its color changes where it crosses zero. The MACDs keep the
// board's colors; the waves take Rahul's "Wave lines" colors.
const LINE = {
  m1: { tf: 1, label: '1m', v: b => b.macd, pair: ['#facc15', '#8b5cf6'], tip: '1m MACD (12, 26): shown only, the gate doesn\'t use it' },   // yellow / violet
  m2: { tf: 2, label: '2m', v: b => b.macd, pair: ['#22c55e', '#fb7185'], early: true, tip: '2m MACD (12, 26): shown only, the gate doesn\'t use it. Solid: its closed 2-minute candles; dotted: every minute, as if its candle closed then' },   // green / rose (owner 5/11/2026: "green above 0, red below")
  m3: { tf: 3, label: '3m', v: b => b.macd, pair: ['#38bdf8', '#fb923c'], early: true, tip: '3m MACD (12, 26): shown only, the gate doesn\'t use it. Solid: its closed 3-minute candles; dotted: every minute, as if its candle closed then' },   // sky / orange (owner 29/10)
  // the MNQ page's other MACDs (owner 5/11/2026: "short term chart will have 1 2 3 5 7m macd on all three", "long term chart will
  // have 9 11 15 30m 1H macd on all three"), shown only; the right side's five in the left's five colors, in the same order. The
  // 30m and 1h from the long candles (swing.js)
  m5: { tf: 5, label: '5m', v: b => b.macd, pair: ['#2dd4bf', '#f472b6'], tip: '5m MACD (12, 26): shown only, the gate doesn\'t use it' },   // teal / pink
  m7: { tf: 7, label: '7m', v: b => b.macd, pair: ['#a3e635', '#c084fc'], tip: '7m MACD (12, 26): shown only, the gate doesn\'t use it' },   // lime / purple
  m9: { tf: 9, label: '9m', v: b => b.macd, pair: ['#facc15', '#8b5cf6'], tip: '9m MACD (12, 26): shown only, the gate doesn\'t use it' },
  m11: { tf: 11, label: '11m', v: b => b.macd, pair: ['#22c55e', '#fb7185'], tip: '11m MACD (12, 26): shown only, the gate doesn\'t use it' },
  m15: { tf: 15, label: '15m', v: b => b.macd, pair: ['#38bdf8', '#fb923c'], tip: '15m MACD (12, 26): shown only, the gate doesn\'t use it' },
  m30: { tf: 30, label: '30m', v: b => b.macd, pair: ['#2dd4bf', '#f472b6'], tip: '30m MACD (12, 26): shown only, the gate doesn\'t use it' },
  m60: { tf: 60, label: '1h', v: b => b.macd, pair: ['#a3e635', '#c084fc'], tip: '1h MACD (12, 26): shown only, the gate doesn\'t use it' },
  // (the entries E1-E4 that read the 1m and 2m MACD came off the board: owner 2/11/2026)
  w5a: { tf: 5, label: '5m 8/47', v: b => b.ema8 - b.ema47, pair: ['#00E676', '#FF5252'] },
  w5b: { tf: 5, label: '5m 21/47', v: b => b.ema21 - b.ema47, pair: ['#00B8D4', '#FF9100'] },
  // the 7m waves (owner 5/11/2026: "add 7 min timeframe ... in the trend pane"; they count for the gate too)
  w7a: { tf: 7, label: '7m 8/47', v: b => b.ema8 - b.ema47, pair: ['#1DE9B6', '#FF4081'] },   // aqua / pink
  w7b: { tf: 7, label: '7m 21/47', v: b => b.ema21 - b.ema47, pair: ['#B388FF', '#FFAB40'] },  // lavender / amber
  w9a: { tf: 9, label: '9m 8/47', v: b => b.ema8 - b.ema47, pair: ['#2979FF', '#FFEA00'] },
  w9b: { tf: 9, label: '9m 21/47', v: b => b.ema21 - b.ema47, pair: ['#FFFFFF', '#D500F9'] },
  w11a: { tf: 11, label: '11m 8/47', v: b => b.ema8 - b.ema47, pair: ['#76FF03', '#F50057'] },
  w11b: { tf: 11, label: '11m 21/47', v: b => b.ema21 - b.ema47, pair: ['#B0BEC5', '#8D6E63'] },
  // the 15m waves (owner 3/11/2026: "add 15 min timeframe as well on the trend thing"; they count for the gate too)
  w15a: { tf: 15, label: '15m 8/47', v: b => b.ema8 - b.ema47, pair: ['#40C4FF', '#FF6E40'] },
  w15b: { tf: 15, label: '15m 21/47', v: b => b.ema21 - b.ema47, pair: ['#EA80FC', '#FFE57F'] },
};
for (const l of PANES.trend.lines)
  LINE[l].tip = `${LINE[l].label.replace(' ', ' EMA ').replace('/', ' − EMA ')} (left color above 0, right color below): counts for the gate and the shading while switched on`;
// every MACD's signal line (EMA 9 of the MACD): drawn only where a pane asks for them (MacdPane opts.signals: the MNQ page, owner
// 5/11/2026: "a separate switch for each timeframe's signal line"), shown only, each switched on and off by itself (SIG)
const MACDS = Object.keys(LINE).filter(l => /^m\d+$/.test(l));
for (const l of MACDS) LINE[l].sig = b => b.signal;
const SIG = l => 'sig.' + l;
const LINES = [...new Set(Object.values(LINE).map(l => l.tf))];  // the candle sizes the engine must provide
const shades = lines => Object.fromEntries(lines.map(l => [l, LINE[l].pair]));
const faded = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;
const MATCH = { BULLISH: 'rgba(43, 182, 138, 0.13)', BEARISH: 'rgba(240, 85, 95, 0.12)' };

// ---- which lines are on ------------------------------------------------------------------------------
const KEY = 'nsb.macd.show';
const show = Object.fromEntries([...Object.keys(LINE).map(l => [l, true]), ...MACDS.map(l => [SIG(l), true]), ['early', true]]);
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && typeof saved === 'object') for (const k in show) if (typeof saved[k] === 'boolean') show[k] = saved[k];
} catch (e) {}
const listeners = [];
let showVer = 0;  // bumped by every switch: trendState keeps its answer per point and per version
function toggle(k) {
  show[k] = !show[k];
  showVer += 1;
  // saved over what is stored, not instead of it (31/10/2026: a page saved only the lines it knows, so a switch on any
  // other tab turned the Perps tab's Swing lines back on)
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  try { localStorage.setItem(KEY, JSON.stringify({ ...(saved && typeof saved === 'object' ? saved : {}), ...show })); } catch (e) {}
  for (const fn of listeners) fn(k);
}
// another window of the board switched a line: switch it here too (31/10/2026: the installed app and a Chrome tab each
// kept their own copy, and the last one to switch overwrote the other's choices)
window.addEventListener('storage', e => {
  if (e.key !== KEY) return;
  let saved = null;
  try { saved = JSON.parse(e.newValue); } catch (x) {}
  if (!saved || typeof saved !== 'object') return;
  let changed = false;
  for (const k in show) if (typeof saved[k] === 'boolean' && saved[k] !== show[k]) { show[k] = saved[k]; changed = true; }
  if (!changed) return;
  showVer += 1;
  for (const fn of listeners) try { fn(null); } catch (x) { /* a page still loading has nothing drawn yet: its first draw reads show */ }
});

// ---- each line at every candle's close ------------------------------------------------------------------
// bars: the price chart's candles (ms times), tf their size, src: { minutes: closed bars with their indicators } ->
// one point per candle: v (and sg, a line's signal line, if it has one) by line
// A src bar that carries its own `end` (ms) closes then (1/11/2026: the Swing pane's weeks and months, which the one-day
// cap of bucketEnd would show from the end of their first day); the others close at bucketEnd, as before
const barEnd = (b, m, origin) => typeof b.end === 'number' ? b.end : bucketEnd(b.time, m, origin);
// A line with `early` (the 2m and 3m MACD, owner 4/11/2026: "update the macd every 1 min instead of waiting for candle close")
// also gets ev: at each candle's close, the value its own candle would have if it closed then - the EMA 12 and 26 of its last
// closed candle moved on by the series' last closed minute (as the engine's forming bar: never ahead of that minute). Once its
// candle has closed, ev is the line's value; nothing else reads it.
const EMA12 = 2 / 13, EMA26 = 2 / 27;
function points(bars, tf, src, lines, origin = 0) {
  const early = lines.filter(l => LINE[l].early);
  const out = [], tfs = [...new Set([...lines.map(l => LINE[l].tf), ...(early.length ? [1] : [])])], k = Object.fromEntries(tfs.map(m => [m, -1]));
  for (let i = 0; i < bars.length; i++) {
    const end = bucketEnd(bars[i].time, tf, origin), v = {}, sg = {}, at = {};
    for (const m of tfs) {
      const a = src[m] || [];
      while (k[m] + 1 < a.length && barEnd(a[k[m] + 1], m, origin) <= end) k[m]++;
      const j = i === bars.length - 1 ? a.length - 1 : k[m];
      at[m] = j >= 0 ? a[j] : null;
    }
    for (const l of lines) {
      const b = at[LINE[l].tf], x = b ? LINE[l].v(b) : null;
      if (ok(x)) { v[l] = x; if (LINE[l].sig) sg[l] = LINE[l].sig(b); }
    }
    const ev = {}, one = at[1];  // the series' last closed minute
    for (const l of early) {
      const m = LINE[l].tf, b = at[m];
      if (!b || !one || !ok(one.close)) continue;
      if (barEnd(b, m, origin) >= barEnd(one, 1, origin)) { if (ok(v[l])) ev[l] = v[l]; continue; }  // its candle closed with that minute
      if (!ok(b.f12) || !ok(b.s26)) continue;
      const c = one.close;
      ev[l] = (b.f12 + EMA12 * (c - b.f12)) - (b.s26 + EMA26 * (c - b.s26));
    }
    out.push({ time: Math.floor(bars[i].time / 1000), v, sg, ev });
  }
  return out;
}
function matchAt(a, b, lines) {  // the stocks' and the index's points at one candle -> 'BULLISH', 'BEARISH' or null
  const on = lines.filter(m => show[m]);
  if (!a || !b || !on.length || a.time !== b.time) return null;
  let up = 0, down = 0;
  for (const m of on) {
    const x = a.v[m], y = b.v[m];
    if (!ok(x) || !ok(y)) return null;
    if (x > 0 && y > 0) up += 1; else if (x < 0 && y < 0) down += 1; else return null;
  }
  return up === on.length ? 'BULLISH' : down === on.length ? 'BEARISH' : null;
}

// The colour at one candle (owner 24/10/2026): from the Trend waves switched on, green where every one of them is above
// 0, red where every one is below, none otherwise or with all of them off. With the 5m, 9m and 11m ones on (the 7m and 15m
// ones off: 15m since 3/11/2026, 7m since 5/11/2026) that is the RDX WIP trend itself (owner 28/10/2026: the 5m, 9m and 11m waves all up, which has the
// 5m EMA 21 above the 47). The price chart and
// both panes use it, on every page; the gate itself is shown in words.
function trendState(pt) {
  if (!pt) return null;
  if (pt.stVer === showVer) return pt.st;  // worked out once per point (28/10/2026: the shading asked again on every frame)
  pt.stVer = showVer;
  const on = PANES.trend.lines.filter(m => show[m]);
  if (!on.length) return pt.st = null;
  let up = 0, down = 0;
  for (const m of on) { const v = pt.v[m]; if (!ok(v)) return pt.st = null; if (v > 0) up += 1; else if (v < 0) down += 1; }
  return pt.st = up === on.length ? 'BULLISH' : down === on.length ? 'BEARISH' : null;
}

// ---- the price chart's 5m EMA 8 / 21 / 47, and the gate's conditions (owner 28/10/2026, Rahul's RDX WIP Trend) ---------
// All three EMAs in one color, by their stack: green the 21 above the 47 with the 8 above the 21, red the mirror; yellow
// a shallow pullback (the 8 between the 21 and the 47) or no stack; orange a deeper one (the 8 beyond the 47)
const STACK = { up: '#00C853', down: '#FF1744', mixed: '#FFD600', deep: '#FF6D00' };
function stackColor(b) {
  const s = b.ema21 > b.ema47 ? 1 : b.ema21 < b.ema47 ? -1 : 0;
  if (!s) return STACK.mixed;
  if ((b.ema8 - b.ema21) * s > 0) return s > 0 ? STACK.up : STACK.down;
  return (b.ema8 - b.ema47) * s > 0 ? STACK.mixed : STACK.deep;
}
// bars: the price chart's candles (ms), tf their size, src: { minutes: closed bars } -> the 5m EMAs as of each candle's
// close (never ahead of it): [{ time (s), e8, e21, e47, color }]
function emaPoints(bars, tf, src, origin = 0) {
  const a = (src[5] || []).filter(b => ok(b.ema47)), out = [];
  let k = -1;
  for (let i = 0; i < bars.length; i++) {
    const end = bucketEnd(bars[i].time, tf, origin);
    while (k + 1 < a.length && bucketEnd(a[k + 1].time, 5, origin) <= end) k++;
    if (k >= 0) out.push({ time: Math.floor(bars[i].time / 1000), e8: a[k].ema8, e21: a[k].ema21, e47: a[k].ema47, color: stackColor(a[k]) });
  }
  return out;
}
const emaTag = (e, fmt) => `<span class="t-ema"><span class="sw" style="background:${e.color}"></span>5m EMA 8 <b>${fmt(e.e8)}</b> 21 <b>${fmt(e.e21)}</b> 47 <b>${fmt(e.e47)}</b></span>`;
// the gate's conditions as chips: ▲ above 0, ▼ below, ◆ a timeframe's waves mixed (one up, one down)
const chips = (rules, ch) => rules.map(([key, name]) => { const v = ch[key];
  return v > 0 ? `<span class="up">${name} ▲</span>` : v < 0 ? `<span class="down">${name} ▼</span>` : `<span class="mixed">${name} ◆</span>`; }).join('');

// ---- series primitives ----------------------------------------------------------------------------------
class Bands {  // colored bands behind a chart's series, one per run of candles: state(i) -> color or null
  constructor(chart, count, state) {
    this.chart = chart; this.count = count; this.state = state; this.bands = [];
    this.views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: t => this.render(t) }) }];
  }
  attached({ requestUpdate }) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = null; }
  paneViews() { return this.views; }
  update() { if (this.requestUpdate) this.requestUpdate(); }
  updateAllViews() {  // the candles on screen only (28/10/2026: every candle of the strip on every frame lagged)
    const n = this.count(), ts = this.chart().timeScale(), bands = [];
    const x0 = n ? ts.logicalToCoordinate(0) : null, x1 = n ? ts.logicalToCoordinate(1) : null, r = n ? ts.getVisibleLogicalRange() : null;
    if (x0 !== null && x1 !== null && r) {
      const step = x1 - x0, lo = Math.max(0, Math.floor(r.from) - 1), hi = Math.min(n - 1, Math.ceil(r.to) + 1);
      let i = lo, s = lo <= hi ? this.state(lo) : null;
      for (let j = lo + 1; j <= hi + 1; j++) {  // runs of one state: [first, last] candle
        const t = j <= hi ? this.state(j) : undefined;
        if (t === s) continue;
        if (s) bands.push([x0 + (i - 0.5) * step, x0 + (j - 0.5) * step, s]);
        i = j; s = t;
      }
    }
    this.bands = bands;
  }
  render(target) {
    target.useBitmapCoordinateSpace(({ context: c, bitmapSize: size, horizontalPixelRatio: hr }) => {
      for (const [l, r, color] of this.bands) {
        const a = Math.max(0, Math.round(l * hr)), b = Math.min(size.width, Math.round(r * hr));
        if (b > a) { c.fillStyle = color; c.fillRect(a, 0, b - a, size.height); }
      }
    });
  }
}

class DayLines {  // a dashed line where a new day begins, with its date along the top
  // labelTop: where the date goes (px from the top), null for no date. origin: the market's session open (ms after
  // 00:00 UTC): its day begins there (owner 24/10/2026: a market's new day starts at its open, not at midnight);
  // 'cme': at the CME open, 17:00 Chicago, dated by its trading day (owner 24/10/2026: every US chart, the stock
  // perps too); 0 or none: at midnight in the viewer's timezone; a function: t -> its day's number (days since 1 Jan 1970,
  // dated by it; the Perps tab's US hours, 5/11/2026: each session)
  constructor(chart, bars, labelTop, origin) {
    this.chart = chart; this.bars = bars; this.top = labelTop; this.origin = origin || 0; this.lines = [];
    this.views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: t => this.render(t) }) }];
  }
  attached({ requestUpdate }) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = null; }
  paneViews() { return this.views; }
  updateAllViews() {
    const bars = this.bars(), ts = this.chart().timeScale(), out = [];
    const x0 = bars.length > 1 ? ts.logicalToCoordinate(0) : null, x1 = bars.length > 1 ? ts.logicalToCoordinate(1) : null, r = ts.getVisibleLogicalRange();
    if (x0 !== null && x1 !== null && r) {
      const step = x1 - x0, o = this.origin, cme = o === 'cme' || typeof o === 'function';
      const day = typeof o === 'function' ? o : cme ? NsbCme.dayNo : o ? t => Math.floor((t - o) / 86400000) : t => { const d = new Date(t); return d.getFullYear() * 512 + d.getMonth() * 32 + d.getDate(); };
      const lo = Math.min(bars.length - 1, Math.max(0, Math.floor(r.from) - 1)), hi = Math.min(bars.length - 1, Math.ceil(r.to) + 1);  // the candles on screen
      let prev = day(bars[lo].time);
      for (let i = lo + 1; i <= hi; i++) {
        const k = day(bars[i].time);
        if (k === prev) continue;
        prev = k;
        // the date: a CME day's trading date; a market with its own open, the date of that open in UTC (= the local
        // date where it trades, NSE's 09:15 IST is 03:45 UTC), whatever the viewer's timezone; otherwise the viewer's date
        const d = new Date(cme ? k * 86400000 : o ? k * 86400000 + o : bars[i].time), u = cme || o ? 'getUTC' : 'get';
        out.push([x0 + (i - 0.5) * step, `${WEEKDAY[d[u + 'Day']()]} ${d[u + 'Date']()} ${MON[d[u + 'Month']()]}`]);
      }
    }
    this.lines = out;
  }
  render(target) {
    target.useBitmapCoordinateSpace(({ context: c, bitmapSize: size, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      c.save();
      // dashed, but brighter, thicker and with longer dashes than before (owner 24/10/2026)
      c.strokeStyle = 'rgba(214, 224, 238, 0.6)'; c.lineWidth = Math.max(2, Math.round(1.5 * hr));
      c.setLineDash([Math.round(7 * vr), Math.round(5 * vr)]);
      for (const [x] of this.lines) {
        const px = Math.round(x * hr) + 0.5;
        if (px < 0 || px > size.width) continue;
        c.beginPath(); c.moveTo(px, 0); c.lineTo(px, size.height); c.stroke();
      }
      c.setLineDash([]);
      if (this.top !== null) {
        c.font = `700 ${Math.round(11.5 * vr)}px "IBM Plex Sans", "Segoe UI", sans-serif`; c.textBaseline = 'top';
        for (const [x, text] of this.lines) {
          const px = Math.round(x * hr), w = c.measureText(text).width, pad = Math.round(5 * hr), y = Math.round(this.top * vr);
          if (px < 0 || px + 3 * hr + w + 2 * pad > size.width) continue;
          // the date as plain bright text beside the line, no box (owner 24/10/2026); a dark halo keeps it readable over candles
          c.lineWidth = Math.max(3, Math.round(3 * hr)); c.strokeStyle = 'rgba(10, 13, 18, 0.9)'; c.setLineDash([]);
          c.strokeText(text, px + Math.round(3 * hr) + pad, y + Math.round(3 * vr));
          c.fillStyle = '#e8eef6'; c.fillText(text, px + Math.round(3 * hr) + pad, y + Math.round(3 * vr));
        }
      }
      c.restore();
    });
  }
}

// ---- one MACD pane ----------------------------------------------------------------------------------------
// opts: el and tagEl (the pane and its label), kind ('trend', 'entry', 'swing' or 'all'), title (the label's first word, if
// not the kind's), lines (the lines drawn, if not the kind's), colors ({ line: [above 0, below 0] }), widths ({ line: px }), scales ({ line: price
// scale id }: lines drawn on a scale of their own in this pane), name, digits,
// options (chart options), bars() and tf() (the price chart's candles and their size), src() ({ minutes: MACD bars }
// of the series drawn), and for the shading either match() -> [stocks' points, index's points] or stocks() (the
// stocks' MACD bars; the series drawn is then the index)
class MacdPane {
  constructor(opts) {
    Object.assign(this, opts);
    // the lines drawn: the pane's own set, or a page's choice of them (setLines; 1/11/2026: the Swing pane's 1W and 1M on
    // the Perps tab's stocks only, PANES.swing.all)
    this.lines = this.lines || PANES[this.kind].lines;
    this.pts = []; this.stockPts = []; this.store = new Map();
    const fine = { type: 'price', precision: this.digits, minMove: 10 ** -this.digits };
    const chart = this.chart = LightweightCharts.createChart(this.el, this.options);
    chart.applyOptions({ crosshair: { horzLine: { visible: false, labelVisible: false } } });  // no horizontal hover line in the panes, only the vertical one (owner 24/10)
    // A line with a scale of its own (LINE[m].scale: the Swing pane's 1W and 1M, whose size flattened the others, 1/11/2026)
    // is drawn on that scale; while one is drawn every scale keeps 0 in the middle, so the zero line stays every line's
    const scaleOf = m => (this.scales && this.scales[m]) || LINE[m].scale;
    const sym = orig => {
      const r = orig();
      if (!this.split || !r || !r.priceRange) return r;
      const a = Math.max(Math.abs(r.priceRange.minValue), Math.abs(r.priceRange.maxValue)) || 1;
      return { ...r, priceRange: { minValue: -a, maxValue: a } };
    };
    const line = (color, extra) => chart.addLineSeries({ color, lineWidth: 2, priceFormat: fine, priceLineVisible: false,
                                                         crosshairMarkerVisible: false, autoscaleInfoProvider: sym, ...extra });
    // the zero line as a series of its own (0 at every candle): always shown whichever lines are off, and it carries
    // the shading and day lines, which a hidden series would take with it
    this.zero = line('#6b778a', { lineWidth: 1, lastValueVisible: false });
    this.series = {};
    // each line's two colors (a page's own for some lines: opts.colors, 4/11/2026: the MNQ page's 1h waves beside the 5m ones)
    this.shade2 = { ...shades([...new Set([...(PANES[this.kind].all || PANES[this.kind].lines), ...this.lines])]), ...(this.colors || {}) };
    this.addLine = m => {
      if (scaleOf(m)) chart.priceScale(scaleOf(m)).applyOptions({ scaleMargins: { top: 0.2, bottom: 0.06 } });
      return line(this.shade2[m][0], { lineWidth: (this.widths && this.widths[m]) || (m === 'm1' ? 1 : 2), ...(scaleOf(m) ? { priceScaleId: scaleOf(m) } : {}) });
    };
    for (const m of this.lines) this.series[m] = this.addLine(m);
    this.scaleOf = scaleOf;
    this.split = this.lines.some(scaleOf);
    // each MACD's signal line where the page asks for them (opts.signals, the MNQ page since 5/11/2026; none elsewhere since
    // 28/10/2026): dashed, in the line's first color, on its scale, with a switch of its own in the label
    this.sigs = {};
    this.addSig = m => line(faded(this.shade2[m][0], 0.8), { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, lastValueVisible: false,
                                                            ...(scaleOf(m) ? { priceScaleId: scaleOf(m) } : {}) });
    if (this.signals) for (const m of this.lines) if (LINE[m].sig) this.sigs[m] = this.addSig(m);
    // the 2m and 3m MACD's early line (owner 4/11/2026): dotted, in the line's colors, on its scale; as thick as the line and nearly as
    // bright since 4/11 (owner: "the dotted line is not clearly visible")
    const EARLY_ALPHA = 0.9;
    this.earlys = {};
    this.addEarly = m => line(faded(this.shade2[m][0], EARLY_ALPHA), { lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dotted, lastValueVisible: false,
                                                              ...(scaleOf(m) ? { priceScaleId: scaleOf(m) } : {}) });
    this.earlyAlpha = EARLY_ALPHA;
    for (const m of this.lines) if (LINE[m].early) this.earlys[m] = this.addEarly(m);
    this.zero.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0.06 } });
    this.shading = new Bands(() => chart, () => this.pts.length, i => {
      if (this.shade) return MATCH[this.shade(i)] || null;  // the page's state at candle i (the Trend waves switched on)
      const [a, b] = this.pair();
      return MATCH[matchAt(a[i], b[i], this.lines)] || null;
    });
    this.zero.attachPrimitive(this.shading);
    this.zero.attachPrimitive(new DayLines(() => chart, this.bars, null, this.days !== undefined ? this.days : this.origin));  // days: where the day lines go, if not at origin
    this.tagEl.addEventListener('pointerdown', e => {  // the label's names are switches
      const b = e.target.closest('[data-k]');
      if (b) { e.preventDefault(); e.stopPropagation(); toggle(b.dataset.k); }
    });
    this.showLines();
  }
  pair() { return this.match ? this.match() : [this.stockPts, this.pts]; }
  setLines(list) {  // another choice of the pane's lines (a market with or without some): drawn whole at the next update()
    if (list.join() === this.lines.join()) return;
    for (const m of list) if (!this.shade2[m]) this.shade2[m] = LINE[m].pair;  // (lines new to the pane: their own colors)
    for (const m of list) if (!this.series[m]) this.series[m] = this.addLine(m);
    for (const m of list) if (LINE[m].early && !this.earlys[m]) this.earlys[m] = this.addEarly(m);
    for (const m in this.earlys) if (!list.includes(m)) this.earlys[m].setData([]);
    if (this.signals) for (const m of list) if (LINE[m].sig && !this.sigs[m]) this.sigs[m] = this.addSig(m);
    for (const m in this.sigs) if (!list.includes(m)) this.sigs[m].setData([]);
    for (const m in this.series) if (!list.includes(m)) { this.series[m].setData([]); this.series[m].applyOptions({ visible: false }); }
    this.lines = list; this.split = list.some(this.scaleOf);
    this.pts = []; this.store.clear(); this.lastQ = null; this.html = null;
    this.showLines();
  }
  setScales() {  // the lines on the price scales of this.scales again (the MNQ page's Waves and MACD tabs, 5/11/2026: a tab's lines on
    // the pane's own scale, its labels theirs); the next update() draws them
    const id = m => this.scaleOf(m) || 'right';
    for (const set of [this.series, this.sigs, this.earlys]) for (const m in set) set[m].applyOptions({ priceScaleId: id(m) });
    for (const sc of new Set(Object.keys(this.series).map(id))) if (sc !== 'right') this.chart.priceScale(sc).applyOptions({ scaleMargins: { top: 0.2, bottom: 0.06 } });
    this.split = this.lines.some(this.scaleOf);
  }
  showLines() {
    for (const m of this.lines) this.series[m].applyOptions({ visible: show[m] });
    for (const m in this.sigs) this.sigs[m].applyOptions({ visible: this.lines.includes(m) && show[m] && show[SIG(m)] });  // a hidden line takes its signal with it
    for (const m in this.earlys) this.earlys[m].applyOptions({ visible: this.lines.includes(m) && show[m] && show.early });  // and its early line
    this.shading.update();
  }
  // Redraw from the latest bars, or only move the newest points when that's all that changed. True when it redrew
  // everything (the caller then lines the pane up with the price chart again).
  update() {
    if (this.stocks) this.stockPts = points(this.bars(), this.tf(), this.stocks(), this.lines, this.origin || 0);
    const pts = points(this.bars(), this.tf(), this.src(), this.lines, this.origin || 0), old = this.pts, n = pts.length, k = old.length;
    const same = (a, b) => a.time === b.time && this.lines.every(m => a.v[m] === b.v[m] && a.sg[m] === b.sg[m] && a.ev[m] === b.ev[m]);
    let i = 0;
    while (i < n && i < k && same(pts[i], old[i])) i++;
    this.shading.update();
    if (i === n && n === k) return false;
    this.pts = pts;
    const pt = (p, value) => value === undefined ? { time: p.time } : { time: p.time, value };  // blank, but the candle keeps its slot
    const wave = (p, m) => { const v = p.v[m]; return v === undefined ? { time: p.time } : { time: p.time, value: v, color: this.shade2[m][v >= 0 ? 0 : 1] }; };
    const put = p => { if (this.lines.some(m => p.v[m] !== undefined)) this.store.set(p.time, p); };
    const early = (p, m) => { const v = p.ev[m]; return v === undefined ? { time: p.time } : { time: p.time, value: v, color: faded(this.shade2[m][v >= 0 ? 0 : 1], this.earlyAlpha) }; };
    const earlys = Object.keys(this.earlys).filter(m => this.lines.includes(m));
    if (k && n >= k && n <= k + 1 && i >= k - 1 && pts[k - 1].time === old[k - 1].time) {
      for (let j = k - 1; j < n; j++) {
        const p = pts[j];
        for (const m of this.lines) this.series[m].update(wave(p, m));
        for (const m in this.sigs) this.sigs[m].update(pt(p, p.sg[m]));
        for (const m of earlys) this.earlys[m].update(early(p, m));
        this.zero.update({ time: p.time, value: 0 });
        put(p);
      }
      return false;
    }
    for (const m of this.lines) this.series[m].setData(pts.map(p => wave(p, m)));
    for (const m in this.sigs) this.sigs[m].setData(pts.map(p => pt(p, p.sg[m])));
    for (const m of earlys) this.earlys[m].setData(pts.map(p => early(p, m)));
    this.zero.setData(pts.map(p => ({ time: p.time, value: 0 })));
    this.store.clear();
    pts.forEach(put);
    return true;
  }
  sync(range) { if (range) this.chart.timeScale().setVisibleLogicalRange(range); }
  value(q) {  // where the crosshair goes on this pane for point q: the longest line switched on
    for (const m of [...this.lines].reverse()) if (show[m] && ok(q.v[m])) return q.v[m];
    return 0;
  }
  tag(t) {  // the label: the pane's name, then one switch per line (its value while hovering)
    // (a candle no longer drawn, after a new candle size under a held crosshair: the values last shown, so the switches still repaint)
    const q = (t === undefined ? this.pts[this.pts.length - 1] : this.store.get(t)) || this.lastQ;
    if (!q) return;
    this.lastQ = q;
    const v = q.v, d = this.digits;
    const item = m => {
      const pass = v[m] > 0;  // the dot: above or below zero, as the gate tests
      const tip = `${LINE[m].tip}. Click to ${show[m] ? 'hide' : 'show'}`;
      return `<span class="t-mm${show[m] ? '' : ' off'}" data-k="${m}" title="${tip}"><span class="sw" style="background:linear-gradient(90deg, ${this.shade2[m][0]} 50%, ${this.shade2[m][1]} 50%)"></span><b>${LINE[m].label}</b>`
        + `<span class="t-dot ${ok(v[m]) ? (pass ? 'pass' : 'fail') : ''}"></span>`
        + `<span class="t-v">${this.sigs[m] ? `${sgn(v[m], d)} / ${sgn(q.sg[m], d)}` : sgn(v[m], d)}${this.earlys[m] && show.early && ok(q.ev[m]) && q.ev[m] !== v[m] ? ` ~${sgn(q.ev[m], d)}` : ''}</span></span>`;
    };
    // a MACD's signal line: its own switch, right after the line's (owner 5/11/2026)
    const sigItem = m => !this.sigs[m] ? '' : `<span class="t-mm${show[SIG(m)] ? '' : ' off'}" data-k="${SIG(m)}" title="The ${LINE[m].label} MACD's signal line (the EMA 9 of it, dashed): shown only. Click to ${show[SIG(m)] ? 'hide' : 'show'} it">`
      + `<span class="sw dash" style="border-top-color:${this.shade2[m][0]}"></span><span class="t-of">sig</span></span>`;
    const html = `<span class="t-name"><b>${this.title || PANES[this.kind].title}</b></span>` + this.lines.map(m => item(m) + sigItem(m)).join('')  // no market name (owner 24/10/2026)
      + (this.lines.some(m => this.earlys[m]) ? `<span class="t-mm${show.early ? '' : ' off'}" data-k="early" title="The 2m and 3m MACD's dotted lines: every minute, the value their candle would have if it closed then (it can change until it closes; the solid lines are the closed candles'). Click to ${show.early ? 'hide' : 'show'} them">`
                  + `<span class="sw dot"></span><span class="t-of">early</span></span>` : '');
    // written only when it changed (31/10/2026: the live prices wrote the same label again every second or so, rebuilding
    // the chip under the pointer)
    if (html !== this.html) this.tagEl.innerHTML = this.html = html;
  }
}

// the panes' labels look the same on both pages (the page styles .tag itself: its place and background)
const css = document.createElement('style');
css.textContent = `
  /* tighter since 1/11/2026 (owner: "the space is very jumbled up"): a pane's six switches stay on one row on two or three
     charts side by side, their values too */
  .tag.mix { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 2px; white-space: normal; max-width: calc(100% - 80px);
             padding: 2px 4px; font: 10.5px var(--font-ui); }
  .tag.mix .t-name { color: var(--muted); padding: 0 3px 0 1px; white-space: nowrap; position: relative; pointer-events: auto;
                     user-select: none; -webkit-user-select: none; }
  /* the name and the switches take the pointer across the gaps between them too (31/10/2026: through a gap the chart under the
     label took the pointer, its values changed and the next switch moved); the rest of the label still passes it to the chart */
  .tag.mix .t-name::before, .tag.mix .t-mm::before { content: ''; position: absolute; top: -2px; bottom: -2px; left: -3px; right: -3px; }
  .tag.mix .t-name b { color: var(--text); font-weight: 600; }
  .tag.mix .t-mm { position: relative; display: inline-flex; align-items: center; gap: 3px; padding: 1px 4px; border-radius: 5px; white-space: nowrap;
                   box-shadow: inset 0 0 0 1px var(--line-strong); pointer-events: auto; cursor: pointer;
                   user-select: none; -webkit-user-select: none; touch-action: manipulation; }
  .tag.mix .t-mm:hover { background: rgba(255, 255, 255, .06); }
  .tag.mix .t-mm b { color: var(--text); font: 600 10.5px var(--font-num); letter-spacing: -.01em; }
  .tag.mix .t-mm .sw { width: 9px; height: 3px; border-radius: 2px; display: inline-block; }
  .tag.mix .t-mm .sw.dash { background: none !important; border-top: 2px dashed var(--muted); height: 0; }
  .tag.mix .t-mm .sw.dot { background: none !important; border-top: 2px dotted var(--muted); height: 0; }
  .tag.mix .t-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); display: inline-block; }
  .tag.mix .t-dot.pass { background: var(--up); } .tag.mix .t-dot.fail { background: var(--down); }
  .tag.mix .t-v { display: none; font-family: var(--font-num); color: var(--text); }
  .hovering .tag.mix .t-v { display: inline; }
  .tag.mix .t-of { color: var(--muted); }
  .tag.mix .t-mm.off { opacity: .45; box-shadow: inset 0 0 0 1px var(--line); }
  .tag.mix .t-mm.off .sw { background: transparent !important; box-shadow: inset 0 0 0 1px var(--faint); }
  .tag.mix .t-mm.off .t-v, .tag.mix .t-mm.off .t-dot { visibility: hidden; }  /* kept in place: switching a line off moves no chip (31/10/2026) */
  .conds .mixed { color: #FFD600; }
  /* the A button (autoButton): in the price chart's bottom-right corner, under its price scale, as on TradingView */
  .nsb-auto { position: absolute; right: 6px; bottom: 3px; z-index: 6; min-width: 22px; height: 20px; padding: 0 5px;
              border: 1px solid var(--line-strong); border-radius: 5px; background: var(--bg); color: var(--muted);
              font: 600 11px/18px var(--font-num); cursor: pointer; touch-action: manipulation; }
  .nsb-auto:hover { color: var(--text); border-color: var(--muted); }
`;
document.head.appendChild(css);

// How long until the newest candle closes, just under its price on the price scale, as on TradingView (owner
// 25/10/2026). last(): { close, end (when the candle closes, ms), up } of the newest candle; nothing shows once it has
// closed (a market that is shut).
const counters = new Set();
setInterval(() => { for (const c of counters) if (c.requestUpdate) c.requestUpdate(); }, 1000);
class Countdown {
  constructor(series, last) { this.series = series; this.last = last; this.views = []; }
  attached({ requestUpdate }) { this.requestUpdate = requestUpdate; counters.add(this); }
  detached() { this.requestUpdate = null; counters.delete(this); }
  paneViews() { return []; }
  priceAxisViews() { return this.views; }
  updateAllViews() {
    const k = this.last(), now = Date.now();
    this.views = [];
    if (!k || !(k.end > now)) return;
    const y = this.series.priceToCoordinate(k.close);
    if (y === null) return;
    const s = Math.ceil((k.end - now) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), two = v => String(v).padStart(2, '0');
    const text = h ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`, bg = k.up ? '#2bb68a' : '#f0555f';
    // its fixed place too (4/11/2026): without one the chart took it as the scale's top, and with both labels in the top
    // half it pushed the price's own label up there, away from its line
    this.views = [{ coordinate: () => y + 17, fixedCoordinate: () => y + 17, text: () => text, textColor: () => '#ffffff', backColor: () => bg, visible: () => true, tickVisible: () => false }];
  }
}

// the lines' values in the pane labels (body.hovering, above), shown while a mouse's crosshair is up: switched a moment
// later, and never while the pointer is on a label's switches (31/10/2026: a crosshair coming up just before the pointer
// reached a switch widened every chip, so the click hit the one beside it). They come up once the mouse slows down (a
// mouse on its way across a chart to a switch leaves them off), and after a finger's tap on a switch they stay as they
// are until its next press off the labels (a touch laptop: the tapped chip keeps :hover only for a while)
let valuesOn = false, valuesTimer = 0, stillX = 0, stillY = 0, stillAt = 0, tapOnChip = false;
document.addEventListener('mousemove', e => {  // where and when the mouse last moved more than 12 px
  if (Math.hypot(e.clientX - stillX, e.clientY - stillY) > 12) { stillX = e.clientX; stillY = e.clientY; stillAt = performance.now(); }
}, { capture: true, passive: true });
document.addEventListener('pointerdown', e => { tapOnChip = e.pointerType !== 'mouse' && !!(e.target.closest && e.target.closest('.tag.mix')); }, true);
document.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') tapOnChip = false; }, { capture: true, passive: true });  // the mouse again
function showValues(on) {
  valuesOn = on;
  if (document.body.classList.contains('hovering') === on) { clearTimeout(valuesTimer); valuesTimer = 0; }
  else if (!valuesTimer) valuesTimer = setTimeout(applyValues, 120);
}
function applyValues() {
  const wait = tapOnChip || document.querySelector('.tag.mix:hover') ? 150  // once it leaves them
    : valuesOn ? 120 - (performance.now() - stillAt) : 0;
  if (wait > 0) { valuesTimer = setTimeout(applyValues, Math.max(wait, 20)); return; }
  valuesTimer = 0;
  document.body.classList.toggle('hovering', valuesOn);
}

// The A button (owner 4/11/2026: "an auto size thing ... similar to TradingView ... it says A"), in a price chart's
// bottom-right corner under its price scale: the page's reset() puts its charts back as they opened, their prices fitted
// top to bottom again (a dragged price scale too). While it runs, roomy() keeps a day that has only just begun from
// stretching its few candles across the chart: about 7 px a candle, the newest some two thirds across with room on its
// right and the day before filling the left (owner 5/11/2026, from a picture: "still zoomed in too much")
let fitting = false;
function autoButton(el, reset) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'nsb-auto'; b.textContent = 'A';
  b.title = 'Fit the chart: back as it opened, its prices top to bottom';
  b.addEventListener('dblclick', e => e.stopPropagation());
  b.addEventListener('click', e => { e.stopPropagation(); fitting = true; try { reset(); } finally { fitting = false; } });
  el.appendChild(b);
  return b;
}
const roomy = (r, chart, live) => {  // r: the range a page's fit shows (to: 3 past the newest candle); live: the picked day is today
  if (!fitting || !live) return r;
  const slots = chart.timeScale().width() / 7;
  if (r.to - r.from >= slots) return r;
  const to = r.to - 3 + slots * 0.35;
  return { from: to - slots, to };
};
window.NsbMacd = { autoButton, roomy, PANES, LINES, LINE, STACK, stackColor, emaPoints, emaTag, chips, MacdPane, DayLines, Bands, Countdown, show, toggle, onToggle: fn => listeners.push(fn), points, matchAt, trendState, showValues };
})();
