/* Nasdaq Signal Board: the indicators both pages draw. The MACD panes under a price chart, the EMA stack on it, and
   the day separators.

   Two panes: Trend (5m, 7m, 9m, 11m and 15m MACD; 5m, 7m and 15m are the signal's rules) and Entry (1m, 2m and 3m,
   for timing). Every line is drawn on the price chart's own candles, at its value as of each candle's close (never
   ahead of it; the forming candle live), so a pane lines up bar for bar with the chart above it and scrolls with it.
   Any line can be switched off from its pane's label; the choice is kept in this browser and shared by both pages.
   Each pane is shaded where the 10 stocks' MACDs and the index's MACDs agree on every line switched on in it: green
   when all of them are above zero for both, red when all are below zero for both.

   The EMA stack: EMA 8, 21, 34, 55 and 89 of the price chart's own candles. Stacked bullish when each is above the next
   (8 > 21 > 34 > 55 > 89), bearish when each is below; anything else is mixed. Each EMA can be switched off too. */
(() => {
'use strict';
const DAY = 86400000;
const bucketEnd = (t, m) => { const d0 = t - (t % DAY), s = m * 60000; return Math.min(d0 + Math.floor((t - d0) / s) * s + s, d0 + DAY); };
const ok = v => v !== null && v !== undefined && isFinite(v);
const sgn = (v, d) => ok(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) : '—';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PANES = {
  trend: { title: 'Trend', lines: [5, 7, 9, 11, 15] },
  entry: { title: 'Entry', lines: [1, 2, 3] },
};
const LINES = [1, 2, 3, 5, 7, 9, 11, 15];  // every MACD drawn: the candle sizes the engine must provide
const COLOR = { 1: '#facc15', 2: '#fb7185', 3: '#22d3ee', 5: '#38bdf8', 7: '#c084fc', 9: '#2dd4bf', 11: '#a3e635', 15: '#f472b6',
                sig: 'rgba(244, 114, 182, 0.6)' };
const RULE = { 5: 'MACD vs 0, one of the signal\'s rules', 7: 'MACD vs 0, one of the signal\'s rules',
               15: 'MACD vs its signal line, one of the signal\'s rules' };
const STACK = [8, 21, 34, 55, 89];
const STACK_COLOR = { 8: '#fae8ff', 21: '#f0abfc', 34: '#e879f9', 55: '#c084fc', 89: '#9333ea' };
const MATCH = { BULLISH: 'rgba(43, 182, 138, 0.13)', BEARISH: 'rgba(240, 85, 95, 0.12)' };

// ---- which lines are on ------------------------------------------------------------------------------
const KEY = 'nsb.macd.show';
const show = Object.fromEntries([...LINES.map(m => [m, true]), ['sig', true], ...STACK.map(n => ['s' + n, true]), ['rule', true]]);
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && typeof saved === 'object') for (const k in show) if (typeof saved[k] === 'boolean') show[k] = saved[k];
} catch (e) {}
const listeners = [];
function chips(el) {  // a label whose names switch lines: one listener for all its chips, however often it is redrawn
  el.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-k]');
    if (b) { e.preventDefault(); e.stopPropagation(); toggle(b.dataset.k); }
  });
}
function toggle(k) {
  show[k] = !show[k];
  try { localStorage.setItem(KEY, JSON.stringify(show)); } catch (e) {}
  for (const fn of listeners) fn(k);
}

// ---- each MACD at every candle's close ------------------------------------------------------------------
// bars: the price chart's candles (ms times), tf their size, src: { minutes: MACD bars } -> one point per candle
function points(bars, tf, src, lines) {
  const out = [], k = Object.fromEntries(lines.map(m => [m, -1]));
  for (let i = 0; i < bars.length; i++) {
    const end = bucketEnd(bars[i].time, tf), v = {};
    let sig;
    for (const m of lines) {
      const a = src[m] || [];
      while (k[m] + 1 < a.length && bucketEnd(a[k[m] + 1].time, m) <= end) k[m]++;
      const j = i === bars.length - 1 ? a.length - 1 : k[m];
      if (j >= 0 && ok(a[j].macd)) { v[m] = a[j].macd; if (m === 15) sig = a[j].signal; }
    }
    out.push({ time: Math.floor(bars[i].time / 1000), v, sig });
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
    for (const m of this.lines) this.series[m] = line(COLOR[m], { lineWidth: m === 1 ? 1 : 2, lastValueVisible: false });  // values: in the label
    this.sig = this.lines.includes(15) ? line(COLOR.sig, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, lastValueVisible: false }) : null;
    this.zero.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0.06 } });
    this.shading = new Bands(() => chart, () => this.pts.length, i => {
      const [a, b] = this.pair();
      return MATCH[matchAt(a[i], b[i], this.lines)] || null;
    });
    this.zero.attachPrimitive(this.shading);
    this.zero.attachPrimitive(new DayLines(() => chart, this.bars, null));
    chips(this.tagEl);
    this.showLines();
  }
  pair() { return this.match ? this.match() : [this.stockPts, this.pts]; }
  showLines() {
    for (const m of this.lines) this.series[m].applyOptions({ visible: show[m] });
    if (this.sig) this.sig.applyOptions({ visible: show.sig });
    this.shading.update();
  }
  // Redraw from the latest bars, or only move the newest points when that's all that changed. True when it redrew
  // everything (the caller then lines the pane up with the price chart again).
  update() {
    if (this.stocks) this.stockPts = points(this.bars(), this.tf(), this.stocks(), this.lines);
    const pts = points(this.bars(), this.tf(), this.src(), this.lines), old = this.pts, n = pts.length, k = old.length;
    const same = (a, b) => a.time === b.time && a.sig === b.sig && this.lines.every(m => a.v[m] === b.v[m]);
    let i = 0;
    while (i < n && i < k && same(pts[i], old[i])) i++;
    this.shading.update();
    if (i === n && n === k) return false;
    this.pts = pts;
    const pt = (p, value) => value === undefined ? { time: p.time } : { time: p.time, value };  // blank, but the candle keeps its slot
    const put = p => { if (this.lines.some(m => p.v[m] !== undefined)) this.store.set(p.time, p); };
    if (k && n >= k && n <= k + 1 && i >= k - 1 && pts[k - 1].time === old[k - 1].time) {
      for (let j = k - 1; j < n; j++) {
        const p = pts[j];
        for (const m of this.lines) this.series[m].update(pt(p, p.v[m]));
        if (this.sig) this.sig.update(pt(p, p.sig));
        this.zero.update({ time: p.time, value: 0 });
        put(p);
      }
      return false;
    }
    for (const m of this.lines) this.series[m].setData(pts.map(p => pt(p, p.v[m])));
    if (this.sig) this.sig.setData(pts.map(p => pt(p, p.sig)));
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
  tag(t) {  // the label: the pane's name, then one switch per line with its value (live, or at the candle hovered)
    const q = t === undefined ? this.pts[this.pts.length - 1] : this.store.get(t);
    if (!q) return;
    const v = q.v, d = this.digits, rules = this.lines.filter(m => RULE[m]), more = this.lines.filter(m => !RULE[m]);
    const chip = m => {
      const pass = m === 15 ? v[m] > q.sig : v[m] > 0, has = ok(v[m]);
      const tip = `${m}m MACD${RULE[m] ? `: ${RULE[m]}` : ' (not part of the signal)'}. Click to ${show[m] ? 'hide' : 'show'} it`;
      return `<span class="t-mm${show[m] ? '' : ' off'}" data-k="${m}" title="${tip}"><span class="sw" style="background:${COLOR[m]}"></span>`
        + `<b>${m}m</b><span class="t-v ${has ? (pass ? 'up' : 'down') : ''}">${sgn(v[m], d)}</span></span>`;
    };
    const shading = 'Shading: green where the stocks\' and the index\'s MACDs are all above zero, red where all are below zero, '
      + 'counting only the lines switched on in this pane';
    let html = `<span class="t-name" title="${this.kind === 'trend' ? 'Trend MACD (12/26/9)' : 'Entry MACD (12/26/9), for timing'}. ${shading}">`
      + `${PANES[this.kind].title}<small>${this.name}</small></span>`;
    if (rules.length) html += '<span class="t-group" title="The signal\'s MACD rules">rules</span>' + rules.map(chip).join('');
    if (more.length) html += `<span class="t-group">${rules.length ? 'more' : 'timing'}</span>` + more.map(chip).join('');
    if (this.sig) html += `<span class="t-mm${show.sig ? '' : ' off'}" data-k="sig" title="The 15m signal line (dashed). Click to ${show.sig ? 'hide' : 'show'} it">`
      + `<span class="sw dash"></span><b>sig</b><span class="t-v">${sgn(q.sig, d)}</span></span>`;
    this.tagEl.innerHTML = html + `<span class="t-info" title="${shading}">?</span>`;
  }
}

// ---- the EMA stack on a price chart ----------------------------------------------------------------------
// opts: chart (the price chart), bars() (its candles, ms times), tf() (their size)
class EmaStack {
  constructor(opts) {
    Object.assign(this, opts);
    this.pts = []; this.store = new Map(); this.series = {};
    for (const n of STACK) this.series[n] = this.chart.addLineSeries({ color: STACK_COLOR[n], lineWidth: n === 8 ? 1 : 2,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.showLines();
  }
  showLines() { for (const n of STACK) this.series[n].applyOptions({ visible: show['s' + n] }); }
  compute() {  // each EMA of the candles' closes (the forming candle's live close last); blank until it has `n` candles
    const bars = this.bars(), out = bars.map(b => ({ time: Math.floor(b.time / 1000), e: {} }));
    for (const n of STACK) {
      const a = 2 / (n + 1);
      let v = null;
      for (let i = 0; i < bars.length; i++) {
        v = v === null ? bars[i].close : v + a * (bars[i].close - v);
        if (i >= n - 1) out[i].e[n] = v;
      }
    }
    return out;
  }
  update() {  // redraw, or move only the newest points when that's all that changed
    const pts = this.compute(), old = this.pts, n = pts.length, k = old.length;
    this.pts = pts;
    const pt = (p, value) => value === undefined ? { time: p.time } : { time: p.time, value };
    const sameBefore = k < 2 || (pts[k - 2].time === old[k - 2].time && STACK.every(m => pts[k - 2].e[m] === old[k - 2].e[m]));
    if (k && (n === k || n === k + 1) && pts[k - 1].time === old[k - 1].time && sameBefore) {
      for (let j = k - 1; j < n; j++) { for (const m of STACK) this.series[m].update(pt(pts[j], pts[j].e[m])); this.store.set(pts[j].time, pts[j]); }
      return;
    }
    for (const m of STACK) this.series[m].setData(pts.map(p => pt(p, p.e[m])));
    this.store.clear();
    for (const p of pts) this.store.set(p.time, p);
  }
  state(p) {  // 'BULL', 'BEAR' or 'MIXED' at point p, over the EMAs switched on
    const on = STACK.filter(n => show['s' + n]).map(n => p && p.e[n]);
    if (on.length < 2 || on.some(x => !ok(x))) return null;
    if (on.every((x, i) => i === 0 || on[i - 1] > x)) return 'BULL';
    if (on.every((x, i) => i === 0 || on[i - 1] < x)) return 'BEAR';
    return 'MIXED';
  }
  label(t) {  // one row of the price chart's label: the stack's state, then a switch per EMA (values while hovering)
    const p = t === undefined ? this.pts[this.pts.length - 1] : this.store.get(t), st = this.state(p);
    const word = { BULL: 'BULL STACK', BEAR: 'BEAR STACK', MIXED: 'MIXED' }[st] || '…';
    return `<span class="t-row"><span class="t-name" title="EMA 8, 21, 34, 55 and 89 of these ${this.tf()}m candles. Bull stack: each above the next; `
      + `bear stack: each below the next; counting only the EMAs switched on">EMA stack<small>${this.tf()}m</small></span>`
      + `<span class="t-badge ${(st || '').toLowerCase()}">${word}</span>`
      + STACK.map(n => `<span class="t-mm${show['s' + n] ? '' : ' off'}" data-k="s${n}" title="EMA ${n}. Click to ${show['s' + n] ? 'hide' : 'show'} it">`
        + `<span class="sw" style="background:${STACK_COLOR[n]}"></span><b>${n}</b>`
        + `<span class="t-v t-hv">${p && ok(p.e[n]) ? p.e[n].toFixed(1) : '—'}</span></span>`).join('')
      + '</span>';
  }
}
// the 3m EMA 8 / EMA 21 pair the signal's 3m rule tests, as one switch; gap = EMA 8 minus EMA 21
function ruleChip(gap, digits, of) {
  return `<span class="t-row"><span class="t-mm${show.rule ? '' : ' off'}" data-k="rule" title="The 3m EMA 8 (amber) and EMA 21 (blue) that the signal's 3m rule tests`
    + `${of ? `, of ${of}, scaled onto XYZ100's price` : ''}; the number is EMA 8 minus EMA 21. Click to ${show.rule ? 'hide' : 'show'} them">`
    + '<span class="sw" style="background:#f2b33d"></span><span class="sw" style="background:#5b8cff"></span>'
    + `<b>3m EMA 8/21</b>${of ? `<span class="t-of">${of}</span>` : ''}`
    + `<span class="t-v ${ok(gap) ? (gap > 0 ? 'up' : 'down') : ''}">${sgn(gap, digits)}</span></span>`
    + '<span class="t-group">signal rule</span></span>';
}

// the panes' labels look the same on both pages (the page styles .tag itself: its place and background)
const css = document.createElement('style');
css.textContent = `
  .tag.mix { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 4px; white-space: normal; max-width: calc(100% - 70px);
             padding: 3px 5px; font: 11px var(--font-ui); }
  .tag .t-row { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 3px 4px; margin-top: 3px; font: 11px var(--font-ui); }
  .tag .t-name { display: inline-flex; align-items: baseline; gap: 5px; margin-right: 4px; color: var(--text); font: 700 10.5px var(--font-ui);
                 letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; pointer-events: auto; cursor: help; }
  .tag .t-name small { color: var(--muted); font-weight: 500; letter-spacing: .02em; text-transform: none; font-size: 10.5px; }
  .tag .t-group { color: var(--faint); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; margin: 0 1px 0 5px; white-space: nowrap; }
  .tag .t-mm { display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px 1px 6px; border-radius: 5px; white-space: nowrap;
               background: rgba(255, 255, 255, .03); box-shadow: inset 0 0 0 1px var(--line-strong); pointer-events: auto; cursor: pointer;
               user-select: none; -webkit-user-select: none; touch-action: manipulation; }
  .tag .t-mm:hover { background: rgba(255, 255, 255, .08); }
  .tag .t-mm b { color: var(--text); font: 600 11px var(--font-num); }
  .tag .t-mm .sw { width: 12px; height: 3px; border-radius: 2px; display: inline-block; flex: none; }
  .tag .t-mm .sw + .sw { margin-left: -2px; }
  .tag .t-mm .sw.dash { background: none !important; border-top: 2px dashed #f472b6; height: 0; }
  .tag .t-mm .t-v { font: 500 11px var(--font-num); color: var(--muted); }
  .tag .t-mm .t-v.up { color: var(--up); } .tag .t-mm .t-v.down { color: var(--down); }
  .tag .t-mm .t-v.t-hv { display: none; color: var(--text); }
  .hovering .tag .t-mm .t-v.t-hv { display: inline; }
  .tag .t-mm .t-of { color: var(--faint); font-size: 10.5px; }
  .tag .t-mm.off { opacity: .4; background: none; box-shadow: inset 0 0 0 1px var(--line); }
  .tag .t-mm.off b { text-decoration: line-through; text-decoration-color: var(--faint); }
  .tag .t-mm.off .sw { background: transparent !important; box-shadow: inset 0 0 0 1px var(--faint); }
  .tag .t-mm.off .t-v { display: none !important; }
  .tag .t-badge { padding: 1px 7px; border-radius: 5px; font: 700 10px var(--font-ui); letter-spacing: .08em; color: var(--muted);
                  box-shadow: inset 0 0 0 1px var(--line-strong); white-space: nowrap; }
  .tag .t-badge.bull { color: #04150f; background: var(--up); box-shadow: none; }
  .tag .t-badge.bear { color: #1e0507; background: var(--down); box-shadow: none; }
  .tag .t-info { display: inline-grid; place-items: center; width: 15px; height: 15px; margin-left: 2px; border-radius: 50%; color: var(--muted);
                 box-shadow: inset 0 0 0 1px var(--line-strong); font: 600 10px var(--font-ui); pointer-events: auto; cursor: help; }
`;
document.head.appendChild(css);

window.NsbMacd = { PANES, LINES, COLOR, STACK, MacdPane, EmaStack, DayLines, Bands, show, toggle, chips, ruleChip,
                   onToggle: fn => listeners.push(fn), points, matchAt };
})();
