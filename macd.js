/* Nasdaq Signal Board: the MACD panes under a price chart, and the day separators, shared by both pages.

   Two panes: Entry (2m and 3m MACD, for timing) above Trend (1m, 5m, 7m, 9m, 11m and 15m; 5m, 9m and 11m are the
   gate's MACD rules), each Trend line with its own signal line, dashed in its color. Every line is drawn on the price
   chart's own candles, at its value as of each candle's close (never ahead of it; the forming candle live), so a pane
   lines up bar for bar with the chart above it and scrolls with it. Any line can be switched off from its pane's label;
   the choice is kept in this browser and shared by both pages. A page can pass shade(i), the state at candle i, to
   shade the panes by the gate (green LONG, red SHORT); without it a pane is shaded where the 10 stocks' MACDs and the
   index's MACDs agree on every line switched on in it. */
(() => {
'use strict';
const DAY = 86400000;
// origin: where each day's bars start, in ms after 00:00 UTC (a market's session open; 0 for the 24/7 perps)
const bucketEnd = (t, m, origin = 0) => { const d0 = t - ((t - origin) % DAY + DAY) % DAY, s = m * 60000; return Math.min(d0 + Math.floor((t - d0) / s) * s + s, d0 + DAY); };
const ok = v => v !== null && v !== undefined && isFinite(v);
const sgn = (v, d) => ok(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) : '—';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PANES = {
  entry: { title: 'Entry', lines: [2, 3] },
  trend: { title: 'Trend', lines: [1, 5, 7, 9, 11, 15], signals: true },
};
const LINES = [1, 2, 3, 5, 7, 9, 11, 15];  // every MACD drawn: the candle sizes the engine must provide
const COLOR = { 1: '#facc15', 2: '#fb7185', 3: '#22d3ee', 5: '#38bdf8', 7: '#c084fc', 9: '#2dd4bf', 11: '#a3e635', 15: '#f472b6' };
// Each wave has two colors of its own: one while its MACD is above 0, another while below, so its color changes where it
// crosses zero. No color repeats within a pane; the dashed signal lines are the wave's above-zero color, faded.
const PAIRS = {  // minutes -> [above 0, below 0]
  2: ['#fb7185', '#22c55e'],   // rose / green
  3: ['#22d3ee', '#eab308'],   // cyan / gold
  1: ['#facc15', '#8b5cf6'],   // yellow / violet
  5: ['#38bdf8', '#f97316'],   // sky / orange
  7: ['#c084fc', '#84cc16'],   // lilac / lime
  9: ['#2dd4bf', '#ef4444'],   // teal / red
  11: ['#e2e8f0', '#0369a1'],  // white / deep blue
  15: ['#f472b6', '#b45309'],  // pink / brown
};
const shades = lines => Object.fromEntries(lines.map(m => [m, PAIRS[m]]));
const faded = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;
const RULE = { 5: 'MACD vs 0, one of the gate\'s rules', 9: 'MACD vs 0, one of the gate\'s rules',
               11: 'MACD vs 0, one of the gate\'s rules' };
const MATCH = { BULLISH: 'rgba(43, 182, 138, 0.13)', BEARISH: 'rgba(240, 85, 95, 0.12)' };

// ---- which lines are on ------------------------------------------------------------------------------
const KEY = 'nsb.macd.show';
const show = Object.fromEntries([...LINES.map(m => [m, true]), ['sig', true]]);
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && typeof saved === 'object') for (const k in show) if (typeof saved[k] === 'boolean') show[k] = saved[k];
} catch (e) {}
const listeners = [];
function toggle(k) {
  show[k] = !show[k];
  try { localStorage.setItem(KEY, JSON.stringify(show)); } catch (e) {}
  for (const fn of listeners) fn(k);
}

// ---- each MACD at every candle's close ------------------------------------------------------------------
// bars: the price chart's candles (ms times), tf their size, src: { minutes: MACD bars } -> one point per candle
function points(bars, tf, src, lines, origin = 0) {
  const out = [], k = Object.fromEntries(lines.map(m => [m, -1]));
  for (let i = 0; i < bars.length; i++) {
    const end = bucketEnd(bars[i].time, tf, origin), v = {}, sg = {};
    for (const m of lines) {
      const a = src[m] || [];
      while (k[m] + 1 < a.length && bucketEnd(a[k[m] + 1].time, m, origin) <= end) k[m]++;
      const j = i === bars.length - 1 ? a.length - 1 : k[m];
      if (j >= 0 && ok(a[j].macd)) { v[m] = a[j].macd; sg[m] = a[j].signal; }
    }
    out.push({ time: Math.floor(bars[i].time / 1000), v, sg });
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
  updateAllViews() {
    const n = this.count(), ts = this.chart().timeScale(), bands = [];
    const x0 = n ? ts.logicalToCoordinate(0) : null, x1 = n ? ts.logicalToCoordinate(1) : null;
    if (x0 !== null && x1 !== null) {
      const step = x1 - x0, st = Array.from({ length: n }, (_, i) => this.state(i));
      for (let i = 0, j; i < n; i = j + 1) {
        for (j = i; j + 1 < n && st[j + 1] === st[i];) j++;
        if (st[i]) bands.push([x0 + (i - 0.5) * step, x0 + (j + 0.5) * step, st[i]]);
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

class DayLines {  // a dashed line where a new day begins in the viewer's timezone, with its date along the top
  constructor(chart, bars, labelTop) {  // labelTop: where the date goes (px from the top); null for no date
    this.chart = chart; this.bars = bars; this.top = labelTop; this.lines = [];
    this.views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: t => this.render(t) }) }];
  }
  attached({ requestUpdate }) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = null; }
  paneViews() { return this.views; }
  updateAllViews() {
    const bars = this.bars(), ts = this.chart().timeScale(), out = [];
    const x0 = bars.length > 1 ? ts.logicalToCoordinate(0) : null, x1 = bars.length > 1 ? ts.logicalToCoordinate(1) : null;
    if (x0 !== null && x1 !== null) {
      const step = x1 - x0, day = t => { const d = new Date(t); return d.getFullYear() * 512 + d.getMonth() * 32 + d.getDate(); };
      let prev = day(bars[0].time);
      for (let i = 1; i < bars.length; i++) {
        const k = day(bars[i].time);
        if (k === prev) continue;
        prev = k;
        const d = new Date(bars[i].time);
        out.push([x0 + (i - 0.5) * step, `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`]);
      }
    }
    this.lines = out;
  }
  render(target) {
    target.useBitmapCoordinateSpace(({ context: c, bitmapSize: size, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      c.save();
      c.strokeStyle = 'rgba(160, 172, 190, 0.38)'; c.lineWidth = Math.max(1, Math.round(hr));
      c.setLineDash([Math.round(4 * vr), Math.round(4 * vr)]);
      for (const [x] of this.lines) {
        const px = Math.round(x * hr) + 0.5;
        if (px < 0 || px > size.width) continue;
        c.beginPath(); c.moveTo(px, 0); c.lineTo(px, size.height); c.stroke();
      }
      c.setLineDash([]);
      if (this.top !== null) {
        c.font = `600 ${Math.round(10.5 * vr)}px "IBM Plex Sans", "Segoe UI", sans-serif`; c.textBaseline = 'top';
        for (const [x, text] of this.lines) {
          const px = Math.round(x * hr), w = c.measureText(text).width, pad = Math.round(5 * hr), y = Math.round(this.top * vr);
          if (px < 0 || px + 3 * hr + w + 2 * pad > size.width) continue;
          c.fillStyle = 'rgba(10, 13, 18, 0.85)'; c.fillRect(px + Math.round(3 * hr), y, w + 2 * pad, Math.round(16 * vr));
          c.fillStyle = '#c3ccd8'; c.fillText(text, px + Math.round(3 * hr) + pad, y + Math.round(3 * vr));
        }
      }
      c.restore();
    });
  }
}

// ---- one MACD pane ----------------------------------------------------------------------------------------
// opts: el and tagEl (the pane and its label), kind ('trend' or 'entry'), name (shown first in the label), digits,
// options (chart options), bars() and tf() (the price chart's candles and their size), src() ({ minutes: MACD bars }
// of the series drawn), and for the shading either match() -> [stocks' points, index's points] or stocks() (the
// stocks' MACD bars; the series drawn is then the index)
class MacdPane {
  constructor(opts) {
    Object.assign(this, opts);
    this.lines = PANES[this.kind].lines;
    this.pts = []; this.stockPts = []; this.store = new Map();
    const fine = { type: 'price', precision: this.digits, minMove: 10 ** -this.digits };
    const chart = this.chart = LightweightCharts.createChart(this.el, this.options);
    const line = (color, extra) => chart.addLineSeries({ color, lineWidth: 2, priceFormat: fine, priceLineVisible: false,
                                                         crosshairMarkerVisible: false, ...extra });
    // the zero line as a series of its own (0 at every candle): always shown whichever lines are off, and it carries
    // the shading and day lines, which a hidden series would take with it
    this.zero = line('#6b778a', { lineWidth: 1, lastValueVisible: false });
    this.series = {};
    this.shade2 = shades(this.lines);
    for (const m of this.lines) this.series[m] = line(this.shade2[m][0], { lineWidth: m === 1 ? 1 : 2 });
    this.sigs = {};  // each line's signal line (Trend only): dashed, in the line's color
    if (PANES[this.kind].signals) for (const m of this.lines)
      this.sigs[m] = line(faded(PAIRS[m][0], 0.55), { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, lastValueVisible: false });
    this.zero.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0.06 } });
    this.shading = new Bands(() => chart, () => this.pts.length, i => {
      if (this.shade) return MATCH[this.shade(i)] || null;  // the page's state at candle i: the gate
      const [a, b] = this.pair();
      return MATCH[matchAt(a[i], b[i], this.lines)] || null;
    });
    this.zero.attachPrimitive(this.shading);
    this.zero.attachPrimitive(new DayLines(() => chart, this.bars, null));
    this.tagEl.addEventListener('pointerdown', e => {  // the label's names are switches
      const b = e.target.closest('[data-k]');
      if (b) { e.preventDefault(); e.stopPropagation(); toggle(b.dataset.k); }
    });
    this.showLines();
  }
  pair() { return this.match ? this.match() : [this.stockPts, this.pts]; }
  showLines() {
    for (const m of this.lines) this.series[m].applyOptions({ visible: show[m] });
    for (const m in this.sigs) this.sigs[m].applyOptions({ visible: show[m] && show.sig });  // a hidden line takes its signal with it
    this.shading.update();
  }
  // Redraw from the latest bars, or only move the newest points when that's all that changed. True when it redrew
  // everything (the caller then lines the pane up with the price chart again).
  update() {
    if (this.stocks) this.stockPts = points(this.bars(), this.tf(), this.stocks(), this.lines, this.origin || 0);
    const pts = points(this.bars(), this.tf(), this.src(), this.lines, this.origin || 0), old = this.pts, n = pts.length, k = old.length;
    const same = (a, b) => a.time === b.time && this.lines.every(m => a.v[m] === b.v[m] && a.sg[m] === b.sg[m]);
    let i = 0;
    while (i < n && i < k && same(pts[i], old[i])) i++;
    this.shading.update();
    if (i === n && n === k) return false;
    this.pts = pts;
    const pt = (p, value) => value === undefined ? { time: p.time } : { time: p.time, value };  // blank, but the candle keeps its slot
    const wave = (p, m) => { const v = p.v[m]; return v === undefined ? { time: p.time } : { time: p.time, value: v, color: this.shade2[m][v >= 0 ? 0 : 1] }; };
    const put = p => { if (this.lines.some(m => p.v[m] !== undefined)) this.store.set(p.time, p); };
    if (k && n >= k && n <= k + 1 && i >= k - 1 && pts[k - 1].time === old[k - 1].time) {
      for (let j = k - 1; j < n; j++) {
        const p = pts[j];
        for (const m of this.lines) this.series[m].update(wave(p, m));
        for (const m in this.sigs) this.sigs[m].update(pt(p, p.sg[m]));
        this.zero.update({ time: p.time, value: 0 });
        put(p);
      }
      return false;
    }
    for (const m of this.lines) this.series[m].setData(pts.map(p => wave(p, m)));
    for (const m in this.sigs) this.sigs[m].setData(pts.map(p => pt(p, p.sg[m])));
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
    const q = t === undefined ? this.pts[this.pts.length - 1] : this.store.get(t);
    if (!q) return;
    const v = q.v, d = this.digits;
    const item = m => {
      const pass = v[m] > 0;  // the dot: above or below zero, as the gate tests
      const tip = `${m}m MACD (left color above 0, right color below)${RULE[m] ? `: ${RULE[m]}` : ' (not in the gate)'}. Click to ${show[m] ? 'hide' : 'show'}`;
      return `<span class="t-mm${show[m] ? '' : ' off'}" data-k="${m}" title="${tip}"><span class="sw" style="background:linear-gradient(90deg, ${this.shade2[m][0]} 50%, ${this.shade2[m][1]} 50%)"></span><b>${m}m</b>`
        + `<span class="t-dot ${ok(v[m]) ? (pass ? 'pass' : 'fail') : ''}"></span>`
        + `<span class="t-v">${this.sigs[m] ? `${sgn(v[m], d)} / ${sgn(q.sg[m], d)}` : sgn(v[m], d)}</span></span>`;
    };
    this.tagEl.innerHTML = `<span class="t-name">${this.name} <b>${PANES[this.kind].title}</b></span>` + this.lines.map(item).join('')
      + (Object.keys(this.sigs).length ? `<span class="t-mm${show.sig ? '' : ' off'}" data-k="sig" title="Every line's signal line (dashed, in its color). Click to ${show.sig ? 'hide' : 'show'} them">`
                  + `<span class="sw dash"></span><span class="t-of">signals</span></span>` : '');
  }
}

// the panes' labels look the same on both pages (the page styles .tag itself: its place and background)
const css = document.createElement('style');
css.textContent = `
  .tag.mix { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 5px; white-space: normal; max-width: calc(100% - 80px);
             padding: 2px 4px; font: 11px var(--font-ui); }
  .tag.mix .t-name { color: var(--muted); padding: 0 4px 0 2px; white-space: nowrap; }
  .tag.mix .t-name b { color: var(--text); font-weight: 600; }
  .tag.mix .t-mm { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 5px; white-space: nowrap;
                   box-shadow: inset 0 0 0 1px var(--line-strong); pointer-events: auto; cursor: pointer;
                   user-select: none; -webkit-user-select: none; touch-action: manipulation; }
  .tag.mix .t-mm:hover { background: rgba(255, 255, 255, .06); }
  .tag.mix .t-mm b { color: var(--text); font: 600 11px var(--font-num); }
  .tag.mix .t-mm .sw { width: 11px; height: 3px; border-radius: 2px; display: inline-block; }
  .tag.mix .t-mm .sw.dash { background: none !important; border-top: 2px dashed var(--muted); height: 0; }
  .tag.mix .t-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); display: inline-block; }
  .tag.mix .t-dot.pass { background: var(--up); } .tag.mix .t-dot.fail { background: var(--down); }
  .tag.mix .t-v { display: none; font-family: var(--font-num); color: var(--text); }
  .hovering .tag.mix .t-v { display: inline; }
  .tag.mix .t-of { color: var(--muted); }
  .tag.mix .t-mm.off { opacity: .45; box-shadow: inset 0 0 0 1px var(--line); }
  .tag.mix .t-mm.off .sw { background: transparent !important; box-shadow: inset 0 0 0 1px var(--faint); }
  .tag.mix .t-mm.off .t-v, .tag.mix .t-mm.off .t-dot { display: none; }
`;
document.head.appendChild(css);

window.NsbMacd = { PANES, LINES, COLOR, MacdPane, DayLines, Bands, show, toggle, onToggle: fn => listeners.push(fn), points, matchAt };
})();
