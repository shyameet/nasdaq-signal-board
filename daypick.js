// The day picker of the replay pages (owner 24/10/2026: "a small calendar instead of going back and forward"): one
// small button with the day; a click opens a month calendar where only the days with data can be picked.
//   const pick = DayPick(hostElement, { onPick: key => ..., title: 'Day' });
//   pick.set(['2026-10-24', '2026-10-23', ...], '2026-10-24', todayKey);   // days with data (any order), the one shown
(function () {
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON3 = MON.map(m => m.slice(0, 3)), WKD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const css = `
    .dp { position: relative; display: inline-flex; }
    .dp-btn { display: inline-flex; align-items: center; gap: 7px; padding: 3px 9px; border: 1px solid var(--line, #1c2430); border-radius: 7px;
      background: var(--bg, #0a0d12); color: var(--text, #e8eef6); cursor: pointer; font: 500 12px var(--font-num, monospace); white-space: nowrap; }
    .dp-btn:hover, .dp-btn[aria-expanded="true"] { border-color: var(--line-strong, #283240); background: var(--tile, #121922); }
    .dp-btn svg { width: 13px; height: 13px; flex: none; opacity: .75; }
    .dp-pop { position: fixed; z-index: 60; width: 236px; padding: 10px; border: 1px solid var(--line-strong, #283240); border-radius: 10px;
      background: var(--surface, #0e131a); box-shadow: 0 16px 48px rgba(0, 0, 0, .55); font: 12px var(--font-ui, sans-serif); color: var(--text, #e8eef6); }
    .dp-pop[hidden] { display: none; }
    .dp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-weight: 600; }
    .dp-head button { width: 26px; height: 24px; border: 1px solid var(--line, #1c2430); border-radius: 6px; background: transparent;
      color: var(--muted, #8d99ab); cursor: pointer; }
    .dp-head button:disabled { opacity: .3; cursor: default; }
    .dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
    .dp-grid .wd { color: var(--faint, #5c6879); font-size: 10.5px; padding: 2px 0; }
    .dp-grid button { height: 26px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text, #e8eef6);
      cursor: pointer; font: 12px var(--font-num, monospace); }
    .dp-grid button:hover:not(:disabled) { background: var(--tile, #121922); border-color: var(--line-strong, #283240); }
    .dp-grid button:disabled { color: var(--faint, #5c6879); opacity: .45; cursor: default; }
    .dp-grid button.today { border-color: var(--line-strong, #283240); }
    .dp-grid button.on { background: var(--accent, #5b8cff); color: #fff; }`;
  let styled = false;
  const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';
  const parse = k => { const [y, m, d] = k.split('-').map(Number); return { y, m: m - 1, d }; };
  const label = k => { const { y, m, d } = parse(k); return `${WKD[new Date(Date.UTC(y, m, d)).getUTCDay()]} ${d} ${MON3[m]}`; };
  const key = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  window.DayPick = function (host, { onPick, title = 'Day' } = {}) {
    if (!styled) { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); styled = true; }
    host.classList.add('dp');
    host.innerHTML = `<button type="button" class="dp-btn" aria-haspopup="dialog" aria-expanded="false" title="${title}: pick a day (today is outlined in the calendar)">${ICON}<span></span><span aria-hidden="true">▾</span></button>`;
    const btn = host.querySelector('.dp-btn'), text = btn.querySelector('span');
    const pop = document.createElement('div');
    pop.className = 'dp-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Pick a day');
    document.body.appendChild(pop);
    let days = new Set(), value = null, today = null, view = null;  // view: { y, m } shown in the calendar
    const months = () => [...days].map(k => { const { y, m } = parse(k); return y * 12 + m; });
    function draw() {
      const { y, m } = view, first = new Date(Date.UTC(y, m, 1)).getUTCDay(), n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const ms = months(), cur = y * 12 + m, lo = Math.min(...ms), hi = Math.max(...ms);
      let cells = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(w => `<span class="wd">${w}</span>`).join('');
      for (let i = 0; i < first; i++) cells += '<span></span>';
      for (let d = 1; d <= n; d++) {
        const k = key(y, m, d), cls = [k === value ? 'on' : '', k === today ? 'today' : ''].join(' ').trim();
        cells += `<button type="button" data-k="${k}" class="${cls}"${days.has(k) ? '' : ' disabled'} title="${days.has(k) ? label(k) : 'no data'}">${d}</button>`;
      }
      pop.innerHTML = `<div class="dp-head"><button type="button" data-step="-1"${cur <= lo ? ' disabled' : ''} aria-label="Previous month">◀</button>`
        + `<span>${MON[m]} ${y}</span><button type="button" data-step="1"${cur >= hi ? ' disabled' : ''} aria-label="Next month">▶</button></div>`
        + `<div class="dp-grid">${cells}</div>`;
    }
    function open(on) {
      pop.hidden = !on; btn.setAttribute('aria-expanded', String(on));
      if (!on) return;
      view = value ? { y: parse(value).y, m: parse(value).m } : view;
      draw();
      const r = btn.getBoundingClientRect();
      pop.style.top = `${Math.round(r.bottom + 6)}px`;
      pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - 244)))}px`;
    }
    btn.addEventListener('click', () => open(pop.hidden));
    pop.addEventListener('click', e => {
      const s = e.target.closest('[data-step]');
      if (s && !s.disabled) { const t = view.y * 12 + view.m + Number(s.dataset.step); view = { y: Math.floor(t / 12), m: t % 12 }; draw(); return; }
      const b = e.target.closest('[data-k]');
      if (b && !b.disabled) { open(false); if (b.dataset.k !== value) onPick(b.dataset.k); }
    });
    document.addEventListener('mousedown', e => { if (!pop.hidden && !pop.contains(e.target) && !host.contains(e.target)) open(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) open(false); });
    return {
      set(list, v, t) { days = new Set(list); value = v; today = t || null; text.textContent = v ? label(v) : '—'; if (!pop.hidden) draw(); },
      get value() { return value; },
    };
  };
})();
