// Lucid paper week: the live PAPER page (owner 8/11/2026, D6: on the Signal Board site, not in its navigation, noindex;
// redesign 10/11/2026 to the owner's approved layout: summary strip, live now (the 4 Sim bots), all paper accounts,
// calendar heatmap, live trades).
// PAPER ONLY - Sim, no real money. It reads the VPS's paper-only feed: its address is in data/paper_feed.json {"url": ...}
// (read again while the feed fails, so a new address needs no code change); the document there is the publisher's
// sanitized "rdx-lucid-paper-public" v1 (v1.1 adds the bots' live numbers, every account's day by day and the trades feed).
// Polled every 5 s (30 s while the tab is hidden); when the feed is down the page keeps the last data, greyed, says since
// when, and keeps retrying (5 s, then 15 s, then 30 s). A request that gets no answer in 8 s counts as down too. One
// request at a time. A day's trades come from the feed's second document (days.json next to paper.json), fetched only when
// a calendar square is opened and again while it is open when the feed says it changed. Nothing is stored in the browser.
// Market prices are shown only when the feed sends them (the publisher sends none unless the owner turns them on).
(function () {
  'use strict';
  const POLL_MS = 5000, HIDDEN_MS = 30000, FETCH_MS = 8000, FEED_FILE = 'data/paper_feed.json';
  const KIND = 'rdx-lucid-paper-public', KIND_DAYS = 'rdx-lucid-paper-days';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = v => typeof v === 'number' && isFinite(v);
  const int = v => ok(v) ? String(Math.round(v)) : '–';  // a count put into HTML: a number or a dash, never raw text
  const tms = s => { const t = Date.parse(s); return isFinite(t) ? t : null; };
  let fCT, fCTd, fCTw;
  try {
    fCT = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    fCTd = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    fCTw = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch (e) { fCT = fCTd = fCTw = null; }
  const ct = s => { const t = typeof s === 'number' ? s : tms(s); return t == null ? '–' : fCT ? fCT.format(t) : new Date(t).toISOString().slice(11, 19) + 'Z'; };
  const ctd = s => { const t = tms(s); return t == null ? '–' : fCTd ? fCTd.format(t) : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z'; };
  const ctw = s => { const t = tms(s); return t == null ? '–' : fCTw ? fCTw.format(t).replace(',', '') : new Date(t).toISOString().slice(5, 19).replace('T', ' ') + 'Z'; };
  const n2 = v => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd = v => ok(v) ? (v < 0 ? '−$' : '$') + n2(v) : '–';
  const sgn = v => ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + n2(v) : '–';
  const cls = v => ok(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '';
  const pnl = v => ok(v) ? `<span class="num ${cls(v)}">${sgn(v)}</span>` : '<span class="faint">–</span>';
  const pnlUsd = v => ok(v) ? `<span class="num ${cls(v)}">${v > 0 ? '+' : v < 0 ? '−' : ''}$${n2(v)}</span>` : '<span class="faint">–</span>';
  const px = v => ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–';
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const dayOf = (s, o) => isDate(s) ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o)) : '–';
  const day = s => dayOf(s, { weekday: 'short', day: 'numeric', month: 'short' });
  const ago = msv => { const s = Math.max(0, Math.round(msv / 1000)); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
  const STATUS = { evaluation: 'Evaluation', funded: 'Funded', passed: 'Passed', failed: 'Failed', closed: 'Closed', ended: 'Ended' };
  const stChip = s => s ? `<span class="st ${esc(s)}">${esc(STATUS[s] || s)}</span>` : '';
  const SIDE = s => s === 'long' ? 'LONG' : s === 'short' ? 'SHORT' : '';
  const sideChip = (side, size) => SIDE(side) ? `<span class="pos ${side === 'long' ? 'long' : 'short'}">${SIDE(side)}${size ? ' ' + esc(size) : ''}</span>` : (size ? esc(size) : '');
  const NAME = { SC: 'Scalper 3m', GT: 'Gold TONL' };
  const GROUPS = [['SC', '50K'], ['SC', '25K'], ['GT', '50K'], ['GT', '25K']];
  const stratOf = id => /^SC/.test(id) ? 'SC' : 'GT';
  const sizeOf = id => (String(id).match(/-(50K|25K)-/) || [])[1] || '';
  const OPEN = new Set(['evaluation', 'funded', 'passed']);

  let feedUrl = null, doc = null, lastOk = 0, lastGen = null, lastGenAt = 0, fails = 0, firstFail = 0, timer = 0, rendered = null, busy = false;
  const filt = { strat: '', size: '' };           // the accounts table's filter (this page view only)
  let sel = null, daysDoc = null, daysErr = false, daysBusy = null, calScrolled = false;

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
  const FEED_OPTS = { cache: 'no-cache', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' };
  async function poll() {
    if (busy) return;  // a request is still waiting: it schedules the next one itself
    busy = true; clearTimeout(timer);
    try {
      if (!feedUrl || (fails && fails % 6 === 0)) feedUrl = (await readFeed()) || feedUrl;
      if (feedUrl) {
        try {
          const j = await getJson(feedUrl, FEED_OPTS);
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

  // the days document (each day's trades): next to the feed, fetched only for an opened calendar square
  const daysUrl = () => feedUrl && /paper\.json(\?|$)/.test(feedUrl) ? feedUrl.replace(/paper\.json(?=\?|$)/, 'days.json') : null;
  function fetchDays() {
    if (daysBusy) return daysBusy;
    const u = daysUrl();
    if (!u) { daysErr = true; return Promise.resolve(); }
    daysBusy = (async () => {
      try {
        const j = await getJson(u, FEED_OPTS);
        if (j && j.kind === KIND_DAYS && j.paper_only === true && !j.withheld && Array.isArray(j.accounts)) { daysDoc = j; daysErr = false; }
        else daysErr = true;
      } catch (e) { daysErr = true; } finally { daysBusy = null; }
    })();
    return daysBusy;
  }

  // ---------------------------------------------------------------- the state dot, the "updated" time, the alert
  function paint() {
    const dot = $('dot'), upd = $('upd'), al = $('alert'), now = Date.now();
    let state = 'live', word = 'Live', msg = '', klass = '';
    const down = fails > 0 && (!doc || now - lastOk > 12000);
    if (down) {
      state = 'down'; word = doc ? `Not live · last ${ago(now - lastOk)} ago` : 'Not live'; klass = 'down';
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
    al.hidden = !msg; al.textContent = msg; al.className = 'alert ' + klass;
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
    renderSummary(); renderBots(); renderAccounts(); renderCal(); renderTrades();
    if (sel) {
      renderDay();
      if (!daysDoc || (doc.days_at && daysDoc.generated !== doc.days_at)) fetchDays().then(renderDay);
    }
  }

  // 1. the summary strip
  function summaryOf() {
    if (doc.summary) return doc.summary;
    const c = doc.counts || {}, fl = doc.fleets || [], sum = k => fl.reduce((a, f) => a + ((f.to_date || {})[k] || 0), 0);  // a v1 feed
    const live = fl.filter(f => f.live);
    return { open: c.open, evaluation: c.evaluation, funded: c.funded, waiting: c.passed, passed: sum('passed'), failed: c.failed, closed: c.closed,
      today: live.length ? live.reduce((a, f) => a + (f.day_net || 0), 0) : null, fees: sum('fees'), recv: sum('recv'), net: sum('net') };
  }
  function renderSummary() {
    const s = summaryOf();
    const tile = (lbl, val, sub) => `<div class="tile"><span class="lbl">${lbl}</span><span class="val">${val}</span><span class="sub">${sub}</span></div>`;
    $('sum').innerHTML =
      tile('Open', `<span class="num">${int(s.open)}</span>`, `${int(s.evaluation)} evaluation · ${int(s.funded)} funded${s.waiting ? ` · ${int(s.waiting)} passed, not yet funded` : ''}`)
      + tile('Passed', `<span class="num up">${int(s.passed)}</span>`, 'evaluations passed to date')
      + tile('Failed', `<span class="num${s.failed ? ' down' : ''}">${int(s.failed)}</span>`, s.closed ? `to date · ${int(s.closed)} closed` : 'to date')
      + tile('Today\'s P&amp;L', pnlUsd(s.today), ok(s.today) ? 'all paper accounts, live' : 'no session now')
      + tile('Net to date', pnlUsd(s.net), `fees ${usd(s.fees)} · payouts ${usd(s.recv)}`);
  }

  // 2. live now: the 4 bots
  function instText(m) {
    const mon = typeof m.inst === 'string' ? (m.inst.match(/ (\d{2}-\d{2})$/) || [])[1] : null;
    return m.unit ? esc(m.unit) + (mon ? ' ' + esc(mon) : '') : esc(m.inst || '');
  }
  function bar(label, value, limit, stop) {
    const v = ok(value) ? (stop ? Math.max(0, -value) : Math.max(0, value)) : 0;
    const pct = ok(limit) && limit > 0 ? Math.min(100, v / limit * 100) : 0;
    return `<div class="bar${stop ? ' stop' : ''}"><span class="bl">${label}</span><span class="bt"><i style="width:${pct.toFixed(1)}%"></i></span>`
      + `<span class="bv">${Math.round(pct)}% of ${ok(limit) ? (stop ? '−' : '+') + n2(limit) : '–'}</span></div>`;
  }
  function botCard(m) {
    const role = m.role === 'primary' ? '<span class="tagx prim">feeds the paper</span>' : m.role === 'standby' ? '<span class="tagx">standby</span>' : '';
    const test = m.synthetic ? '<span class="tagx test">test data</span>' : '';
    const head = `<div class="bh"><span class="acct">${esc(m.acct)}</span>${stChip(m.status)}${role}${test}</div>`
      + `<div class="bsub">${esc(m.strategy)} · ${esc(m.size)}${m.inst || m.unit ? ' · ' + instText(m) : ''}</div>`;
    if (m.state !== 'ok') return `<article class="card">${head}<div class="muted">No file from this bot this session yet.</div></article>`;
    const kp = `<div class="kpis"><div class="kpi"><span class="lbl">Balance</span><span class="big">${usd(m.balance)}</span>`
      + `<span class="sm">start of day ${usd(m.start_of_day)}</span></div>`
      + `<div class="kpi"><span class="lbl">Room to the max-loss floor</span><span class="big${ok(m.room) && m.room < 0 ? ' down' : ''}">${usd(m.room)}</span>`
      + `<span class="sm">floor ${usd(m.floor)}</span></div></div>`;
    const open = (m.open || []).filter(o => o.side === 'long' || o.side === 'short');
    const trades = open.length ? open.map(o => {
      const entry = ok(o.avg_px) ? o.avg_px : o.px;
      const prices = ok(entry) || ok(o.last_px) ? `<div class="tp"><span>entry <b>${px(entry)}</b></span><span>now <b>${px(o.last_px)}</b></span></div>` : '';
      const exits = ok(o.stop_px) || ok(o.target_px) ? `<div class="tx">stop ${px(o.stop_px)} · target ${px(o.target_px)}</div>` : '';
      return `<div class="trade"><div class="tl">${sideChip(o.side, o.size || (ok(o.qty) ? int(o.qty) : ''))}<span class="pnl ${cls(o.pnl)}">${ok(o.pnl) ? sgn(o.pnl) : '–'}</span></div>${prices}${exits}</div>`;
    }).join('') : '<div class="trade flat"><div class="tl"><span class="pos flat">FLAT</span> no open trade</div></div>';
    const today = ok(m.today) ? m.today : m.day_net;
    const bars = `<div class="bars">${bar('Day target', today, m.day_target, false)}${bar('Day stop', today, m.day_stop, true)}</div>`;
    const priced = m.price_t ? ` · live P&amp;L from the ${esc(ct(m.price_t).slice(0, 5))} CT minute bar` : '';
    const foot = `<div class="bf">Today ${pnl(today)} · ${int(m.trades_today || 0)} closed${priced}${m.warns_today ? ` · <span class="down">${int(m.warns_today)} warning${m.warns_today === 1 ? '' : 's'}</span>` : ''}</div>`;
    return `<article class="card">${head}${kp}${trades}${bars}${foot}</article>`;
  }
  function renderBots() {
    const ms = doc.masters || [];
    const ss = ms.map(m => m.session).filter(isDate).sort();
    $('live-sub').textContent = (ss.length ? `session ${day(ss[ss.length - 1])} · ` : '') + 'the 4 bots on NinjaTrader Sim';
    $('bots').innerHTML = ms.length ? ms.map(botCard).join('') : '<div class="empty">No bot data.</div>';
  }

  // 3. all paper accounts
  function ruleOf(fid) { const f = (doc.fleets || []).find(x => x.id === fid); return f ? f.rule_label : ''; }
  function accRow(a) {
    const open = OPEN.has(a.status);
    const flag = a.today === 'passed' || a.today === 'failed' ? ' <span class="faint">today</span>' : '';
    let need = '–';
    if (a.status === 'evaluation' && ok(a.pass_need)) need = usd(a.pass_need) + (ok(a.eval_days) ? `<span class="halt">day ${int(a.eval_days)}${ok(a.min_days) ? ' of ' + int(a.min_days) + '+' : ''}</span>` : '');
    else if (a.status === 'passed' || (a.passed && a.status !== 'evaluation')) need = '<span class="up">passed</span>';
    const pays = ok(a.payouts) && a.payouts ? int(a.payouts) + (ok(a.pay_recv) ? ' · ' + usd(a.pay_recv) : '') : (ok(a.pay_recv) ? usd(a.pay_recv) : '–');
    const today = a.session && ok(a.day_net) ? pnl(a.day_net) + (a.halted && a.halt ? `<span class="halt">${esc(a.halt)}</span>` : '') : '<span class="faint">–</span>';
    return `<tr class="row${open ? '' : ' done'}"><td class="c-id">${esc(a.id)}</td><td class="c-rule">${esc(ruleOf(a.fleet))}</td>`
      + `<td class="c-st">${stChip(a.status)}${flag}</td><td class="c-bal r">${usd(a.balance)}</td>`
      + `<td class="c-room r" data-l="Room">${open ? usd(a.room) : '–'}</td><td class="c-today r" data-l="Today">${today}</td>`
      + `<td class="c-need r" data-l="To pass">${need}</td><td class="c-pay r" data-l="Payouts">${pays}</td></tr>`;
  }
  function renderAccounts() {
    const all = doc.accounts || [];
    const ac = all.filter(a => (!filt.strat || stratOf(a.fleet) === filt.strat) && (!filt.size || sizeOf(a.fleet) === filt.size));
    $('acc-sub').textContent = `${ac.length === all.length ? all.length : ac.length + ' of ' + all.length} accounts · open ones first`;
    let body = '';
    for (const [s, z] of GROUPS) {
      const rows = ac.filter(a => stratOf(a.fleet) === s && sizeOf(a.fleet) === z);
      if (!rows.length) continue;
      const nOpen = rows.filter(a => OPEN.has(a.status)).length, nFail = rows.filter(a => a.status === 'failed').length;
      body += `<tr class="grp"><td colspan="8">${esc(NAME[s])} · ${esc(z)}<span>${nOpen} open${nFail ? ` · ${nFail} failed` : ''}</span></td></tr>`;
      body += rows.map(accRow).join('');
    }
    const head = '<thead><tr><th>Account</th><th>Buying rule</th><th>Status</th><th class="r">Balance</th><th class="r">Room</th>'
      + '<th class="r">Today</th><th class="r">To pass</th><th class="r">Payouts</th></tr></thead>';
    $('accts').innerHTML = body ? `<table class="atbl">${head}<tbody>${body}</tbody></table>` : `<div class="empty">${all.length ? 'No account in this filter.' : 'No paper account yet.'}</div>`;
  }
  document.querySelector('.filters').addEventListener('click', e => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    const seg = b.parentElement;
    filt[seg.dataset.f] = b.dataset.v;
    for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    if (doc && !doc.withheld) renderAccounts();
  });

  // 4. the calendar heatmap
  const MARKS = { fail: ['✕', 'failed'], pass: ['▲', 'passed'], payout: ['◆', 'payout'] };
  function calRows() {
    const rows = [['Bots on NinjaTrader Sim', (doc.masters || []).map(m => ({ id: m.acct, z: m.size, days: m.days || [] }))]];
    for (const [s, z] of GROUPS) {
      const acc = (doc.accounts || []).filter(a => stratOf(a.fleet) === s && sizeOf(a.fleet) === z);
      if (acc.length) rows.push([`${NAME[s]} · ${z}`, acc.map(a => ({ id: a.id, z, days: a.days || [] }))]);
    }
    return rows;
  }
  function findDay(id, s) {
    for (const [, list] of calRows()) for (const r of list) if (r.id === id) return { row: r, d: (r.days || []).find(x => x.s === s) || null };
    return null;
  }
  function square(r, d, s) {
    if (!d) return '<td><span class="sq-none"></span></td>';
    const scale = r.z === '25K' ? 750 : 1500;  // a full colour at a day of 3% of the account
    const k = ok(d.net) && d.net > 0 ? 'up' : ok(d.net) && d.net < 0 ? 'down' : 'zero';
    const a = ok(d.net) ? 0.28 + 0.72 * Math.min(1, Math.abs(d.net) / scale) : 0;
    const mk = (d.marks || []).find(x => MARKS[x]);
    const isSel = sel && sel.a === r.id && sel.s === s;
    const lab = `${r.id} ${day(s)} ${ok(d.net) ? sgn(d.net) : ''}${(d.marks || []).filter(x => MARKS[x]).map(x => ' ' + MARKS[x][1]).join('')}${d.live ? ' live' : ''}`;
    return `<td><button type="button" class="sq ${k}${d.live ? ' live' : ''}${isSel ? ' sel' : ''}" style="--a:${a.toFixed(2)}" data-a="${esc(r.id)}" data-s="${esc(s)}"`
      + ` title="${esc(lab)}" aria-label="${esc(lab)}" aria-pressed="${isSel ? 'true' : 'false'}">${mk ? MARKS[mk][0] : ''}</button></td>`;
  }
  function renderCal() {
    const ss = (doc.sessions || []).filter(isDate);
    if (!ss.length) { $('cal').innerHTML = `<div class="empty">${doc.sessions ? 'No session yet.' : 'The calendar needs the updated feed (v1.1).'}</div>`; return; }
    const liveS = new Set((doc.masters || []).concat(doc.accounts || []).flatMap(x => (x.days || []).filter(d => d.live).map(d => d.s)));
    const head = '<thead><tr><th></th>' + ss.map(s => `<th class="${liveS.has(s) ? 'now' : ''}" title="${esc(day(s))}">${esc(dayOf(s, { weekday: 'short' }))}<br>${esc(dayOf(s, { day: 'numeric' }))}</th>`).join('') + '</tr></thead>';
    let body = '';
    for (const [g, list] of calRows()) {
      body += `<tr class="grp"><th colspan="${ss.length + 1}">${esc(g)}</th></tr>`;
      for (const r of list) {
        const by = new Map((r.days || []).map(d => [d.s, d]));
        body += `<tr><th class="hl" scope="row">${esc(r.id)}</th>${ss.map(s => square(r, by.get(s), s)).join('')}</tr>`;
      }
    }
    const old = document.querySelector('#cal .cal-scroll');
    const left = old ? old.scrollLeft : null;
    $('cal').innerHTML = `<div class="cal-scroll"><table class="hm">${head}<tbody>${body}</tbody></table></div>`;
    const sc = document.querySelector('#cal .cal-scroll');
    if (left != null) sc.scrollLeft = left; else if (!calScrolled) { sc.scrollLeft = sc.scrollWidth; calScrolled = true; }  // the newest sessions in view
  }
  $('cal').addEventListener('click', e => {
    const b = e.target.closest('button.sq');
    if (!b) return;
    const same = sel && sel.a === b.dataset.a && sel.s === b.dataset.s;
    sel = same ? null : { a: b.dataset.a, s: b.dataset.s };
    for (const x of document.querySelectorAll('#cal .sq.sel')) { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); }
    if (sel) { b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); }
    renderDay();
    if (sel) {
      if (!daysDoc || (doc.days_at && daysDoc.generated !== doc.days_at)) fetchDays().then(renderDay);
      $('day').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  $('day').addEventListener('click', e => {
    if (!e.target.closest('button.x')) return;
    sel = null; renderDay();
    for (const x of document.querySelectorAll('#cal .sq.sel')) { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); }
  });
  const HOW = { open: 'still open', exit: 'closed', closed: 'closed' };
  function renderDay() {
    const box = $('day');
    if (!sel || !doc) { box.hidden = true; box.innerHTML = ''; return; }
    const f = findDay(sel.a, sel.s);
    const d = f && f.d;
    const marks = d ? (d.marks || []).filter(x => MARKS[x]).map(x => `<span class="${x === 'fail' ? 'down' : 'up'}">${MARKS[x][0]} ${MARKS[x][1]}</span>`).join(' ') : '';
    let html = `<div class="dh"><b>${esc(sel.a)}</b><span>${esc(day(sel.s))}${d && d.live ? ' · live' : ''}</span>`
      + (d ? `<span>day ${pnl(d.net)}</span><span class="muted">end balance <span class="num">${usd(d.bal)}</span></span>${marks}` : '')
      + '<button type="button" class="x" aria-label="Close">×</button></div>';
    const acc = daysDoc && (daysDoc.accounts || []).find(x => x.id === sel.a);
    const dd = acc && (acc.days || []).find(x => x.s === sel.s);
    const trades = dd ? dd.trades || [] : null;
    if (trades && trades.length) {
      const hasPx = trades.some(t => 'px_in' in t);
      html += '<table class="dtbl"><thead><tr><th>In (CT)</th><th>Out (CT)</th><th>Trade</th>' + (hasPx ? '<th>Entry → exit</th>' : '')
        + '<th class="r">Result</th><th>How it ended</th></tr></thead><tbody>'
        + trades.map(t => `<tr><td class="tin">${esc(ct(t.tin))}</td><td class="tout">${t.tout ? esc(ct(t.tout)) : '–'}</td>`
          + `<td class="sd">${sideChip(t.side, t.size)}</td>` + (hasPx ? `<td class="pxs">${px(t.px_in)} → ${t.tout ? px(t.px_out) : '…'}</td>` : '')
          + `<td class="res r">${pnl(t.net)}</td><td class="how">${esc(HOW[t.how] || t.how || '')}</td></tr>`).join('')
        + '</tbody></table>';
      const sum = trades.reduce((a, t) => a + (ok(t.net) ? t.net : 0), 0);
      if (d && d.final && ok(d.net) && trades.every(t => ok(t.net)) && Math.abs(sum - d.net) > 0.5)
        html += `<div class="note">The trades are as the simulator saw them live (${sgn(sum)}); the after-close final for the day is ${sgn(d.net)}.</div>`;
    } else if (trades) html += '<div class="muted">No trade that day.</div>';
    else if (daysBusy || (!daysDoc && !daysErr)) html += '<div class="muted">Loading the trades…</div>';
    else html += '<div class="muted">The trades of this day are not available from the feed right now.</div>';
    box.innerHTML = html; box.hidden = false;
  }

  // 5. live trades
  function renderTrades() {
    if (!doc.trades) {  // a v1 feed: its entry / exit events
      const ev = (doc.events || []).filter(e => e.ev === 'entry' || e.ev === 'exit').slice().reverse();
      $('trades').innerHTML = ev.length ? '<ul class="trl">' + ev.map(e => `<li><span class="t" title="${esc(ctd(e.t))} CT">${esc(ctw(e.t))}</span>`
        + `<span class="e ${e.ev}">${e.ev === 'entry' ? 'ENTRY' : 'EXIT'}</span><span class="x">${esc(e.text)}</span><span class="w">${esc(e.acct || '')}${e.src === 'bot' ? ' · bot' : ''}</span></li>`).join('') + '</ul>'
        : '<div class="empty">No trade yet.</div>';
      return;
    }
    const tr = doc.trades.slice().reverse();
    $('trades').innerHTML = tr.length ? '<ul class="trl">' + tr.map(r => {
      const what = r.ev === 'exit' ? `${pnl(r.net)}${r.how ? ' <span class="muted">' + esc(r.how) + '</span>' : ''}${ok(r.px) ? ' <span class="muted">· out</span> <b>' + px(r.px) + '</b>' : ''}`
        : (ok(r.px) ? '<span class="muted">in</span> <b>' + px(r.px) + '</b>' : '');
      const who = (r.accts || []).map(esc).join(' · ') + (r.src === 'bot' ? ' · bot on Sim' : '');
      return `<li><span class="t" title="${esc(ctd(r.t))} CT">${esc(ctw(r.t))}</span><span class="e ${r.ev === 'entry' ? 'entry' : 'exit'}">${r.ev === 'entry' ? 'ENTRY' : 'EXIT'}</span>`
        + `<span class="x">${sideChip(r.side, r.size)} ${what}</span><span class="w">${who}</span></li>`;
    }).join('') + '</ul>' : '<div class="empty">No trade yet.</div>';
  }

  function start() { setBar(); paint(); poll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
