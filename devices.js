// Devices: the RDX bus machines (owner 12/11/2026, the approved layout: a top line "Bus OK" when every device is online,
// else "N devices offline"; 4 cards VPS, SUMEET-PC, SUMEET-LT, RAHUL-PC with two lights (Machine on, Claude listening),
// last seen, unread messages and how long the oldest has waited, when its Claude was last started automatically). No
// message text anywhere: the status file carries none and the page shows none.
// It reads the VPS's status file (rdx-bus-devices v1) from the rdx-bus-status repo every 60 s; times there are absolute
// (ISO UTC) and the page works out every age itself, so a stale file still shows true ages. A device is online when its
// machine was seen within offline_after_min; machine.last_seen null = never set up. Until the first good read the page says
// "Status not available yet"; after that a failed read keeps the last data (its ages keep growing). When the file's
// "generated" is more than 15 min old, one small line says how old it is. Nothing is stored in the browser.
// Preview/tests only: devices.html?src=<url> reads another file (same site, localhost/127.0.0.1, or a shyameet
// raw.githubusercontent.com file); any other src reads nothing.
(function () {
  'use strict';
  const SRC = 'https://raw.githubusercontent.com/shyameet/rdx-bus-status/main/devices.json';
  const KIND = 'rdx-bus-devices', POLL_MS = 60000, PAINT_MS = 15000, FETCH_MS = 10000, OLD_FILE_MIN = 15;
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
  function dur(ms) {  // "under 1 min", "2 min", "3 h", "6 days"
    const m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 1) return 'under 1 min';
    if (m < 90) return m + ' min';
    const h = Math.floor(m / 60);
    if (h < 48) return h + ' h';
    const d = Math.floor(h / 24);
    return d + (d === 1 ? ' day' : ' days');
  }

  function srcUrl() {
    const p = new URLSearchParams(location.search).get('src');
    if (!p) return SRC;
    try {
      const u = new URL(p, location.href);
      const fine = u.origin === location.origin || (/^https?:$/.test(u.protocol) && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) ||
        (u.protocol === 'https:' && u.hostname === 'raw.githubusercontent.com' && u.pathname.indexOf('/shyameet/') === 0);
      return fine ? u.href : null;
    } catch (e) { return null; }
  }
  const src = srcUrl();

  let doc = null, busy = false, timer = 0;
  async function getJson(url) {  // the answer and its body within FETCH_MS, else it throws
    const c = typeof AbortController === 'function' ? new AbortController() : null;
    const t = c ? setTimeout(() => c.abort(), FETCH_MS) : 0;
    try {
      const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: c ? c.signal : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function poll() {
    if (busy) return;
    busy = true; clearTimeout(timer);
    try {
      if (src) {
        const j = await getJson(src + (src.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now());
        if (j && j.kind === KIND && Array.isArray(j.devices)) doc = j;
      }
    } catch (e) { /* not there yet, refused, no answer, not JSON: keep what we have */ }
    finally { busy = false; }
    timer = setTimeout(poll, POLL_MS);
    paint();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  // ---------------------------------------------------------------- render
  const light = (state, label) => `<span class="lt ${state}"><i aria-hidden="true"></i>${label}<span class="sr">: ${state === 'on' ? 'yes' : state === 'off' ? 'no' : 'not known'}</span></span>`;
  const kv = (k, v, sub, na) => `<div class="kv"><span class="k">${k}</span><span class="v${na ? ' na' : ''}">${v}${sub ? `<small>${sub}</small>` : ''}</span></div>`;

  function device(id, d, offMs, now) {
    const seen = d ? tms(d.machine && d.machine.last_seen) : null;
    const online = seen != null && now - seen <= offMs;
    const cl = (d && d.claude) || {}, inbox = (d && d.inbox) || {}, auto = (d && d.auto) || {};
    let mLight = 'none', cLight = 'none', seenRow;
    if (!d) seenRow = kv('Last seen', 'not in the status file', '', true);
    else if (seen == null) seenRow = kv('Last seen', 'never set up', '', true);
    else {
      mLight = online ? 'on' : 'off';
      const cSeen = tms(cl.last_seen);
      cLight = online && cl.listening === true && (cSeen == null || now - cSeen <= offMs) ? 'on' : 'off';
      seenRow = kv('Last seen', esc(dur(now - seen)) + ' ago', esc(ct(seen, now)));
    }
    const unread = d && ok(inbox.unread) ? Math.max(0, Math.round(inbox.unread)) : null, oldest = tms(inbox.oldest_at);
    const unreadRow = unread == null ? kv('Unread messages', '–', '', true)
      : kv('Unread messages', String(unread), unread > 0 && oldest != null ? 'oldest waiting ' + esc(dur(now - oldest)) : '');
    const st = tms(auto.last_start);
    const autoRow = !d ? kv('Claude auto-started', '–', '', true)
      : st == null ? kv('Claude auto-started', 'never', '', true) : kv('Claude auto-started', esc(dur(now - st)) + ' ago', esc(ct(st, now)));
    return { online, html: `<article class="card" aria-label="${esc(id)}"><h2>${esc(id)}</h2>` +
      `<div class="lts">${light(mLight, 'Machine on')}${light(cLight, 'Claude listening')}</div>` +
      `<div class="kvs">${seenRow}${unreadRow}${autoRow}</div></article>` };
  }

  let shown = '';
  function setBus(klass, text) {  // only when it changes: the line is a live region, so no re-announcing every 15 s
    const bus = $('bus');
    if (bus.className !== klass) bus.className = klass;
    if (bus.textContent !== text) bus.innerHTML = '<i aria-hidden="true"></i>' + esc(text);
  }
  function paint() {
    const age = $('age'), devs = $('devs'), now = Date.now();
    if (!doc) {
      setBus('bus na', 'Status not available yet');
      age.hidden = true; devs.innerHTML = ''; shown = '';
      return;
    }
    const offMin = ok(doc.offline_after_min) && doc.offline_after_min > 0 ? doc.offline_after_min : 10;
    const byId = {};
    for (const d of doc.devices) if (d && typeof d.id === 'string' && !byId[d.id]) byId[d.id] = d;
    const cards = ORDER.map(id => device(id, byId[id] || null, offMin * 60000, now));
    const off = cards.filter(c => !c.online).length;
    setBus('bus ' + (off ? 'off' : 'ok'), off ? `${off} ${off === 1 ? 'device' : 'devices'} offline` : 'Bus OK');
    const gen = tms(doc.generated);
    age.hidden = !(gen != null && now - gen > OLD_FILE_MIN * 60000);
    if (!age.hidden) age.textContent = `The status file is ${dur(now - gen)} old.`;
    const html = cards.map(c => c.html).join('');
    if (html !== shown) { devs.innerHTML = html; shown = html; }
  }

  // on a phone the tab row scrolls inside itself and Devices is its last tab: start it scrolled so Devices shows
  const nav = document.querySelector('nav.tabs'), cur = nav && nav.querySelector('a[aria-current="page"]');
  const showCur = () => { if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += Math.max(0, cur.getBoundingClientRect().right - nav.getBoundingClientRect().right + 2); };
  showCur();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(showCur);  // the web font changes the tabs' widths

  setInterval(paint, PAINT_MS);
  poll();
})();
