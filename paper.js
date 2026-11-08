// Lucid paper week: the live PAPER page (owner 8/11/2026, D6: on the Signal Board site, not in its navigation, noindex).
// PAPER ONLY - Sim, no real money. It reads the VPS's paper-only feed: its address is in data/paper_feed.json {"url": ...}
// (read again while the feed fails, so a new address needs no code change); the document there is the publisher's
// sanitized "rdx-lucid-paper-public" v1 (4 Sim masters, 12 paper fleets, their accounts, the last events). Polled every
// 5 s (30 s while the tab is hidden); when the feed is down the page keeps the last data, greyed, says since when, and
// keeps retrying (5 s, then 15 s, then 30 s). A request that gets no answer in 8 s counts as down too (a feed that
// accepts the connection and then hangs). One request at a time. Nothing is stored in the browser. Market prices are
// shown only when the feed sends them (the publisher sends none unless the owner turns them on).
(function () {
  'use strict';
  const POLL_MS = 5000, HIDDEN_MS = 30000, FETCH_MS = 8000, FEED_FILE = 'data/paper_feed.json', KIND = 'rdx-lucid-paper-public';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = v => typeof v === 'number' && isFinite(v);
  const int = v => ok(v) ? String(Math.round(v)) : '–';  // a count put into HTML: a number or a dash, never raw text
  const tms = s => { const t = Date.parse(s); return isFinite(t) ? t : null; };
  let fCT, fCTd;
  try {
    fCT = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    fCTd = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch (e) { fCT = fCTd = null; }
  const ct = s => { const t = typeof s === 'number' ? s : tms(s); return t == null ? '–' : fCT ? fCT.format(t) : new Date(t).toISOString().slice(11, 19) + 'Z'; };
  const ctd = s => { const t = tms(s); return t == null ? '–' : fCTd ? fCTd.format(t) : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z'; };
  const n2 = v => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd = v => ok(v) ? (v < 0 ? '−$' : '$') + n2(v) : '–';
  const pnl = v => ok(v) ? `<span class="num ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${n2(v)}</span>` : '<span class="faint">–</span>';
  const px = v => ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–';
  const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '–';
  const ago = msv => { const s = Math.max(0, Math.round(msv / 1000)); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
  const STATUS = { evaluation: 'Evaluation', funded: 'Funded', passed: 'Passed', failed: 'Failed', closed: 'Closed', ended: 'Ended' };
  const stChip = s => `<span class="st ${esc(s)}">${esc(STATUS[s] || s)}</span>`;

  let feedUrl = null, doc = null, lastOk = 0, lastGen = null, lastGenAt = 0, fails = 0, firstFail = 0, timer = 0, rendered = null, busy = false;
  const userOpen = new Map();  // a <details> the viewer opened or closed: kept across refreshes (this page view only)

  // ---------------------------------------------------------------- the feed
  async function getJson(url, opts) {  // the answer AND its body within FETCH_MS, else it throws (AbortError)
    const c = typeof AbortController === 'function' ? new AbortController() : null;
    const t = c ? setTimeout(() => c.abort(), FETCH_MS) : 0;
    try {
      const r = await fetch(url, c ? Object.assign({}, opts, { signal: c.signal }) : opts);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function readFeed() {
    try {
      const j = await getJson(FEED_FILE, { cache: 'no-store' });
      return j && typeof j.url === 'string' && /^https:\/\/[^\s/@]+(:\d+)?\/[^\s]*$|^http:\/\/127\.0\.0\.1:\d+\/[^\s]*$/.test(j.url) ? j.url : null;
    } catch (e) { return null; }
  }
  async function poll() {
    if (busy) return;  // a request is still waiting: it schedules the next one itself
    busy = true; clearTimeout(timer);
    try {
      if (!feedUrl || (fails && fails % 6 === 0)) feedUrl = (await readFeed()) || feedUrl;
      if (feedUrl) {
        try {
          const j = await getJson(feedUrl, { cache: 'no-cache', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!j || j.kind !== KIND || j.paper_only !== true) throw new Error('not the paper feed');
          fails = 0; firstFail = 0; lastOk = Date.now();
          if (j.generated !== lastGen) { lastGen = j.generated; lastGenAt = Date.now(); }
          doc = j;
          if (rendered !== j.generated) { render(); rendered = j.generated; }
        } catch (e) { fails++; if (!firstFail) firstFail = Date.now(); }  // refused, HTTP error, no answer in 8 s, bad JSON
      } else { fails++; if (!firstFail) firstFail = Date.now(); }
    } finally { busy = false; }
    timer = setTimeout(poll, document.hidden ? HIDDEN_MS : fails < 6 ? POLL_MS : fails < 20 ? 15000 : 30000);
    paint();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  // ---------------------------------------------------------------- the state dot, the "updated" time, the alert
  function paint() {
    const dot = $('dot'), upd = $('upd'), al = $('alert'), now = Date.now();
    let state = 'live', word = 'Live', msg = '', cls = '';
    const down = fails > 0 && (!doc || now - lastOk > 12000);
    if (down) {
      state = 'down'; word = doc ? `Not live · last ${ago(now - lastOk)} ago` : 'Not live'; cls = 'down';
      msg = doc ? `The feed from the VPS is down since ${ct(firstFail)} CT. Showing the last data it sent (updated ${ctd(doc.sim && doc.sim.asof || doc.generated)} CT); retrying.`
        : (feedUrl ? 'Waiting for the feed from the VPS: it does not answer yet (the simulator or its publisher may be off). Retrying.'
          : 'The feed address is not set yet. Retrying.');
    } else if (doc && doc.withheld) {
      state = 'stale'; word = 'Held back';
      msg = 'The VPS held this update back (its safety check found something that must not be public). Nothing is shown until the next clean one.';
    } else if (doc && now - lastGenAt > 30000) {
      state = 'stale'; word = 'Not updating';
      msg = `The feed answers but has not changed for ${ago(now - lastGenAt)}.`;
    } else if (doc && doc.sim && doc.sim.state !== 'ok') {
      state = 'stale'; word = 'Simulator off';
      msg = doc.sim.state === 'missing' ? 'The paper simulator has not written its status yet (it may not be running).' : 'The paper simulator\'s status could not be read; retrying.';
    } else if (doc && doc.sim && tms(doc.sim.asof) != null && tms(doc.generated) - tms(doc.sim.asof) > 60000) {
      state = 'stale'; word = 'Simulator quiet';
      msg = `The paper simulator's last update was ${ct(doc.sim.asof)} CT, ${ago(tms(doc.generated) - tms(doc.sim.asof))} before this feed's.`;
    } else if (doc && tms(doc.generated) != null && now - tms(doc.generated) > 600000) {
      state = 'stale'; word = 'Old data';  // 10 min: far above any clock difference between this device and the VPS
      msg = `The newest data from the VPS is from ${ctd(doc.generated)} CT (${ago(now - tms(doc.generated))} ago). If that looks wrong, check this device's clock.`;
    } else if (!doc) { state = ''; word = 'Connecting…'; }
    dot.className = 'lv ' + state; dot.lastChild.textContent = word;
    const asof = doc && !doc.withheld ? (doc.sim && doc.sim.asof) || doc.generated : null;
    upd.textContent = asof ? `Updated ${ct(asof)} CT · ${ago(now - tms(asof))} ago` : '';
    al.hidden = !msg; al.textContent = msg; al.className = 'alert ' + cls;
    $('main').classList.toggle('old', down || !!(doc && doc.withheld));
    setBar();  // the top bar can wrap to two rows on a phone: the band stays under it
  }
  let barH = 0;
  function setBar() {
    const h = $('bar').offsetHeight;
    if (h !== barH) { barH = h; document.documentElement.style.setProperty('--bar-h', h + 'px'); }
  }
  setInterval(paint, 1000);
  window.addEventListener('resize', setBar);

  // ---------------------------------------------------------------- render
  function render() {
    if (!doc || doc.withheld) return;
    renderSummary(); renderBots(); renderFleets(); renderAccounts(); renderEvents();
  }
  function stratLine(s) {
    if (!s) return '';
    if (s.live) {
      let t = `<b>${esc(s.name)}</b> session ${esc(day(s.session))} · live · ${ok(s.bars) ? s.bars + ' bars' : 'no bar yet'}`;
      if (s.signal && typeof s.signal.side === 'string' && s.signal.side !== 'none') {
        t += ` · tonight ${esc(s.signal.side.toUpperCase())}${ok(s.signal.entry_px) ? ' at ' + px(s.signal.entry_px) : ''}`;
      }
      return `<span class="chip on">${t}</span>`;
    }
    return `<span class="chip"><b>${esc(s.name)}</b> no live session${s.last_session ? ` · last ${esc(day(s.last_session))}` : ''}${s.final_through ? ` · final through ${esc(day(s.final_through))}` : ''}</span>`;
  }
  function renderSummary() {
    const c = doc.counts || {}, sim = doc.sim || {};
    const meaning = sim.buy_meaning === 'every' ? 'a new evaluation every session (or Mon / Wed / Fri)' : 'at most one a session (5 / 3 places)';
    $('sum').innerHTML = stratLine(doc.strategies && doc.strategies.SC) + stratLine(doc.strategies && doc.strategies.GT)
      + `<span class="chip">Open <b class="num">${int(c.open || 0)}</b>: ${int(c.evaluation || 0)} evaluation · ${int(c.funded || 0)} funded · ${int(c.passed || 0)} passed</span>`
      + `<span class="chip">Failed <b class="num">${int(c.failed || 0)}</b>${c.closed ? ` · closed ${int(c.closed)}` : ''}${c.ended ? ` · ended ${int(c.ended)}` : ''}</span>`
      + (sim.buy_meaning ? `<span class="chip">Buying: <b>${esc(meaning)}</b></span>` : '')
      + (sim.start ? `<span class="chip">From <b>${esc(day(sim.start))}</b></span>` : '');
  }
  function renderBots() {
    const ms = doc.masters || [];
    if (!ms.length) { $('bots').innerHTML = '<div class="empty">No bot data.</div>'; return; }
    $('bots').innerHTML = ms.map(m => {
      const role = m.role === 'primary' ? '<span class="tagx prim">feeds the paper</span>' : m.role === 'standby' ? '<span class="tagx">standby</span>' : '';
      const test = m.synthetic ? '<span class="tagx test">test data</span>' : '';
      const sub = `${esc(m.strategy)} · ${esc(m.size)}${m.inst ? ' · ' + esc(m.inst) : ''}`;
      if (m.state !== 'ok') {
        return `<article class="card"><h3><span class="acct">${esc(m.acct)}</span>${role}</h3><div class="muted" style="margin-bottom:6px">${sub}</div>`
          + '<div class="muted">No file from this bot this session yet.</div></article>';
      }
      const p = m.plan;
      let plan = '–';
      if (p) {
        const parts = [];
        if (p.side) parts.push(esc(`${p.side.toUpperCase()} ${p.qty != null ? p.qty : ''}`.trim()));
        else if (p.mode) parts.push(esc(p.mode) + (ok(p.micros) ? ` · ${p.micros} micros` : ''));
        if (p.status && p.status !== 'trade') parts.push({ reached: 'day target reached', no_room: 'no room', balance_unavailable: 'balance unreadable' }[p.status] || '');
        plan = parts.join(' · ') + (ok(p.day_tp) || ok(p.day_sl) ? `<br><span class="muted">day target</span> ${pnl(p.day_tp)} <span class="muted">· day stop</span> ${pnl(ok(p.day_sl) ? -Math.abs(p.day_sl) : null)}` : '');
      }
      const pos = (m.open && m.open.length) ? m.open.map(o => `<span class="pos ${o.side === 'long' ? 'long' : 'short'}">${o.side === 'long' ? 'LONG' : 'SHORT'}${o.qty != null ? ' ' + int(o.qty) : ''}</span>`
          + (ok(o.px) ? ` <span class="num">${px(o.px)}</span>` : '')  // prices only when the feed sends them
          + (ok(o.stop_px) ? ` <span class="muted">stop</span> <span class="num">${px(o.stop_px)}</span>` : '')
          + (ok(o.target_px) ? ` <span class="muted">target</span> <span class="num">${px(o.target_px)}</span>` : '')).join('<br>')
        : '<span class="pos flat">FLAT</span>';
      const v = m.virtual ? `#${m.virtual.n != null ? int(m.virtual.n) : '?'} · ${esc(m.virtual.status || '')}` : '–';
      const st = m.started ? `${m.started.build ? esc(m.started.build) : 'started'}${m.started.orders === true ? ' · orders ON' : m.started.orders === false ? ' · orders OFF' : ''}` : '';
      return `<article class="card"><h3><span class="acct">${esc(m.acct)}</span>${role}${test}</h3>`
        + `<div class="muted" style="margin-bottom:6px">${sub}${m.session ? ' · session ' + esc(day(m.session)) : ''}</div><dl class="kv">`
        + `<dt>Plan</dt><dd>${plan}</dd><dt>Position</dt><dd>${pos}</dd>`
        + `<dt>Today</dt><dd>${pnl(m.day_net)}${m.trades_today ? ` <span class="muted">· ${int(m.trades_today)} closed</span>` : ''}</dd>`
        + `<dt>Virtual</dt><dd>${v}</dd>`
        + (st ? `<dt>Bot</dt><dd>${st}</dd>` : '')
        + (m.warns_today ? `<dt>Warnings</dt><dd class="down">${int(m.warns_today)} today</dd>` : '')
        + `<dt>Last line</dt><dd class="num">${esc(ct(m.last_t))} CT</dd></dl></article>`;
    }).join('');
  }
  const GROUPS = [['SC', '50K'], ['SC', '25K'], ['GT', '50K'], ['GT', '25K']];
  const NAME = { SC: 'Scalper 3m', GT: 'Gold TONL' };
  function counts(c) {
    const out = [];
    for (const k of ['evaluation', 'funded', 'passed']) if (c && c[k]) out.push(`${stChip(k)} <span class="num">${int(c[k])}</span>`);
    return out.length ? `<span class="cnt">${out.join(' ')}</span>` : '<span class="faint">none open</span>';
  }
  function renderFleets() {
    const fl = doc.fleets || [];
    const head = '<thead><tr><th>Buying rule</th><th>Open</th><th class="r">Failed</th><th class="r">Today</th><th class="r">Net to date</th>'
      + '<th class="r">Fees</th><th class="r">Payouts</th><th class="r">Bought</th><th class="r">Passed</th></tr></thead>';
    let body = '';
    for (const [s, z] of GROUPS) {
      const rows = fl.filter(f => f.strat === s && f.size === z);
      if (!rows.length) continue;
      body += `<tr class="grp"><td colspan="9">${esc(NAME[s])} · ${esc(z)}</td></tr>`;
      for (const f of rows) {
        const t = f.to_date || {}, c = f.counts || {};
        body += `<tr><td class="first" data-l="Rule">${esc(f.rule_label)}${f.after_close_differs ? ' <span class="tagx test">final differs</span>' : ''}</td>`
          + `<td data-l="Open">${counts(c)}</td>`
          + `<td class="r num" data-l="Failed">${int(c.failed || 0)}${c.closed ? ` <span class="faint">+${int(c.closed)} closed</span>` : ''}</td>`
          + `<td class="r" data-l="Today">${f.live ? pnl(f.day_net) : '<span class="faint">no session</span>'}</td>`
          + `<td class="r" data-l="Net to date">${pnl(t.net)}</td>`
          + `<td class="r num" data-l="Fees">${usd(t.fees)}</td>`
          + `<td class="r num" data-l="Payouts">${usd(t.recv)}</td>`
          + `<td class="r num" data-l="Bought">${ok(t.bought) ? t.bought : '–'}</td>`
          + `<td class="r num" data-l="Passed">${ok(t.passed) ? t.passed : '–'}</td></tr>`;
      }
    }
    $('fleets').innerHTML = body ? `<table class="tbl">${head}<tbody>${body}</tbody></table>` : '<div class="empty">No fleet data.</div>';
  }
  function accCard(a) {
    const rows = [];
    rows.push(['Balance', `<span class="num">${usd(a.balance)}</span>`]);
    rows.push([a.day_live ? 'Today' : 'Last session', pnl(a.day_net)]);
    if (ok(a.target) || ok(a.stop)) rows.push(['Day target / stop', `${pnl(a.target)} / ${pnl(ok(a.stop) ? -Math.abs(a.stop) : null)}`]);
    if (ok(a.size_units)) rows.push(['Size', `${a.size_units} ${a.unit === 'micros' ? 'micros' : 'MGC'}`]);
    if (a.status === 'evaluation' && ok(a.pass_need)) rows.push(['To pass', `${usd(a.pass_need)}${ok(a.eval_days) ? ` · day ${a.eval_days}${ok(a.min_days) ? ' of ' + a.min_days + '+' : ''}` : ''}`]);
    if (a.status === 'funded') {
      const more = [];
      if (ok(a.payout_more_profit) && a.payout_more_profit > 0) more.push(`${usd(a.payout_more_profit)} more profit`);
      if (ok(a.payout_more_days) && a.payout_more_days > 0) more.push(`${a.payout_more_days} more qualifying day${a.payout_more_days === 1 ? '' : 's'}`);
      rows.push(['Payout', (!more.length && ok(a.payout_now) && a.payout_now > 0 ? `${usd(a.payout_now)} can be taken` : 'not yet' + (more.length ? ': ' + more.join(', ') : ''))
        + (ok(a.payouts) && a.payouts ? ` · ${a.payouts} paid` : '')]);
    }
    if (ok(a.floor)) rows.push(['Floor', `<span class="num">${usd(a.floor)}</span>`]);
    if (a.halted && a.halt) rows.push(['Stopped for the day', esc(a.halt)]);
    rows.push(['Bought', esc(day(a.bought)) + (a.passed ? ` · passed ${esc(day(a.passed))}` : '')]);
    const flag = a.today === 'passed' ? ' <span class="st passed">today</span>' : a.today === 'failed' ? ' <span class="st failed">today</span>' : '';
    return `<div class="acc"><div class="hd"><b>#${esc(a.n)}</b><span>${stChip(a.status)}${flag}${a.provisional ? ' <span class="faint" title="provisional until the after-close final">prov.</span>' : ''}</span></div>`
      + rows.map(r => `<div class="row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('') + '</div>';
  }
  function renderAccounts() {
    const fl = doc.fleets || [], ac = doc.accounts || [];
    $('accts-sub').textContent = `${ac.length} in all · open ones first in each fleet`;
    if (!fl.length) { $('accts').innerHTML = '<div class="empty">No account data.</div>'; return; }
    $('accts').innerHTML = fl.map(f => {
      const mine = ac.filter(a => a.fleet === f.id);
      const open = mine.filter(a => a.status === 'evaluation' || a.status === 'funded' || a.status === 'passed');
      const done = mine.filter(a => !open.includes(a));
      const def = open.length > 0, isOpen = userOpen.has(f.id) ? userOpen.get(f.id) : def;
      const dk = f.id + ':ended', dOpen = userOpen.has(dk) ? userOpen.get(dk) : false;
      const today = f.live ? ` · today ${pnl(f.day_net)}` : '';
      return `<details class="fl" data-k="${esc(f.id)}" data-def="${def ? 1 : 0}"${isOpen ? ' open' : ''}><summary><b>${esc(f.strategy)} ${esc(f.size)}</b>`
        + `<span class="muted">${esc(f.rule_label)}</span><span class="muted">· ${open.length} open · ${done.filter(a => a.status === 'failed').length} failed${today}</span></summary>`
        + (open.length ? `<div class="accts">${open.map(accCard).join('')}</div>` : '<div class="muted" style="padding:0 12px 10px">No open account.</div>')
        + (done.length ? `<details class="ended" data-k="${esc(dk)}" data-def="0"${dOpen ? ' open' : ''}><summary>${done.length} failed or closed</summary><div class="endl">`
          + done.map(a => `<div><b>#${esc(a.n)}</b>${stChip(a.status)}<span>${esc(day(a.ended))}${ok(a.balance) ? ' · ' + usd(a.balance) : ''}${a.end_reason ? ' · ' + esc(a.end_reason) : ''}</span></div>`).join('')
          + '</div></details>' : '')
        + '</details>';
    }).join('');
  }
  $('accts').addEventListener('toggle', e => {  // capture: "toggle" does not bubble
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.k) return;
    if (d.open === (d.dataset.def === '1')) userOpen.delete(d.dataset.k); else userOpen.set(d.dataset.k, d.open);
  }, true);
  function renderEvents() {
    const ev = (doc.events || []).slice().reverse();
    $('evs').innerHTML = ev.length ? '<ul class="evs">' + ev.map(e => {
      const who = e.acct || e.strategy || '';
      return `<li class="${e.sev === 'urgent' ? 'urgent' : e.sev === 'warn' ? 'warn' : ''}"><span class="t" title="${esc(ctd(e.t))} CT">${esc(ct(e.t))}</span>`
        + `<span class="w" title="${esc(who)}">${esc(who)}${e.src === 'bot' ? ' <span class="tagx">bot</span>' : ''}</span><span class="x">${esc(e.text)}</span></li>`;
    }).join('') + '</ul>' : '<div class="empty">No event yet.</div>';
  }

  function start() { setBar(); paint(); poll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
