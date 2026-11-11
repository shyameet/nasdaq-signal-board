// Lucid paper week: the live PAPER page (owner 8/11/2026, D6: on the Signal Board site, not in its navigation, noindex;
// redesign 10/11/2026 to the owner's approved layout: summary strip, live now (the 4 Sim bots), all paper accounts,
// calendar, live trades; 10/11/2026 the owner's picks from the design canvas: Rules A (three buying-rule cards with the
// week's buys), Calendar A (one block a buying rule, the day's P&L in each square, balance and the way to the pass) and
// Trades A (one row a whole trade, open trades on top)).
// PAPER ONLY - Sim, no real money. It reads the VPS's paper-only feed: its address is in data/paper_feed.json {"url": ...}
// (read again while the feed fails, so a new address needs no code change); the document there is the publisher's
// sanitized "rdx-lucid-paper-public" v1 (v1.1 adds the bots' live numbers, every account's day by day and the trades feed).
// Polled every 5 s (30 s while the tab is hidden); when the feed is down the page keeps the last data, greyed, says since
// when, and keeps retrying (5 s, then 15 s, then 30 s). A request that gets no answer in 8 s counts as down too. One
// request at a time. Every account's trades come from the feed's second document (days.json next to paper.json), fetched
// again whenever the feed says it changed (days_at); the live trades are built from it (whole trades, entry and exit
// together). Nothing is stored in the browser.
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
  const sgn = v => ok(v) ? (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + n2(v) : '–';
  const cls = v => ok(v) ? (v > 0.004 ? 'up' : v < -0.004 ? 'down' : '') : '';
  const pnl = v => ok(v) ? `<span class="num ${cls(v)}">${sgn(v)}</span>` : '<span class="faint">–</span>';
  const pnlUsd = v => ok(v) ? `<span class="num ${cls(v)}">${v > 0.004 ? '+' : v < -0.004 ? '−' : ''}$${n2(v)}</span>` : '<span class="faint">–</span>';
  const px = v => ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–';
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const dayOf = (s, o) => isDate(s) ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o)) : '–';
  const day = s => dayOf(s, { weekday: 'short', day: 'numeric', month: 'short' });
  const short = s => isDate(s) ? dayOf(s, { weekday: 'short' }) + ' ' + dayOf(s, { day: 'numeric' }) : '–';   // "Mon 9"
  const ago = msv => { const s = Math.max(0, Math.round(msv / 1000)); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
  const STATUS = { evaluation: 'Evaluation', funded: 'Funded', passed: 'Passed', failed: 'Failed', closed: 'Closed', ended: 'Ended' };
  const stChip = s => s ? `<span class="st ${esc(s)}">${esc(STATUS[s] || s)}</span>` : '';
  const SIDE = s => s === 'long' ? 'LONG' : s === 'short' ? 'SHORT' : '';
  const sideChip = (side, size) => SIDE(side) ? `<span class="pos ${side === 'long' ? 'long' : 'short'}">${SIDE(side)}${size ? ' ' + esc(size) : ''}</span>` : (size ? esc(size) : '');
  const NAME = { SC: 'Scalper 3m', GT: 'Gold TONL' };
  const KIND_NAME = { SC: 'Scalper', GT: 'Gold' };
  const GROUPS = [['SC', '50K'], ['SC', '25K'], ['GT', '50K'], ['GT', '25K']];
  const stratOf = id => /^SC/.test(id) ? 'SC' : 'GT';
  const sizeOf = id => (String(id).match(/-(50K|25K)-/) || [])[1] || '';
  const placeOf = id => Number((String(id).match(/#(\d+)$/) || [])[1]) || 0;
  const OPEN = new Set(['evaluation', 'funded', 'passed']);
  const CHECK = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5l2.5 2.5 4.5-5.5"></path></svg>';

  let feedUrl = null, doc = null, lastOk = 0, lastGen = null, lastGenAt = 0, fails = 0, firstFail = 0, timer = 0, rendered = null, busy = false;
  const filt = { strat: '', size: '' };           // the accounts table's filter (this page view only)
  let sel = null, daysDoc = null, daysErr = false, daysBusy = null;
  // owner 11/11/2026: the live trades are their own view (the page no longer grows with them), one session at a time;
  // #trades opens that view (a bookmark or a link), the overview is the page without a hash
  let view = location.hash === '#trades' ? 'trades' : 'main', trSess = null;

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

  // the days document (every account's trades, day by day): next to the feed, fetched again when the feed says it changed
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
  const daysStale = () => !daysDoc || !!(doc && doc.days_at && daysDoc.generated !== doc.days_at);

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
  function setView(v, push) {
    view = v === 'trades' ? 'trades' : 'main';
    for (const s of document.querySelectorAll('main > section[data-view]')) s.hidden = s.dataset.view !== view;
    for (const b of document.querySelectorAll('#views button')) b.setAttribute('aria-pressed', b.dataset.view === view ? 'true' : 'false');
    if (push) {
      try { history.replaceState(null, '', view === 'trades' ? '#trades' : location.pathname + location.search); } catch (e) { /* the view still switches */ }
      window.scrollTo(0, 0);
    }
  }
  $('views').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view, true); });
  window.addEventListener('hashchange', () => setView(location.hash === '#trades' ? 'trades' : 'main', false));
  setView(view, false);

  function render() {
    if (!doc || doc.withheld) return;
    renderSummary(); renderBots(); renderAccounts(); renderRules(); renderCal(); renderTrades();
    if (sel) renderDay();
    if (daysStale() && !daysBusy) fetchDays().then(() => { if (doc && !doc.withheld) { renderCal(); renderTrades(); renderDay(); } });
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
    // owner 11/11/2026: a bot that passed and bought its next evaluation says so ("Passed #1 (Tue 10)" = the session
    // that earned it); the feed's last_end = its latest ended purchase, so a later fail drops the chip
    const le = m.last_end, nNow = m.virtual && ok(m.virtual.n) ? m.virtual.n : null;
    const passed = le && le.how === 'pass' && isDate(le.s) && m.status === 'evaluation' && !(ok(le.n) && nNow != null && le.n >= nNow)
      ? `<span class="st passed" title="${esc(`Purchase${ok(le.n) ? ' #' + int(le.n) : ''} reached the target on the ${day(le.s)} session`
        + `${ok(le.best_pct) ? ` (best day ${le.best_pct.toFixed(3)}% of the profit)` : ''}; the bot now runs its next evaluation${nNow != null ? ', #' + int(nNow) : ''}.`)}">`
        + `Passed${ok(le.n) ? ' #' + int(le.n) : ''} (${esc(short(le.s))})</span>` : '';
    const head = `<div class="bh"><span class="acct">${esc(m.acct)}</span>${stChip(m.status)}${passed}${role}${test}</div>`
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

  // ---------------------------------------------------------------- sessions and the buying rules
  // A session is named by the day it ends: Mon = Sun 17:00 CT to Mon 16:00 CT. The feed's sessions are the ones so far.
  const addD = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const wdOf = s => new Date(s + 'T12:00:00Z').getUTCDay();          // 0 Sun … 6 Sat
  const isWd = s => wdOf(s) > 0 && wdOf(s) < 6;
  const nextWd = s => { let x = addD(s, 1); while (!isWd(x)) x = addD(x, 1); return x; };
  const weekOf = s => { const mon = addD(s, -((wdOf(s) + 6) % 7)); return [0, 1, 2, 3, 4].map(i => addD(mon, i)); };
  const sessList = () => (doc.sessions || []).filter(isDate).slice().sort();
  const curSess = () => { const ss = sessList(); return ss.length ? ss[ss.length - 1] : null; };
  const liveSet = () => new Set((doc.masters || []).concat(doc.accounts || []).flatMap(x => (x.days || []).filter(d => d.live).map(d => d.s)));
  function calCols() {  // every weekday from the Monday of the first session's week to the Friday of the last one's, and every session
    const ss = sessList();
    if (!ss.length) return [];
    const set = new Set(ss);
    for (let d = weekOf(ss[0])[0], end = weekOf(ss[ss.length - 1])[4]; d <= end; d = addD(d, 1)) if (isWd(d)) set.add(d);
    return [...set].sort();
  }
  function sessNo(s) {  // the paper's session number (1 = its first session), weekdays only
    const ss = sessList();
    if (!ss.length || s < ss[0]) return 0;
    let n = 0;
    for (let d = ss[0]; d <= s; d = addD(d, 1)) if (isWd(d)) n++;
    return n;
  }
  // the buying rules (the simulator's "every" meaning, lp_common.BUY_TEXT): what each one buys and when
  const RULES = [
    ['demo', 'As the demo', 'Same buying as the demo fund: Scalper buys one a session on the first 5 sessions, Gold on sessions 1, 2 and 3. '
      + 'A Scalper place that fails is bought again the next session; a Gold place buys again the session after it passes or fails.'],
    ['one', 'One every session', 'One new evaluation every session, while fewer than 10 are open.'],
    ['mwf', 'Mon / Wed / Fri', 'One new evaluation every Monday, Wednesday and Friday session, while fewer than 10 are open.'],
  ];
  function rulesOf() {
    const have = [...new Set((doc.fleets || []).map(f => f.rule).filter(Boolean))];
    const out = RULES.filter(r => have.includes(r[0]));
    for (const r of have) if (!RULES.some(x => x[0] === r)) out.push([r, ((doc.fleets || []).find(f => f.rule === r) || {}).rule_label || r, '']);
    return out;
  }
  const ruleOfAcct = a => { const f = (doc.fleets || []).find(x => x.id === a.fleet); return f ? f.rule : String(a.fleet || '').split('-')[2]; };
  function plans(rule, strat, s) {  // does this rule plan a purchase on this session (strat: SC / GT, or null = any)
    if (!isWd(s)) return false;
    if (rule === 'demo') { const k = sessNo(s); return k >= 1 && k <= (strat === 'GT' ? 3 : 5); }
    if (rule === 'one') return true;
    if (rule === 'mwf') return [1, 3, 5].includes(wdOf(s));
    return false;
  }
  const boughtOn = (rule, strat, s) => (doc.accounts || []).some(a => a.bought === s && ruleOfAcct(a) === rule && (!strat || stratOf(a.fleet) === strat));
  function ruleStats(rule) {
    const fl = (doc.fleets || []).filter(f => f.rule === rule);
    const td = k => fl.reduce((a, f) => a + (((f.to_date || {})[k]) || 0), 0), cn = k => fl.reduce((a, f) => a + (((f.counts || {})[k]) || 0), 0);
    const live = fl.filter(f => f.live && ok(f.day_net)), cs = curSess();
    let today = null, lab = cs ? `${dayOf(cs, { weekday: 'short' })} session` : 'Session';
    if (live.length) { today = live.reduce((a, f) => a + f.day_net, 0); lab += ' so far'; }
    else if (cs) {  // no live session: the last one, from the accounts' days
      const ds = (doc.accounts || []).filter(a => ruleOfAcct(a) === rule).map(a => (a.days || []).find(d => d.s === cs)).filter(d => d && ok(d.net));
      if (ds.length) today = ds.reduce((a, d) => a + d.net, 0);
    }
    // owner 11/11/2026: the rule's whole record, not just today: every evaluation it passed / failed since the start (the
    // summary tile's "passed to date" meaning: passed, funded, passed today, or a pass mark on any day) and its accounts'
    // trading P&L to date (every day's result of every account, fees not included)
    const accs = (doc.accounts || []).filter(a => ruleOfAcct(a) === rule);
    const mark = (a, m) => (a.days || []).some(d => (d.marks || []).includes(m));
    const passed = accs.filter(a => a.passed || a.status === 'passed' || a.status === 'funded' || a.today === 'passed' || mark(a, 'pass')).length;
    const failed = accs.filter(a => a.status === 'failed' || a.today === 'failed' || mark(a, 'fail')).length;
    const pls = accs.flatMap(a => (a.days || []).map(d => d.net)).filter(ok);
    const pl = pls.length ? Math.round(pls.reduce((a, v) => a + v, 0) * 100) / 100 : null;
    return { bought: td('bought'), fees: td('fees'), recv: td('recv'), net: td('net'), today, todayLab: lab, live: live.length > 0,
      passed, failed, funded: cn('funded'), pl };
  }
  function nextBuy(rule) {
    const cs = curSess();
    if (!cs) return '–';
    for (let s = nextWd(cs), i = 0; i < 15; s = nextWd(s), i++)
      if (rule === 'demo' ? plans('demo', 'SC', s) || plans('demo', 'GT', s) : plans(rule, null, s)) return `${day(s)} session`;
    return rule === 'demo' ? 'when a place frees up' : '–';
  }

  // 3b. the buying rules: one card a rule (the rule, this week's buys, its score so far)
  function strip(rule) {
    const cs = curSess(), wk = weekOf(cs);
    const rows = rule === 'demo' ? [['Scalper', 'SC'], ['Gold', 'GT']] : [['All four', null]];
    let h = '<div class="strip"><span></span>' + wk.map(s => `<span class="dh${s === cs ? ' now' : ''}">${esc(dayOf(s, { weekday: 'short' }))}</span>`).join('') + '</div>';
    for (const [nm, st] of rows) {
      h += `<div class="strip"><span class="sn">${nm}</span>` + wk.map(s => {
        const got = boughtOn(rule, st, s), plan = plans(rule, st, s) && s > cs;
        const lab = `${nm}, ${day(s)}: ${got ? 'bought' : plan ? 'planned' : 'no buy'}`;
        return `<span class="b ${got ? 'got' : plan ? 'plan' : 'no'}" title="${esc(lab)}" aria-label="${esc(lab)}">${got ? CHECK : plan ? '' : '–'}</span>`;
      }).join('') + '</div>';
    }
    return h;
  }
  const kv = (k, v, c, big) => `<div class="kv"><span class="k">${k}</span><span class="v num${big ? ' big' : ''}${c ? ' ' + c : ''}">${v}</span></div>`;
  function renderRules() {
    const rs = rulesOf(), cs = curSess();
    if (!rs.length || !cs) { $('rules').innerHTML = `<div class="empty">${rs.length ? 'No session yet.' : 'No buying rule in the feed.'}</div>`; return; }
    $('rules-sub').textContent = `the week of ${day(weekOf(cs)[0])} · next buys after the ${short(cs)} session`;
    $('rules').innerHTML = rs.map(([rule, name, text], i) => {
      const st = ruleStats(rule);
      return `<article class="rcard"><div class="rc-h"><span class="rk">Buying rule ${i + 1}</span><h3>${esc(name)}</h3><p>${esc(text)}</p></div>`
        + `<div class="rc-w"><span class="lbl2">Buys this week</span>${strip(rule)}</div>`
        + '<div class="rc-s">'
        + kv('Bought so far', int(st.bought), '', true)
        + kv('Passed to date', int(st.passed), st.passed ? 'up' : 'muted')
        + kv('Failed to date', int(st.failed), st.failed ? 'down' : 'muted')
        + kv('Funded', int(st.funded), st.funded ? 'up' : 'muted')
        + kv('Fees paid', n2(st.fees))
        + kv('Payouts received', n2(st.recv), cls(st.recv))
        + kv('Net so far', sgn(st.net), cls(st.net), true)
        + kv(esc(st.todayLab), sgn(st.today), cls(st.today))
        + `</div><div class="rc-n"><span class="lbl2">Next buy</span><b>${esc(nextBuy(rule))}</b></div></article>`;
    }).join('');
  }

  // 4. the calendar: one block a buying rule, one row an account, one square a session (its P&L), balance, the way to the pass
  function openIn(id, s) {  // the account's trades still open that session (the days document)
    const acc = daysDoc && (daysDoc.accounts || []).find(x => x.id === id);
    const dd = acc && (acc.days || []).find(x => x.s === s);
    return dd ? (dd.trades || []).filter(t => !t.tout || t.how === 'open') : [];
  }
  function cell(a, s, cs) {
    if (isDate(a.bought) && s < a.bought) return '<div class="dc nb">not bought</div>';
    const d = s > cs ? null : (a.days || []).find(x => x.s === s);
    if (!d) return '<div class="dc fut"></div>';
    const net = d.net, k = 'k-' + (cls(net) || 'flat'), marks = d.marks || [];
    let tag = '', tc = '';
    if (marks.includes('pass')) { tag = 'PASS'; tc = 'up'; }
    else if (marks.includes('fail')) { tag = 'FAIL'; tc = 'down'; }
    else if (marks.includes('payout')) { tag = 'payout'; tc = 'up'; }
    else if (d.live) {
      const halt = a.session === s && a.halt ? String(a.halt) : '';
      if (halt) { tag = halt === 'day target' ? 'target hit' : halt === 'day stop' ? 'day stop hit' : halt; tc = halt === 'day target' ? 'up' : halt === 'day stop' ? 'down' : ''; }
      else if (openIn(a.id, s).length) { tag = 'trade open'; tc = 'warn'; }
      else tag = d.n ? `${int(d.n)} trade${d.n === 1 ? '' : 's'}` : 'no trade yet';
    } else tag = d.n ? `${int(d.n)} trade${d.n === 1 ? '' : 's'}` : 'no trade';
    const isSel = sel && sel.a === a.id && sel.s === s;
    const lab = `${a.id}, ${day(s)}: ${ok(net) ? sgn(net) : 'no number'}, ${tag}${d.live ? ', live' : ''}`;
    return `<button type="button" class="dc ${k}${tc === 'warn' ? ' open' : ''}${isSel ? ' sel' : ''}" data-a="${esc(a.id)}" data-s="${esc(s)}"`
      + ` title="${esc(lab)}" aria-label="${esc(lab)}" aria-pressed="${isSel ? 'true' : 'false'}">`
      + `<span class="n ${cls(net)}">${ok(net) ? sgn(net) : '–'}</span><span class="g ${tc}">${esc(tag)}</span></button>`;
  }
  function toPass(a) {
    if (a.status === 'passed') return '<div class="tpb"><span class="pbar ok"><i style="width:100%"></i></span><span class="tpl up">PASSED</span></div>';
    if (a.status === 'funded') return '<div class="tpb"><span class="tpl up">FUNDED</span></div>';
    if (a.status === 'failed') return '<div class="tpb"><span class="tpl down">FAILED</span></div>';
    if (a.status !== 'evaluation') return `<div class="tpb"><span class="tpl muted">${esc((STATUS[a.status] || a.status || '–').toUpperCase())}</span></div>`;
    const t = a.pass_target, nd = a.pass_need;
    const p = ok(t) && t > 0 && ok(nd) ? Math.max(0, Math.min(1, (t - nd) / t)) : 0;
    return `<div class="tpb"><span class="pbar"><i style="width:${(p * 100).toFixed(1)}%"></i></span>`
      + `<span class="tpl">needs <b class="num">${ok(nd) ? n2(nd) : '–'}</b> more</span></div>`;
  }
  const chip = (k, v, c) => `<div class="chip"><span class="k">${k}</span><span class="v num${c ? ' ' + c : ''}">${v}</span></div>`;
  function renderCal() {
    const cols = calCols(), cs = curSess();
    if (!cols.length) { $('cal').innerHTML = `<div class="empty">${doc.sessions ? 'No session yet.' : 'The calendar needs the updated feed (v1.1).'}</div>`; return; }
    const liveS = liveSet(), n = `style="--n:${cols.length}"`;
    const head = `<div class="cg-row cg-head" ${n}><span class="lbl2">Account</span>`
      + cols.map(s => `<span class="lbl2${liveS.has(s) ? ' now' : ''}">${esc(short(s))}</span>`).join('')
      + '<span class="lbl2 r">Balance</span><span class="lbl2">To pass</span></div>';
    let html = '';
    for (const [rule, name, text] of rulesOf()) {
      const st = ruleStats(rule), accs = (doc.accounts || []).filter(a => ruleOfAcct(a) === rule);
      let rows = '';
      for (const [s, z] of GROUPS)
        for (const a of accs.filter(a => stratOf(a.fleet) === s && sizeOf(a.fleet) === z).sort((x, y) => placeOf(x.id) - placeOf(y.id)))
          rows += `<div class="cg-row" ${n}><div class="cg-a"><span class="nm">${KIND_NAME[s]} ${esc(z)} <span class="muted">#${int(placeOf(a.id))}</span></span>`
            + `<span class="sub">bought ${esc(short(a.bought))}</span></div>${cols.map(s2 => cell(a, s2, cs)).join('')}`
            + `<div class="r num">${ok(a.balance) ? n2(a.balance) : '–'}</div><div>${toPass(a)}</div></div>`;
      html += `<section class="cr"><div class="cr-h"><div class="cr-t"><h3>${esc(name)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`
        + `<div class="chips">${chip('Accounts', int(st.bought))}${chip('Passed to date', int(st.passed), st.passed ? 'up' : '')}`
        + `${chip('Failed to date', int(st.failed), st.failed ? 'down' : '')}${chip('P&amp;L to date', sgn(st.pl), cls(st.pl))}`
        + `${chip(st.live ? 'Today so far' : esc(st.todayLab), sgn(st.today), cls(st.today))}${chip('Fees paid', n2(st.fees))}</div></div>`
        + `<div class="cg-scroll"><div class="cg">${head}${rows || '<div class="muted">No account yet.</div>'}</div></div></section>`;
    }
    $('cal').innerHTML = html;
  }
  function findDay(id, s) {
    const x = (doc.accounts || []).find(a => a.id === id) || (doc.masters || []).find(m => m.acct === id);
    return x ? { row: x, d: (x.days || []).find(d => d.s === s) || null } : null;
  }
  $('cal').addEventListener('click', e => {
    const b = e.target.closest('button.dc');
    if (!b) return;
    const same = sel && sel.a === b.dataset.a && sel.s === b.dataset.s;
    sel = same ? null : { a: b.dataset.a, s: b.dataset.s };
    for (const x of document.querySelectorAll('#cal .dc.sel')) { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); }
    if (sel) { b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); }
    renderDay();
    if (sel) {
      if (daysStale()) fetchDays().then(renderDay);
      $('day').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  $('day').addEventListener('click', e => {
    if (!e.target.closest('button.x')) return;
    sel = null; renderDay();
    for (const x of document.querySelectorAll('#cal .dc.sel')) { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); }
  });
  const MARKS = { fail: ['✕', 'failed'], pass: ['▲', 'passed'], payout: ['◆', 'payout'] };
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

  // 5. live trades: one row a whole trade (entry and exit), the same paper trade on several accounts = one row; open ones on top
  function acctLabel(ids) {  // ['GT-50K-demo#1', 'GT-50K-one#1', …] -> 'Gold 50K #1 (2 accounts)'; a bot keeps its name
    if (!ids.length || !String(ids[0]).includes('#')) return ids.join(', ');
    const g = new Map();
    for (const id of ids) {
      const k = `${KIND_NAME[stratOf(id)]} ${sizeOf(id)}`, p = placeOf(id);
      if (!g.has(k)) g.set(k, new Map());
      g.get(k).set(p, (g.get(k).get(p) || 0) + 1);
    }
    return [...g].map(([k, m]) => k + ' ' + [...m].sort((a, b) => a[0] - b[0]).map(([p, c]) => `#${p} (${c} account${c > 1 ? 's' : ''})`).join(', ')).join('; ');
  }
  function wholeTrades() {
    const M = new Map((doc.masters || []).map(m => [m.acct, m])), out = new Map();
    for (const acc of daysDoc.accounts || []) {
      const id = String(acc.id || ''), m = M.get(id), bot = !!m || !id.includes('#');
      const strat = bot ? (m && m.strat) || (/-SC$/.test(id) ? 'SC' : 'GT') : stratOf(id);
      const z = bot ? (m && m.size) || (/50/.test(id) ? '50K' : '25K') : sizeOf(id);
      for (const d of acc.days || []) for (const t of d.trades || []) {
        const open = !t.tout || t.how === 'open';
        const key = bot ? [id, d.s, t.tin, t.side, t.size].join('|') : [d.s, strat, z, t.tin, t.tout, t.side, t.size, t.net, t.how, t.px_in, t.px_out].join('|');
        let r = out.get(key);
        if (!r) out.set(key, r = { s: d.s, src: bot ? 'bot' : 'paper', strat, z, t, open, accts: [] });
        r.accts.push(id);
      }
    }
    const rows = [...out.values()];
    for (const r of rows) r.accts.sort((a, b) => a.split('#')[0] < b.split('#')[0] ? -1 : a.split('#')[0] > b.split('#')[0] ? 1 : placeOf(a) - placeOf(b));
    return rows.sort((a, b) => (String(a.t.tin).slice(0, 16) < String(b.t.tin).slice(0, 16) ? -1 : String(a.t.tin).slice(0, 16) > String(b.t.tin).slice(0, 16) ? 1 : 0)
      || (a.src === 'bot' ? 0 : 1) - (b.src === 'bot' ? 0 : 1) || (a.z === '50K' ? 0 : 1) - (b.z === '50K' ? 0 : 1) || (a.accts[0] < b.accts[0] ? -1 : 1));
  }
  function openPl(r) {  // the open trade's P&L so far, each account (a paper account: its day so far minus its closed trades that day)
    if (r.src === 'bot') {
      const m = (doc.masters || []).find(x => x.acct === r.accts[0]);
      const o = m && (m.open || []).find(o => o.t === r.t.tin) || (m && (m.open || []).length === 1 ? m.open[0] : null);
      return o && ok(o.pnl) ? o.pnl : null;
    }
    const a = (doc.accounts || []).find(x => x.id === r.accts[0]);
    const d = a && (a.days || []).find(x => x.s === r.s);
    const acc = (daysDoc.accounts || []).find(x => x.id === r.accts[0]);
    const dd = acc && (acc.days || []).find(x => x.s === r.s);
    if (!d || !d.live || !ok(d.net) || !dd) return null;
    const opens = (dd.trades || []).filter(t => !t.tout || t.how === 'open');
    if (opens.length !== 1) return null;  // two open at once: the feed has only their sum
    return Math.round((d.net - (dd.trades || []).reduce((s, t) => s + (t.tout && ok(t.net) ? t.net : 0), 0)) * 100) / 100;
  }
  const inSince = t => { const w = ctw(t); return w.length > 3 ? w.slice(0, -3) : w; };   // "Mon 17:00"
  function openCard(r) {
    const t = r.t, pl = openPl(r);
    const kvs = [['In', t.px_in], ['Stop', t.stop_px], ['Target', t.target_px]].filter(([, v]) => ok(v))
      .map(([k, v]) => `<div class="okv"><span class="lbl2">${k}</span><span class="num">${px(v)}</span></div>`).join('');
    return `<article class="ocard"><div class="oc-a"><span class="lbl2 warn">Open now</span>`
      + `<span class="oc-t">${KIND_NAME[r.strat]} ${esc(t.side || '')}, ${esc(t.size || '')}</span>`
      + `<span class="muted">${r.src === 'bot' ? 'Bot on NinjaTrader Sim' : 'Paper'}. In since ${esc(inSince(t.tin))} CT. ${esc(acctLabel(r.accts))}</span></div>`
      + (kvs ? `<div class="oc-kv">${kvs}</div>` : '')
      + `<div class="oc-r"><span class="lbl2">${r.src === 'bot' ? 'So far' : 'So far, each account'}</span><span class="oc-pl num ${cls(pl)}">${ok(pl) ? sgn(pl) : '–'}</span></div></article>`;
  }
  function tradeRow(r) {
    const t = r.t, how = /day limit/.test(t.how || '') ? 'day limit' : (t.how || '');
    const out = ok(t.px_out) ? px(t.px_out) : /^day (target|stop)$/.test(how) ? `at the ${how}` : '–';
    return `<div class="tr"><div class="c-t num"><span>${esc(ctw(t.tin))}</span><span class="muted">out ${esc(ct(t.tout))}</span></div>`
      + `<div class="c-tr">${r.src === 'bot' ? '<span class="pill bot">BOT</span>' : '<span class="pill">PAPER</span>'}`
      + `<span>${KIND_NAME[r.strat]} ${esc(t.side || '')}, <span class="num">${esc(t.size || '')}</span></span></div>`
      + `<div class="c-px num"><span>in ${px(t.px_in)}</span><span class="muted">out ${out}</span></div>`
      + `<div class="c-how">${esc(how)}</div><div class="c-res num ${cls(t.net)}">${ok(t.net) ? sgn(t.net) : '–'}</div>`
      + `<div class="c-acc">${esc(acctLabel(r.accts))}</div></div>`;
  }
  function renderTrades() {
    if (!daysDoc) {
      $('tr-sess').hidden = true;
      if (daysErr) renderTradesList();
      else $('trades').innerHTML = '<div class="empty">Loading the trades…</div>';
      return;
    }
    const rows = wholeTrades(), liveS = liveSet(), open = rows.filter(r => r.open), done = rows.filter(r => !r.open);
    const ss = [...new Set(done.map(r => r.s).concat(open.map(r => r.s)))].filter(isDate).sort().reverse();
    // one session at a time (owner 11/11/2026): the newest by default, the others one tap away
    if (!ss.includes(trSess)) trSess = ss[0] || null;
    const cs = curSess(), nNow = cs ? rows.filter(r => r.s === cs).length : 0;
    $('tr-count').textContent = nNow ? `${nNow} this session` : '';
    $('tr-sess').innerHTML = ss.map(s => {
      const n = rows.filter(r => r.s === s).length;
      return `<button type="button" data-s="${esc(s)}" aria-pressed="${s === trSess ? 'true' : 'false'}">${esc(short(s))}<span class="vc">${int(n)}</span></button>`;
    }).join('');
    $('tr-sess').hidden = ss.length < 2;
    let html = open.map(openCard).join('');
    const head = '<div class="tr th"><span class="lbl2">Time, CT</span><span class="lbl2">Trade</span><span class="lbl2">Price</span>'
      + '<span class="lbl2">Ended by</span><span class="lbl2 r">Result</span><span class="lbl2">Accounts</span></div>';
    for (const s of ss.filter(x => x === trSess)) {
      const list = done.filter(r => r.s === s);
      const span = `${dayOf(addD(s, -1), { weekday: 'short' })} 17:00 to ${dayOf(s, { weekday: 'short' })} 16:00 CT. ${liveS.has(s) ? 'Still open' : 'Closed'}.`;
      html += `<section class="tsec"><div class="ts-h"><h3>${esc(day(s))} session</h3><span class="muted">${esc(span)} ${list.length} trade${list.length === 1 ? '' : 's'}.</span></div>`
        + (list.length ? head + list.map(tradeRow).join('') : '<div class="muted">No closed trade yet.</div>') + '</section>';
    }
    html += '<p class="tnote">Each row is one whole trade, entry and exit together. A paper trade that ends at the day target or the day stop '
      + 'has no exit price in the feed, so the row says so. The result is for each account.</p>';
    $('trades').innerHTML = rows.length ? html : '<div class="empty">No trade yet.</div>';
  }
  $('tr-sess').addEventListener('click', e => {
    const b = e.target.closest('button[data-s]');
    if (!b || b.dataset.s === trSess) return;
    trSess = b.dataset.s;
    if (doc && !doc.withheld) renderTrades();
  });
  function renderTradesList() {  // the days document is not available: the feed's own entry / exit rows
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
