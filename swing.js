/* Indra Quant Signal Board: the Swing pane's lines and candles, shared by the pages that show it.

   The Swing pane (owner 31/10/2026 on the Perps tab; 1/11/2026: on every tab and every chart, crypto too): the Trend
   pane's waves, EMA 8 − EMA 47 and EMA 21 − EMA 47, on the 1-hour, 4-hour and daily candles; the weekly and monthly ones
   only on the Perps tab's stocks (owner 1/11: "keep the weekly thing monthly thing for stocks tab only"): PANES.swing.lines
   is the 1h/4h/1D set every pane draws, PANES.swing.all adds 1W and 1M (a pane's setLines, a spec's `wm`). 1W and 1M have
   a scale of their own in the pane (LINE[k].scale), so their size doesn't flatten the others.
   Since 2/11/2026 the lines switched on count for the gate and the shading (gate.js). Every candle carries its own close time (`end`), which macd.js
   reads, so a week or a month never shows before it has closed. The 30m waves (NsbSwing.M30, 4/11/2026) are drawn only on
   the MNQ page's right side, with its hours, days and weeks.
     NsbSwing.state(pt)               the pane's shading at one of its points
     NsbSwing.file(id)                data/swing/<id>.json, the VPS's nightly long candles (none: null)
     NsbSwing.hl(coin)                a Hyperliquid market's 1h and 1d candles straight from Hyperliquid
     NsbSwing.series(spec, minutes)   -> { 60, 240, 1440, 10080, 43200 (and 30): candles with their EMAs }
   and the builders the series is made with (build, periods, withEmas), for the pages and the tests. */
(() => {
'use strict';
if (window.NsbSwing) return;  // registered once, whichever page loads it
const { LINE, PANES, show } = NsbMacd;
const { Ema, candleRows, toBar } = NdxEngine.internals;
const DAY = 86400000, MIN = 60000, HOUR = 3600000;
const WM = true;  // the 1W and 1M lines (owner 1/11/2026: the Perps tab's stocks only): false takes all four off, on every page

// ---- the lines -------------------------------------------------------------------------------------------------
// key, candle minutes, label, its two colors: 1h in the 5m's, 4h in the 9m's, 1D in the 11m's (as on the Perps tab since
// 31/10); 1W and 1M in four pairs of their own, the furthest (CIELAB) from those six and light enough for the dark charts
const SWING = [['s1a', 60, '1h 8/47', 'w5a'], ['s1b', 60, '1h 21/47', 'w5b'], ['s4a', 240, '4h 8/47', 'w9a'], ['s4b', 240, '4h 21/47', 'w9b'],
               ['sDa', 1440, '1D 8/47', 'w11a'], ['sDb', 1440, '1D 21/47', 'w11b']].map(([k, tf, label, like]) => [k, tf, label, LINE[like].pair])
  .concat(WM ? [['sWa', 10080, '1W 8/47', ['#64FFDA', '#FF80AB']], ['sWb', 10080, '1W 21/47', ['#82B1FF', '#FFAB91']],     // teal / pink, blue / peach
                ['sMa', 43200, '1M 8/47', ['#FFF59D', '#EA80FC']], ['sMb', 43200, '1M 21/47', ['#A5D6A7', '#CE93D8']]] : []);  // yellow / orchid, sage / lilac
// the 30-minute waves (owner 4/11/2026, the MNQ page's right side: "we just need the long term values such as 30 min 1 hr 4hr
// daily and weekly"): only where a page asks for them (a spec's `m30`), not on the Swing pane; in the 15m waves' colors, which
// that side doesn't draw
const M30 = [['s30a', 30, '30m 8/47', 'w15a'], ['s30b', 30, '30m 21/47', 'w15b']].map(([k, tf, label, like]) => [k, tf, label, LINE[like].pair]);
{
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('nsb.macd.show')) || {}; } catch (e) {}
  for (const [k, tf, label, pair] of [...SWING, ...M30]) {
    const fast = label.endsWith('8/47');
    LINE[k] = { tf, label, v: fast ? b => b.ema8 - b.ema47 : b => b.ema21 - b.ema47, pair, ...(tf >= 10080 ? { scale: 'wm' } : {}),
                tip: `${label.split(' ')[0]} EMA ${fast ? 8 : 21} − EMA 47 (left color above 0, right color below): counts for the gate and the shading while switched on (once it has a value)` };
    if (typeof show[k] !== 'boolean') show[k] = typeof saved[k] === 'boolean' ? saved[k] : true;  // the switches kept with the other panes' ones
  }
  PANES.swing = { title: 'Swing', lines: SWING.filter(s => s[1] <= 1440).map(s => s[0]), all: SWING.map(s => s[0]) };
}
const ok = v => v !== null && v !== undefined && isFinite(v);
// green where every Swing line drawn and switched on that has a value is above 0, red where every one is below, none
// otherwise (1/11/2026: a line with no value yet, a month on a young market, no longer wipes the others' shading)
function state(pt) {
  if (!pt) return null;
  let up = 0, down = 0, n = 0;
  for (const m of PANES.swing.all) {
    const v = pt.v[m];
    if (!show[m] || !ok(v)) continue;
    n += 1;
    if (v > 0) up += 1; else if (v < 0) down += 1;
  }
  return !n ? null : up === n ? 'BULLISH' : down === n ? 'BEARISH' : null;
}

// ---- the candles: each market on its own grid ---------------------------------------------------------------------
// origin: where the market's day begins, in ms after 00:00 UTC (0 for Hyperliquid, NSE 03:45 UTC, MCX 03:30 UTC, GIFT
// 01:00 UTC), or 'cme': the CME open, 17:00 Chicago (cme.js). Hours and 4 hours count from it and stop at the day's end
// (NSE: 09:15, 10:15, ... 15:15; 4h 09:15 and 13:15), as on TradingView.
// day number <-> date, each made once (4/11/2026: the MNQ page's right side reads some 50 000 days a load, and making each
// date afresh was most of its weeks' time)
const isos = new Map(), nos = new Map();
const iso = n => { let k = isos.get(n); if (k === undefined) { k = new Date(n * DAY).toISOString().slice(0, 10); isos.set(n, k); } return k; };
const no = k => { let n = nos.get(k); if (n === undefined) { n = Math.round(Date.parse(k + 'T00:00:00Z') / DAY); nos.set(k, n); } return n; };
const day0Of = (t, o) => o === 'cme' ? NsbCme.day0(t) : t - ((t - o) % DAY + DAY) % DAY;
const dayEndOf = (t, o) => o === 'cme' ? NsbCme.dayEnd(t) : day0Of(t, o) + DAY;
const bucketStart = (t, m, o) => { const d0 = day0Of(t, o), s = m * MIN; return d0 + Math.floor((t - d0) / s) * s; };
const bucketEnd = (t, m, o) => Math.min(bucketStart(t, m, o) + m * MIN, dayEndOf(t, o));
const dayKeyOf = (t, o) => o === 'cme' ? NsbCme.key(t) : iso(Math.floor((t - o) / DAY));  // the trading day's date, in the market's own calendar
const dayOpen = (k, o) => o === 'cme' ? NsbCme.open(k) : no(k) * DAY + o;               // when trading day k begins
// rows { t (ms), o, h, l, c, v } oldest first (1-minute or hourly candles) -> m-minute candles on the market's grid:
// { time: its first row's t, end: its bucket's end (ms), open, high, low, close, volume }
function build(rows, m, origin) {
  const out = [];
  let at = null;
  for (const r of rows) {
    const s = bucketStart(r.t, m, origin), last = out[out.length - 1];
    if (!last || s !== at) { out.push({ time: r.t, end: bucketEnd(r.t, m, origin), open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v || 0 }); at = s; }
    else { last.high = Math.max(last.high, r.h); last.low = Math.min(last.low, r.l); last.close = r.c; last.volume += r.v || 0; }
  }
  return out;
}
// daily candles { key (their trading day 'YYYY-MM-DD'), time, open, high, low, close, volume } -> weekly ones (weeks begin
// on Monday) or calendar months, by the trading day's date; each ends where the next week's Monday or the next month's
// 1st begins in the market's day calendar
const mondayOf = k => { const n = no(k); return iso(n - (n + 3) % 7); };  // day 0, 1 Jan 1970, was a Thursday
const monthAfter = ym => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };
function periods(days, origin, monthly) {
  const out = [];
  let at = null;
  for (const d of days) {
    const p = monthly ? d.key.slice(0, 7) : mondayOf(d.key), last = out[out.length - 1];
    if (!last || p !== at) {
      out.push({ time: d.time, end: dayOpen(monthly ? monthAfter(p) : iso(no(p) + 7), origin), open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume || 0 });
      at = p;
    } else { last.high = Math.max(last.high, d.high); last.low = Math.min(last.low, d.low); last.close = d.close; last.volume += d.volume || 0; }
  }
  return out;
}
// EMA 8, 21 and 47 of the closes (the engine's EMA, seeded with the first close, as on the Perps tab), put on the
// candles from the 47th on, as the gate waits for 47 bars. seed: closes run through the EMAs before the candles' own
// (they count toward the 47)
// Also the MACD (12, 26) and its signal line (EMA 9 of it), from the 35th close on (the MNQ page's 30m and 1h MACD, owner 5/11/2026)
function withEmas(bars, seed = []) {
  const e8 = new Ema(8), e21 = new Ema(21), e47 = new Ema(47), e12 = new Ema(12), e26 = new Ema(26), e9 = new Ema(9);
  const macd = c => { const line = e12.update(c) - e26.update(c); return [line, e9.update(line)]; };
  for (const c of seed) { e8.update(c); e21.update(c); e47.update(c); macd(c); }
  bars.forEach((b, i) => {
    const x = [e8.update(b.close), e21.update(b.close), e47.update(b.close)], [line, signal] = macd(b.close);
    if (seed.length + i >= 46) Object.assign(b, { ema8: x[0], ema21: x[1], ema47: x[2] });
    if (seed.length + i >= 34) Object.assign(b, { macd: line, signal });
  });
  return bars;
}
// The 30-minute candles (a spec's m30; the files keep only hours and days): from the page's own minutes, their EMAs carried
// in from the hours before the first minute, each hour as two half-hours closing at its close (4/11/2026: on the 3 days the
// MNQ page loads, MNQ's 30m waves came out up to 22 points off a month of its minutes' own; carried in so, about 1)
function halfHours(hours, minutes, origin) {
  const first = minutes.length ? minutes[0].t : Infinity;
  return withEmas(build(minutes, 30, origin), hours.filter(r => r.t + HOUR <= first).flatMap(r => [r.c, r.c]));
}

// ---- where the candles come from -------------------------------------------------------------------------------
// The VPS's nightly file per market (data/swing/<id>.json: hourly and daily candles, t the candle's open in UTC seconds),
// read once per page load. Not there (404): null. Which markets have one: data/swing/index.json (read once; none there:
// no files), so a market without a file costs no request
let listing = null;
const listed = () => listing || (listing = fetch('data/swing/index.json', { cache: 'no-cache' })
  .then(r => r.ok ? r.json() : null).then(j => (j && j.ids) || {})
  .catch(() => { listing = null; return {}; }));  // unreachable just now: asked again at the next build
const has = async id => !!id && Object.prototype.hasOwnProperty.call(await listed(), id);
const files = new Map();
function file(id) {
  if (!files.has(id)) files.set(id, (async () => {
    const r = await fetch(`data/swing/${id}.json`, { cache: 'no-cache' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${id}: ${r.status}`);
    return r.json();
  })().catch(() => { files.delete(id); return null; }));  // unreachable just now: asked again at the next build
  return files.get(id);
}
// A Hyperliquid market that has no file: its 1-hour candles (Hyperliquid keeps the last 5000) and its daily ones,
// closed candles only, asked again once a new hour has begun (as the Perps tab did). Failing: the last ones.
const hlCache = new Map();
async function hl(coin) {
  const now = Date.now(), hour = Math.floor(now / HOUR), have = hlCache.get(coin);
  if (have && have.hour === hour) return have.data;
  const got = {};
  const data = Promise.all([[60, '1h', now - 4990 * HOUR], [1440, '1d', 0]].map(async ([m, iv, from]) => {
    got[m] = (await candleRows(coin, iv, from, now)).map(toBar).sort((a, b) => a.t - b.t).filter(r => r.t + m * MIN <= now);  // still forming: not yet
  })).then(() => ({ origin: 0, 60: got[60], 1440: got[1440] }));
  const entry = { hour, data };
  hlCache.set(coin, entry);
  try { return await data; } catch (e) {
    if (hlCache.get(coin) === entry) { if (have) hlCache.set(coin, have); else hlCache.delete(coin); }  // tried again at the next build
    return have ? have.data : null;
  }
}
// The Nasdaq tab's composite from its members' files, the way the engine makes its close: Σ coef · close, at the times
// where every member has a candle (open: the close before, as the engine's composite)
const comps = new Map();
function composite(members) {
  const key = JSON.stringify(members);
  if (!comps.has(key)) comps.set(key, (async () => {
    const ids = Object.keys(members);
    if (!ids.length || !(await Promise.all(ids.map(has))).every(Boolean)) { comps.delete(key); return null; }  // a member without its file: none (asked again next build)
    const fs = await Promise.all(ids.map(file));
    if (fs.some(f => !f)) { comps.delete(key); return null; }
    const out = { origin: 0 };
    for (const m of ['60', '1440']) {
      const by = fs.map(f => new Map((f[m] || []).map(r => [r[0], r[4]])));  // t (s) -> close
      let prev = null;
      out[m] = [...by[0].keys()].filter(t => by.every(x => x.has(t))).sort((a, b) => a - b).map(t => {
        const c = ids.reduce((s, id, i) => s + members[id] * by[i].get(t), 0), o = prev === null ? c : prev;
        prev = c;
        return { t: t * 1000, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 0 };
      });
    }
    return out;
  })());
  return comps.get(key);
}
// A composite's days before its own first one (its youngest member's listing), for its weeks and months (a spec's `unders`:
// { member id: its real stock's daily file }; 4/11/2026, the MNQ page's right baskets: a weekly EMA 47 wants 47 weeks, and
// the default basket's SPCX has had 24). Each member's daily closes: its real stock's up to the day before its perp's own
// first daily candle, then the perp's, the last one carried over a day it has none (a weekend, or before it was listed
// anywhere); the basket moves day to day as Σ coef · close of the members there on both days, scaled at the end to meet its
// own first day's close. first: that day { key, close }
const befores = new Map();
function composedBefore(members, unders, first, origin) {
  const key = JSON.stringify([members, unders, first.key, first.close]);
  if (!befores.has(key)) befores.set(key, (async () => {
    const ids = Object.keys(members), fs = await Promise.all(ids.map(file));
    if (fs.some(f => !f)) return [];
    const us = await Promise.all(ids.map(async id => unders[id] && await has(unders[id]) ? file(unders[id]) : null));
    const closes = ids.map((id, i) => {
      const fo = typeof fs[i].origin === 'number' ? fs[i].origin : 0, tc = r => Array.isArray(r) ? [r[0] * 1000, +r[4]] : [r.t, r.c];
      const own = (fs[i]['1440'] || []).map(r => { const [t, c] = tc(r); return [dayKeyOf(t, fo), c]; }), m = new Map(), u = us[i];
      const uo = u && (u.origin === 'cme' || typeof u.origin === 'number') ? u.origin : 0;
      if (u && own.length) for (const r of u['1440'] || []) { const [t, c] = tc(r), k = dayKeyOf(t, uo); if (k < own[0][0]) m.set(k, c); }
      for (const [k, c] of own) m.set(k, c);
      return m;
    });
    const keys = [...new Set(closes.flatMap(m => [...m.keys()]))].filter(k => k <= first.key).sort();
    const last = ids.map(() => undefined), chain = [];
    let level = null;
    for (const k of keys) {
      const now = closes.map((m, i) => m.has(k) ? m.get(k) : last[i]);
      if (level === null) level = ids.reduce((s, id, i) => s + (now[i] === undefined ? 0 : members[id] * now[i]), 0);
      else {
        let a = 0, b = 0;
        ids.forEach((id, i) => { if (last[i] !== undefined) { a += members[id] * now[i]; b += members[id] * last[i]; } });
        if (b > 0) level *= a / b;
      }
      now.forEach((c, i) => { last[i] = c; });
      chain.push([k, level]);
    }
    const end = chain[chain.length - 1];
    if (!end || end[0] !== first.key || !(end[1] > 0)) return [];
    const scale = first.close / end[1];
    return chain.slice(0, -1).map(([k, v]) => { const c = v * scale; return { key: k, time: dayOpen(k, origin), open: c, high: c, low: c, close: c, volume: 0 }; });
  })().catch(() => { befores.delete(key); return []; }));
  return befores.get(key);
}
const rowsOf = a => (a || []).map(r => Array.isArray(r) ? { t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] || 0 } : r);
// a futures history moved onto the contract traded now, as the page's own candles are (rolls.js): adjusted together
// with the page's newest minute, so rolls.js still knows the candles have reached a switch (marks, the live day)
const adjusted = (sym, rows, minutes) => {
  if (!window.NsbRolls || !rows.length) return rows;
  const tail = minutes.length ? [minutes[minutes.length - 1]] : [];
  return NsbRolls.adjust(sym, rows.concat(tail)).slice(0, rows.length);
};

// One market's Swing candles: { 60, 240, 1440, 10080, 43200 } (the last two only with WM), each with its EMAs.
//   spec: { id: its file (data/swing/<id>.json), hl: a Hyperliquid coin (from Hyperliquid when it has no file),
//           origin: its grid when it has neither, roll: a futures symbol (rolls.js), under: its underlying's daily file
//           for 1W and 1M (us_<TICKER>, us_NDX), members: { id: coef } for the composite, unders: { member id: its real
//           stock's daily file } for a composite's 1W and 1M (composedBefore), m30: the 30m candles too (halfHours) }
//   minutes: the page's own 1-minute candles { t (ms), o, h, l, c, v }, closed minutes only, oldest first
// The history (the file, Hyperliquid, or the composite of its members' files), then candles built from the page's
// minutes for every hour and day after the history's last one, so today's hour, day, week and month are current (the
// newest of each still forming: on the newest candle only, as macd.js puts it). 4h from the hours, 1W and 1M from the days.
async function series(spec, minutes = []) {
  // a composite's real stocks' files (its weeks before its members' listings) asked for at once, beside its members' own
  if (WM && spec.wm && spec.unders) for (const u of new Set(Object.values(spec.unders))) has(u).then(y => { if (y) file(u); });
  let h = null;
  if (spec.members) h = await composite(spec.members);
  else {
    if (await has(spec.id)) h = await file(spec.id);
    if (!h && spec.hl) { try { h = await hl(spec.hl); } catch (e) { h = null; } }  // a Hyperliquid market not in the files
  }
  const origin = h && h.origin !== undefined && h.origin !== null ? h.origin : spec.origin !== undefined ? spec.origin : 0;
  let h60 = rowsOf(h && h['60']), h1440 = rowsOf(h && h['1440']);
  // futures: the file's candles (back-adjusted to the contract of 15/10, or raw for MCX) moved by the switches since
  if (spec.roll) { h60 = adjusted(spec.roll, h60, minutes); h1440 = adjusted(spec.roll, h1440, minutes); }
  const after = (rows, m) => { const last = rows.length ? bucketStart(rows[rows.length - 1].t, m, origin) : -Infinity;
                               return minutes.filter(r => bucketStart(r.t, m, origin) > last); };
  const b60 = build(h60, 60, origin).concat(build(after(h60, 60), 60, origin));
  const b1440 = build(h1440, 1440, origin).concat(build(after(h1440, 1440), 1440, origin));
  const b240 = build(b60.map(b => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })), 240, origin);
  const out = { 60: withEmas(b60), 240: withEmas(b240), 1440: withEmas(b1440) };
  if (spec.m30) out[30] = halfHours(h60, minutes, origin);
  if (!WM || !spec.wm) return out;  // weeks and months only where they're drawn (the Perps tab's stocks, the MNQ page's right side)
  let days = b1440.map(b => ({ key: dayKeyOf(b.time, origin), time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  // The stock perps and XYZ100 (listed on Hyperliquid in Oct 2025 - May 2026: too few weeks and months for an EMA 47):
  // the weeks and months take the real stock's (or the Nasdaq-100's) daily candles up to the day before the perp's own
  // first daily candle, then the perp's own. Split-adjusted closes; the two series meet at that day as they are (no
  // scaling: the perp tracks the stock's price). The 1D line stays on the perp's own days.
  if (spec.under && days.length && await has(spec.under)) {
    const u = await file(spec.under), uo = u && (u.origin === 'cme' || typeof u.origin === 'number') ? u.origin : 0;
    if (u) days = rowsOf(u['1440']).map(r => ({ key: dayKeyOf(r.t, uo), time: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }))
      .filter(d => d.key < days[0].key).concat(days);
  } else if (spec.members && spec.unders && days.length) days = (await composedBefore(spec.members, spec.unders, days[0], origin)).concat(days);
  out[10080] = withEmas(periods(days, origin, false));
  out[43200] = withEmas(periods(days, origin, true));
  return out;
}

window.NsbSwing = { WM, LINES: PANES.swing.lines, ALL: PANES.swing.all, M30: M30.map(s => s[0]), state, file, hl, series, build, periods, withEmas, dayKeyOf, bucketStart, bucketEnd };
})();
