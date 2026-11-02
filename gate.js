/* Indra Quant Signal Board: the gate from the lines switched on (owner 1/11/2026, through VPS Work: "the switching on and
   off should exactly work and reflect on the shading area as our trend" ... "gate as well").

   At each minute's close, from the bars CLOSED by then (as the engine's gate, "candle close"):
     LONG (BULLISH)     every Trend line switched on (5m, 9m, 11m: EMA 8 − EMA 47, EMA 21 − EMA 47) and every Swing line
                        switched on that has a value yet (1h, 4h, 1D; 1W and 1M where the chart draws them) above 0
     SHORT (BEARISH)    every one of them below 0
     NO TRADE (NEUTRAL) anything else; also when no line is switched on, or a Trend line switched on has no value yet
   A line switched off counts for nothing, at once. With every Trend line on and the Swing lines off it is exactly the
   engine's RDX WIP gate (its "5m EMA21 vs EMA47" is the 5m 21/47 line). Your stocks (two or more picked): each stock's own
   Trend lines decide its own gate and they must all agree, as the engine's; the Swing lines are the composite's.
     NsbGate.states(sig, swing, swingLines, own) -> Map(minute ms -> 'BULLISH' | 'BEARISH' | 'NEUTRAL'), the minutes the
                                                 engine's sig has run (its trace); worked out again after a switch. own:
                                                 the series' own lines only (Your stocks' shading: its own waves, not every
                                                 stock's agreement; for one market the same as the gate)
     NsbGate.chips(sig, swing, swingLines, t) -> the header's chips at minute t: one per timeframe with a line on, ▲ all
                                                 its lines on above 0, ▼ all below, ◆ mixed (the composite's own lines)
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
const LABEL = { 5: '5m', 9: '9m', 11: '11m', 60: '1h', 240: '4h', 1440: '1D', 10080: '1W', 43200: '1M' };

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
const cache = new WeakMap(), ownCache = new WeakMap();
// own: the series' own lines only, even for Your stocks (the shading of the composite's chart, as before 2/11/2026: its own
// waves, not every stock's agreement; for one market it is the gate itself)
function states(sig, swing, swingLines = PANES.swing.lines, own = false) {
  if (!sig || !sig.trace) return new Map();
  const store = own ? ownCache : cache;
  const key = `${ver}|${swingLines.join()}`, have = store.get(sig);
  if (have && have.key === key && have.swing === swing && have.n === sig.trace.length && have.last === (sig.trace[sig.trace.length - 1] || {}).t) return have.map;
  const tOn = PANES.trend.lines.filter(m => show[m]), sOn = swingLines.filter(m => show[m]);
  const sw = swingAt(swing, sOn);
  // two or more stocks: each one's own Trend gate by minute (they must all agree)
  const parts = sig.parts && !own ? Object.values(sig.parts).map(p => new Map((p.trace || []).map(e => [e.t, e.state === null ? null : e.b]))) : null;
  const map = new Map();
  for (const e of sig.trace) {
    if (e.state === null) continue;  // the engine not warmed up yet: no gate
    let dir = null, counted = 0;     // dir: 1 / -1 so far, 0: they disagree
    if (tOn.length) {
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
      counted += 1;
    }
    if (dir !== 0 && sOn.length) {
      for (const x of sw(e.t)) {
        if (x === null) continue;  // a Swing line with no value yet (a young market's month): not counted
        const d = x > 0 ? 1 : x < 0 ? -1 : 0;
        dir = dir === null ? d : dir === d ? d : 0;
        counted += 1;
        if (!dir) break;
      }
    }
    map.set(e.t, counted && dir === 1 ? 'BULLISH' : counted && dir === -1 ? 'BEARISH' : 'NEUTRAL');
  }
  store.set(sig, { key, swing, n: sig.trace.length, last: (sig.trace[sig.trace.length - 1] || {}).t, map });
  return map;
}
// the header's chips at minute t (the series' own lines; Your stocks: the composite's), one per timeframe with a line on
function chips(sig, swing, swingLines = PANES.swing.lines, t) {
  if (!sig || !sig.trace || !sig.trace.length) return '';
  let e = null;
  for (let i = sig.trace.length - 1; i >= 0; i--) if (sig.trace[i].t <= t) { e = sig.trace[i]; break; }
  if (!e) return '';
  const groups = new Map();
  for (const l of PANES.trend.lines.filter(m => show[m])) {
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
