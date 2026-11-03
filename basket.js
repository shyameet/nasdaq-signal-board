/* Indra Quant Signal Board: your stocks' leader, followers and the ones still waiting (owner 2-3/11/2026: "i need to know
   which stocks are the last to turn bearish or bullish but they are still neutral ... the last follower to join it so i can
   trade the follower instead of the leader ... and the leader stock as well").

   The basket is in a trend where the stocks chart is shaded (its own lines switched on: NsbGate.states(..., own)). Each
   picked stock is judged by its own gate (the lines switched on, its own Trend and Swing lines). In each run of the
   basket's trend (6a: counted from when the basket was last mixed or NO TRADE):
     - the stocks already that way when it starts are put in order of when each one last turned: the first is the LEADER
       (it may have turned before the basket did); then every stock that turns that way while the trend holds JOINS
       (k of n); the first to make it all n is the LAST FOLLOWER (one a trend). A stock that drops out and comes back joins again (the strip
       counts it; no second mark unless it is the last); one on the other side (or NO TRADE) is still WAITING (owner: "both counts").
     NsbBasket.of(sig, swing, memberSwing, swingLines) -> { events, at(t) } or null (fewer than two stocks)
       sig: the composite's engine TrendSignal (its parts are the stocks), swing: the composite's Swing candles,
       memberSwing: { coin: that stock's Swing candles }, swingLines: the Swing lines the chart draws
       events: [{ t (ms, the minute it turned), coin, dir 'BULLISH'|'BEARISH', k, n, kind 'lead'|'join'|'last' }]
       at(t): the situation at minute t (the newest minute at or before it): null outside a trend, else
              { dir, n, inn: [coins that way], leader, wait: [[coin, its gate]] }
     NsbBasket.strip(info, name) -> the strip's HTML; NsbBasket.marks(events, at) -> markers for Lightweight Charts */
(() => {
'use strict';
if (window.NsbBasket) return;
let ver = 0;
NsbMacd.onToggle(() => { ver += 1; });  // a switch: the gates, so the basket's turns, change
const cache = new WeakMap();
const trend = s => s === 'BULLISH' || s === 'BEARISH' ? s : null;
function of(sig, swing, memberSwing, swingLines) {
  if (!sig || !sig.parts || !sig.trace) return null;
  const key = `${ver}|${swingLines.join()}|${sig.trace.length}|${(sig.trace[sig.trace.length - 1] || {}).t}`, have = cache.get(sig);
  if (have && have.key === key && have.swing === swing && have.memberSwing === memberSwing) return have.out;
  const basket = NsbGate.states(sig, swing, swingLines, true);  // the basket's trend: the stocks chart's own lines
  const coins = Object.keys(sig.parts), n = coins.length;
  const gates = Object.fromEntries(coins.map(c => [c, NsbGate.states(sig.parts[c], memberSwing && memberSwing[c], swingLines)]));
  const times = [...basket.keys()].sort((a, b) => a - b);
  const events = [], snaps = [];  // snaps: [t, situation] at every minute in a trend
  const prev = {}, since = {};     // each stock's gate at the minute before, and the minute its current gate began
  // joined: every stock that has joined in this trend; last: its last follower, the first stock to make it all n (one a trend)
  let dir = null, inn = new Set(), leader = null, joined = new Set(), last = null;
  for (const t of times) {
    const D = trend(basket.get(t)), st = {};
    for (const c of coins) {
      const s = gates[c].get(t) || null;
      if (s !== prev[c]) { since[c] = t; prev[c] = s; }
      st[c] = s;
    }
    if (D !== dir) {  // the basket's trend begins (or ends)
      dir = D; inn = new Set(); leader = null; joined = new Set(); last = null;
      if (D) {
        const already = coins.filter(c => st[c] === D).sort((a, b) => since[a] - since[b]);
        for (const c of already) {
          inn.add(c);
          const kind = !leader ? 'lead' : inn.size === n && !last ? 'last' : 'join';
          events.push({ t: since[c], coin: c, dir: D, k: inn.size, n, kind, again: false });
          if (!leader) leader = c;
          if (kind === 'last') last = c;
          joined.add(c);
        }
      }
    } else if (D) {
      for (const c of coins) {
        const was = inn.has(c), now = st[c] === D;
        if (now && !was) {
          inn.add(c);
          const kind = !leader ? 'lead' : inn.size === n && !last ? 'last' : 'join';
          events.push({ t, coin: c, dir: D, k: inn.size, n, kind, again: joined.has(c) });
          if (!leader) leader = c;
          if (kind === 'last') last = c;
          joined.add(c);
        } else if (!now && was) inn.delete(c);
      }
    }
    if (D) snaps.push([t, { dir: D, n, inn: [...inn], leader, last, wait: coins.filter(c => !inn.has(c)).map(c => [c, st[c]]) }]);
    else snaps.push([t, null]);
  }
  events.sort((a, b) => a.t - b.t);
  const at = t => {  // the newest minute at or before t
    let lo = 0, hi = snaps.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (snaps[mid][0] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best >= 0 ? snaps[best][1] : null;
  };
  const out = { events, at };
  cache.set(sig, { key, swing, memberSwing, out });
  return out;
}
const WORD = { BULLISH: 'LONG', BEARISH: 'SHORT', NEUTRAL: 'NO TRADE' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// the strip, in plain words (owner 3/11/2026: "the labels of lead and last are very confusing"):
//   "Basket SHORT · 4 of 6 joined · Leader NVDA · Still waiting: META (NO TRADE), GOOGL (LONG)"
//   "Basket SHORT · all 6 joined · Leader NVDA · Last follower GOOGL"
function strip(info, name) {
  if (!info) return '<span class="bk-none">Basket: no trend</span>';
  const cls = info.dir === 'BULLISH' ? 'up' : 'down', all = info.inn.length === info.n;
  const wait = info.wait.map(([c, s]) => `<span class="bk-w${s && s !== 'NEUTRAL' ? ' bk-opp' : ''}" title="${esc(name(c))} is ${WORD[s] || 'without a gate yet'}: not joined">${esc(name(c))} <i>(${WORD[s] || '—'})</i></span>`);
  return `<span class="bk-dir ${cls}" title="Your stocks chart's own trend">Basket ${WORD[info.dir]}</span>`
    + `<span class="bk-n">${all ? `all ${info.n} joined` : `${info.inn.length} of ${info.n} joined`}</span>`
    + (info.leader ? `<span class="bk-lead" title="Leader: the first of your stocks to turn ${WORD[info.dir]} in this trend">Leader <b>${esc(name(info.leader))}</b></span>` : '')
    + (info.last ? `<span class="bk-last" title="Last follower: the stock that was last to turn ${WORD[info.dir]}, so all ${info.n} joined">Last follower <b>${esc(name(info.last))}</b></span>` : '')
    + (wait.length ? `<span class="bk-wait">Still waiting:</span>${wait.join('')}` : '');
}
// the marks on the stocks chart: "LEADER NVDA" (yellow), each stock's first join in the trend ("META 4/6"), "LAST FOLLOWER
// GOOGL" (cyan, one a trend: the first time all n have joined); a stock coming back in the same trend gets no second mark
// (the strip shows every change). time(t) -> the candle's time (s)
function marks(events, time, name, from = -Infinity, to = Infinity, gap = 0) {
  // gap (s): a join closer than this to the last worded mark keeps its arrow, not its words (as the MNQ tab's marks);
  // the leader and the last always say who they are
  let worded = -Infinity;
  return events.filter(e => e.t >= from && e.t < to && (!e.again || e.kind !== 'join')).map(e => {
    const up = e.dir === 'BULLISH', at = time(e.t), say = e.kind !== 'join' || at - worded >= gap;
    if (say) worded = at;
    return { time: at, position: up ? 'belowBar' : 'aboveBar', shape: up ? 'arrowUp' : 'arrowDown',
             color: e.kind === 'lead' ? '#FFD600' : e.kind === 'last' ? '#00E5FF' : up ? '#2bb68a' : '#f0555f',
             text: !say ? '' : e.kind === 'lead' ? `LEADER ${name(e.coin)}` : e.kind === 'last' ? `LAST FOLLOWER ${name(e.coin)}` : `${name(e.coin)} ${e.k}/${e.n}`,
             size: e.kind === 'join' ? 1 : 2 };
  });
}
const css = document.createElement('style');
css.textContent = `
  .bk { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding: 3px 10px; min-height: 22px;
        border-bottom: 1px solid var(--line); font: 11.5px var(--font-ui); color: var(--muted); }
  .bk .bk-dir { font: 700 11.5px var(--font-num); padding: 1px 7px; border-radius: 5px; }
  .bk .bk-dir.up { background: var(--up); color: #04150f; } .bk .bk-dir.down { background: var(--down); color: #1e0507; }
  .bk .bk-n { color: var(--text); font-weight: 600; }
  .bk .bk-lead b { color: #FFD600; font-weight: 700; }
  .bk .bk-last b { color: #00E5FF; font-weight: 700; }
  .bk .bk-w { color: var(--text); font-weight: 600; white-space: nowrap; }
  .bk .bk-w i { font-style: normal; font-weight: 500; color: var(--muted); font-size: 10.5px; }
  .bk .bk-w.bk-opp i { color: var(--warn); }
`;
document.head.appendChild(css);
window.NsbBasket = { of, strip, marks };
})();
