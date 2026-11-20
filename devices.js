// Devices: the RDX bus machines and the data feeds (owner 12/11/2026; clearer layout 14/11/2026; data feeds 20/11/2026;
// tiles 20/11/2026: "can you fix the UI and UX of the devices tab? ... it is very weird, the design. Fix the design and
// make it a little better").
// Layout (owner-approved 20/11): one plain status line at the top ("All data flowing" / "1 problem: US futures 1-minute
// files late"), then two tile grids: Machines (VPS, SUMEET-PC, SUMEET-LT, RAHUL-PC) and Data feeds (Hyperliquid, MCX,
// Indian market with its GIFT NIFTY line, US futures, Forex). Each tile: a big status dot, the name and how long ago
// (machines: "checked 1 min ago"; feeds: "last price 20 s ago"); a one-line reason only when something is wrong. A
// machine's technical details (Claude on the bus, unread messages, the last automatic Claude start) open on a tap.
// No message text anywhere: the status file carries none and the page shows none. Nothing is stored in the browser.
//
// Feed: the VPS's live feed (Tailscale Funnel /devices, rebuilt every 10 s) is read every 15 s. When it does not answer the
// page falls back to the 5-minute copy on GitHub (rdx-bus-status, which GitHub's cache can hold up to 5 min more) and
// keeps trying the live feed. Times in the file are absolute (ISO UTC) and the page works out every age itself, so an
// old file still shows true ages. The data feeds (doc.feeds, built by the VPS's feeds_watch.py every 10 s) are in the live
// feed only: each source carries its own amber / red limits and whether its market is open (closed = grey).
// Preview/tests only: devices.html?src=<url> reads another live feed (same site, localhost/127.0.0.1, or a shyameet
// raw.githubusercontent.com file); any other src reads nothing.
(function () {
  'use strict';
  const LIVE = 'https://server.tail103b42.ts.net:8443/devices/devices.json';
  const COPY = 'https://raw.githubusercontent.com/shyameet/rdx-bus-status/main/devices.json';
  const KIND = 'rdx-bus-devices', LIVE_MS = 15000, COPY_MS = 60000, PAINT_MS = 5000, FETCH_MS = 8000, OLD_FILE_MIN = 15;
  const ORDER = ['VPS', 'SUMEET-PC', 'SUMEET-LT', 'RAHUL-PC'];
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = v => typeof v === 'number' && isFinite(v);
  const tms = s => { if (typeof s !== 'string') return null; const t = Date.parse(s); return isFinite(t) ? t : null; };

  // times in Chicago (CT), as every tab
  let fT, fD, fDay;
  try {
    fT = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    fD = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    fDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) { fT = fD = fDay = null; }
  function ct(t, now) {  // "09:58 CT" today (CT), else "Fri 6 Nov 10:00 CT"
    if (!fT) return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    return (fDay.format(t) === fDay.format(now) ? fT.format(t) : fD.format(t).replace(',', '')) + ' CT';
  }
  function dur(ms) {  // "5 s", "40 s", "2 min", "3 h", "6 days"
    const s = Math.floor(Math.max(0, ms) / 1000);
    if (s < 10) return Math.max(1, s) + ' s';
    if (s < 90) return Math.round(s / 5) * 5 + ' s';
    const m = Math.floor(s / 60);
    if (m < 90) return m + ' min';
    const h = Math.floor(m / 60);
    if (h < 48) return h + ' h';
    const d = Math.floor(h / 24);
    return d + (d === 1 ? ' day' : ' days');
  }

  function srcUrl() {
    const p = new URLSearchParams(location.search).get('src');
    if (!p) return LIVE;
    try {
      const u = new URL(p, location.href);
      const fine = u.origin === location.origin || (/^https?:$/.test(u.protocol) && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) ||
        (u.protocol === 'https:' && u.hostname === 'raw.githubusercontent.com' && u.pathname.indexOf('/shyameet/') === 0);
      return fine ? u.href : null;
    } catch (e) { return null; }
  }
  const live = srcUrl();

  // doc = the newest good file; via = 'live' or 'copy'
  let doc = null, via = '', busy = false, timer = 0, lastCopy = 0;
  async function getJson(url) {  // the answer and its body within FETCH_MS, else it throws
    const c = typeof AbortController === 'function' ? new AbortController() : null;
    const t = c ? setTimeout(() => c.abort(), FETCH_MS) : 0;
    try {
      const r = await fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(),
        { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: c ? c.signal : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!(j && j.kind === KIND && Array.isArray(j.devices))) throw new Error('not a status file');
      return j;
    } finally { clearTimeout(t); }
  }
  const newer = j => !doc || (tms(j.generated) || 0) >= (tms(doc.generated) || 0);
  async function poll() {
    if (busy) return;
    busy = true; clearTimeout(timer);
    let liveOk = false;
    try {
      if (live) { const j = await getJson(live); liveOk = true; if (newer(j)) { doc = j; via = 'live'; } }
    } catch (e) { /* the live feed did not answer: the GitHub copy below */ }
    if (!liveOk && Date.now() - lastCopy >= COPY_MS - 1000) {
      lastCopy = Date.now();
      try { const j = await getJson(COPY); if (newer(j)) { doc = j; via = 'copy'; } } catch (e) { /* keep what we have */ }
    }
    busy = false;
    timer = setTimeout(poll, LIVE_MS);
    paint();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  // ---------------------------------------------------------------- a machine tile
  const row = (k, v, sub, cls) => `<div class="row"><dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
  const opened = new Set();  // machine tiles the viewer opened (kept open across repaints)

  function machine(id, d, offMs, now) {
    const seen = d ? tms(d.machine && d.machine.last_seen) : null;
    const state = !d || seen == null ? 'none' : now - seen <= offMs ? 'ok' : 'off';
    const cl = (d && d.claude) || {}, inbox = (d && d.inbox) || {}, auto = (d && d.auto) || {};

    let line, why = '';
    if (state === 'ok') line = `checked ${esc(dur(now - seen))} ago`;
    else if (state === 'off') { line = `last check-in ${esc(dur(now - seen))} ago`; why = `Offline since ${esc(ct(seen, now))}`; }
    else { line = 'not set up'; why = d ? 'The bus setup has not been run on this machine' : 'Not in the status file'; }

    // the technical details, on a tap: Claude on the bus, unread messages, the last automatic Claude start
    const cSeen = tms(cl.last_seen);
    const listening = state === 'ok' && cl.listening === true && (cSeen == null || now - cSeen <= offMs);
    const autoTxt = auto.enabled === true ? 'auto-start on' : auto.enabled === false ? 'auto-start off' : '';
    const claudeRow = !d || state === 'none' ? row('Claude on the bus', '–', '', 'na')
      : row('Claude on the bus', listening ? 'listening' : 'not listening', autoTxt, listening ? 'good' : 'na');
    const unread = d && ok(inbox.unread) ? Math.max(0, Math.round(inbox.unread)) : null, oldest = tms(inbox.oldest_at);
    const unreadRow = unread == null ? row('Unread messages', '–', '', 'na')
      : row('Unread messages', String(unread), unread > 0 && oldest != null ? 'oldest waiting ' + esc(dur(now - oldest)) : '', unread > 0 ? 'warn' : '');
    const st = tms(auto.last_start), en = tms(auto.last_end);
    const rc = auto.last_rc == null ? null : String(auto.last_rc);
    let autoRow;
    if (!d || state === 'none') autoRow = row('Last auto-start', '–', '', 'na');
    else if (st == null) autoRow = row('Last auto-start', 'never', '', 'na');
    else if (auto.running === true) autoRow = row('Last auto-start', esc(dur(now - st)) + ' ago', 'running now', 'good');
    else if (rc != null && rc !== '0' && (en == null || en >= st)) autoRow = row('Last auto-start', esc(ct(st, now)), 'failed', 'bad');
    else autoRow = row('Last auto-start', esc(dur(now - st)) + ' ago', esc(ct(st, now)));

    const word = { ok: 'working', off: 'offline', none: 'not set up' }[state];
    const html = `<details class="tile m ${state}" data-id="${esc(id)}"${opened.has(id) ? ' open' : ''}>` +
      `<summary aria-label="${esc(id)}: ${word}"><span class="dot" aria-hidden="true"></span>` +
      `<span class="tx"><b class="nm">${esc(id)}</b><span class="ln">${line}</span>${why ? `<span class="why">${why}</span>` : ''}</span>` +
      `<span class="more" aria-hidden="true"></span></summary>` +
      `<dl class="rows">${claudeRow}${unreadRow}${autoRow}</dl></details>`;
    const problem = state === 'off' ? { lvl: 'red', txt: `${id} offline ${dur(now - seen)}` }
      : state === 'none' ? { lvl: 'red', txt: `${id} not set up` } : null;
    return { html, problem };
  }

  // ---------------------------------------------------------------- a data-feed tile
  const RANK = { ok: 0, amber: 1, red: 2 };
  function partState(p, open, now) {  // -> { state: 'ok'|'amber'|'red'|'closed', age (ms|null), stale: [names] }
    const lim = s => (ok(s) ? s * 1000 : null);
    const amber = lim(p.amber_s) || 60000, red = lim(p.red_s) || 300000;
    const judge = age => age == null ? 'red' : age > red ? 'red' : age > amber ? 'amber' : 'ok';
    let age = null, st = 'ok';
    const stale = [];
    if (Array.isArray(p.items)) {  // several files: the oldest decides; the late ones are named
      for (const it of p.items) {
        const t = tms(it && it.t), a = t == null ? null : Math.max(0, now - t), s = judge(a);
        if (s !== 'ok') stale.push(String(it.n));
        if (RANK[s] > RANK[st]) st = s;
        if (a != null && (age == null || a > age)) age = a;
      }
    } else {
      const t = tms(p.last);
      age = t == null ? null : Math.max(0, now - t);
      st = judge(age);
    }
    if (p.bad) st = 'red';
    if (p.open === false || (p.open !== true && !open)) st = 'closed';  // a source with its own hours (GIFT NIFTY) says so
    return { state: st, age, stale };
  }
  const short = name => String(name || '').replace(/\s*\(.*\)\s*$/, '');  // "1-minute files (RDXAutoLogger)" -> "1-minute files"
  function reason(p, j) {  // why a source is late, in one short phrase
    if (p.bad) return `${short(p.name)}: ${p.bad}`;
    if (Array.isArray(p.items) && j.stale.length) return `${short(p.name)} late: ${j.stale.join(', ')}`;
    return j.age == null ? `${short(p.name)}: no price yet` : `${short(p.name)}: no price for ${dur(j.age)}`;
  }
  function feedTile(f, now) {
    const open = f.open !== false, all = Array.isArray(f.parts) ? f.parts : [];
    const gift = all.filter(p => p.id === 'gift'), parts = all.filter(p => p.id !== 'gift').map(p => ({ p, j: partState(p, open, now) }));
    const live = parts.filter(x => x.j.state !== 'closed');
    // the tile's dot and age come from its worst source; between equally good ones a live price beats a daily file
    // (kind "day": the archive's age is its day's end, not a price), then the older one
    const day = x => (x.p.kind === 'day' ? 1 : 0);
    let worst = null;
    for (const x of live) {
      if (!worst) { worst = x; continue; }
      const r = RANK[x.j.state] - RANK[worst.j.state];
      if (r > 0 || (r === 0 && (day(x) < day(worst) || (day(x) === day(worst) &&
          (x.j.age == null || (worst.j.age != null && x.j.age > worst.j.age)))))) worst = x;
    }
    const state = worst ? worst.j.state : 'closed';
    let line;
    if (state === 'closed') {
      const newest = parts.reduce((m, x) => x.j.age != null && (m == null || x.j.age < m) ? x.j.age : m, null);
      line = 'market closed' + (newest != null ? ` · last price ${esc(dur(newest))} ago` : '');
    } else line = worst.j.age == null ? 'no price yet' : `last price ${esc(dur(worst.j.age))} ago`;
    const late = live.filter(x => x.j.state !== 'ok').map(x => ({ p: x.p, j: x.j }));

    // GIFT NIFTY: its own small line inside the Indian market tile (own hours: 06:30 -> 02:45 IST)
    const g = gift.map(p => {
      const j = partState(p, true, now);
      const txt = j.state === 'closed' ? 'closed' : j.age == null ? 'no price yet' : `last price ${esc(dur(j.age))} ago`;
      if (j.state === 'amber' || j.state === 'red') late.push({ p: Object.assign({}, p, { name: 'GIFT NIFTY' }), j });
      return { lvl: j.state, html: `<span class="sub ${j.state}"><i aria-hidden="true"></i>GIFT NIFTY · ${txt}</span>` };
    });
    // the tile: the worst of its open sources (GIFT included); grey only when every one is closed
    const open_ = [state].concat(g.map(x => x.lvl)).filter(s => s !== 'closed');
    const tState = open_.length ? open_.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : 'closed';
    const note = parts.map(x => x.p.note).filter(n => n && /dropped/.test(n));   // the MCX drop count (owner 20/11)
    const word = { ok: 'receiving', amber: 'slow', red: 'not receiving', closed: 'market closed' }[tState];
    const why = late.map(x => reason(x.p, x.j)).join(' · ');
    const html = `<article class="tile f ${tState}" aria-label="${esc(f.name)}: ${word}"><span class="dot" aria-hidden="true"></span>` +
      `<span class="tx"><b class="nm">${esc(f.name)}</b><span class="ln">${line}</span>${g.map(x => x.html).join('')}` +
      `${note.map(n => `<span class="note">${esc(n)}</span>`).join('')}` +
      `${why ? `<span class="why">${esc(why)}</span>` : ''}</span></article>`;
    // for the status line: "US futures 1-minute files late"
    const brief = x => Array.isArray(x.p.items) && x.j.stale.length ? `${short(x.p.name)} late`
      : x.p.bad ? `${short(x.p.name)}: ${x.p.bad}` : x.j.age == null ? `${short(x.p.name)}: no price yet` : `${short(x.p.name)}: no price for ${dur(x.j.age)}`;
    const problem = late.length ? { lvl: tState, txt: `${short(f.name)} ${late.map(brief).join(', ')}` } : null;
    return { html, problem };
  }

  // ---------------------------------------------------------------- the page
  const shown = { sum: '', devs: '', feeds: '' };
  const put = (id, html) => { if (html !== shown[id]) { $(id).innerHTML = html; shown[id] = html; } };
  function paint() {
    const now = Date.now();
    if (!doc) {
      put('sum', '<p class="status na"><span class="dot" aria-hidden="true"></span>Status not available yet<span class="fresh">waiting for the first answer…</span></p>');
      put('devs', ''); put('feeds', '');
      return;
    }
    const offMin = ok(doc.offline_after_min) && doc.offline_after_min > 0 ? doc.offline_after_min : 10;
    const byId = {};
    for (const d of doc.devices) if (d && typeof d.id === 'string' && !byId[d.id]) byId[d.id] = d;
    const ms = ORDER.map(id => machine(id, byId[id] || null, offMin * 60000, now));
    const F = doc.feeds;
    const fs = F && Array.isArray(F.feeds) ? F.feeds.map(f => feedTile(f, now)) : null;

    // the status line: "All data flowing" / "N problems: ..." and how fresh the status itself is
    const problems = ms.concat(fs || []).map(x => x.problem).filter(Boolean);
    const gen = tms(doc.generated), age = gen == null ? null : now - gen;
    if (age != null && age > OLD_FILE_MIN * 60000) problems.unshift({ lvl: 'red', txt: `status is ${dur(age)} old (is the VPS down?)` });
    if (!fs) problems.push({ lvl: 'amber', txt: F && F.error ? `data feeds: ${F.error}` : 'data feeds not in this status file (live feed not answering)' });
    const lvl = problems.some(p => p.lvl === 'red') ? 'red' : problems.length ? 'amber' : 'ok';
    const head = problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}: ${esc(problems.map(p => p.txt).join(' · '))}` : 'All data flowing';
    const fresh = age == null ? '' : via === 'live' ? `updated ${esc(dur(age))} ago` : `5-minute copy · updated ${esc(dur(age))} ago`;
    put('sum', `<p class="status ${lvl}"><span class="dot" aria-hidden="true"></span><span class="st">${head}</span>${fresh ? `<span class="fresh">${fresh}</span>` : ''}</p>`);

    put('devs', `<h2 class="sec">Machines</h2><div class="grid g4">${ms.map(x => x.html).join('')}</div>`);
    put('feeds', `<h2 class="sec">Data feeds</h2>` + (fs ? `<div class="grid g5">${fs.map(x => x.html).join('')}</div>`
      : `<p class="empty">${F && F.error ? esc(F.error) : 'The data feeds come with the live feed only; it is not answering.'}</p>`));
  }
  // keep a machine tile open across repaints once the viewer opened it
  document.addEventListener('toggle', e => {
    const t = e.target;
    if (t && t.matches && t.matches('details.tile.m')) { if (t.open) opened.add(t.dataset.id); else opened.delete(t.dataset.id); }
  }, true);

  // on a phone the tab row scrolls inside itself and Devices is its last tab: start it scrolled so Devices shows
  const nav = document.querySelector('nav.tabs'), cur = nav && nav.querySelector('a[aria-current="page"]');
  const showCur = () => { if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += Math.max(0, cur.getBoundingClientRect().right - nav.getBoundingClientRect().right + 2); };
  showCur();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(showCur);  // the web font changes the tabs' widths

  setInterval(paint, PAINT_MS);
  paint();
  poll();
})();
