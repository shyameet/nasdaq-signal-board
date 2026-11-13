/* Indra Quant Signal Board: the India tab's option signals (owner 10/11/2026), two parts:

   NsbSub: 15-second candles -> the 30-second MACD (12, 26) line, the exit of a 1m entry. Dhan has no history below one
     minute, so these start with Board Live's 15 s candles (C:\RDX\tools\board_live\PROTOCOL_OPTIONS.md, from 11/11/2026):
     saved days from data/india/15s/<day>.json (the VPS's nightly file: { day, <SYM>: { t0: first candle's open (UTC s),
     c: [the close of every 15 s from t0 on, null where none traded] } }), today from the stream ("s15" once after each
     snapshot, then "b15" as each candle closes). 30 s = the two 15 s candles t, t + 15 s with t % 30 s == 0 (the
     protocol's rule): its close is the later one's (the earlier one's when the later had no trade).
       await NsbSub.load(keys)       the saved days (IST day keys) a strip needs
       NsbSub.bars(sym)              its closed 30 s bars { time, end (ms), close, macd (from the 35th bar on) }, oldest first
       NsbSub.has(sym, key)          true when day `key` has any 15 s candle of sym
       NsbSub.live(names)            ask the stream for these names' 15 s candles (again after every reconnect)
       NsbSub.on(fn)                 fn(sym) when a 15 s candle of sym closed (live)

   NsbOpt: the option candles and the floating option window ("design M", owner 5/11/2026: drag, enlarge, close).
     Saved days: data/india/options/<ROOT>/<day>.json (C:\RDX\tools\india_options_1m\india_options_1m.py, from the hub's own
     NIFTY / BANKNIFTY option bars; the stocks' from Board Live's records once they exist): the nearest series that day,
     every strike near the money, 1-minute candles, and its strikes' closes at the end of the day before ("prev").
     Today: Board Live ("chain" for the names, then "osub" for the strikes the window needs; "form" / "bar" keep them live).
     The window shows the ROLLING ATM (the strike nearest the underlying at each minute, owner 5/11/2026) of the trend's
     side: the call while the chart's trend is LONG, the put while SHORT (NO TRADE: the last side). Where the strike (or
     the series, after an expiry) changes, the candles before move by the gap between the two at that moment, so the
     line carries on (as rolls.js at a contract switch), and a small mark shows the new strike. While an entry's trade is
     open, "Our trade" sits beside it: the strike bought at the entry (the ATM then), locked, with its entry price and the
     gain or loss since. */
(() => {
'use strict';
if (window.NsbOpt) return;
const MIN = 60000, DAY = 86400000, IST = 19800000, S15 = 15000, S30 = 30000;
const { Macd, TrendSignal, SHOWN } = NdxEngine.internals;
const ok = v => v !== null && v !== undefined && isFinite(v);
const sec = ms => Math.floor(ms / 1000);
const two = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const istKey = t => new Date(t + IST).toISOString().slice(0, 10);  // a minute's IST date (NSE: its trading day)
const getJson = async url => { const r = await fetch(url, { cache: 'no-cache' }); if (r.status === 404) return null; if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };
const FIRST_SUB = '2026-11-11';  // Board Live's first day of 15 s candles and stock options (PROTOCOL_OPTIONS.md)

// ---- NsbSub: 15 s candles, 30 s MACD -----------------------------------------------------------------------------
const Sub = (() => {
  let index = null;
  const files = new Map();     // key -> Promise of { SYM: [[t ms, close], ...] } (none: {})
  const closes = {};           // SYM -> Map(t ms -> close): every 15 s candle known (saved days and live)
  const days = {};             // SYM -> Set of IST day keys with a candle
  const cache = {};            // SYM -> { ver, bars }
  const vers = {};             // SYM -> bumped by every new candle
  const subs = [];
  let asked = [];
  const add = (s, t, c) => {
    if (!ok(t) || !ok(c)) return;
    (closes[s] || (closes[s] = new Map())).set(t, c);
    (days[s] || (days[s] = new Set())).add(istKey(t));
    vers[s] = (vers[s] || 0) + 1;
  };
  const listed = () => index || (index = getJson('data/india/15s/index.json').then(j => new Set((j && j.dates) || []))
    .catch(() => { index = null; return new Set(); }));
  function file(key) {
    if (!files.has(key)) files.set(key, (async () => {
      if (!(await listed()).has(key)) return {};
      const j = await getJson(`data/india/15s/${key}.json`);
      if (j) for (const [s, v] of Object.entries(j)) {
        if (!v || !Array.isArray(v.c)) continue;
        v.c.forEach((c, i) => { if (c !== null) add(s, (v.t0 + 15 * i) * 1000, c); });
      }
      return j || {};
    })().catch(() => { files.delete(key); return {}; }));
    return files.get(key);
  }
  async function load(keys) { await Promise.all(keys.map(file)); }
  // its closed 30 s bars: a 30 s bar is closed once its later 15 s candle is in, a later candle is, or 34 s have passed
  function bars(s) {
    const m = closes[s];
    if (!m) return [];
    const have = cache[s];
    if (have && have.ver === vers[s] && have.until > Date.now()) return have.bars;
    const ts = [...m.keys()].sort((a, b) => a - b), out = [], macd = new Macd();
    let n = 0;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i], b0 = t - t % S30;
      const last = out[out.length - 1];
      if (last && last.time === b0) { last.close = m.get(t); last.half = 2; continue; }
      out.push({ time: b0, end: b0 + S30, close: m.get(t), half: t === b0 ? 1 : 2 });
    }
    const newest = ts.length ? ts[ts.length - 1] : 0;
    if (out.length) { const b = out[out.length - 1]; if (b.half === 1 && newest === b.time && Date.now() < b.end + 4000) out.pop(); }  // still forming
    for (const b of out) { const [line] = macd.update(b.close); n += 1; if (n >= 35) b.macd = line; delete b.half; }
    cache[s] = { ver: vers[s], bars: out, until: out.length && newest === out[out.length - 1].time ? out[out.length - 1].end + 4000 : Infinity };
    return out;
  }
  const has = (s, key) => !!(days[s] && days[s].has(key));
  // the stream: after each snapshot (every connect), ask once more; its candles from the day before's session start
  function live(names) {
    asked = names.slice();
    if (window.NsbLive && NsbLive.send && asked.length) {
      const start = Date.parse(istKey(Date.now()) + 'T06:00:00Z') - IST;  // today's session start, 06:00 IST
      NsbLive.send({ s15: asked, since: start - DAY });
    }
  }
  if (window.NsbLive && NsbLive.onMsg) {
    NsbLive.on(kind => { if (kind === 'snapshot' && asked.length) live(asked); });
    NsbLive.onMsg(m => {
      if (m.type === 's15' && m.ok !== false && m.candles) {
        for (const [s, rows] of Object.entries(m.candles)) for (const r of rows || []) add(s, +r[0], +r[4]);
        for (const s of Object.keys(m.candles)) for (const fn of subs) fn(s);
      } else if (m.type === 'b15' && m.s) {
        add(m.s, +m.t, +m.c);
        for (const fn of subs) fn(m.s);
      }
    });
  }
  return { load, bars, has, live, on: fn => subs.push(fn), first: FIRST_SUB };
})();

// ---- NsbOpt: option candles ------------------------------------------------------------------------------------
const Data = (() => {
  let index = null;
  const files = new Map();  // root|key -> Promise of a parsed day, or null
  const listed = () => index || (index = getJson('data/india/options/index.json').then(j => j || {}).catch(() => { index = null; return {}; }));
  const toMap = rows => new Map(rows.map(([m, o, h, l, c]) => [m, { o, h, l, c }]));
  function parse(j) {  // -> { key, expiry, series, t0 (ms), strikes [...], CE: Map(strike -> Map(t ms -> bar)), PE, prev }
    const day = { key: j.day, expiry: j.expiry, series: j.series, t0: j.t0 * 1000, CE: new Map(), PE: new Map(), prev: null, live: false };
    for (const side of ['CE', 'PE']) for (const [k, rows] of Object.entries(j[side] || {})) {
      const m = new Map();
      for (const [i, o, h, l, c] of rows) m.set(j.t0 * 1000 + i * MIN, { o, h, l, c });
      day[side].set(+k, m);
    }
    day.strikes = [...new Set([...day.CE.keys(), ...day.PE.keys()])].sort((a, b) => a - b);
    if (j.prev) day.prev = { t: j.prev.t * 1000, CE: new Map(Object.entries(j.prev.CE || {}).map(([k, v]) => [+k, v])),
                             PE: new Map(Object.entries(j.prev.PE || {}).map(([k, v]) => [+k, v])) };
    return day;
  }
  function file(root, key) {
    const id = root + '|' + key;
    if (!files.has(id)) files.set(id, (async () => {
      const ix = await listed();
      if (!(ix[root] || []).includes(key)) return null;
      const j = await getJson(`data/india/options/${root}/${key}.json`);
      return j ? parse(j) : null;
    })().catch(() => { files.delete(id); return null; }));
    return files.get(id);
  }
  return { file, listed };
})();

// today's options from Board Live: the chain's names by strike, and the candles of the names asked for ("osub")
const Live = (() => {
  const chains = {};    // root -> { expiry, rows: Map(strike -> { CE: name, PE: name }), at }
  const wanted = {};    // root -> Set of names asked for
  const sent = new Set(), chained = new Set();  // asked since the last snapshot (a chain with "none" comes by itself later)
  const subs = [];
  let ver = 0;
  const tell = (root, kind) => { ver += 1; for (const fn of subs) fn(root, kind); };  // kind: 'tick' (a forming minute moved), 'bar', 'chain', 'osub'
  function chain(root) {
    if (!window.NsbLive || !NsbLive.send) return;
    if (!wanted[root]) wanted[root] = new Set();
    if (chained.has(root)) return;
    if (NsbLive.send({ chain: root })) chained.add(root);
  }
  function want(root, names) {  // at most 50 a client (the stream's limit): the newest asks win
    const fresh = names.filter(n => n && !sent.has(n));
    if (!fresh.length || !window.NsbLive) return;
    if (!wanted[root]) wanted[root] = new Set();
    for (const n of fresh) { sent.add(n); wanted[root].add(n); }
    if (sent.size > 50) { const drop = [...sent].slice(0, sent.size - 50); for (const n of drop) sent.delete(n); NsbLive.send({ ounsub: drop }); }
    NsbLive.send({ osub: fresh });
  }
  if (window.NsbLive && NsbLive.onMsg) {
    NsbLive.on((kind, s) => {
      if (kind === 'snapshot') {  // a new connection: every ask again
        sent.clear(); chained.clear();
        for (const root of Object.keys(wanted)) { chain(root); const names = [...wanted[root]]; if (names.length) { NsbLive.send({ osub: names }); for (const n of names) sent.add(n); } }
      }
      else if ((kind === 'bar' || kind === 'tick') && s && s.startsWith('NFO:')) { const root = s.slice(4).split('-')[0]; if (chains[root]) tell(root, kind); }
    });
    NsbLive.onMsg(m => {
      if (m.type === 'chain' && m.u && m.ok !== false && Array.isArray(m.rows)) {
        const rows = new Map(m.rows.map(([k, ce, pe]) => [+k, { CE: ce || null, PE: pe || null }]));
        chains[m.u] = { expiry: m.expiry || null, rows, at: Date.now() };
        tell(m.u, 'chain');
      } else if (m.type === 'osub' && m.s && m.ok !== false) {
        NsbLive.put(m.s, m.candles || [], m.forming === undefined ? undefined : m.forming);
        tell(m.u || m.s.slice(4).split('-')[0], 'osub');
      } else if (m.type === 'osub' && m.s && m.ok === false) sent.delete(m.s);
    });
  }
  // today's option day from the stream, in the saved files' shape: built from the candles asked for so far
  function day(root, key) {
    const ch = chains[root];
    if (!ch || !window.NsbLive) return null;
    const d = { key, expiry: ch.expiry, series: null, t0: Date.parse(key + 'T09:15:00Z') - IST, CE: new Map(), PE: new Map(), prev: null, live: true,
                strikes: [...ch.rows.keys()].sort((a, b) => a - b), names: ch.rows };
    for (const [k, nm] of ch.rows) for (const side of ['CE', 'PE']) {
      if (!nm[side] || !NsbLive.has(nm[side])) continue;
      const m = new Map();
      for (const b of NsbLive.bars(nm[side])) if (istKey(b.t) === key) m.set(b.t, { o: b.o, h: b.h, l: b.l, c: b.c });
      d[side].set(k, m);
    }
    return d;
  }
  return { chain, want, day, has: root => !!chains[root], on: fn => subs.push(fn), ver: () => ver };
})();

// ---- the rolling ATM ---------------------------------------------------------------------------------------------
const nearest = (strikes, px) => {  // the strike nearest px (a tie: the lower one)
  let lo = 0, hi = strikes.length - 1;
  if (hi < 0) return null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (strikes[mid] <= px) lo = mid; else hi = mid; }
  return Math.abs(strikes[hi] - px) < Math.abs(strikes[lo] - px) ? strikes[hi] : strikes[lo];
};
// the last close of strike k at or before t that day (none: null)
function closeBy(day, side, k, t) {
  const m = day && day[side].get(k);
  if (!m) return null;
  for (let x = t; x >= day.t0; x -= MIN) { const b = m.get(x); if (b) return b.c; }
  return null;
}
// under: the underlying's 1-minute candles [{ time (ms), close }] oldest first; days: key -> its option day (saved or live)
// -> { bars: [{ time, o, h, l, c (moved), raw: the strike's own close, k, key, expiry }], marks: [{ time, k, exp }] }
function rolling(under, days, side) {
  const out = [];
  for (const u of under) {
    const key = istKey(u.time), d = days[key];
    if (!d || !d.strikes.length) continue;
    const k = nearest(d.strikes, u.close), m = d[side].get(k), b = m && m.get(u.time);
    if (!b) continue;
    out.push({ time: u.time, o: b.o, h: b.h, l: b.l, c: b.c, raw: b.c, k, key, expiry: d.expiry });
  }
  const gaps = [], marks = [];
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (a.k === b.k && a.expiry === b.expiry) continue;
    let gap = null, nw = null;
    if (a.key === b.key || (a.expiry && a.expiry === b.expiry)) nw = closeBy(days[a.key], side, b.k, a.time);  // the same series: both strikes at the old one's last minute
    else {  // a new series overnight (after an expiry): its strike at the end of the day before (the file's prev)
      const pv = days[b.key] && days[b.key].prev;
      if (pv && istKey(pv.t) === a.key) nw = pv[side].get(b.k);
    }
    if (ok(nw)) gap = nw - a.c;
    if (!ok(gap)) gap = b.o - a.c;  // not measured: joined where it opened
    gaps.push([b.time, gap]);
    marks.push({ time: b.time, k: b.k, exp: a.expiry !== b.expiry ? b.expiry : null });
  }
  let add = 0, g = gaps.length - 1;
  const r6 = v => Math.round(v * 1e6) / 1e6;
  for (let i = out.length - 1; i >= 0; i--) {
    while (g >= 0 && out[i].time < gaps[g][0]) add = r6(add + gaps[g--][1]);
    if (add) { const b = out[i]; b.o = r6(b.o + add); b.h = r6(b.h + add); b.l = r6(b.l + add); b.c = r6(b.c + add); }
  }
  return { bars: out, marks };
}
// one strike's own candles over the days given, from t on (Our trade)
function locked(days, keys, side, k, expiry, from, upto) {
  const out = [];
  for (const key of keys) {
    const d = days[key], m = d && d[side].get(k);
    if (!m || (expiry && d.expiry && d.expiry !== expiry)) continue;
    for (const [t, b] of [...m].sort((x, y) => x[0] - y[0])) if (t >= from && t <= upto) out.push({ time: t, ...b });
  }
  return out;
}

// ---- the floating window ---------------------------------------------------------------------------------------
const css = document.createElement('style');
css.textContent = `
  .ow { position: absolute; z-index: 16; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--line-strong);
        border-radius: 8px; background: var(--surface); box-shadow: 0 8px 28px rgba(0, 0, 0, .55); overflow: hidden; }
  .ow[hidden] { display: none; }
  .ow-h { flex: none; display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 8px; border-bottom: 1px solid var(--line);
          cursor: move; touch-action: none; user-select: none; -webkit-user-select: none; white-space: nowrap; overflow: hidden; font-size: 11.5px; }
  .ow-h .ow-t { font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
  .ow-h .ow-s { padding: 0 6px; border-radius: 5px; font: 700 10.5px/16px var(--font-num); letter-spacing: .04em; background: var(--tile); color: var(--muted); }
  .ow-h .ow-s.bull { background: var(--up); color: #04150f; } .ow-h .ow-s.bear { background: var(--down); color: #1e0507; }
  .ow-h .ow-n { color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
  .ow.tiny .ow-h .ow-t { display: none; }   /* a phone: the chart's own name is just above it */
  .ow-h button { margin-left: auto; flex: none; width: 22px; height: 20px; padding: 0; border: 1px solid var(--line); border-radius: 5px;
                 background: var(--bg); color: var(--muted); cursor: pointer; font: 600 12px/18px var(--font-ui); touch-action: manipulation; }
  .ow-h button + button { margin-left: 0; }
  .ow-h button:hover { color: var(--text); border-color: var(--line-strong); }
  .ow-b { flex: 1; min-height: 0; display: flex; }
  .ow.narrow .ow-b { flex-direction: column; }
  .ow-col { flex: 1 1 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .ow-col + .ow-col { border-left: 1px solid var(--line-strong); }
  .ow.narrow .ow-col + .ow-col { border-left: 0; border-top: 1px solid var(--line-strong); }
  .ow-col[hidden] { display: none; }
  .ow-sub { flex: none; padding: 2px 7px; font: 11px/15px var(--font-num); color: var(--muted); white-space: nowrap; overflow: hidden; }
  .ow-sub > div { overflow: hidden; text-overflow: ellipsis; }
  .ow-sub b { color: var(--text); font-weight: 600; } .ow-sub .k { font-family: var(--font-ui); color: var(--faint); }
  .ow-sub .up { color: var(--up); } .ow-sub .down { color: var(--down); }
  .ow-sub b.up { color: var(--up); } .ow-sub b.down { color: var(--down); }
  .ow-c { position: relative; min-height: 0; min-width: 0; }
  .ow-cp { flex: 62 1 0; } .ow-ce, .ow-ct { flex: 19 1 0; border-top: 1px solid var(--line); }
  .ow-c .tag { top: 2px; left: 4px; }
  .ow .ow-c .tag, .ow:not(.big) .ow-ct, .ow .nsb-vals { display: none; }   /* no labels (the chart's own panes have the switches); small: the price and the Entry pane */
  .ow:not(.big) .ow-ce { flex-basis: 0; flex-grow: 26; }
  .ow.empty .ow-b { visibility: hidden; }
  .ow-msg { position: absolute; z-index: 4; left: 0; right: 0; top: 50%; transform: translateY(-30%); padding: 0 12px; text-align: center; color: var(--muted); font-size: 12px; pointer-events: none; }
  .ow.empty .ow-msg { top: 27px; transform: none; text-align: left; padding: 0 8px; line-height: 1.35; }
  .ow.empty .ow-rs { display: none; }
  .ow-msg[hidden] { display: none; }
  .ow-rs { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; touch-action: none; z-index: 3;
           background: linear-gradient(135deg, transparent 50%, var(--line-strong) 50%); }
  .owbtn { padding: 1px 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--muted); cursor: pointer;
           font: 600 11px/16px var(--font-ui); white-space: nowrap; touch-action: manipulation; }
  .owbtn:hover { color: var(--text); border-color: var(--line-strong); }
  .owbtn[aria-pressed="true"] { border-color: var(--accent); color: var(--text); background: rgba(91, 140, 255, .14); }
`;
document.head.appendChild(css);

const SIZES = { small: [300, 200], big: [560, 390] };
// where the strike (or the series) changed: a short amber tick along the price chart's top edge (owner 5/11/2026: "a small
// mark"; markers were too big for the rolling ATM, which can change strike many times a day), its new strike written beside
// the first tick of each hour once the window is enlarged
class Ticks {
  constructor(chart) { this.chart = chart; this.marks = []; this.big = false; this.out = []; this.views = [{ zOrder: () => 'top', renderer: () => ({ draw: t => this.render(t) }) }]; }
  attached({ requestUpdate }) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = null; }
  paneViews() { return this.views; }
  set(marks, big) { this.marks = marks; this.big = big; if (this.requestUpdate) this.requestUpdate(); }
  updateAllViews() {
    const ts = this.chart().timeScale(), out = [];
    let lastX = -1e9;
    for (const m of this.marks) {
      const x = ts.timeToCoordinate(m.time);
      if (x === null) continue;
      const label = this.big && x - lastX >= 64;  // labels at least 64 px apart
      if (label) lastX = x;
      out.push([x, label ? m.text : '']);
    }
    this.out = out;
  }
  render(target) {
    target.useBitmapCoordinateSpace(({ context: c, bitmapSize: size, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      c.save();
      c.fillStyle = STRIKE_MARK;
      for (const [x] of this.out) { const px = Math.round(x * hr); if (px >= 0 && px < size.width) c.fillRect(px - Math.max(1, Math.round(hr * 0.75)), 0, Math.max(2, Math.round(1.5 * hr)), Math.round(5 * vr)); }
      c.font = `600 ${Math.round(9.5 * vr)}px "IBM Plex Mono", monospace`; c.textBaseline = 'top';
      for (const [x, text] of this.out) if (text) {
        const px = Math.round(x * hr) + Math.round(3 * hr), w = c.measureText(text).width;
        if (px + w > size.width) continue;
        c.lineWidth = Math.max(3, Math.round(3 * hr)); c.strokeStyle = 'rgba(14, 19, 26, 0.9)'; c.strokeText(text, px, Math.round(6 * vr));
        c.fillText(text, px, Math.round(6 * vr));
      }
      c.restore();
    });
  }
}
const pref = (k, fb) => { try { const v = localStorage.getItem('nsb.ireplay.ow.' + k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } };
const save = (k, v) => { try { localStorage.setItem('nsb.ireplay.ow.' + k, JSON.stringify(v)); } catch (e) {} };
const SIDE_WORD = { CE: 'CALL', PE: 'PUT' };
const STRIKE_MARK = '#f2b33d';

class Window {
  // host: the chart's panel (position: relative); id: its storage key; name: the underlying's name; root: its option root;
  // api: { options(showTime, isMain), digits, origin, tf(), alignAt(t), fmt(v), num(v, d), when(ms), hhmm(ms), btn (the header button) }
  constructor(host, id, name, root, api) {
    Object.assign(this, { host, id, name, root, api });
    const st = pref(id, {});
    this.big = !!st.big; this.open = st.open !== false; this.pos = st.pos || null; this.size = st.size || null;
    const el = this.el = document.createElement('div');
    el.className = 'ow';
    el.innerHTML = `<div class="ow-h"><span class="ow-t">${name}</span><span class="ow-s">—</span><span class="ow-n"></span>
        <button type="button" class="ow-big" title="Enlarge">⤢</button><button type="button" class="ow-x" title="Close (the Option button in the chart's header opens it again)">×</button></div>
      <div class="ow-b">
        <div class="ow-col ow-now"><div class="ow-sub"></div><div class="ow-c ow-cp"></div><div class="ow-c ow-ce"><div class="tag mix"></div></div><div class="ow-c ow-ct"><div class="tag mix"></div></div></div>
        <div class="ow-col ow-trade" hidden><div class="ow-sub"></div><div class="ow-c ow-cp"></div></div>
      </div><div class="ow-msg" hidden></div><div class="ow-rs" title="Drag to size"></div>`;
    host.appendChild(el);
    const q = s => el.querySelector(s);
    this.subNow = q('.ow-now .ow-sub'); this.subTrade = q('.ow-trade .ow-sub'); this.colTrade = q('.ow-trade'); this.msg = q('.ow-msg');
    this.sideEl = q('.ow-s'); this.nameEl = q('.ow-n');
    // the charts: ATM now (price, Entry, Trend) and Our trade (price)
    const opts = (time) => ({ ...api.options(time, true), watermark: { visible: false }, handleScroll: true, handleScale: true,
                              rightPriceScale: { borderColor: '#1c2430', minimumWidth: 52 }, layout: { ...api.options(time, true).layout, fontSize: 10, attributionLogo: false } });
    this.chart = LightweightCharts.createChart(q('.ow-now .ow-cp'), opts(true));
    this.candles = this.chart.addCandlestickSeries({ upColor: '#2bb68a', downColor: '#f0555f', borderVisible: false, wickUpColor: '#2bb68a', wickDownColor: '#f0555f' });
    this.candles.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.08 } });
    const emaLine = () => this.chart.addLineSeries({ color: NsbMacd.STACK.mixed, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.e8 = emaLine(); this.e21 = emaLine(); this.e47 = emaLine();
    this.bars = []; this.src = {};
    this.zones = new NsbMacd.Bands(() => this.chart, () => this.bars.length, i => this.shade(i));
    this.candles.attachPrimitive(this.zones);
    this.days = new NsbMacd.DayLines(() => this.chart, () => this.bars, null, api.origin);
    this.candles.attachPrimitive(this.days);
    this.ticks = new Ticks(() => this.chart);
    this.candles.attachPrimitive(this.ticks);
    this.panes = {};
    for (const [k, cls] of [['entry', '.ow-ce'], ['trend', '.ow-ct']]) this.panes[k] = new NsbMacd.MacdPane({
      el: q(`.ow-now ${cls}`), tagEl: q(`.ow-now ${cls} .tag`), kind: k, name: '', digits: 2, options: { ...api.options(false, false), rightPriceScale: { borderColor: '#1c2430', minimumWidth: 52 }, layout: { ...api.options(false, false).layout, fontSize: 10 } },
      origin: api.origin, bars: () => this.bars, tf: () => api.tf(), src: () => this.src, shade: i => this.state(i) });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => { for (const p of Object.values(this.panes)) p.sync(r); });
    this.tchart = LightweightCharts.createChart(q('.ow-trade .ow-cp'), opts(true));
    this.tcandles = this.tchart.addCandlestickSeries({ upColor: '#2bb68a', downColor: '#f0555f', borderVisible: false, wickUpColor: '#2bb68a', wickDownColor: '#f0555f' });
    this.tcandles.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.08 } });
    this.entryLine = null;
    // moving, sizing, enlarging, closing
    const head = q('.ow-h');
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault(); e.stopPropagation();
      const r0 = el.getBoundingClientRect(), h = host.getBoundingClientRect(), dx = e.clientX - r0.left, dy = e.clientY - r0.top;
      try { head.setPointerCapture(e.pointerId); } catch (x) {}
      const move = ev => { this.pos = [ev.clientX - h.left - dx, ev.clientY - h.top - dy]; this.place(); };
      const up = () => { head.removeEventListener('pointermove', move); this.keep(); };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up, { once: true }); head.addEventListener('pointercancel', up, { once: true });
    });
    const rs = q('.ow-rs');
    rs.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const r0 = el.getBoundingClientRect();
      try { rs.setPointerCapture(e.pointerId); } catch (x) {}
      const move = ev => { this.size = [ev.clientX - r0.left, ev.clientY - r0.top]; this.place(); };
      const up = () => { rs.removeEventListener('pointermove', move); this.keep(); };
      rs.addEventListener('pointermove', move);
      rs.addEventListener('pointerup', up, { once: true }); rs.addEventListener('pointercancel', up, { once: true });
    });
    for (const ev of ['pointerdown', 'wheel', 'touchstart', 'click', 'dblclick']) el.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'wheel' || ev === 'touchstart' });
    q('.ow-big').addEventListener('click', () => { this.big = !this.big; this.size = null; this.place(); this.keep(); });
    q('.ow-x').addEventListener('click', () => this.show(false));
    this.btn = api.btn;
    if (this.btn) this.btn.addEventListener('click', e => { e.stopPropagation(); this.show(!this.open); });
    this.ro = new ResizeObserver(() => this.place());
    this.ro.observe(host);
    this.show(this.open, false);
    this.side = null; this.run = null; this.trade = null; this.ver = -1;
  }
  keep() { save(this.id, { big: this.big, open: this.open, pos: this.pos, size: this.size }); }
  show(on, keep = true) {
    this.open = on; this.el.hidden = !on;
    if (this.btn) { this.btn.setAttribute('aria-pressed', String(on)); this.btn.title = on ? 'Hide the option window' : 'Show the option window'; }
    if (on) { this.place(); if (this.pending) { this.pending = false; if (this.ctx) this.update(this.ctx); } }  // (closed, it took nothing in: 13/11/2026)
    if (keep) this.keep();
  }
  place() {  // inside the chart's panel, below its header, clear of its price scale
    if (this.el.hidden) return;
    const H = this.host.clientWidth, V = this.host.clientHeight, head = 34, [w0, h0] = SIZES[this.big ? 'big' : 'small'];
    // (its own size, or the default: at most half the chart's width and a third of its height small, most of it enlarged)
    const pm = this.host.querySelector('.pane'), P = pm ? pm.offsetTop + pm.offsetHeight : V;  // the price chart's bottom
    let [w, h] = this.size || [Math.min(w0, Math.round(H * (this.big ? 0.8 : 0.5))), Math.min(h0, Math.round((P - head) * (this.big ? 0.72 : 0.42)))];
    w = Math.max(200, Math.min(w, H - 12)); h = Math.max(140, Math.min(h, V - head - 8));
    if (this.el.classList.contains('empty')) h = w < 300 ? 74 : 58;  // nothing to chart: its header and the note only
    // by default top left, under the chart's label (the newest candles stay in view)
    const tag = this.host.querySelector('.tag.main'), under = tag ? Math.round(tag.getBoundingClientRect().bottom - this.host.getBoundingClientRect().top) + 6 : head + 46;
    let [x, y] = this.pos || [6, under];
    x = Math.max(4, Math.min(x, H - w - 4)); y = Math.max(head, Math.min(y, V - h - 4));
    Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const big = this.big || w >= 420;
    if (big !== this.el.classList.contains('big')) { this.el.classList.toggle('big', big); if (this.run) this.setMarks(); }
    this.el.classList.toggle('narrow', w < 380 && !this.colTrade.hidden);
    this.el.classList.toggle('tiny', w < 225);
  }
  remove() { this.gone = true; this.ro.disconnect(); this.chart.remove(); for (const p of Object.values(this.panes)) p.chart.remove(); this.tchart.remove(); this.el.remove(); }
  state(i) { const b = this.bars[i]; if (!b) return null; const tf = this.api.tf(); let s = null; for (let t = b.time + tf * MIN - MIN; t >= b.time && !s; t -= MIN) s = this.api.alignAt(t); return s && s !== 'NEUTRAL' ? s : null; }
  shade(i) { const s = this.state(i); return s === 'BULLISH' ? 'rgba(43, 182, 138, 0.11)' : s === 'BEARISH' ? 'rgba(240, 85, 95, 0.10)' : null; }
  // ctx: { under: the underlying's 1-minute candles [{ time, close }] (strip and warm-up days), keys: their IST day keys,
  // shownFrom: the first shown minute, today: today's key or null, trades: the chart's entries [{ kind, dir, t, exit }],
  // note: text when there is nothing to show yet }; then at(t) for the minute shown (hovered, or the newest)
  async update(ctx) {
    this.ctx = ctx; this.ver += 1;
    if (!this.open) { this.pending = true; return; }  // a closed window does nothing until it opens (13/11/2026, owner: "laggy")
    const my = this.ver;
    if (this.root && ctx.today && Live.has && !Live.has(this.root)) Live.chain(this.root);
    const days = {};
    await Promise.all(ctx.keys.map(async k => { days[k] = (await Data.file(this.root, k)) || (k === ctx.today ? Live.day(this.root, k) : null); }));
    if (my !== this.ver || this.gone) return;
    this.daysMap = days;
    this.run = null;
    if (!this.open) { this.pending = true; return; }
    this.at(this.t, true);
  }
  // live (13/11/2026, owner: "laggy"): the forming minute of the strike shown moved. Only its candle moves;
  // a closed minute, a new strike or the chain build the window whole (update), as before
  tick() {
    if (!this.open || !this.run || !this.bars.length || this.t !== undefined || !this.ctx || !this.ctx.today) return;  // (hovering: the minute shown stays)
    const d = this.daysMap && this.daysMap[this.ctx.today], last = this.run.bars[this.run.bars.length - 1];
    if (!d || !d.live || !d.names || !last || last.key !== this.ctx.today) return;
    const nm = d.names.get(last.k), name = nm && nm[this.side], cur = name && window.NsbLive && NsbLive.cur(name);
    if (!cur || cur.t < last.time) return;
    const gap = last.c - last.raw, s = this.bucket(cur.t), b = this.bars[this.bars.length - 1];
    if (s === b.time) { b.close = cur.c + gap; b.high = Math.max(b.high, cur.h + gap); b.low = Math.min(b.low, cur.l + gap); }
    else if (s > b.time) this.bars.push({ time: s, open: cur.o + gap, high: cur.h + gap, low: cur.l + gap, close: cur.c + gap });
    else return;
    const n = this.bars[this.bars.length - 1];
    this.candles.update({ time: sec(n.time), open: n.open, high: n.high, low: n.low, close: n.close });  // (the "ATM now" text stays the last closed minute's, as at())
  }
  // the minute shown: t (hovered) or the newest; the side, ATM now and Our trade as of then
  at(t, force = false) {
    this.t = t;
    if (!this.ctx || !this.daysMap) return;
    if (!this.open && !force) { this.pending = true; return; }
    const ctx = this.ctx, ref = t !== undefined ? t : ctx.under.length ? ctx.under[ctx.under.length - 1].time : 0;
    const dir = this.api.dirAt(ref), side = dir === 'BEARISH' ? 'PE' : 'CE', now = this.api.alignAt(ref);
    if (side !== this.side || !this.run || force) { this.side = side; this.build(); }
    // as of ref: the ATM strike and its own price
    const run = this.run, bars = run ? run.bars : [];
    let i = bars.length - 1;
    while (i >= 0 && bars[i].time > ref) i--;
    let b = i >= 0 ? bars[i] : null;
    const d = this.api.digits;
    // a series is never shown on a day after it ended (13/11/2026: NIFTY 50 showed "exp 9 Nov ... CE 0.05 15:29" on 12 and
    // 13 Nov, whose option candles were not saved: the last candle known was the expired series')
    const bd = b && this.daysMap[b.key];
    if (bd && bd.expiry && bd.expiry < istKey(ref)) b = null;
    this.sideEl.textContent = SIDE_WORD[side]; this.sideEl.className = 'ow-s ' + (now === 'BULLISH' ? 'bull' : now === 'BEARISH' ? 'bear' : '');
    this.sideEl.title = now === 'BULLISH' || now === 'BEARISH' ? `The trend's side: the ${side === 'CE' ? 'call' : 'put'}` : `No trend now: the last trend's side (${side === 'CE' ? 'call' : 'put'})`;
    const day0 = b && this.daysMap[b.key];
    this.nameEl.textContent = day0 && day0.expiry ? `exp ${+day0.expiry.slice(8)} ${MON[+day0.expiry.slice(5, 7) - 1]}` : '';
    this.subNow.innerHTML = b ? `<div><span class="k">ATM now</span> <b>${b.k} ${side}</b></div><div><b>${this.api.num(b.raw, 2)}</b> <span class="k">${this.api.hhmm(b.time)}</span></div>`
      : `<div><span class="k">ATM now</span> —</div><div>&nbsp;</div>`;
    // nothing to chart: none at all (the page's note), or only from the warm-up days before the strip
    const empty = !bars.length || !this.bars.length;
    this.msg.hidden = !empty; this.msg.textContent = empty ? (bars.length ? `No ${this.name} option candles for these days` : (ctx.note || 'No option candles for these days')) : '';
    if (empty !== this.el.classList.contains('empty')) { this.el.classList.toggle('empty', empty); this.place(); }
    // Our trade: the newest entry still open at ref
    const open = (ctx.trades || []).filter(x => x.t <= ref && ref <= x.end).sort((a, c) => c.t - a.t);
    const tr = open[0] || null, key = tr ? `${tr.kind}|${tr.dir}|${tr.t}` : null;
    if (key !== this.tradeKey || force) { this.tradeKey = key; this.buildTrade(tr); }
    if (tr && this.tradeRun) this.tradeText(tr, ref, open.length - 1);
    if (this.colTrade.hidden !== !tr) { this.colTrade.hidden = !tr; this.place(); if (tr) this.fitTrade(); }
    // the crosshair on the minute shown
    if (t !== undefined && b) { const s = this.bucket(b.time); const v = this.bars.find(x => x.time === s); if (v) { this.chart.setCrosshairPosition(v.close, sec(s), this.candles); this.crossOn = true; } }
    else if (this.crossOn) { this.chart.clearCrosshairPosition(); this.crossOn = false; }  // (only when one is set: each clear redrew the chart, 13/11/2026)
  }
  bucket(t) { const tf = this.api.tf(), o = this.api.origin, d0 = t - ((t - o) % DAY + DAY) % DAY; return d0 + Math.floor((t - d0) / (tf * MIN)) * tf * MIN; }
  build() {  // the rolling ATM of this.side over the strip, its indicators, marks and shading
    const ctx = this.ctx, run = this.run = rolling(ctx.under, this.daysMap, this.side);
    // the strikes today's candles need from the stream: every strike the ATM path touched, both sides' nearest
    if (ctx.today && this.daysMap[ctx.today] && this.daysMap[ctx.today].live) {
      const d = this.daysMap[ctx.today], names = new Set();
      for (const u of ctx.under) if (istKey(u.time) === ctx.today) {
        const k = nearest(d.strikes, u.close), nm = d.names.get(k);
        if (nm) { names.add(nm[this.side]); const j = d.strikes.indexOf(k); for (const kk of [d.strikes[j - 1], d.strikes[j + 1]]) { const n2 = kk !== undefined && d.names.get(kk); if (n2) names.add(n2[this.side]); } }
      }
      Live.want(this.root, [...names].filter(Boolean));
    }
    const sig = new TrendSignal({ OPT: 1 }, SHOWN, this.api.origin);
    for (const b of run.bars) sig.onMemberBar('OPT', b.time, b.c, 0);
    this.src = Object.fromEntries(Object.entries(sig.tfs).map(([m, tf]) => [m, tf.bars]));
    const tf = this.api.tf(), from = ctx.shownFrom, agg = [];
    for (const b of run.bars) {
      if (b.time < from) continue;
      const s = this.bucket(b.time), last = agg[agg.length - 1];
      if (!last || last.time !== s) agg.push({ time: s, open: b.o, high: b.h, low: b.l, close: b.c });
      else { last.high = Math.max(last.high, b.h); last.low = Math.min(last.low, b.l); last.close = b.c; }
    }
    this.bars = agg;
    const r0 = this.fitted ? this.chart.timeScale().getVisibleLogicalRange() : null, n0 = this.shown || 0;
    this.candles.setData(agg.map(b => ({ time: sec(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    this.shown = agg.length;
    const ema = NsbMacd.emaPoints(agg, tf, this.src, this.api.origin);
    for (const k of ['e8', 'e21', 'e47']) this[k].setData(ema.map(p => ({ time: p.time, value: p[k], color: p.color })));
    this.setMarks();
    for (const p of Object.values(this.panes)) { p.update(); p.showLines(); p.tag(); }
    this.zones.update();
    const n = agg.length;
    if (n && r0 && this.fitKey === `${this.side}|${tf}`) {  // the view kept: on the newest candles it follows them
      const add = r0.to >= n0 - 2 ? n - n0 : 0;
      this.chart.timeScale().setVisibleLogicalRange({ from: r0.from + add, to: r0.to + add });
    } else if (n) {  // the newest day
      const last = agg[n - 1], d0 = last.time - ((last.time - this.api.origin) % DAY + DAY) % DAY;
      let i = agg.findIndex(b => b.time >= d0);
      if (i < 0) i = 0;
      this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(i - 1, n - 400 / tf), to: n + 2 });
      this.fitted = true; this.fitKey = `${this.side}|${tf}`;
    }
  }
  setMarks() {  // where the strike (or the series) changed (Ticks)
    const from = this.ctx.shownFrom, marks = [];
    for (const m of this.run.marks) if (m.time >= from) marks.push({ time: sec(this.bucket(m.time)), text: m.exp ? `exp ${+m.exp.slice(8)} ${MON[+m.exp.slice(5, 7) - 1]}` : String(m.k) });
    this.ticks.set(marks, this.el.classList.contains('big'));
  }
  buildTrade(tr) {  // Our trade: the strike bought at the entry, locked
    this.tradeRun = null;
    if (this.entryLine) { try { this.tcandles.removePriceLine(this.entryLine); } catch (e) {} this.entryLine = null; }
    if (!tr) { this.tcandles.setData([]); this.tcandles.setMarkers([]); return; }
    const side = tr.dir === 'BEARISH' ? 'PE' : 'CE', key = istKey(tr.t), d = this.daysMap[key];
    const u = this.ctx.under.filter(x => x.time <= tr.t).pop();
    if (!d || !u) { this.subTrade.innerHTML = '<span class="k">Our trade</span> no option candles then'; this.tcandles.setData([]); return; }
    const k = nearest(d.strikes, u.close);
    const nm = d.names && d.names.get(k);
    if (d.live && nm) Live.want(this.root, [nm[side]]);
    let entry = closeBy(d, side, k, tr.t);
    const keys = this.ctx.keys.filter(x => x >= key);
    const rows = locked(this.daysMap, keys, side, k, d.expiry, Math.max(d.t0, tr.t - 30 * MIN), tr.end === undefined ? Infinity : tr.end);  // from half an hour before the entry to its exit
    if (!ok(entry)) { const nx = rows.find(r => r.time > tr.t); entry = nx ? nx.o : null; }
    this.tradeRun = { side, k, entry, rows, expiry: d.expiry };
    const tf = this.api.tf(), agg = [];
    for (const b of rows) {
      const s = this.bucket(b.time), last = agg[agg.length - 1];
      if (!last || last.time !== s) agg.push({ time: s, open: b.o, high: b.h, low: b.l, close: b.c });
      else { last.high = Math.max(last.high, b.h); last.low = Math.min(last.low, b.l); last.close = b.c; }
    }
    this.tcandles.setData(agg.map(b => ({ time: sec(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    this.tcandles.setMarkers([{ time: sec(this.bucket(tr.t)), position: tr.dir === 'BEARISH' ? 'aboveBar' : 'belowBar', color: tr.color || '#00E5FF',
                                shape: tr.dir === 'BEARISH' ? 'arrowDown' : 'arrowUp', text: `${tr.kind}m` }]);
    if (ok(entry)) this.entryLine = this.tcandles.createPriceLine({ price: entry, color: '#5b8cff', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'in' });
    this.tradeBars = agg.length;
    this.fitTrade();
  }
  fitTrade() {  // the whole trade in view, once its column has its size (a chart sized later keeps its bar spacing)
    const go = () => { if (!this.gone && this.tradeBars) this.tchart.timeScale().setVisibleLogicalRange({ from: -1, to: this.tradeBars + 1 }); };
    go(); requestAnimationFrame(() => requestAnimationFrame(go));
  }
  tradeText(tr, ref, more) {
    const r = this.tradeRun, d = this.api.digits;
    let now = null;
    for (const b of r.rows) if (b.time <= ref) now = b.c; else break;
    const pl = ok(now) && ok(r.entry) ? now - r.entry : null, pct = ok(pl) && r.entry ? pl / r.entry * 100 : null;
    const cls = pl > 0 ? 'up' : pl < 0 ? 'down' : '';
    const end = tr.exit && tr.exit.m <= ref ? ' · exit' : tr.noExit ? ' · no exit yet (30 s)' : '';
    this.subTrade.innerHTML = `<div><span class="k">Our trade</span> <b>${r.k} ${r.side}</b> <span class="k">${tr.kind}m entry ${this.api.hhmm(tr.t)}${end}</span>${more > 0 ? ` <span class="k">+${more} open</span>` : ''}</div>`
      + `<div><span class="k">in</span> ${ok(r.entry) ? this.api.num(r.entry, 2) : '—'} <span class="k">now</span> ${ok(now) ? this.api.num(now, 2) : '—'} `
      + `<b class="${cls}">${ok(pl) ? (pl >= 0 ? '+' : '−') + this.api.num(Math.abs(pl), 2) : '—'}${ok(pct) ? ` (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)` : ''}</b></div>`;
  }
}

window.NsbSub = Sub;
window.NsbOpt = { Window, Data, Live, rolling, nearest, locked, FIRST: FIRST_SUB, live: root => Live.chain(root), onLive: fn => Live.on(fn) };
})();
