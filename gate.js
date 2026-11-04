/* Indra Quant Signal Board: the gate from the lines switched on (owner 1/11/2026, through VPS Work: "the switching on and
   off should exactly work and reflect on the shading area as our trend" ... "gate as well").

   At each minute's close, from the bars CLOSED by then (as the engine's gate, "candle close"):
     LONG (BULLISH)     every Trend line switched on (5m, 9m, 11m, 15m: EMA 8 − EMA 47, EMA 21 − EMA 47) and every Swing line
                        switched on that has a value yet (1h, 4h, 1D; 1W and 1M where the chart draws them) above 0
     SHORT (BEARISH)    every one of them below 0
     NO TRADE (NEUTRAL) anything else; also when no line is switched on, or a Trend line switched on has no value yet
   A line switched off counts for nothing, at once. With the 5m, 9m and 11m Trend lines on (the 15m ones, owner 3/11/2026,
   and the Swing lines off) it is exactly the engine's RDX WIP gate (its "5m EMA21 vs EMA47" is the 5m 21/47 line). Your stocks (two or more picked): each stock's own
   Trend lines decide its own gate and they must all agree, as the engine's; the Swing lines are the composite's.
     NsbGate.states(sig, swing, swingLines, own) -> Map(minute ms -> 'BULLISH' | 'BEARISH' | 'NEUTRAL'), the minutes the
                                                 engine's sig has run (its trace); worked out again after a switch. own:
                                                 the series' own lines only (Your stocks' shading: its own waves, not every
                                                 stock's agreement; for one market the same as the gate)
     NsbGate.chips(sig, swing, swingLines, t) -> the header's chips at minute t: one per timeframe with a line on, ▲ all
                                                 its lines on above 0, ▼ all below, ◆ mixed (the composite's own lines)
   Both take a last argument `trend` (default true): false leaves the Trend lines out, the Swing lines given deciding alone
   (4/11/2026: the MNQ page's right side, its 30m, 1h, 4h, 1D and 1W waves only), from every minute the engine has run.
   sig: an engine TrendSignal (NdxEngine.internals); swing: NsbSwing.series(...)'s candles { 60: [...], 240: [...], ... }
   (each with its own `end`); swingLines: the Swing lines the chart draws (NsbSwing.LINES, or NsbSwing.ALL). */
(() => {
'use strict';
if (window.NsbGate) return;
const { LINE, PANES, show } = NsbMacd;
const MIN = 60000;
const ok = v => v !== null && v !== undefined && isFinite(v);
let ver = 0;
NsbMacd.onToggle(() => { ver += 1; });  // a switch: every gate is worked out again
const LABEL = { 5: '5m', 9: '9m', 11: '11m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1D', 10080: '1W', 43200: '1M' };

// each Swing line switched on, minute by minute: its value from the last candle CLOSED by the minute's close (none: no value)
function swingAt(swing, lines) {
  const tfs = [...new Set(lines.map(m => LINE[m].tf))], k = Object.fromEntries(tfs.map(m => [m, -1]));
  return t => {
    const end = t + MIN, v = {};
    for (const m of tfs) {
      const a = (swing && swing[m]) || [];
      while (k[m] + 1 < a.length && a[k[m] + 1].end <= end) k[m]++;  // minutes come in order
      v[m] = k[m] >= 0 ? a[k[m]] : null;
    }
    return lines.map(l => { const b = v[LINE[l].tf], x = b ? LINE[l].v(b) : null; return ok(x) ? x : null; });
  };
}
// one series' Trend lines switched on, from a trace entry's closed bars -> 1 all above 0, -1 all below, 0 otherwise
// (null: a line on has no value yet - NO TRADE, as the engine)
function trendDir(b, lines) {
  let up = 0, down = 0;
  for (const l of lines) {
    const bar = b[LINE[l].tf], x = bar ? LINE[l].v(bar) : null;
    if (!ok(x)) return null;
    if (x > 0) up += 1; else if (x < 0) down += 1;
  }
  return up === lines.length ? 1 : down === lines.length ? -1 : 0;
}
const cache = new WeakMap(), ownCache = new WeakMap(), dirCache = new WeakMap(), ownDirCache = new WeakMap(), noDirCache = new WeakMap();
const traceKey = sig => `${sig.trace.length}|${(sig.trace[sig.trace.length - 1] || {}).t}`;
// Each minute's Trend verdict, before any Swing line: 1 (all the Trend lines on above 0), -1 (all below), 0 (not so, or a line
// on without a value yet), null (no Trend line on); none for a minute the engine had not warmed up. Two or more stocks: every
// stock's own lines must agree. Worked out once per series, switch state and trace (4/11/2026: it was redone, every stock's
// minutes looked up afresh, for every set of Swing lines asked - the MNQ page's two copies - and that was most of its load)
function trendDirs(sig, own) {
  const store = own ? ownDirCache : dirCache, key = `${ver}|${traceKey(sig)}`, have = store.get(sig);
  if (have && have.key === key) return have.dirs;
  const tOn = PANES.trend.lines.filter(m => show[m]);
  const parts = sig.parts && !own ? Object.values(sig.parts).map(p => new Map((p.trace || []).map(e => [e.t, e.state === null ? null : e.b]))) : null;
  const dirs = new Map();
  for (const e of sig.trace) {
    if (e.state === null) continue;  // the engine not warmed up yet: no gate
    if (!tOn.length) { dirs.set(e.t, null); continue; }
    let dir = null;  // 1 / -1 so far, 0: they disagree
    if (parts) {
      for (const p of parts) {
        const b = p.get(e.t), d = b ? trendDir(b, tOn) : null;
        if (d === null || d === 0) { dir = 0; break; }
        dir = dir === null ? d : dir === d ? d : 0;
        if (!dir) break;
      }
    } else {
      const d = trendDir(e.b, tOn);
      dir = d === null ? 0 : d;
    }
    dirs.set(e.t, dir);
  }
  store.set(sig, { key, dirs });
  return dirs;
}
// no Trend line counted (trend = false): every minute the engine has run, warmed up or not, with no verdict yet
function noTrendDirs(sig) {
  const key = traceKey(sig), have = noDirCache.get(sig);
  if (have && have.key === key) return have.dirs;
  const dirs = new Map(sig.trace.map(e => [e.t, null]));
  noDirCache.set(sig, { key, dirs });
  return dirs;
}
// own: the series' own lines only, even for Your stocks (the shading of the composite's chart, as before 2/11/2026: its own
// waves, not every stock's agreement; for one market it is the gate itself)
function states(sig, swing, swingLines = PANES.swing.lines, own = false, trend = true) {
  if (!sig || !sig.trace) return new Map();
  // one answer kept per series and set of Swing lines (4/11/2026: the MNQ page asks the same series with and without its 1h lines)
  // (no Trend line: a basket's own lines and its gate are the same, the composite's Swing lines; one answer for both)
  const store = own && trend ? ownCache : cache, lk = (trend ? '' : 'long|') + swingLines.join(), per = store.get(sig) || {};
  const key = `${ver}|${lk}|${traceKey(sig)}`, have = per[lk];
  if (have && have.key === key && have.swing === swing) return have.map;
  const sOn = swingLines.filter(m => show[m]), sw = swingAt(swing, sOn), dirs = trend ? trendDirs(sig, own) : noTrendDirs(sig);
  const map = new Map();
  for (const [t, trend] of dirs) {
    let dir = trend, counted = trend === null ? 0 : 1;  // dir: 1 / -1 so far, 0: they disagree
    if (dir !== 0 && sOn.length) {
      for (const x of sw(t)) {
        if (x === null) continue;  // a Swing line with no value yet (a young market's month): not counted
        const d = x > 0 ? 1 : x < 0 ? -1 : 0;
        dir = dir === null ? d : dir === d ? d : 0;
        counted += 1;
        if (!dir) break;
      }
    }
    map.set(t, counted && dir === 1 ? 'BULLISH' : counted && dir === -1 ? 'BEARISH' : 'NEUTRAL');
  }
  per[lk] = { key, swing, map };
  store.set(sig, per);
  return map;
}
// the header's chips at minute t (the series' own lines; Your stocks: the composite's), one per timeframe with a line on
function chips(sig, swing, swingLines = PANES.swing.lines, t, trend = true) {
  if (!sig || !sig.trace || !sig.trace.length) return '';
  let e = null;
  for (let i = sig.trace.length - 1; i >= 0; i--) if (sig.trace[i].t <= t) { e = sig.trace[i]; break; }
  if (!e) return '';
  const groups = new Map();
  for (const l of trend ? PANES.trend.lines.filter(m => show[m]) : []) {
    const bar = e.b[LINE[l].tf], x = bar ? LINE[l].v(bar) : null;
    const g = groups.get(LINE[l].tf) || []; g.push(x); groups.set(LINE[l].tf, g);
  }
  const sOn = swingLines.filter(m => show[m]), sv = swingAt(swing, sOn)(e.t);
  sOn.forEach((l, i) => { const g = groups.get(LINE[l].tf) || []; g.push(sv[i]); groups.set(LINE[l].tf, g); });
  return [...groups].map(([tf, xs]) => {
    const name = LABEL[tf] || `${tf}m`, have = xs.filter(ok);
    if (!have.length) return `<span class="mixed" style="opacity:.5" title="No value yet">${name} –</span>`;
    return have.every(x => x > 0) && have.length === xs.length ? `<span class="up">${name} ▲</span>`
      : have.every(x => x < 0) && have.length === xs.length ? `<span class="down">${name} ▼</span>` : `<span class="mixed">${name} ◆</span>`;
  }).join('');
}
window.NsbGate = { states, chips };
})();
