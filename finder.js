/* Indra Quant Signal Board: the market finder (owner 3/11/2026: "add all the stocks from hyperliquid but how would we
   categorize so much in a drop down list" -> "(a) The finder in the picture"; then "i mean i also need this on the
   compare tab right?"). The Perps tab's market button and each Compare chart's open one: a search box over the whole
   list (ticker, name, country, group), group chips (a market can be in two), ★ My list (this browser, the same on every
   tab), Hyperliquid's markets busiest first with their 24-hour change and volume (its own figures), ↑ ↓ Enter Esc.
     NsbFinder.make(o) -> { open(), close(), toggle(), isOpen(), list(chip), render(), place() }
       o.anchor        the button it opens under (or above, when the button sits low on the screen)
       o.items()       [{ id, ticker, name, kind ('stock' | 'preipo' | 'etf' | ...), mfp (on MyFundedPerps), groups [chip
                         ids], where (its country: searched), coin (its Hyperliquid name: the 24-hour figures and the ★;
                         none: no figures, the ★ by id) }]
       o.chips()       [[id, label], ...]; 'star' (My list) and 'all' (every item) are the finder's own; [] = no chips
       o.chip(), o.setChip(id)   the chip shown (the page remembers it)
       o.ordered(chip) true: that chip keeps the items' own order (the board's markets), else busiest first
       o.current()     the id shown;  o.onPick(id);  o.mfp(): the MyFundedPerps column;  o.onStars(): after a ★
       list(chip)      that chip's ids in the finder's order (the Perps tab's ‹ › step through them)
     NsbFinder.stats   coin -> { vol, chg };  NsbFinder.loadStats(coins) (a minute old at most);  NsbFinder.stars() */
(() => {
'use strict';
if (window.NsbFinder) return;
const STARS = 'nsb.finder.stars';
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const fin = v => v !== null && v !== undefined && isFinite(v);
const money = v => !v ? '—' : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : `$${Math.max(1, Math.round(v / 1e3))}K`;
const pct = v => !fin(v) ? '—' : Math.abs(v) < 0.0005 ? '0.0%' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;  // (not "-0.0%")
function stars() {  // the ★ markets (Hyperliquid names, or the board's ids); the Perps tab kept them on its own on 3/11
  let a = null;
  try { a = JSON.parse(localStorage.getItem(STARS)); if (a === null) a = JSON.parse(localStorage.getItem('nsb.perps.stars')); } catch (e) {}
  return Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
}
const setStars = a => { try { localStorage.setItem(STARS, JSON.stringify(a)); } catch (e) {} };
const stats = {}, statsAt = {}, statsBusy = {};  // dex ('' = Hyperliquid's main one) -> when read, the read under way
function loadStats(coins) {  // Hyperliquid's 24-hour volume and change of every market on the dexes of these coins: one
  // request a dex (weight 20), each a minute old at most
  const dexes = [...new Set(coins.filter(Boolean).map(c => c.includes(':') ? c.split(':')[0] : ''))];
  return Promise.all(dexes.map(dex => {
    if (Date.now() - (statsAt[dex] || 0) < 60000) return null;
    if (!statsBusy[dex]) statsBusy[dex] = (async () => {
      const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' }) });
      if (!r.ok) throw new Error(r.status);
      const [meta, ctx] = await r.json();
      meta.universe.forEach((a, i) => { const x = ctx[i] || {}, px = +x.markPx, prev = +x.prevDayPx;
        stats[a.name] = { vol: +x.dayNtlVlm || 0, chg: px && prev ? px / prev - 1 : null }; });
      statsAt[dex] = Date.now();
    })().catch(() => { /* asked again next time */ }).finally(() => { delete statsBusy[dex]; });
    return statsBusy[dex];
  }));
}
const finders = [];
document.addEventListener('pointerdown', e => {  // a press outside an open finder (and its button) closes it
  for (const f of finders) if (f.isOpen() && !f.el.contains(e.target) && !f.anchor.contains(e.target)) f.close();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') for (const f of finders) if (f.isOpen()) f.close(); });
window.addEventListener('resize', () => { for (const f of finders) if (f.isOpen()) f.place(); });

function make(o) {
  const el = document.createElement('div');
  el.className = 'nf'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Pick a market');
  el.innerHTML = `<input class="nf-search" type="search" autocomplete="off" spellcheck="false" placeholder="Type a ticker or a name: “micron”, “korea”, “memory”…" aria-label="Search">
    <div class="nf-chips" role="group" aria-label="Groups"></div>
    <div class="nf-head"><span></span><span>Ticker</span><span>Company</span><span class="nf-mh">MyFundedPerps</span><span>24h</span><span>24h traded</span></div>
    <div class="nf-rows" role="listbox" aria-label="Markets"></div>
    <div class="nf-foot"><span><b>↑ ↓</b> move</span><span><b>Enter</b> open</span><span><b>★</b> your list (this browser)</span><span><b>Esc</b> close</span></div>`;
  document.body.appendChild(el);
  const q = el.querySelector('.nf-search'), chipsEl = el.querySelector('.nf-chips'), rowsEl = el.querySelector('.nf-rows');
  let rows = [], sel = 0, byId = new Map();
  const starOf = it => it.coin || it.id;
  const busiest = list => list.slice().sort((a, b) => {
    const x = a.coin ? (stats[a.coin] || {}).vol || 0 : -1, y = b.coin ? (stats[b.coin] || {}).vol || 0 : -1;
    return y - x || (x < 0 && y < 0 ? 0 : a.ticker.localeCompare(b.ticker));
  });
  function inChip(items, chip) {
    if (chip === 'all') return items;
    if (chip === 'star') { const s = new Set(stars()); return items.filter(it => s.has(starOf(it))); }
    return items.filter(it => (it.groups || []).includes(chip));
  }
  const order = (list, chip) => o.ordered && o.ordered(chip) ? list : busiest(list);
  function list(chip) { return order(inChip(o.items(), chip), chip).map(it => it.id); }
  const starts = (it, s) => it.ticker.toLowerCase().startsWith(s) || (it.coin || '').split(':').pop().toLowerCase().startsWith(s);
  function found() {  // typing: every item (tickers that begin with it first), busiest first; else the chip's
    const s = q.value.trim().toLowerCase(), items = o.items();
    if (!s) { const c = o.chip(); return order(inChip(items, c), c); }
    const label = Object.fromEntries(o.chips());
    const hit = it => [it.ticker, it.coin || it.id, it.name, it.where || '', ...(it.groups || []).map(g => label[g] || '')].some(x => String(x).toLowerCase().includes(s));
    const all = busiest(items.filter(hit));
    return all.filter(it => starts(it, s)).concat(all.filter(it => !starts(it, s)));
  }
  function render() {
    const items = o.items(), chips = o.chips(), chip = o.chip(), typing = !!q.value.trim();
    byId = new Map(items.map(it => [it.id, it]));
    el.classList.toggle('nf-nomfp', !(o.mfp && o.mfp()));
    chipsEl.hidden = !chips.length;
    chipsEl.innerHTML = chips.map(([id, label]) => `<button type="button" class="nf-chip${id === 'star' ? ' star' : ''}" data-g="${esc(id)}" aria-pressed="${!typing && id === chip}">${esc(label)}<em>${inChip(items, id).length}</em></button>`).join('');
    rows = found();
    const cur = o.current(), st = new Set(stars());
    if (sel < 0 || sel >= rows.length) sel = Math.max(0, rows.findIndex(it => it.id === cur));
    rowsEl.innerHTML = rows.length ? rows.map((it, i) => {
      const s = it.coin ? stats[it.coin] || {} : {}, on = st.has(starOf(it));
      const tag = it.kind === 'preipo' ? ' <span class="nf-tag ipo">pre-IPO</span>' : it.kind === 'etf' ? ' <span class="nf-tag etf">ETF</span>' : '';
      return `<div class="nf-row${i === sel ? ' sel' : ''}${it.id === cur ? ' now' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">`
        + `<button type="button" class="nf-star${on ? ' on' : ''}" data-star="${i}" title="${on ? 'Take it off My list' : 'Add it to My list'}" aria-label="${on ? 'Take it off My list' : 'Add it to My list'}">${on ? '★' : '☆'}</button>`
        + `<span class="nf-t">${esc(it.ticker)}${it.mfp ? '<span class="nf-dot" title="On MyFundedPerps">MFP</span>' : ''}</span>`
        + `<span class="nf-c" title="${esc(it.name)}">${esc(it.name)}${tag}</span>`
        + `<span class="nf-m">${it.mfp ? '<span class="nf-tag mfp">yes</span>' : '<span class="nf-none">—</span>'}</span>`
        + `<span class="nf-ch ${s.chg > 0 ? 'up' : s.chg < 0 ? 'down' : ''}">${it.coin ? pct(s.chg) : ''}</span><span class="nf-v">${it.coin ? money(s.vol) : ''}</span></div>`;
    }).join('') : '<div class="nf-empty">Nothing matches.</div>';
    const r = rowsEl.querySelector('.nf-row.sel');
    if (r) r.scrollIntoView({ block: 'nearest' });
  }
  function mark(i) {  // the keyboard's row, without drawing the list again
    if (!rows.length) return;
    sel = (i + rows.length) % rows.length;
    for (const r of rowsEl.children) { const on = +r.dataset.i === sel; r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on)); }
    const r = rowsEl.querySelector('.nf-row.sel');
    if (r) r.scrollIntoView({ block: 'nearest' });
  }
  function place() {  // under its button, inside the window; above it when there is more room there (a low button on a phone)
    if (el.hidden) return;
    const r = o.anchor.getBoundingClientRect(), w = el.offsetWidth;
    const below = window.innerHeight - r.bottom - 16, above = r.top - 16, down = below >= 320 || below >= above;
    el.style.left = `${Math.max(8, Math.min(Math.round(r.left) - 40, window.innerWidth - w - 8))}px`;
    el.style.maxHeight = `${Math.max(200, Math.round(down ? below : above))}px`;
    el.style.top = `${Math.round(down ? r.bottom + 6 : Math.max(8, r.top - 6 - el.offsetHeight))}px`;
  }
  const isOpen = () => !el.hidden;
  function open() {
    if (isOpen()) return;
    el.hidden = false;
    if (o.anchor.setAttribute) o.anchor.setAttribute('aria-expanded', 'true');
    q.value = ''; sel = -1;
    render(); place();
    q.focus();
    loadStats(o.items().map(it => it.coin)).then(() => { if (isOpen()) { render(); place(); } });
  }
  function close() { if (el.hidden) return; el.hidden = true; if (o.anchor.setAttribute) o.anchor.setAttribute('aria-expanded', 'false'); }
  const toggle = () => { if (isOpen()) close(); else open(); };
  function pick(i) { const it = rows[i]; if (!it) return; close(); if (it.id !== o.current()) o.onPick(it.id); }
  q.addEventListener('input', () => { sel = 0; render(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mark(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); if (o.anchor.focus) o.anchor.focus(); }
  });
  chipsEl.addEventListener('click', e => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    o.setChip(b.dataset.g); q.value = ''; sel = -1; render(); place(); q.focus();
  });
  rowsEl.addEventListener('click', e => {
    const s = e.target.closest('[data-star]');
    if (s) {  // ★: on or off My list; the list stays as it is
      e.stopPropagation();
      const it = rows[+s.dataset.star], k = it && starOf(it), a = stars();
      if (!it) return;
      setStars(a.includes(k) ? a.filter(x => x !== k) : a.concat(k));
      render(); q.focus();
      if (o.onStars) o.onStars();
      return;
    }
    const r = e.target.closest('.nf-row');
    if (r) pick(+r.dataset.i);
  });
  const f = { el, anchor: o.anchor, open, close, toggle, isOpen, list, render, place };
  finders.push(f);
  return f;
}

const css = document.createElement('style');
css.textContent = `
  .nf-btn { display: inline-flex; align-items: center; gap: 6px; max-width: 16em; padding: 3px 8px; border: 1px solid var(--line);
            border-radius: 7px; background: var(--bg); color: var(--text); font: 600 12px var(--font-num); cursor: pointer; }
  .nf-btn:hover, .nf-btn[aria-expanded="true"] { border-color: var(--accent); }
  .nf-btn span { font: 400 12px var(--font-ui); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nf-btn i { font-style: normal; color: var(--muted); font-size: 10px; }
  .nf { position: fixed; z-index: 65; width: min(680px, calc(100vw - 16px)); display: flex; flex-direction: column;
        background: var(--surface); border: 1px solid var(--line-strong); border-radius: 10px; box-shadow: 0 18px 50px rgba(0, 0, 0, .6);
        font: 13px/1.4 var(--font-ui); color: var(--text); }
  .nf[hidden] { display: none; }
  .nf-search { margin: 10px 10px 8px; padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg);
               color: var(--text); font: 13px var(--font-ui); outline: none; }
  .nf-search:focus { border-color: var(--accent); }
  .nf-search::placeholder { color: var(--faint); }
  .nf-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 10px 9px; border-bottom: 1px solid var(--line); }
  .nf-chips[hidden] { display: none; }
  .nf-chip { padding: 2px 9px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--muted);
             font: 12px var(--font-ui); white-space: nowrap; cursor: pointer; }
  .nf-chip:hover { color: var(--text); border-color: var(--line-strong); }
  .nf-chip em { font: normal 11px var(--font-num); color: var(--faint); margin-left: 4px; }
  .nf-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #06101f; font-weight: 600; }
  .nf-chip[aria-pressed="true"] em { color: #0b1d3d; }
  .nf-chip.star { color: var(--warn); border-color: #4a3a16; }
  .nf-head, .nf-row { display: grid; grid-template-columns: 24px 104px minmax(0, 1fr) 96px 58px 78px; gap: 0 8px; align-items: center; padding: 0 12px; }
  .nf-head { padding-top: 6px; padding-bottom: 4px; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
  .nf-head span { white-space: nowrap; }
  .nf-head span:nth-child(n+5), .nf-row .nf-ch, .nf-row .nf-v { text-align: right; }
  .nf-rows { overflow-y: auto; min-height: 0; flex: 1; }
  .nf-row { padding-top: 5px; padding-bottom: 5px; border-top: 1px solid var(--line); cursor: pointer; }
  .nf-row:hover { background: var(--tile); }
  .nf-row.sel { background: var(--tile-2); box-shadow: inset 3px 0 0 var(--accent); }
  .nf-row.now .nf-t { color: var(--accent); }
  .nf-star { padding: 0; border: 0; background: none; color: var(--faint); font-size: 14px; cursor: pointer; }
  .nf-star.on { color: var(--warn); }
  .nf-t { font: 600 12.5px var(--font-num); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nf-c { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nf-ch, .nf-v { font: 12px var(--font-num); white-space: nowrap; }
  .nf-ch.up { color: var(--up); } .nf-ch.down { color: var(--down); }
  .nf-v { color: var(--text); }
  .nf-tag { font: 10.5px var(--font-ui); padding: 1px 6px; border-radius: 4px; }
  .nf-tag.mfp { background: #13283f; color: #8fb6ff; } .nf-tag.ipo { background: #3a2a10; color: var(--warn); }
  .nf-tag.etf { background: var(--tile-2); color: var(--muted); }
  .nf-none { color: var(--faint); }
  .nf-dot { display: none; margin-left: 5px; font: 600 9.5px var(--font-ui); padding: 0 4px; border-radius: 3px; background: #13283f; color: #8fb6ff; vertical-align: 1px; }
  .nf-empty { padding: 18px 12px; color: var(--faint); }
  .nf-foot { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 7px 12px; border-top: 1px solid var(--line); color: var(--faint); font-size: 11.5px; }
  .nf-foot b { color: var(--muted); font-weight: 500; }
  .nf.nf-nomfp .nf-mh, .nf.nf-nomfp .nf-row .nf-m { visibility: hidden; }
  @media (max-width: 640px) {
    .nf-head { display: none; }
    .nf-row { grid-template-columns: 24px minmax(0, 1fr) 54px 58px; grid-template-areas: "s t ch v" "s c ch v"; row-gap: 1px; }
    .nf-row .nf-star { grid-area: s; } .nf-row .nf-t { grid-area: t; } .nf-row .nf-c { grid-area: c; font-size: 12px; }
    .nf-row .nf-ch { grid-area: ch; } .nf-row .nf-v { grid-area: v; } .nf-row .nf-m { display: none; }
    .nf-dot { display: inline-block; }
    .nf-foot { display: none; }
    .nf-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }  /* one row to swipe, so the list keeps the screen */
    .nf-chips::-webkit-scrollbar { display: none; }
  }
`;
document.head.appendChild(css);
window.NsbFinder = { make, stats, loadStats, stars };
})();
