/* Indra Quant Signal Board: 15-second candles of the futures -> the 1.5-minute MACD (owner 19/11/2026: "I want the
   1.5-minute MACD entry on other tabs as well, including the commodities and the Nasdaq"; the same day: "no need for 1.5 m
   on the nasdaq tab then"). The India tab's NsbSub (options.js) for the Commodities tab, on UTC days as its 1-minute files:
     saved days  data/futures/15s/<UTC day>.json (the VPS's nightly file, as data/india/15s: { day, <SYM>: { t0: first
                 15 s candle's open (UTC s), c: [the close of every 15 s from t0 on, null where none traded] } })
     today       Board Live's stream ("s15" once after each snapshot for the names asked so far, then "b15" as each candle
                 closes; C:\RDX\tools\board_live\PROTOCOL_OPTIONS.md, the futures' part from 19/11/2026)
   1.5-minute bar = the six 15 s candles t .. t + 75 s with t % 90 s == 0, its close the last one that traded; closed once
   its last 15 s candle is in, a later candle is, or 4 s after its end. MACD (12, 26) from the 35th bar on.
     NsbSubF.load(keys)       the saved UTC days (YYYY-MM-DD) a strip needs
     NsbSubF.bars90(sym)      its closed 1.5-minute bars { time, end (ms), close, macd }, oldest first
     NsbSubF.has(sym, key)    true when UTC day `key` has any 15 s candle of sym
     NsbSubF.live(names)      ask the stream for these names' 15 s candles too (all asked again after every reconnect)
     NsbSubF.on(fn)           fn(sym) when 15 s candles of sym came in
     NsbSubF.put(sym, t, c)   one 15 s close from elsewhere (the baskets' own, built in the browser)
   No candle at all is invented: a minute without 15 s candles has no 1.5 m value (the pages' LINE.m90s.stale). */
(() => {
'use strict';
if (window.NsbSubF) return;
const DAY = 86400000, S15 = 15000, S90 = 90000;
const { Macd } = NdxEngine.internals;
const ok = v => v !== null && v !== undefined && isFinite(v);
const utcKey = t => new Date(t).toISOString().slice(0, 10);
const getJson = async url => { const r = await fetch(url, { cache: 'no-cache' }); if (r.status === 404) return null; if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };
const FIRST = '2026-10-15';  // the saved futures 1-minute days begin here; 15 s days only where the VPS built them

let index = null;
const files = new Map();     // key -> Promise
const closes = {};           // SYM -> Map(t ms -> close)
const days = {};             // SYM -> Set of UTC day keys with a candle
const vers = {};
const cache90 = {};
const subs = [];
let asked = [];
const add = (s, t, c) => {
  if (!ok(t) || !ok(c)) return;
  (closes[s] || (closes[s] = new Map())).set(t, c);
  (days[s] || (days[s] = new Set())).add(utcKey(t));
  vers[s] = (vers[s] || 0) + 1;
};
const listed = () => index || (index = getJson('data/futures/15s/index.json').then(j => new Set((j && j.dates) || []))
  .catch(() => { index = null; return new Set(); }));
function file(key) {
  if (!files.has(key)) files.set(key, (async () => {
    if (!(await listed()).has(key)) return {};
    const j = await getJson(`data/futures/15s/${key}.json`);
    if (j) for (const [s, v] of Object.entries(j)) {
      if (!v || !Array.isArray(v.c)) continue;
      v.c.forEach((c, i) => { if (c !== null) add(s, (v.t0 + 15 * i) * 1000, c); });
    }
    return j || {};
  })().catch(() => { files.delete(key); return {}; }));
  return files.get(key);
}
async function load(keys) { await Promise.all(keys.map(file)); }
function bars90(s) {
  const m = closes[s];
  if (!m) return [];
  const have = cache90[s];
  if (have && have.ver === vers[s] && have.until > Date.now()) return have.bars;
  const ts = [...m.keys()].sort((a, b) => a - b), out = [], macd = new Macd();
  // a contract switch inside: the closes before it moved by its gap, as the 1-minute candles (rolls.js), so the MACD runs on
  let cs = ts.map(t => m.get(t));
  if (window.NsbRolls && NsbRolls.adjust) { const a = NsbRolls.adjust(s, ts.map((t, i) => ({ t, o: cs[i], h: cs[i], l: cs[i], c: cs[i] }))); cs = a.map(r => r.c); }
  ts.forEach((t, i) => {
    const b0 = t - t % S90, last = out[out.length - 1];
    if (last && last.time === b0) { last.close = cs[i]; last.lastT = t; return; }
    out.push({ time: b0, end: b0 + S90, close: cs[i], lastT: t });
  });
  let until = Infinity;
  if (out.length) { const b = out[out.length - 1]; if (b.lastT < b.time + S90 - S15 && Date.now() < b.end + 4000) { out.pop(); until = b.end + 4000; } }  // still forming
  let n = 0;
  for (const b of out) { const [line] = macd.update(b.close); n += 1; if (n >= 35) b.macd = line; delete b.lastT; }
  cache90[s] = { ver: vers[s], bars: out, until };
  return out;
}
const has = (s, key) => !!(days[s] && days[s].has(key));
const tell = s => { for (const fn of subs) fn(s); };
// the stream: from 00:00 UTC of the day before (Board Live keeps that UTC day and today); every name asked so far again
// after each snapshot (a reconnect), the new ones as they are shown
function ask(names) {
  if (window.NsbLive && NsbLive.send && names.length) {
    const d0 = Date.parse(utcKey(Date.now()) + 'T00:00:00Z');
    NsbLive.send({ s15: names, since: d0 - DAY });
  }
}
function live(names) {
  const add2 = names.filter(s => !asked.includes(s));
  if (!add2.length) return;
  asked = asked.concat(add2);
  ask(add2);
}
if (window.NsbLive && NsbLive.onMsg) {
  NsbLive.on(kind => { if (kind === 'snapshot' && asked.length) ask(asked); });
  NsbLive.onMsg(m => {
    if (m.type === 's15' && m.ok !== false && m.candles) {
      for (const [s, rows] of Object.entries(m.candles)) for (const r of rows || []) add(s, +r[0], +r[4]);
      for (const s of Object.keys(m.candles)) tell(s);
    } else if (m.type === 'b15' && m.s) {
      add(m.s, +m.t, +m.c);
      tell(m.s);
    }
  });
}
window.NsbSubF = { load, bars90, has, live, on: fn => subs.push(fn), put(s, t, c) { add(s, t, c); }, tell, first: FIRST, utcKey };
})();
