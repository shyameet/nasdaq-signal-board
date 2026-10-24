// Drawing tools on every chart page (owner 24/10/2026: "few tools like vertical line and horizontal line and measuring
// tool, that's it", in a sidebar that opens and closes for more space). A drawing made on one chart shows on every price
// chart of the page, like TradingView's synced layouts: a time copies as it is; a price keeps the same % distance from
// that chart's own price at the drawing's time, because the charts beside each other are different instruments at
// different prices. Saved in this browser, per page. Also: while the chart is dragged, the crosshair keeps following
// the mouse (the chart library freezes it during a drag).
//
// A page calls NsbDraw.setup({ key, when }) once, NsbDraw.add(spec) for each price chart and NsbDraw.use(key) to switch
// to another set of drawings (India and Commodities keep one per setup). spec = { id (the instrument), chart, series
// (the candles), el (the chart's element), bars() (its candles, times in ms), tf() (candle minutes), fmt(price),
// active() (false: shows the drawings but can't draw, like the small tiles) }.
(function () {
  const INK = '#a78bfa', INK_TAG = '#7457d6', DOWN = '#f0555f', BG = '#0a0d12';
  const ok = v => typeof v === 'number' && isFinite(v);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const copy = v => JSON.parse(JSON.stringify(v));
  const charts = [];
  const S = { key: null, when: ms => new Date(ms).toLocaleString(), tool: null, items: [], sel: null, hover: null,
              temp: null, tempChart: null, measure: null, gesture: null, press: false, pan: null, undo: [] };

  // ---- time <-> candle position, and the price of a chart at a time ----
  function indexAt(bars, tf, t) {  // fractional candle position of time t (extrapolated past either end)
    const n = bars.length, step = tf * 60000;
    if (t <= bars[0].time) return (t - bars[0].time) / step;
    if (t >= bars[n - 1].time) return n - 1 + (t - bars[n - 1].time) / step;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) lo = mid; else hi = mid; }
    return lo + (t - bars[lo].time) / (bars[hi].time - bars[lo].time);
  }
  function timeAt(bars, tf, x) {
    const n = bars.length, step = tf * 60000;
    if (x <= 0) return bars[0].time + x * step;
    if (x >= n - 1) return bars[n - 1].time + (x - n + 1) * step;
    const i = Math.floor(x);
    return bars[i].time + (x - i) * (bars[i + 1].time - bars[i].time);
  }
  function closeAt(c, t) {  // chart c's price at time t: the close of its candle then (the first open before its data)
    const bars = c.bars();
    if (!bars.length) return null;
    if (t < bars[0].time) return bars[0].open;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].time <= t) lo = mid; else hi = mid - 1; }
    return bars[lo].close;
  }
  const point = (c, t, p) => ({ t, p, r: closeAt(c, t) });  // a point drawn on chart c, with c's price at that time
  function priceOn(c, q, src) {  // where point q, drawn on chart `src`, sits on chart c: the same % from c's price
    if (!q || !ok(q.p)) return null;
    if (src === c.id) return q.p;
    const here = closeAt(c, q.t);
    return ok(here) && q.r > 0 ? here * q.p / q.r : null;
  }
  function map(c) {  // chart c's mapping between the screen and (time, price); null while it has no candles
    const bars = c.bars(), ts = c.chart.timeScale();
    if (!bars.length) return null;
    const x0 = ts.logicalToCoordinate(0), x1 = ts.logicalToCoordinate(1);
    if (x0 === null || x1 === null || x1 === x0) return null;
    const step = x1 - x0, tf = c.tf();
    return { w: ts.width(), h: c.el.clientHeight - ts.height(), bars, tf,
             x: t => x0 + indexAt(bars, tf, t) * step, y: v => ok(v) ? c.series.priceToCoordinate(v) : null,
             index: x => (x - x0) / step, price: y => c.series.coordinateToPrice(y) };
  }
  function at(c, m, x, y) {  // the point under (x, y) on chart c, its time on the nearest candle
    const p = m.price(y);
    return ok(p) ? point(c, timeAt(m.bars, m.tf, Math.round(m.index(x))), p) : null;
  }
  function shape(c, m, d) {  // drawing d on chart c's screen
    if (d.type === 'vline') return { x: m.x(d.a.t) };
    const y1 = m.y(priceOn(c, d.a, d.src));
    if (y1 === null) return null;
    if (d.type === 'hline') return { y: y1 };
    const y2 = m.y(priceOn(c, d.b, d.src));
    return y2 === null ? null : { x1: m.x(d.a.t), y1, x2: m.x(d.b.t), y2 };
  }
  function hit(c, m, x, y) {  // the line under (x, y): the selected one first, then the newest
    const sel = S.items.find(d => d.id === S.sel);
    for (const d of [sel, ...S.items.slice().reverse()]) {
      const s = d && shape(c, m, d);
      if (!s) continue;
      if (d.type === 'hline' ? Math.abs(s.y - y) <= 5 : Math.abs(s.x - x) <= 5) return d;
    }
    return null;
  }
  const lasting = ms => { const all = Math.round(ms / 60000), d = Math.floor(all / 1440), h = Math.floor(all % 1440 / 60), mm = all % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; };
  const axisTag = (at, text) => ({ coordinate: () => at, text: () => text, textColor: () => '#ffffff', backColor: () => INK_TAG,
                                   visible: () => true, tickVisible: () => true });

  class Layer {  // the drawings on one chart (a Lightweight Charts series primitive)
    constructor(c) {
      this.c = c; this.m = null; this.shapes = []; this.prices = []; this.times = [];
      this.views = [{ zOrder: () => 'top', renderer: () => ({ draw: target => this.render(target) }) }];
    }
    attached({ requestUpdate }) { this.requestUpdate = requestUpdate; }
    detached() { this.requestUpdate = null; }
    paneViews() { return this.views; }
    priceAxisViews() { return this.prices; }
    timeAxisViews() { return this.times; }
    hitTest(x, y) {  // the chart asks on every mouse move; the answer sets the mouse cursor
      if (this.c.pane || !this.c.active()) return null;
      let cursor = null;
      if (S.gesture) cursor = S.gesture.kind === 'drag' ? 'grabbing' : 'crosshair';
      else if (S.tool || S.temp) cursor = 'crosshair';
      else {
        const m = map(this.c), d = m && hit(this.c, m, x, y), id = d ? d.id : null;
        if (id !== S.hover) { S.hover = id; queueMicrotask(redraw); }
        if (d) cursor = d.type === 'hline' ? 'ns-resize' : 'ew-resize';
      }
      return cursor && { cursorStyle: cursor, externalId: 'drawing', zOrder: 'top' };
    }
    updateAllViews() {
      const c = this.c, m = map(c), shapes = [], prices = [], times = [];
      this.m = m; this.shapes = shapes; this.prices = prices; this.times = times;  // new arrays: the chart re-reads the tags
      if (!m) return;
      const priceTag = v => { const y = m.y(v); if (y !== null) prices.push(axisTag(y, c.fmt(v))); };
      const timeTag = t => times.push(axisTag(m.x(t), S.when(t)));
      const all = S.items.map(d => ({ d, sel: d.id === S.sel, hover: d.id === S.hover }));
      if (S.temp) all.push({ d: S.temp });
      if (S.measure) all.push({ d: S.measure });
      for (const it of all) {
        if (c.pane && it.d.type !== 'vline') continue;  // a pane under a chart shows its vertical lines only
        const s = shape(c, m, it.d), d = it.d;
        if (!s) continue;
        shapes.push({ ...it, s });
        if (d.type === 'hline') priceTag(priceOn(c, d.a, d.src));
        else if (d.type === 'vline') { if (!c.pane) timeTag(d.a.t); }
        else { priceTag(priceOn(c, d.a, d.src)); priceTag(priceOn(c, d.b, d.src)); timeTag(d.a.t); timeTag(d.b.t); }
      }
    }
    render(target) {
      const c = this.c, m = this.m;
      if (!m || !this.shapes.length) return;
      target.useBitmapCoordinateSpace(({ context: g, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
        const W = bitmapSize.width, H = bitmapSize.height, X = x => x * hr, Y = y => y * vr;
        const px = w => Math.max(1, Math.round(w * hr));
        const crisp = (v, r, w) => Math.round(v * r) + (w % 2 ? 0.5 : 0);  // thin straight lines on whole pixels stay sharp
        const seg = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
        const handle = (x, y) => { g.beginPath(); g.arc(X(x), Y(y), 4.5 * hr, 0, 2 * Math.PI); g.fillStyle = BG; g.fill();
                                   g.lineWidth = px(1.5); g.strokeStyle = INK; g.stroke(); };
        const arrow = (x1, y1, x2, y2) => {  // the head at (x2, y2)
          seg(X(x1), Y(y1), X(x2), Y(y2));
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len < 12) return;
          const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
          g.beginPath(); g.moveTo(X(x2 - 7 * ux + 4 * uy), Y(y2 - 7 * uy - 4 * ux)); g.lineTo(X(x2), Y(y2));
          g.lineTo(X(x2 - 7 * ux - 4 * uy), Y(y2 - 7 * uy + 4 * ux)); g.stroke();
        };
        const box = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
                                         g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
        g.save();
        g.lineCap = 'round';
        for (const { d, s, sel, hover } of this.shapes) {
          const bold = sel || hover;
          g.strokeStyle = INK;
          if (d.type === 'hline') {
            const w = px(bold ? 2 : 1.5), y = crisp(s.y, vr, w);
            g.lineWidth = w; seg(0, y, W, y);
            if (sel) handle(W / hr / 2, s.y);
          } else if (d.type === 'vline') {
            const w = px(bold ? 2 : 1.5), x = crisp(s.x, hr, w);
            g.lineWidth = w; seg(x, 0, x, H);
            if (sel && !c.pane) handle(s.x, H / vr / 2);
          } else {  // measure: the change in price and %, and how many candles and how long, on this chart
            const pa = priceOn(c, d.a, d.src), pb = priceOn(c, d.b, d.src), dp = pb - pa, up = dp >= 0, col = up ? INK : DOWN;
            const tagBg = up ? INK_TAG : '#c23b47';  // darker, so the white text reads
            const l = Math.min(s.x1, s.x2), r = Math.max(s.x1, s.x2), t = Math.min(s.y1, s.y2), b = Math.max(s.y1, s.y2);
            g.fillStyle = up ? 'rgba(167, 139, 250, 0.16)' : 'rgba(240, 85, 95, 0.16)'; g.fillRect(X(l), Y(t), X(r - l), Y(b - t));
            g.strokeStyle = col; g.lineWidth = px(1.5);
            arrow((s.x1 + s.x2) / 2, s.y1, (s.x1 + s.x2) / 2, s.y2); arrow(s.x1, (s.y1 + s.y2) / 2, s.x2, (s.y1 + s.y2) / 2);
            const n = Math.round(Math.abs(indexAt(m.bars, m.tf, d.b.t) - indexAt(m.bars, m.tf, d.a.t)));
            const lines = [`${up ? '+' : '−'}${c.fmt(Math.abs(dp))}  (${up ? '+' : '−'}${Math.abs(dp / pa * 100).toFixed(2)}%)`,
                           `${n} bar${n === 1 ? '' : 's'}, ${lasting(Math.abs(d.b.t - d.a.t))}`];
            g.font = `600 ${Math.round(11 * vr)}px "IBM Plex Mono", ui-monospace, Consolas, monospace`;
            const bw = Math.max(...lines.map(text => g.measureText(text).width)) + 18 * hr, bh = 38 * vr;
            const bx = Math.max(2 * hr, Math.min(W - bw - 2 * hr, X((l + r) / 2) - bw / 2));
            const by = Math.max(2 * vr, Math.min(H - bh - 2 * vr, up ? Y(t) - bh - 8 * vr : Y(b) + 8 * vr));
            box(bx, by, bw, bh, 5 * hr); g.fillStyle = tagBg; g.fill();
            g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(lines[0], bx + bw / 2, by + bh * 0.3); g.fillText(lines[1], bx + bw / 2, by + bh * 0.72);
          }
        }
        g.restore();
      });
    }
  }

  function redraw() {
    for (const c of charts) for (const l of [c.layer, ...c.panes.map(q => q.layer)]) if (l.requestUpdate) l.requestUpdate();
  }
  function save() { try { localStorage.setItem(S.key, JSON.stringify(S.items)); } catch (e) {} show(); }
  function remember(state = JSON.stringify(S.items)) { S.undo.push(state); if (S.undo.length > 100) S.undo.shift(); }
  function load() {
    S.items = []; S.sel = null; S.hover = null; S.temp = null; S.measure = null; S.undo = [];
    try {
      const saved = JSON.parse(localStorage.getItem(S.key) || '[]');
      if (Array.isArray(saved)) S.items = saved.filter(d => d && d.a && ok(d.a.t) && (d.type === 'vline' || (d.type === 'hline' && ok(d.a.p) && ok(d.a.r))));
    } catch (e) {}
  }
  function setTool(tool) {
    S.tool = tool; S.temp = null; S.tempChart = null;
    for (const c of charts) c.el.classList.toggle('dr-on', !!tool);
    show(); redraw();
  }
  const local = (c, e) => { const r = c.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function down(e, c) {
    if (e.button !== 0 || S.gesture || !c.active()) return;
    const m = map(c), [x, y] = local(c, e);
    if (!m || x < 0 || y < 0 || x > m.w || y > m.h) return;  // the price and time axes keep their drag-to-scale
    if (S.temp) { finish(S.tempChart === c ? at(c, m, x, y) : null); S.press = true; return; }  // the second click
    if (S.measure) { S.measure = null; redraw(); }
    const tool = !S.tool && e.shiftKey ? 'measure' : S.tool;  // Shift+drag: a quick measure
    const start = { c, x0: e.clientX, y0: e.clientY, moved: false };
    if (!tool) {
      const d = hit(c, m, x, y);
      if (!d) { if (S.sel) { S.sel = null; show(); redraw(); } S.pan = c; return; }  // empty space: the chart scrolls as usual
      S.sel = d.id;
      S.gesture = { ...start, kind: 'drag', item: d, orig: copy(d), before: JSON.stringify(S.items), from: { i: m.index(x), p: m.price(y) } };
    } else {
      const pt = at(c, m, x, y);
      if (!pt) return;
      if (tool === 'measure') {  // drag from one point to the other, or click one, move, click the other
        S.temp = { type: 'measure', src: c.id, a: pt, b: { ...pt } }; S.tempChart = c;
        S.gesture = { ...start, kind: 'create' };
      } else {  // a line is placed at once; dragging before letting go moves it
        const before = JSON.stringify(S.items), item = { id: uid(), type: tool, src: c.id, a: pt };
        S.items.push(item); S.sel = item.id;
        setTool(null);
        S.gesture = { ...start, kind: 'drag', item, orig: copy(item), before, created: true, from: { i: m.index(x), p: m.price(y) } };
      }
    }
    S.press = true;
    show(); redraw();
  }
  function dragTo(g, x, y) {  // a line follows the mouse: by whole candles in time, or by the price moved on this chart
    const c = g.c, m = map(c), d = g.item, o = g.orig;
    if (!m) return;
    if (d.type === 'vline') {
      const di = Math.round(m.index(x) - g.from.i);
      d.a = { ...o.a, t: timeAt(m.bars, m.tf, Math.round(indexAt(m.bars, m.tf, o.a.t)) + di) };
    } else {
      const was = priceOn(c, o.a, o.src), dp = m.price(y) - g.from.p;
      if (!ok(was) || !ok(dp)) return;
      d.src = c.id; d.a = point(c, o.a.t, was + dp);  // now kept as drawn on this chart
    }
  }
  function move(e) {
    if (S.pan) {  // the chart is being dragged: keep its crosshair on the mouse
      if (!(e.buttons & 1)) S.pan = null;
      else {
        const c = S.pan, [x, y] = local(c, e), t = c.chart.timeScale().coordinateToTime(x), p = c.series.coordinateToPrice(y);
        if (t !== null && ok(p)) c.chart.setCrosshairPosition(p, t, c.series);
      }
    }
    const g = S.gesture;
    if (g) {
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 3) g.moved = true;
      const [x, y] = local(g.c, e);
      if (g.kind === 'create') { const m = map(g.c), pt = m && at(g.c, m, x, y); if (pt) S.temp.b = pt; }
      else if (g.moved) dragTo(g, x, y);
      redraw();
    } else if (S.temp) {  // between the two clicks, the free end follows the mouse
      const c = S.tempChart, [x, y] = local(c, e), m = map(c), pt = m && at(c, m, x, y);
      if (pt) { S.temp.b = pt; redraw(); }
    }
  }
  function up() {
    S.press = false; S.pan = null;
    const g = S.gesture;
    if (!g) return;
    S.gesture = null;
    if (g.kind === 'create') { if (g.moved) finish(null); }  // after a plain click it waits for the second click
    else if (g.moved || g.created) { remember(g.before); save(); }
    redraw();
  }
  function finish(pt) {
    const t = S.temp;
    S.temp = null; S.tempChart = null;
    if (!t) return;
    if (pt) t.b = pt;
    S.measure = t;  // shown until the next click or Esc
    setTool(null);
  }
  function del() {
    if (!S.sel) return;
    remember(); S.items = S.items.filter(d => d.id !== S.sel); S.sel = null;
    save(); redraw();
  }
  function undo() {
    const prev = S.undo.pop();
    if (prev === undefined) return;
    S.items = JSON.parse(prev); S.sel = null;
    save(); redraw();
  }
  function clearAll() {
    if (!S.items.length) return;
    remember(); S.items = []; S.sel = null;
    save(); redraw();
  }

  // ---- the sidebar ----
  const ICON = {
    vline: '<svg viewBox="0 0 20 20"><path d="M10 2.5v15"/><circle class="fill" cx="10" cy="10" r="1.9"/></svg>',
    hline: '<svg viewBox="0 0 20 20"><path d="M2.5 10h15"/><circle class="fill" cx="10" cy="10" r="1.9"/></svg>',
    measure: '<svg viewBox="0 0 20 20"><path d="M2.9 13.1l10.2-10.2 4 4-10.2 10.2z"/><path d="M5.6 10.4l1.5 1.5M7.8 8.2l1 1M10 6l1.5 1.5"/></svg>',
    del: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8.5 6V4h3v2M5.8 6l.8 10.5h6.8l.8-10.5"/></svg>',
    clear: '<svg viewBox="0 0 20 20"><path d="M11.4 3.7l4.9 4.9-7.6 7.6H5.4l-2-2a1.2 1.2 0 0 1 0-1.7z"/><path d="M7.6 7.5l4.9 4.9M9 16.2h7.5"/></svg>',
    fold: '<svg viewBox="0 0 20 20"><path d="M12 5l-5 5 5 5"/></svg>',
  };
  const css = `
    .dr-wrap { flex: 1; min-height: 0; display: flex; }
    .dr-wrap > main { flex: 1; min-width: 0; }
    .dr-rail { flex: none; width: 42px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0;
      background: var(--surface, #0e131a); border-right: 1px solid var(--line-strong, #283240); }
    .dr-tool { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 7px;
      background: transparent; color: var(--muted, #8d99ab); cursor: pointer; }
    .dr-tool:hover { color: var(--text, #e8eef6); background: var(--tile, #121922); }
    .dr-tool[aria-pressed="true"] { color: var(--accent, #5b8cff); background: rgba(91, 140, 255, .14); box-shadow: inset 0 0 0 1px rgba(91, 140, 255, .45); }
    .dr-tool:disabled { opacity: .3; cursor: default; background: transparent; color: var(--muted, #8d99ab); }
    .dr-tool svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .dr-tool svg .fill { fill: currentColor; stroke: none; }
    .dr-sep { width: 20px; height: 1px; margin: 6px 0; background: var(--line-strong, #283240); }
    .dr-grow { flex: 1; }
    .dr-rail.closed { width: 16px; padding: 0; }
    .dr-rail.closed > :not(.dr-fold) { display: none; }
    .dr-rail.closed .dr-fold { width: 16px; height: auto; flex: 1; border-radius: 0; place-items: end center; padding-bottom: 8px; }  /* the whole strip opens it */
    .dr-rail.closed .dr-fold svg { transform: rotate(180deg); }
    .dr-on { touch-action: none; }  /* with a tool picked, a finger draws instead of scrolling the page */`;
  let rail = null;
  function show() {
    if (!rail) return;
    for (const b of rail.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool));
    rail.querySelector('.dr-del').disabled = !S.sel;
    rail.querySelector('.dr-clear').disabled = !S.items.length;
  }
  function mount() {
    const main = document.querySelector('main');
    if (!main || rail) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const wrap = document.createElement('div');
    wrap.className = 'dr-wrap';
    main.before(wrap);
    rail = document.createElement('nav');
    rail.className = 'dr-rail'; rail.setAttribute('aria-label', 'Drawing tools');
    const btn = (cls, icon, title, attrs = '') => `<button type="button" class="dr-tool ${cls}" title="${title}" aria-label="${title}" ${attrs}>${icon}</button>`;
    rail.innerHTML =
      btn('', ICON.vline, 'Vertical line: click a time', 'data-tool="vline"') +
      btn('', ICON.hline, 'Horizontal line: click a price', 'data-tool="hline"') +
      btn('', ICON.measure, 'Measure price, % and time: drag, or click two points (Shift+drag measures anytime)', 'data-tool="measure"') +
      '<span class="dr-sep" aria-hidden="true"></span>' +
      btn('dr-del', ICON.del, 'Delete the selected line (Del)') +
      btn('dr-clear', ICON.clear, 'Remove all lines (Ctrl+Z brings them back)') +
      '<span class="dr-grow"></span>' +
      btn('dr-fold', ICON.fold, 'Hide the drawing tools');
    wrap.append(rail, main);
    for (const b of rail.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool === S.tool ? null : b.dataset.tool);
    rail.querySelector('.dr-del').onclick = del;
    rail.querySelector('.dr-clear').onclick = clearAll;
    const fold = rail.querySelector('.dr-fold');
    const setOpen = open => {
      rail.classList.toggle('closed', !open);
      fold.title = open ? 'Hide the drawing tools' : 'Show the drawing tools'; fold.setAttribute('aria-label', fold.title);
      if (!open && S.tool) setTool(null);
      try { localStorage.setItem('sb-draw-rail', open ? '1' : '0'); } catch (e) {}
    };
    fold.onclick = () => setOpen(rail.classList.contains('closed'));
    let open = true;
    try { open = localStorage.getItem('sb-draw-rail') !== '0'; } catch (e) {}
    setOpen(open);
    show();
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') {
      const g = S.gesture;
      if (g && g.kind === 'drag') S.items = JSON.parse(g.before);  // put a half-dragged line back
      S.gesture = null; S.press = false; S.measure = null; S.sel = null;
      setTool(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel && !S.gesture) {
      e.preventDefault(); del();
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !S.gesture && S.undo.length) {
      e.preventDefault(); undo();
    }
  });

  window.NsbDraw = {
    setup({ key, when }) {
      S.key = key; if (when) S.when = when;
      load();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
    },
    use(key) { if (key === S.key) return; S.key = key; load(); setTool(null); },
    add(spec) {
      const c = { active: () => true, fmt: v => v.toFixed(2), ...spec };
      c.layer = new Layer(c); c.panes = [];
      c.series.attachPrimitive(c.layer);
      // a press that starts a drawing or grabs one never reaches the chart, so the chart doesn't scroll at the same time
      const onDown = e => down(e, c), onMouse = e => { if (S.press) { e.stopPropagation(); e.preventDefault(); } };
      const onTouch = e => { if (S.press) e.stopPropagation(); };
      const onLeave = () => { if (S.hover) { S.hover = null; redraw(); } };
      c.el.addEventListener('pointerdown', onDown, true);
      c.el.addEventListener('mousedown', onMouse, true);
      c.el.addEventListener('touchstart', onTouch, { capture: true, passive: true });
      c.el.addEventListener('mouseleave', onLeave);
      if (S.tool) c.el.classList.add('dr-on');
      charts.push(c);
      return {
        pane(chart, series) {  // a MACD pane under this chart (same candles): the vertical lines go through it too
          const q = { ...c, chart, series, el: chart.chartElement(), pane: true };
          q.layer = new Layer(q);
          series.attachPrimitive(q.layer);
          c.panes.push(q);
        },
        remove() {
          const i = charts.indexOf(c);
          if (i >= 0) charts.splice(i, 1);
          try { c.series.detachPrimitive(c.layer); } catch (e) {}
          c.el.removeEventListener('pointerdown', onDown, true);
          c.el.removeEventListener('mousedown', onMouse, true);
          c.el.removeEventListener('touchstart', onTouch, { capture: true });
          c.el.removeEventListener('mouseleave', onLeave);
          if (S.pan === c) S.pan = null;
          if (S.tempChart === c) { S.temp = null; S.tempChart = null; }
          if (S.gesture && S.gesture.c === c) S.gesture = null;
        },
      };
    },
    redraw,
  };
})();
