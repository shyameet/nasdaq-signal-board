// Forex props paper: the live PAPER page (owner 11/11/2026: the forex prop paper test in real time, "like the futures one";
// owner 16/11/2026: five firms - FTMO, FundedNext, FundingPips, The5ers, Tradeify FX - and a cleaner page).
// PAPER ONLY - no real money, no order is ever sent. The Scalper 3m bot's own trades (NinjaTrader Sim, one open at a time) on
// paper accounts at five forex prop firms, filled and marked at the firms' own MT5 bid / ask (FundedNext's for FundingPips,
// The5ers and Tradeify FX, and for FTMO once its free trial ends: the feed says which), each firm with its own rules.
// Layout (owner-approved 16/11/2026): one row of firm buttons; the chosen firm's totals; the buying rule ("1 at a time" + a
// placeholder for the study's winner, both from the feed); Live now = one price card a firm ("prices from FundedNext" where the
// feed is borrowed); the accounts plan by plan in one table, a Calendar button on each plan; Live trades with the bot's own rows.
// Times in Chicago (CT). It reads the VPS's paper-only feed: its address is in data/forex_paper_feed.json {"url": ...} (read again
// while the feed fails); the document there is the publisher's sanitized "rdx-forex-paper-public" v1 (fx_live5 keys: firms[].price_feed
// / borrowed, rules, rule_pending, plans_pending, summary_by). Polled every 3 s (30 s while hidden); when the feed is down the page
// keeps the last data, greyed, and retries. Every account's trades come from days.json, fetched again when days_at changes.
// Nothing is stored in the browser.
(function () {
  'use strict';
  const POLL_MS = 3000, HIDDEN_MS = 30000, FETCH_MS = 8000, FEED_FILE = 'data/forex_paper_feed.json';
  const KIND = 'rdx-forex-paper-public', KIND_DAYS = 'rdx-forex-paper-days';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = v => typeof v === 'number' && isFinite(v);
  const int = v => ok(v) ? String(Math.round(v)) : '–';
  const tms = s => { const t = Date.parse(s); return isFinite(t) ? t : null; };
  let fCT, fCTd, fCTw;
  try {
    fCT = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    fCTd = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    fCTw = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch (e) { fCT = fCTd = fCTw = null; }
  const ct = s => { const t = typeof s === 'number' ? s : tms(s); return t == null ? '–' : fCT ? fCT.format(t) : new Date(t).toISOString().slice(11, 19) + 'Z'; };
  const ct5 = s => { const x = ct(s); return x.length > 5 ? x.slice(0, 5) : x; };
  const ctd = s => { const t = tms(s); return t == null ? '–' : fCTd ? fCTd.format(t) : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z'; };
  const ctw = s => { const t = tms(s); return t == null ? '–' : fCTw ? fCTw.format(t).replace(',', '') : new Date(t).toISOString().slice(5, 19).replace('T', ' ') + 'Z'; };
  const n2 = v => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd = v => ok(v) ? (v < 0 ? '−$' : '$') + n2(v) : '–';
  const sgn = v => ok(v) ? (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + n2(v) : '–';
  const cls = v => ok(v) ? (v > 0.004 ? 'up' : v < -0.004 ? 'down' : '') : '';
  const pnl = v => ok(v) ? `<span class="num ${cls(v)}">${sgn(v)}</span>` : '<span class="faint">–</span>';
  const pnlUsd = v => ok(v) ? `<span class="num ${cls(v)}">${v > 0.004 ? '+' : v < -0.004 ? '−' : ''}$${n2(v)}</span>` : '<span class="faint">–</span>';
  const px = v => ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–';
  const pts = v => ok(v) ? `${sgn(v)} pts` : '–';
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const dayOf = (s, o) => isDate(s) ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o)) : '–';
  const day = s => dayOf(s, { weekday: 'short', day: 'numeric', month: 'short' });
  const short = s => isDate(s) ? dayOf(s, { weekday: 'short' }) + ' ' + dayOf(s, { day: 'numeric' }) : '–';
  const ago = msv => { const s = Math.max(0, Math.round(msv / 1000)); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
  const addD = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const wdOf = s => new Date(s + 'T12:00:00Z').getUTCDay();
  const isWd = s => wdOf(s) > 0 && wdOf(s) < 6;
  const weekOf = s => { const mon = addD(s, -((wdOf(s) + 6) % 7)); return [0, 1, 2, 3, 4].map(i => addD(mon, i)); };
  const SIDE = s => s === 'long' ? 'LONG' : s === 'short' ? 'SHORT' : '';
  const sideChip = (side, size) => SIDE(side) ? `<span class="pos ${side === 'long' ? 'long' : 'short'}">${SIDE(side)}${size ? ' ' + esc(size) : ''}</span>` : (size ? esc(size) : '');
  const FIRMS0 = ['FTMO', 'FundedNext', 'FundingPips', 'The5ers', 'Tradeify FX'];       // until the feed says otherwise
  const CODE0 = { FTMO: 'FT', FundedNext: 'FN', FundingPips: 'FP', The5ers: 'T5', 'Tradeify FX': 'TF' };
  const STATUS = { evaluation: 'Evaluation', funded: 'Funded', failed: 'Failed', lost: 'Funded, lost' };
  const OPEN = new Set(['evaluation', 'funded']);
  const FEEDTXT = {
    'ok': 'Live', 'replay': 'Replay', 'no ticks': 'No ticks', 'reader quiet': 'Reader quiet', 'no reader': 'Reader off',
    'terminal not logged in': 'Not logged in', 'wrong account': 'Other account', 'terminal not running': 'Terminal off',
    'terminal not installed': 'Not set up', 'cannot attach': 'Cannot attach', 'terminal offline': 'Terminal offline',
    'no symbol': 'No symbol', 'starting': 'Starting', 'unknown': 'Unknown'
  };
  const FEEDLONG = {
    'terminal not logged in': 'its MT5 terminal is not logged in (the free trial may have ended: the owner logs in again)',
    'wrong account': 'its MT5 terminal is on another account', 'terminal not running': 'its MT5 terminal is not running',
    'terminal not installed': 'its MT5 terminal is not set up yet', 'cannot attach': 'the price reader cannot reach its MT5 terminal',
    'terminal offline': 'its MT5 terminal has no connection to the firm', 'no symbol': 'the Nasdaq CFD is missing on its account',
    'reader quiet': 'the price reader stopped writing', 'no reader': 'the price reader is not running', 'no ticks': 'no price ticks are coming'
  };
  const HOW = { target: 'target', stop: 'stop', 'end of day': 'end of day', 'signal exit': 'signal exit', exit: 'exit', open: 'still open',
    "closed at the firm's pause": "the firm's pause", 'closed at the session end': 'session end', 'exit waiting for a quote': 'exit, waiting for a quote',
    'day target': 'day target', 'day stop': 'day stop' };
  const WHY = { 'trade open': 'a trade was open (one at a time)', 'firm pause': "the firm's pause", 'no price': 'no firm price then' };
  const EVTXT = { 1: 'passed phase', 2: 'PASSED', 3: 'failed: max loss', 4: 'failed: daily loss', 5: 'failed: no room', 6: 'target hit, waiting days',
    7: 'minimum day', 8: 'payout', 9: 'funded lost: max loss', 10: 'funded lost: daily loss' };
  const etToCt = s => { const m = /^(\d{2}):(\d{2})$/.exec(s || ''); return m ? `${String((+m[1] + 23) % 24).padStart(2, '0')}:${m[2]}` : s; };  // Chicago = New York - 1 h, all year

  let feedUrl = null, doc = null, lastOk = 0, lastGen = null, lastGenAt = 0, fails = 0, firstFail = 0, timer = 0, rendered = null, busy = false;
  const filt = { firm: '', rule: '1' };
  const calOpen = new Set();                 // plan keys whose calendar is open
  let sel = null, daysDoc = null, daysErr = false, daysBusy = null;
  let view = location.hash === '#trades' ? 'trades' : 'main', trSess = null;

  // ---------------------------------------------------------------- the feed
  async function getJson(url, opts) {
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
    if (busy) return;
    busy = true; clearTimeout(timer);
    try {
      if (!feedUrl || (fails && fails % 6 === 0)) feedUrl = (await readFeed()) || feedUrl;
      if (feedUrl) {
        try {
          const j = await getJson(feedUrl, FEED_OPTS);
          if (!j || j.kind !== KIND || j.paper_only !== true) throw new Error('not the forex paper feed');
          fails = 0; firstFail = 0; lastOk = Date.now();
          if (j.generated !== lastGen) { lastGen = j.generated; lastGenAt = Date.now(); }
          doc = j;
          if (rendered !== j.generated) { render(); rendered = j.generated; }
        } catch (e) { fails++; if (!firstFail) firstFail = Date.now(); }
      } else { fails++; if (!firstFail) firstFail = Date.now(); }
    } finally { busy = false; }
    timer = setTimeout(poll, document.hidden ? HIDDEN_MS : fails < 6 ? POLL_MS : fails < 20 ? 15000 : 30000);
    paint();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  const daysUrl = () => feedUrl && /state\.json(\?|$)/.test(feedUrl) ? feedUrl.replace(/state\.json(?=\?|$)/, 'days.json') : null;
  function fetchDays() {
    if (daysBusy) return daysBusy;
    const u = daysUrl();
    if (!u) { daysErr = true; return Promise.resolve(); }
    daysBusy = (async () => {
      try {
        const j = await getJson(u, FEED_OPTS);
        if (j && j.kind === KIND_DAYS && j.paper_only === true && !j.withheld && Array.isArray(j.accounts)) { daysDoc = j; daysDoc._at = doc && doc.days_at; daysErr = false; }
        else daysErr = true;
      } catch (e) { daysErr = true; } finally { daysBusy = null; }
    })();
    return daysBusy;
  }
  const daysStale = () => !daysDoc || !!(doc && doc.days_at != null && daysDoc._at !== doc.days_at);

  // ---------------------------------------------------------------- the state dot, the "updated" time, the alert
  function feedTrouble() {  // a live session with a price feed missing: say which feed, which firms use it, and why
    if (!doc || doc.mode === 'replay' || !doc.session || doc.session.status !== 'live') return '';
    const byFeed = {};
    for (const f of doc.firms || []) {
      if (!f.feed || f.feed.state === 'ok') continue;
      const k = f.price_feed || f.firm;
      (byFeed[k] = byFeed[k] || { st: f.feed.state, firms: [] }).firms.push(f.firm);
    }
    const ks = Object.keys(byFeed);
    if (!ks.length) return '';
    return ks.map(k => `${k} prices (${byFeed[k].firms.join(', ')}): ${FEEDLONG[byFeed[k].st] || FEEDTXT[byFeed[k].st] || byFeed[k].st}`).join('. ')
      + '. Those paper accounts take no new trade until the prices come back.';
  }
  function paint() {
    const dot = $('dot'), upd = $('upd'), al = $('alert'), now = Date.now();
    let state = 'live', word = 'Live', msg = '', klass = '';
    const down = fails > 0 && (!doc || now - lastOk > 12000);
    if (down) {
      state = 'down'; word = doc ? `Not live · last ${ago(now - lastOk)} ago` : 'Not live'; klass = 'down';
      msg = doc ? `The feed from the VPS is down since ${ct(firstFail)} CT. Showing the last data it sent (updated ${ctd(doc.engine && doc.engine.asof || doc.generated)} CT); retrying.`
        : (feedUrl ? 'Waiting for the feed from the VPS: it does not answer yet (the forex paper engine or its publisher may be off). Retrying.'
          : 'The feed address is not set yet. Retrying.');
    } else if (doc && doc.withheld) {
      state = 'stale'; word = 'Held back';
      msg = 'The VPS held this update back (its safety check found something that must not be public). Nothing is shown until the next clean one.';
    } else if (doc && doc.mode === 'replay') {
      state = 'stale'; word = 'Replay';
      msg = `Replay of past sessions from the firms' MT5 minute bars and the bot's recorded trades, as of ${ctd(doc.engine && doc.engine.asof)} CT. Not live.`;
    } else if (doc && now - lastGenAt > 30000) {
      state = 'stale'; word = 'Not updating';
      msg = `The feed answers but has not changed for ${ago(now - lastGenAt)}.`;
    } else if (doc && doc.engine && doc.engine.state === 'missing') {
      state = 'stale'; word = 'Engine off';
      msg = 'The forex paper engine has not written its state yet (it may not be running).';
    } else if (doc && doc.engine && doc.engine.state === 'quiet') {
      state = 'stale'; word = 'Engine quiet';
      msg = `The forex paper engine's last update was ${ct(doc.engine.generated)} CT.`;
    } else if (doc && feedTrouble()) {
      state = 'stale'; word = 'Prices missing'; msg = feedTrouble();
    } else if (doc && doc.session && doc.session.status !== 'live') {
      state = ''; word = doc.session.status === 'closed' ? 'Session closed' : 'No session';
    } else if (!doc) { state = ''; word = 'Connecting…'; }
    dot.className = 'lv ' + state; dot.lastChild.textContent = word;
    const asof = doc && !doc.withheld ? (doc.engine && doc.engine.asof) || doc.generated : null;
    upd.textContent = asof ? (doc.mode === 'replay' ? `Replay ${ctd(asof)} CT` : `Updated ${ct(asof)} CT · ${ago(now - tms(asof))} ago`) : '';
    al.hidden = !msg; al.textContent = msg; al.className = 'alert ' + klass;
    $('main').classList.toggle('old', down || !!(doc && doc.withheld));
    setBar();
  }
  let barH = 0;
  function setBar() {
    const h = $('bar').offsetHeight;
    if (h !== barH) { barH = h; document.documentElement.style.setProperty('--bar-h', h + 'px'); }
  }
  setInterval(paint, 1000);
  window.addEventListener('resize', setBar);

  // ---------------------------------------------------------------- views, firm and rule switches
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
  $('firms').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === filt.firm) return;
    filt.firm = b.dataset.v; sel = null;
    if (doc && !doc.withheld) render(); else renderFirms();
  });
  $('rules').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.disabled || b.dataset.v === filt.rule) return;
    filt.rule = b.dataset.v; sel = null;
    if (doc && !doc.withheld) render();
  });

  function render() {
    if (!doc || doc.withheld) return;
    if (!Array.isArray(doc.rules)) doc.rules = [{ key: '1', label: '1 at a time' }];   // a feed from before fx_live5: its first rule only
    if (!doc.rules.some(r => r.key === filt.rule) && doc.rules.length) filt.rule = doc.rules[0].key;
    if (filt.firm && !firmList().includes(filt.firm)) filt.firm = '';
    renderFirms(); renderSummary(); renderRules(); renderLive(); renderAccounts(); renderTrades();
    if (daysStale() && !daysBusy) fetchDays().then(() => { if (doc && !doc.withheld) { renderTrades(); renderDay(); } });
  }
  const firmList = () => doc && (doc.firms || []).length ? doc.firms.map(f => f.firm) : FIRMS0;
  const firmOf = name => (doc && (doc.firms || []).find(f => f.firm === name)) || null;
  const codeOf = name => { const f = firmOf(name); return (f && f.code) || CODE0[name] || ''; };
  const pillCls = name => codeOf(name).toLowerCase();
  const sessList = () => (doc.sessions || []).filter(isDate).slice().sort();
  const curSess = () => (doc.session && isDate(doc.session.s)) ? doc.session.s : (sessList().slice(-1)[0] || null);
  const isLive = () => !!(doc && doc.session && doc.session.status === 'live');
  const ruleLabel = k => ((doc && doc.rules || []).find(r => r.key === k) || {}).label || k;
  const acctName = a => `${Math.round(a.size / 1000)}K #${int(a.n)}`;
  const stageTxt = a => a.status === 'evaluation' ? (a.phases > 1 ? `Phase ${int(a.phase)} of ${int(a.phases)}` : 'Evaluation') : (STATUS[a.status] || a.status);
  const stChip = a => `<span class="st ${esc(a.status)}">${esc(stageTxt(a))}</span>`;
  const shown = () => (doc.accounts || []).filter(a => (!filt.firm || a.firm === filt.firm) && a.rule === filt.rule);
  const priceWord = f => f ? (f.borrowed ? `at ${esc(f.price_feed)}'s MT5 prices` : 'at its own MT5 prices') : '';
  const pauseTxt = f => f && (f.pause || []).length === 2 ? `pause ${esc(f.pause.map(etToCt).join('-'))} CT${f.pause_assumed ? ' (assumed)' : ''}` : '';

  // 1. the firm row, its line, the totals, the buying rule
  function renderFirms() {
    const names = firmList();
    $('firms').innerHTML = [''].concat(names).map(n => `<button type="button" data-v="${esc(n)}" aria-pressed="${n === filt.firm ? 'true' : 'false'}">${n ? esc(n) : 'All'}</button>`).join('');
    let line = '';
    if (doc && !doc.withheld) {
      if (filt.firm) {
        const f = firmOf(filt.firm);
        const np = f ? (f.plans || []).length : 0, nw = f ? (f.pending || []).length : 0;
        line = `<b>${esc(filt.firm)}</b> · ${priceWord(f)}${f && f.symbol ? ` (${esc(f.symbol)})` : ''} · $${f && ok(f.lot_usd_pt) ? int(f.lot_usd_pt) : '–'} a point a lot · ${pauseTxt(f)}`
          + ` · ${np} plan${np === 1 ? '' : 's'}${nw ? ` live, ${nw} waiting for a size pick` : ''} · totals for <b>${esc(ruleLabel(filt.rule))}</b>`;
      } else {
        const lend = {};                                  // the feed each borrowing firm uses (today FundedNext's)
        for (const f of doc.firms || []) if (f.borrowed) (lend[f.price_feed] = lend[f.price_feed] || []).push(f.firm);
        const brw = Object.keys(lend).map(k => `${esc(k)}'s for ${esc(lend[k].join(', '))}`).join('; ');
        line = `<b>All ${names.length} firms</b> at the firms' own MT5 prices${brw ? ` (${brw})` : ''} · totals for <b>${esc(ruleLabel(filt.rule))}</b>`;
      }
    }
    $('fsub').innerHTML = line;
  }
  function renderSummary() {
    const by = (doc.summary_by || {})[filt.rule] || {};
    const s = by[filt.firm || 'All'] || (filt.firm ? {} : doc.summary || {});
    const who = filt.firm ? `${filt.firm} paper accounts` : 'all paper accounts';
    const tile = (lbl, val, sub) => `<div class="tile"><span class="lbl">${lbl}</span><span class="val">${val}</span><span class="sub">${sub}</span></div>`;
    $('sum').innerHTML =
      tile('Open', `<span class="num">${int(s.open)}</span>`, `${int(s.evaluation)} evaluation · ${int(s.funded)} funded`)
      + tile('Passed', `<span class="num up">${int(s.passed)}</span>`, 'evaluations passed to date')
      + tile('Failed', `<span class="num${s.failed ? ' down' : ''}">${int(s.failed)}</span>`, s.lost ? `to date · ${int(s.lost)} funded lost` : 'to date')
      + tile('Today\'s P&amp;L', pnlUsd(s.today), ok(s.today) ? (isLive() ? `${who}, live` : `${who}, the ${short(curSess())} session`) : 'no trade now')
      + tile('Net to date', pnlUsd(s.net), `fees ${usd(s.fees)} · payouts ${usd(s.paid)}${s.refunds ? ' · refunds ' + usd(s.refunds) : ''}`);
  }
  function renderRules() {
    const rs = doc.rules || [];
    const pend = doc.rule_pending;
    $('rules').innerHTML = rs.map(r => `<button type="button" data-v="${esc(r.key)}" aria-pressed="${r.key === filt.rule ? 'true' : 'false'}">${esc(r.label)}</button>`).join('')
      + (pend && pend.label ? `<button type="button" disabled title="${esc(pend.note || '')}">${esc(pend.label)} · ${esc(pend.note ? 'owner picks' : 'to come')}</button>` : '');
  }

  // 2. live now: one price card a firm
  function chipState(st, word) {
    const k = st === 'ok' ? 'okx' : st === 'replay' || st === 'off hours' ? 'offx' : 'warnx';
    return `<span class="st ${k}">${esc(word)}</span>`;
  }
  function firmCard(f) {
    const fd = f.feed || {}, td = f.today || {};
    const st = fd.state || 'unknown';
    const head = `<div class="bh"><span class="acct">${esc(f.firm)}</span>${chipState(st, FEEDTXT[st] || st)}`
      + `${f.borrowed ? `<span class="tagx brw" title="this firm has no MT5 feed here: its paper accounts use ${esc(f.price_feed)}'s bid and ask">prices from ${esc(f.price_feed)}</span>` : ''}`
      + `${fd.algo_on ? '<span class="tagx test">Algo Trading on</span>' : ''}</div>`
      + `<div class="bsub">${esc(f.symbol || '')}${f.borrowed ? ` (${esc(f.price_feed)}'s)` : ''} · $${ok(f.lot_usd_pt) ? int(f.lot_usd_pt) : '–'} a point a lot · ${pauseTxt(f)}</div>`
      + (f.price_windows || []).map(w => `<div class="bsub">${esc(f.firm)} priced from ${esc(w.feed)}'s MT5 from ${esc(ctd(w.start))} `   // owner 19/11/2026: FTMO's trial gap
        + (w.end ? `to ${esc(ctd(w.end))} CT (${esc(f.firm)}'s trial login ended); its own prices before and after</div>` : `CT (${esc(f.firm)}'s trial login ended)</div>`)).join('');
    const q = td.quote || {};
    const bid = ok(fd.bid) ? fd.bid : q.bid, ask = ok(fd.ask) ? fd.ask : q.ask, qt = fd.t || q.t;
    const spr = ok(fd.spread) ? fd.spread : ok(bid) && ok(ask) ? ask - bid : null;
    const kp = `<div class="kpis"><div class="kpi"><span class="lbl">Bid / ask</span><span class="big">${ok(bid) ? px(bid) : '–'}</span>`
      + `<span class="sm">ask ${ok(ask) ? px(ask) : '–'} · spread ${ok(spr) ? spr.toFixed(2) : '–'}${qt ? ' · ' + esc(ct(qt)) + ' CT' : ''}</span></div>`
      + `<div class="kpi"><span class="lbl">This session, 1 lot</span><span class="big ${cls(td.live_pts)}">${pts(td.live_pts)}</span>`
      + `<span class="sm">closed ${pts(td.closed_pts)}${td.open ? ' · 1 open' : ''}</span></div></div>`;
    const open = (td.trades || []).filter(t => t.how === 'open' || !t.tout);
    const lotUsd = ok(f.lot_usd_pt) ? f.lot_usd_pt : 1;
    const ot = open.length ? open.map(t => {
      const now = t.side === 'long' ? bid : ask;
      const pl = ok(now) && ok(t.px_in) ? (t.side === 'long' ? now - t.px_in : t.px_in - now) : null;
      return `<div class="trade"><div class="tl">${sideChip(t.side, '1 lot')}<span class="pnl ${cls(pl)}">${ok(pl) ? sgn(pl) : '–'}</span></div>`
        + `<div class="tp"><span>in <b>${px(t.px_in)}</b></span><span>now <b>${px(now)}</b></span><span>since <b>${esc(ct5(t.tin))}</b></span></div>`
        + `<div class="tx">points a lot ($${n2(lotUsd)} a point) · the bot's entry <b>${px(t.bot_in)}</b></div></div>`;
    }).join('') : '<div class="trade flat"><div class="tl"><span class="pos flat">FLAT</span> no open trade</div></div>';
    const nd = (td.trades || []).filter(t => t.tout).length, nsk = (td.skips || []).length;
    const foot = `<div class="bf">${int(nd)} closed this session${nsk ? ` · ${int(nsk)} signal${nsk === 1 ? '' : 's'} not taken` : ''}`
      + `${st !== 'ok' && FEEDLONG[st] && doc.mode !== 'replay' ? ` · <span class="down">${esc(f.borrowed ? f.price_feed + ': ' : '')}${esc(FEEDLONG[st])}</span>` : ''}</div>`;
    return `<article class="card">${head}${kp}${ot}${foot}</article>`;
  }
  function renderLive() {
    const cs = curSess();
    $('live-sub').textContent = (cs ? `session ${day(cs)} · ` : '') + (filt.firm ? `${filt.firm}'s prices` : 'each firm\'s prices');
    const cards = [];   // owner 16/11/2026: one price card a firm, no NinjaTrader (bot) card
    for (const f of doc.firms || []) if (!filt.firm || f.firm === filt.firm) cards.push(firmCard(f));
    $('bots').innerHTML = cards.length ? cards.join('') : '<div class="empty">No data yet.</div>';
    $('bots').dataset.n = String(cards.length);   // 5 cards: one row of five on a wide screen (CSS)
  }

  // 3. the accounts: one table, plan by plan, a Calendar button on each plan
  function planList() {   // [{firm, plan, key, pending}] in the feed's order (firms, then fx_rules' plans)
    const out = [];
    for (const name of firmList()) {
      if (filt.firm && name !== filt.firm) continue;
      for (const p of doc.plans || []) if (p.firm === name) out.push({ firm: name, plan: p.plan, key: name + '|' + p.plan, p });
      for (const p of doc.plans_pending || []) if (p.firm === name) out.push({ firm: name, plan: p.plan, key: name + '|' + p.plan, pending: p });
    }
    return out;
  }
  const accsOf = (firm, plan) => shown().filter(a => a.firm === firm && a.plan === plan)
    .sort((x, y) => x.size - y.size || x.n - y.n);
  function planText(p) {
    if (!p) return '';
    const ph = p.instant ? 'no evaluation' : (p.phases || []).map(x => x + '%').join(' then ') + ' target';
    const mt = { static: 'static', trail_eod: 'trailing (end of day)', trail_closed_lock: 'trailing, locks at the start', trail_closed: 'trailing' }[p.max_type] || '';
    return `${ph} · max loss ${p.max_loss}% ${mt}${ok(p.daily) ? ` · daily ${p.daily}%` : ''}${p.min_days ? ` · min ${p.min_days} days` : ''}`
      + `${p.prof_days ? ` · ${p.prof_days} profitable days` : ''}${ok(p.consistency) ? ` · best day ≤ ${p.consistency}%` : ''} · funded split ${p.split}%`
      + `${p.provisional ? ' · rules provisional' : ''}`;
  }
  function accRow(a) {
    const open = OPEN.has(a.status), t = a.today;
    let need = '–';
    if (a.status === 'evaluation' && ok(a.pass_need)) need = usd(a.pass_need) + (ok(a.eval_days) ? `<span class="halt">day ${int(a.eval_days)}${a.min_days ? ' of ' + int(a.min_days) + '+' : ''}</span>` : '');
    else if (a.passed) need = `<span class="up">passed${a.passed_s ? ' ' + esc(short(a.passed_s)) : ''}</span>`;
    const pays = a.payouts ? `${int(a.payouts)} · ${usd(a.paid)}` : '–';
    const today = t && ok(t.net) ? pnl(t.net) + (t.halted && t.halt ? `<span class="halt">${esc(t.halt)}</span>` : ok(t.lots) ? `<span class="halt">${n2(t.lots)} lots</span>` : '') : '<span class="faint">–</span>';
    return `<tr class="row${open ? '' : ' done'}"><td class="c-id">${esc(acctName(a))}</td><td class="c-rule">bought ${esc(short(a.bought))} · ${usd(a.price)}</td>`
      + `<td class="c-st">${stChip(a)}</td><td class="c-bal r">${usd(a.balance)}</td>`
      + `<td class="c-room r" data-l="Room">${open ? usd(a.room) : '–'}</td><td class="c-today r" data-l="Today">${today}</td>`
      + `<td class="c-need r" data-l="To pass">${need}</td><td class="c-pay r" data-l="Payouts">${pays}</td></tr>`;
  }
  function renderAccounts() { renderAccountsTable(); renderDay(); }   // the day box lives inside the table: fill it each time
  function renderAccountsTable() {
    const all = shown();
    const nAll = (doc.accounts || []).filter(a => !filt.firm || a.firm === filt.firm).length;
    $('acc-sub').textContent = `${all.length} account${all.length === 1 ? '' : 's'} · ${ruleLabel(filt.rule)}${nAll !== all.length ? ` (${nAll} under every rule)` : ''} · plan by plan · tap Calendar for the days`;
    let body = '';
    for (const pl of planList()) {
      const name = filt.firm ? esc(pl.plan) : `${esc(pl.firm)} ${esc(pl.plan)}`;
      if (pl.pending) {
        body += `<tr class="grp"><td colspan="8"><span class="gname">${name}</span><span>${pl.pending.instant ? 'instant' : 'evaluation'}</span></td></tr>`
          + `<tr class="pend"><td colspan="8">No paper account yet: ${esc(pl.pending.why || 'not picked')}. Its sizes are picked with the same method as the other firms', then it joins.</td></tr>`;
        continue;
      }
      const rows = accsOf(pl.firm, pl.plan);
      const nOpen = rows.filter(a => OPEN.has(a.status)).length, nFail = rows.filter(a => a.status === 'failed' || a.status === 'lost').length;
      const isOpen = calOpen.has(pl.key);
      body += `<tr class="grp"><td colspan="8"><button type="button" class="calb" data-k="${esc(pl.key)}" aria-expanded="${isOpen ? 'true' : 'false'}">${isOpen ? 'Hide calendar' : 'Calendar'}</button>`
        + `<span class="gname">${name}</span><span>${rows.length} account${rows.length === 1 ? '' : 's'} · ${nOpen} open${nFail ? ` · ${nFail} failed` : ''}</span>`
        + `<span class="rl">${esc(planText(pl.p))}</span></td></tr>`;
      body += rows.map(accRow).join('');
      if (isOpen) body += `<tr class="calrow"><td colspan="8">${calendar(pl, rows)}</td></tr>`;
    }
    const head = '<thead><tr><th>Account</th><th>Bought</th><th>Status</th><th class="r">Balance</th><th class="r">Room</th>'
      + '<th class="r">Today</th><th class="r">To pass</th><th class="r">Payouts</th></tr></thead>';
    $('accts').innerHTML = body ? `<table class="atbl">${head}<tbody>${body}</tbody></table>` : `<div class="empty">${(doc.accounts || []).length ? 'No account in this choice.' : 'No paper account yet.'}</div>`;
  }
  $('accts').addEventListener('click', e => {
    const cb = e.target.closest('button.calb');
    if (cb) {
      const k = cb.dataset.k;
      if (calOpen.has(k)) { calOpen.delete(k); if (sel && sel.k === k) sel = null; } else calOpen.add(k);
      if (doc && !doc.withheld) renderAccounts();
      return;
    }
    const b = e.target.closest('button.dc');
    if (b) {
      const same = sel && sel.a === b.dataset.a && sel.s === b.dataset.s;
      sel = same ? null : { a: b.dataset.a, s: b.dataset.s, k: b.dataset.k };
      renderAccounts();
      if (sel && daysStale()) fetchDays().then(renderDay);
      const box = $('day');
      if (sel && box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (e.target.closest('#day button.x')) { sel = null; renderAccounts(); }
  });

  // the calendar of one plan: one row an account, one square a session; a day's trades below it
  function calCols() {
    const ss = sessList();
    if (!ss.length) return [];
    const set = new Set(ss);
    for (let d = weekOf(ss[0])[0], end = weekOf(ss[ss.length - 1])[4]; d <= end; d = addD(d, 1)) if (isWd(d)) set.add(d);
    return [...set].sort();
  }
  const openNow = firm => { const f = firmOf(firm); return !!(f && f.today && f.today.open); };
  function cell(a, s, cs, k) {
    if (isDate(a.bought) && s < a.bought) return '<div class="dc nb">not bought</div>';
    const d = s > cs ? null : (a.days || []).find(x => x.s === s);
    if (!d) return '<div class="dc fut"></div>';
    const live = d.live && a.today, net = live && ok(a.today.net) ? a.today.net : d.net;
    let tag = '', tc = '';
    if (d.code === 2 || d.code === 1) { tag = d.code === 2 ? 'PASS' : 'phase passed'; tc = 'up'; }
    else if ([3, 4, 5, 9, 10].includes(d.code)) { tag = 'FAIL'; tc = 'down'; }
    else if (d.code === 8) { tag = 'payout'; tc = 'up'; }
    else if (d.code === 6 || d.code === 7) { tag = EVTXT[d.code]; tc = 'up'; }
    else if (d.halt) { tag = d.halt === 'day target' ? 'target hit' : 'day stop hit'; tc = d.halt === 'day target' ? 'up' : 'down'; }
    else tag = d.n ? `${int(d.n)} trade${d.n === 1 ? '' : 's'}` : (d.live ? 'no trade yet' : 'no trade');
    const isSel = sel && sel.a === a.id && sel.s === s;
    const lab = `${a.firm} ${a.plan} ${acctName(a)}, ${day(s)}: ${ok(net) ? sgn(net) : 'no number'}, ${tag}${d.live ? ', live' : ''}`;
    return `<button type="button" class="dc k-${cls(net) || 'flat'}${live && a.today && !a.today.halted && openNow(a.firm) ? ' open' : ''}${isSel ? ' sel' : ''}" data-a="${esc(a.id)}" data-s="${esc(s)}" data-k="${esc(k)}"`
      + ` title="${esc(lab)}" aria-label="${esc(lab)}" aria-pressed="${isSel ? 'true' : 'false'}">`
      + `<span class="n ${cls(net)}">${ok(net) ? sgn(net) : '–'}</span><span class="g ${tc}">${esc(tag)}</span></button>`;
  }
  function toPass(a) {
    if (a.status === 'funded') return `<div class="tpb"><span class="tpl up">FUNDED${a.payouts ? ' · ' + int(a.payouts) + ' paid' : ''}</span></div>`;
    if (a.status === 'failed') return '<div class="tpb"><span class="tpl down">FAILED</span></div>';
    if (a.status === 'lost') return '<div class="tpb"><span class="tpl down">FUNDED, LOST</span></div>';
    const t = a.pass_target, nd = a.pass_need;
    const p = ok(t) && t > 0 && ok(nd) ? Math.max(0, Math.min(1, (t - nd) / t)) : 0;
    return `<div class="tpb"><span class="pbar"><i style="width:${(p * 100).toFixed(1)}%"></i></span>`
      + `<span class="tpl">${a.phases > 1 ? 'phase ' + int(a.phase) + ' ' : ''}needs <b class="num">${ok(nd) ? n2(nd) : '–'}</b></span></div>`;
  }
  const chip = (k, v, c) => `<div class="chip"><span class="k">${k}</span><span class="v num${c ? ' ' + c : ''}">${v}</span></div>`;
  function calendar(pl, accs) {
    const cols = calCols(), cs = curSess();
    if (!cols.length || !accs.length) return '<div class="muted">No session yet.</div>';
    const n = `style="--n:${cols.length}"`;
    const head = `<div class="cg-row cg-head" ${n}><span class="lbl2">Account</span>`
      + cols.map(s => `<span class="lbl2${s === cs && isLive() ? ' now' : ''}">${esc(short(s))}</span>`).join('')
      + '<span class="lbl2 r">Balance</span><span class="lbl2">To pass</span></div>';
    const pls = accs.flatMap(a => (a.days || []).map(d => d.live && a.today && ok(a.today.net) ? a.today.net : d.net)).filter(ok);
    const plv = pls.length ? pls.reduce((x, v) => x + v, 0) : null;
    const td = accs.map(a => a.today && ok(a.today.net) ? a.today.net : null).filter(ok);
    const today = td.length ? td.reduce((x, v) => x + v, 0) : null;
    const passed = accs.filter(a => a.passed).length, failed = accs.filter(a => a.status === 'failed' || a.status === 'lost').length;
    const fees = accs.reduce((x, a) => x + (ok(a.price) ? a.price : 0), 0);
    const rows = accs.map(a => `<div class="cg-row" ${n}><div class="cg-a"><span class="nm">${esc(acctName(a))}</span>`
      + `<span class="sub">bought ${esc(short(a.bought))}</span></div>${cols.map(s2 => cell(a, s2, cs, pl.key)).join('')}`
      + `<div class="r num">${ok(a.balance) ? n2(a.balance) : '–'}</div><div>${toPass(a)}</div></div>`).join('');
    const leg = '<div class="leg" aria-hidden="true"><span><i class="sw k-up"></i>up day</span><span><i class="sw k-down"></i>down day</span>'
      + '<span><i class="sw k-flat"></i>no trade yet</span><span><i class="sw nb"></i>not bought yet</span>'
      + '<span>A session runs from 17:00 CT the evening before to 16:00 CT. Tap a day for its trades.</span></div>';
    const box = sel && sel.k === pl.key ? '<div class="day" id="day"></div>' : '';
    return `<div class="chips">${chip('Accounts', int(accs.length))}${chip('Passed to date', int(passed), passed ? 'up' : '')}`
      + `${chip('Failed to date', int(failed), failed ? 'down' : '')}${chip('P&amp;L to date', sgn(plv), cls(plv))}`
      + `${chip(isLive() ? 'Today so far' : `${dayOf(cs, { weekday: 'short' })} session`, sgn(today), cls(today))}${chip('Fees paid', n2(fees))}</div>`
      + leg + `<div class="cg-scroll"><div class="cg">${head}${rows}</div></div>${box}`;
  }
  function renderDay() {
    const box = $('day');
    if (!box) return;
    if (!sel || !doc) { box.hidden = true; box.innerHTML = ''; return; }
    const a = (doc.accounts || []).find(x => x.id === sel.a);
    const d = a && (a.days || []).find(x => x.s === sel.s);
    const net = d && d.live && a.today && ok(a.today.net) ? a.today.net : d && d.net;
    const ev = d && EVTXT[d.code] ? `<span class="${[3, 4, 5, 9, 10].includes(d.code) ? 'down' : 'up'}">${esc(EVTXT[d.code])}${d.code === 8 && ok(d.payout) ? ' ' + usd(d.payout) : ''}</span>` : '';
    let html = `<div class="dh"><b>${a ? esc(a.firm + ' ' + a.plan + ' ' + acctName(a)) : esc(sel.a)}</b><span>${esc(day(sel.s))}${d && d.live ? ' · live' : ''}</span>`
      + (d ? `<span>day ${pnl(net)}</span><span class="muted">profit before the day <span class="num">${usd(d.start)}</span> · day target ${usd(d.T)} · day stop ${usd(d.S)} · ${n2(d.lots)} lots</span>${ev}` : '')
      + '<button type="button" class="x" aria-label="Close">×</button></div>';
    const acc = daysDoc && (daysDoc.accounts || []).find(x => x.id === sel.a);
    const dd = acc && (acc.days || []).find(x => x.s === sel.s);
    const trades = dd ? dd.trades || [] : null;
    if (trades && trades.length) {
      const hasPx = trades.some(t => 'px_in' in t);
      html += '<table class="dtbl"><thead><tr><th>In (CT)</th><th>Out (CT)</th><th>Trade</th>' + (hasPx ? '<th>Entry → exit</th>' : '')
        + '<th class="r">Result</th><th>How it ended</th></tr></thead><tbody>'
        + trades.map(t => `<tr><td class="tin">${esc(ct(t.tin))}</td><td class="tout">${t.tout ? esc(ct(t.tout)) : '–'}</td>`
          + `<td class="sd">${sideChip(t.side, ok(t.size) ? n2(t.size) + ' lots' : '')}</td>` + (hasPx ? `<td class="pxs">${px(t.px_in)} → ${ok(t.px_out) ? px(t.px_out) : t.how === 'open' ? '…' : esc(HOW[t.how] || t.how)}</td>` : '')
          + `<td class="res r">${t.how === 'open' ? '<span class="faint">open</span>' : pnlUsd(t.net)}</td><td class="how">${esc(HOW[t.how] || t.how || '')}${ok(t.pts) ? ' · ' + pts(t.pts) : ''}</td></tr>`).join('')
        + '</tbody></table>';
    } else if (trades) html += '<div class="muted">No trade that day.</div>';
    else if (daysBusy || (!daysDoc && !daysErr)) html += '<div class="muted">Loading the trades…</div>';
    else html += '<div class="muted">The trades of this day are not available from the feed right now.</div>';
    box.innerHTML = html; box.hidden = false;
  }

  // 4. live trades: one row a whole trade, the bot's own and the firms' (firms with the very same fills share a row)
  function takers(firm, s, tin) {  // the paper accounts (of the chosen rule) that took this firm trade that session
    if (!daysDoc) return null;
    const pre = codeOf(firm) + '-', suf = new RegExp(`-${filt.rule.replace(/[^a-z0-9]/gi, '')}-\\d+$`);
    let n = 0;
    for (const acc of daysDoc.accounts || []) {
      if (!String(acc.id).startsWith(pre) || !suf.test(String(acc.id))) continue;
      const dd = (acc.days || []).find(x => x.s === s);
      if (dd && (dd.trades || []).some(t => t.tin === tin)) n++;
    }
    return n;
  }
  const fillKey = t => [t.side, t.tin, t.tout || '', ok(t.px_in) ? t.px_in : '', ok(t.px_out) ? t.px_out : '', t.how || '', ok(t.pts) ? t.pts : ''].join('|');
  function firmTrades(s) {   // [{firms: [...], t}] the firms' trades of session s, the same fill once
    const groups = new Map();
    for (const f of doc.firms || []) {
      if (filt.firm && f.firm !== filt.firm) continue;
      const fdays = daysDoc ? ((daysDoc.firms || []).find(x => x.firm === f.firm) || {}).days || [] : [];
      const fd = fdays.find(x => x.s === s);
      const tr = s === curSess() && f.today ? f.today.trades : fd ? fd.trades : [];
      for (const t of tr || []) {
        const k = fillKey(t);
        if (!groups.has(k)) groups.set(k, { firms: [], t });
        groups.get(k).firms.push(f.firm);
      }
    }
    return [...groups.values()];
  }
  function openCard(g) {
    const t = g.t, f = firmOf(g.firms[0]) || {};
    const fd = f.feed || {}, q = (f.today || {}).quote || {};
    const now = t.side === 'long' ? (ok(fd.bid) ? fd.bid : q.bid) : (ok(fd.ask) ? fd.ask : q.ask);
    const pl = ok(now) && ok(t.px_in) ? (t.side === 'long' ? now - t.px_in : t.px_in - now) : null;
    const ns = g.firms.map(x => takers(x, curSess(), t.tin));
    const nAcc = ns.every(v => v == null) ? null : ns.reduce((x, v) => x + (v || 0), 0);
    const kvs = [['In', t.px_in], ['Bot in', t.bot_in], ['Now', now]].filter(([, v]) => ok(v))
      .map(([k, v]) => `<div class="okv"><span class="lbl2">${k}</span><span class="num">${px(v)}</span></div>`).join('');
    return `<article class="ocard"><div class="oc-a"><span class="lbl2 warn">Open now</span>`
      + `<span class="oc-t">${esc(g.firms.join(', '))} ${esc(t.side)}, ${esc(f.symbol || '')}</span>`
      + `<span class="muted">In since ${esc(ctw(t.tin).slice(0, -3))} CT${nAcc != null ? `. Taken by ${int(nAcc)} paper account${nAcc === 1 ? '' : 's'} (${esc(ruleLabel(filt.rule))})` : ''}.</span></div>`
      + (kvs ? `<div class="oc-kv">${kvs}</div>` : '')
      + `<div class="oc-r"><span class="lbl2">So far, a lot</span><span class="oc-pl num ${cls(pl)}">${ok(pl) ? pts(pl) : '–'}</span></div></article>`;
  }
  function tradeRow(r) {
    const t = r.t;
    const pill = r.src === 'bot' ? '<span class="pill bot">BOT</span>' : r.firms.map(f => `<span class="pill ${esc(pillCls(f))}">${esc(f)}</span>`).join('');
    const what = r.src === 'bot' ? `${esc(t.side)}, 1 MNQ` : `${esc(t.side)}, 1 lot`;
    const outPx = ok(t.px_out) ? px(t.px_out) : (t.how === 'open' ? '…' : '–');
    const botPx = r.src === 'bot' ? '' : ok(t.bot_in) ? `<span class="muted">bot <b>${px(t.bot_in)}</b> → <b>${ok(t.bot_out) ? px(t.bot_out) : '…'}</b></span>` : '';
    const res = r.src === 'bot' ? (ok(t.px_in) && ok(t.px_out) ? (t.side === 'long' ? t.px_out - t.px_in : t.px_in - t.px_out) : null) : t.pts;
    const acc = r.src === 'bot' ? 'NinjaTrader Sim, the signal' : (r.n == null ? '' : `${int(r.n)} paper account${r.n === 1 ? '' : 's'}`);
    return `<div class="tr"><div class="c-t num"><span>${esc(ctw(t.tin))}</span><span class="muted">out ${t.tout ? esc(ct(t.tout)) : '–'}</span></div>`
      + `<div class="c-tr">${pill}<span>${what}</span></div>`
      + `<div class="c-px num"><span>${px(t.px_in)} → ${outPx}</span>${botPx}</div>`
      + `<div class="c-how">${esc(HOW[t.how] || t.how || '')}</div><div class="c-res num ${cls(res)}">${ok(res) ? sgn(res) : '–'}</div>`
      + `<div class="c-acc">${esc(acc)}</div></div>`;
  }
  function sessionRows(s) {
    const rows = [];
    const bot = daysDoc ? (daysDoc.bot || []).find(x => x.s === s) : null;
    const botTr = bot ? bot.trades : (s === curSess() && doc.signal ? doc.signal.trades : []);
    for (const t of botTr || []) rows.push({ src: 'bot', t, tin: t.tin });
    for (const g of firmTrades(s)) {
      const ns = g.firms.map(f => takers(f, s, g.t.tin));
      rows.push({ src: 'firm', firms: g.firms, t: g.t, tin: g.t.tin, n: ns.every(v => v == null) ? null : ns.reduce((x, v) => x + (v || 0), 0) });
    }
    return rows.sort((a, b) => (a.tin < b.tin ? -1 : a.tin > b.tin ? 1 : 0) || (a.src === 'bot' ? -1 : 1) - (b.src === 'bot' ? -1 : 1)
      || String((a.firms || [''])[0]).localeCompare(String((b.firms || [''])[0])));
  }
  function skipsOf(s) {
    const out = new Map();
    for (const f of doc.firms || []) {
      if (filt.firm && f.firm !== filt.firm) continue;
      const fdays = daysDoc ? ((daysDoc.firms || []).find(x => x.firm === f.firm) || {}).days || [] : [];
      const fd = fdays.find(x => x.s === s);
      const sk = s === curSess() && f.today ? f.today.skips : fd ? fd.skips : [];
      for (const k of sk || []) {
        const key = `${k.side} at ${ct5(k.tin)}: ${WHY[k.why] || k.why}`;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(f.firm);
      }
    }
    return [...out.entries()].map(([k, fs]) => `${fs.join(', ')} ${k}`);
  }
  function renderTrades() {
    const ss = sessList().slice().reverse();
    if (!ss.includes(trSess)) trSess = ss[0] || null;
    const cs = curSess();
    const nNow = cs ? sessionRows(cs).filter(r => r.src === 'bot').length : 0;
    $('tr-count').textContent = nNow ? `${nNow} this session` : '';
    $('tr-sess').innerHTML = ss.map(s => `<button type="button" data-s="${esc(s)}" aria-pressed="${s === trSess ? 'true' : 'false'}">${esc(short(s))}</button>`).join('');
    $('tr-sess').hidden = ss.length < 2;
    let html = '';
    if (cs && trSess === cs) for (const g of firmTrades(cs).filter(g => g.t.how === 'open' || !g.t.tout)) html += openCard(g);
    const head = '<div class="tr th"><span class="lbl2">Time, CT</span><span class="lbl2">Trade</span><span class="lbl2">Price</span>'
      + '<span class="lbl2">Ended by</span><span class="lbl2 r">Points</span><span class="lbl2">Accounts</span></div>';
    if (trSess) {
      const list = sessionRows(trSess), sk = skipsOf(trSess);
      const nb = list.filter(r => r.src === 'bot').length;
      const span = `${dayOf(addD(trSess, -1), { weekday: 'short' })} 17:00 to ${dayOf(trSess, { weekday: 'short' })} 16:00 CT. ${trSess === cs && isLive() ? 'Still open' : 'Closed'}.`;
      html += `<section class="tsec"><div class="ts-h"><h3>${esc(day(trSess))} session</h3><span class="muted">${esc(span)} ${nb} bot trade${nb === 1 ? '' : 's'}.</span></div>`
        + (list.length ? head + list.map(tradeRow).join('') : '<div class="muted">No trade yet.</div>')
        + (sk.length ? `<p class="tnote" style="margin-top:8px">Not taken: ${esc(sk.join('; '))}.</p>` : '') + '</section>';
    }
    html += '<p class="tnote">Each BOT row is the Scalper 3m bot\'s own trade (1 MNQ, futures points). Each firm row is the same trade at that firm: in at its ask (long) '
      + 'or bid (short) the moment the bot\'s entry appeared, out at its bid / ask the moment the bot\'s exit appeared, in index points for 1 lot. '
      + 'FundingPips, The5ers and Tradeify FX use FundedNext\'s prices, so their fills share FundedNext\'s row unless their own pause cut the trade. '
      + 'A paper account that reached its own day target or day stop first left earlier; its own rows are in its plan\'s calendar.</p>';
    $('trades').innerHTML = html;
  }
  $('tr-sess').addEventListener('click', e => {
    const b = e.target.closest('button[data-s]');
    if (!b || b.dataset.s === trSess) return;
    trSess = b.dataset.s;
    if (doc && !doc.withheld) { renderTrades(); if (daysStale()) fetchDays().then(renderTrades); }
  });

  function start() { setBar(); paint(); poll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
