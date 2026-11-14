// Devices: the RDX bus machines (owner 12/11/2026; clearer layout 14/11/2026: "it has 4 devices and its kind of confusing
// and hard to know whether its working or not ... make it a bit better and more responsive").
// One answer per device first: WORKING (its machine checked in within offline_after_min), OFFLINE (it did, longer ago)
// or NOT SET UP (it never did). Then the details in plain words: Claude on the bus, unread messages, the last automatic
// Claude start (and whether it failed, when the file says). The top line counts the working devices and names the rest.
// No message text anywhere: the status file carries none and the page shows none. Nothing is stored in the browser.
//
// Feed: the VPS's live feed (Tailscale Funnel /devices, rebuilt every 10 s) is read every 15 s. When it does not answer the
// page falls back to the 5-minute copy on GitHub (rdx-bus-status, which GitHub's cache can hold up to 5 min more) and
// keeps trying the live feed. Times in the file are absolute (ISO UTC) and the page works out every age itself, so an
// old file still shows true ages; the line under the top line says which feed is shown and how old it is.
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

  // doc = the newest good file; via = 'live' or 'copy'; lastLive = when the live feed last answered
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

  // ---------------------------------------------------------------- one device
  const row = (k, v, sub, cls) => `<div class="row"><dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;

  function device(id, d, offMs, now) {
    const seen = d ? tms(d.machine && d.machine.last_seen) : null;
    const state = !d || seen == null ? 'none' : now - seen <= offMs ? 'ok' : 'off';
    const cl = (d && d.claude) || {}, inbox = (d && d.inbox) || {}, auto = (d && d.auto) || {};
    const pill = { ok: 'Working', off: 'Offline', none: 'Not set up' }[state];

    let main;
    if (!d) main = 'Not in the status file.';
    else if (state === 'none') main = 'Never checked in: the bus setup has not been run on this machine.';
    else if (state === 'ok') main = `Checked in <b>${esc(dur(now - seen))} ago</b> <span class="at">${esc(ct(seen, now))}</span>`;
    else main = `Last check-in <b>${esc(dur(now - seen))} ago</b> <span class="at">${esc(ct(seen, now))}</span>`;

    // Claude on the bus: listening (a Claude session there watches the bus) or not; auto-start on/off says whether a
    // message would start one by itself
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

    return { state, id, seen, html: `<article class="card ${state}" aria-label="${esc(id)}: ${pill}">` +
      `<header><h2>${esc(id)}</h2><span class="pill">${pill}</span></header>` +
      `<p class="main">${main}</p>` +
      `<dl class="rows">${claudeRow}${unreadRow}${autoRow}</dl></article>` };
  }

  // ---------------------------------------------------------------- the page
  let shownCards = '', shownTop = '';
  function paint() {
    const sum = $('sum'), devs = $('devs'), now = Date.now();
    if (!doc) {
      const t = '<p class="big na">Status not available yet</p><p class="fresh">Waiting for the first answer…</p>';
      if (t !== shownTop) { sum.innerHTML = t; shownTop = t; }
      if (shownCards) { devs.innerHTML = ''; shownCards = ''; }
      return;
    }
    const offMin = ok(doc.offline_after_min) && doc.offline_after_min > 0 ? doc.offline_after_min : 10;
    const byId = {};
    for (const d of doc.devices) if (d && typeof d.id === 'string' && !byId[d.id]) byId[d.id] = d;
    const cards = ORDER.map(id => device(id, byId[id] || null, offMin * 60000, now));
    const good = cards.filter(c => c.state === 'ok').length;

    // top line: "All 4 devices working" / "2 of 4 devices working", then a chip per device
    const klass = good === cards.length ? 'ok' : good === 0 ? 'off' : 'part';
    const big = good === cards.length ? `All ${cards.length} devices working` : `${good} of ${cards.length} devices working`;
    const chips = cards.map(c => {
      const why = c.state === 'ok' ? '' : c.state === 'none' ? ' · not set up' : ' · offline ' + esc(dur(now - c.seen));
      return `<li class="chip ${c.state}"><i aria-hidden="true"></i>${esc(c.id)}${why}</li>`;
    }).join('');

    // which feed and how old: green "Live" when the live feed answers and the file is fresh
    const gen = tms(doc.generated), age = gen == null ? null : now - gen;
    let fresh;
    if (age != null && age > OLD_FILE_MIN * 60000) fresh = `<p class="fresh old"><i aria-hidden="true"></i>Status is ${esc(dur(age))} old: the VPS has not updated it (is the VPS down?)</p>`;
    else if (via === 'live') fresh = `<p class="fresh live"><i aria-hidden="true"></i>Live · updated ${age == null ? '–' : esc(dur(age)) + ' ago'} · checks every 15 s</p>`;
    else fresh = `<p class="fresh copy"><i aria-hidden="true"></i>5-minute copy · updated ${age == null ? '–' : esc(dur(age)) + ' ago'} (live feed not answering)</p>`;

    const top = `<p class="big ${klass}"><i aria-hidden="true"></i>${big}</p><ul class="chips">${chips}</ul>${fresh}`;
    if (top !== shownTop) { sum.innerHTML = top; shownTop = top; }
    const html = cards.map(c => c.html).join('');
    if (html !== shownCards) { devs.innerHTML = html; shownCards = html; }
  }

  // on a phone the tab row scrolls inside itself and Devices is its last tab: start it scrolled so Devices shows
  const nav = document.querySelector('nav.tabs'), cur = nav && nav.querySelector('a[aria-current="page"]');
  const showCur = () => { if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += Math.max(0, cur.getBoundingClientRect().right - nav.getBoundingClientRect().right + 2); };
  showCur();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(showCur);  // the web font changes the tabs' widths

  setInterval(paint, PAINT_MS);
  paint();
  poll();
})();
