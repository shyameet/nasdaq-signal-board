// The futures' contract switches (owner 24/10/2026: "smooth it and mark it on the chart", a warning on the expiry day "and
// warning can be on day before too", with a disclaimer that the real trading happens elsewhere), from
// data/futures/1m/rolls.json, which the VPS's daily job writes:
//   { rolls: { sym: [{ t: the new contract's first candle (UTC s), day, from, to, gap: new - old price (null: not measured
//                      yet), gap_t }] },
//     next: { sym: { day: the trading day the chart moves to `to`, from, to, expiry (MCX) } } }
// Smoothed by back-adjusting: every candle before a switch moves by its gap, so the line runs on through it and the newest
// candles are the contract traded now, at its own prices. A switch whose gap is not measured yet is marked, not moved.
//   await NsbRolls.load();                        // once at the start (again to refresh); no file: no switches
//   rows = NsbRolls.adjust('MCL', rows);          // rows { t (ms), o, h, l, c, ... } oldest first -> moved copies
//   NsbRolls.marks('MCL', from, to)               // the switches in [from, to) ms: [{ t, text }]
//   NsbRolls.warning(['MCL', 'CRUDEOILM'], key)   // the warning for trading day `key` ('' when none)
(function () {
  let data = { rolls: {}, next: {} };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WKD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const NAME = { MNQ: 'MNQ', MCL: 'MCL', NG: 'NG', CRUDEOILM: 'CRUDEOILM', NATGASMINI: 'NATGASMINI' };
  const fin = v => typeof v === 'number' && isFinite(v);
  // a contract's month: 'CRUDEOILM-19Nov2026-FUT' (MCX) -> 'Nov', 'NG 12-26' (CME, month-year) -> 'Dec'
  const month = c => { const s = String(c || ''), m = /-\d{1,2}([A-Za-z]{3})\d{4}-FUT$/.exec(s), n = /\s(\d{2})-\d{2}$/.exec(s);
                       return m ? m[1] : n && +n[1] >= 1 && +n[1] <= 12 ? MON[+n[1] - 1] : s; };
  const dateOf = k => { const d = new Date(k + 'T00:00:00Z'); return `${WKD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const weekdayBefore = k => { let t = Date.parse(k + 'T00:00:00Z') - 86400000; while ([0, 6].includes(new Date(t).getUTCDay())) t -= 86400000; return iso(t); };
  const r6 = v => Math.round(v * 1e6) / 1e6;  // no 2.6550000000000002

  async function load() {
    try {
      const r = await fetch('data/futures/1m/rolls.json', { cache: 'no-cache' });
      if (r.ok) { const j = await r.json(); data = { rolls: j.rolls || {}, next: j.next || {} }; }
    } catch (e) {}  // unreadable just now: the last one read stands
    return data;
  }
  const listed = sym => (Array.isArray(data.rolls[sym]) ? data.rolls[sym] : []).filter(r => r && fin(r.t));

  function adjust(sym, rows) {
    const rs = listed(sym).filter(r => fin(r.gap) && r.gap !== 0).sort((a, b) => b.t - a.t);  // newest first
    if (!rs.length) return rows;
    const out = new Array(rows.length);
    let k = 0, add = 0;  // walking back from the newest candle: each switch passed adds its gap
    for (let i = rows.length - 1; i >= 0; i--) {
      const b = rows[i];
      while (k < rs.length && b.t < rs[k].t * 1000) add = r6(add + rs[k++].gap);
      out[i] = add ? { ...b, o: r6(b.o + add), h: r6(b.h + add), l: r6(b.l + add), c: r6(b.c + add) } : b;
    }
    return out;
  }

  function marks(sym, from, to) {
    return listed(sym).filter(r => r.t * 1000 >= from && r.t * 1000 < to)
      .map(r => ({ t: r.t * 1000, text: `${month(r.from)} → ${month(r.to)}${fin(r.gap) ? '' : ' (not smoothed yet)'}` }));
  }

  // the switches of sym, past and next, one per day
  function switches(sym) {
    const all = listed(sym).map(r => ({ day: r.day, from: r.from, to: r.to, mcx: /-FUT$/.test(String(r.from || '')) }));
    const n = data.next[sym];
    if (n && n.day && !all.some(s => s.day === n.day)) all.push({ day: n.day, from: n.from, to: n.to, mcx: !!n.expiry });
    return all.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(String(s.day)));
  }
  function warning(syms, key) {
    const out = [];
    for (const sym of syms) for (const s of switches(sym)) {
      const name = NAME[sym] || sym, a = month(s.from), b = month(s.to);
      if (key === s.day) out.push(s.mcx ? `Expiry day: ${name} ${a} expires today; the chart shows ${b} from today's open`
                                        : `Contract switch today: ${name} moves from ${a} to ${b}`);
      else if (key >= weekdayBefore(s.day) && key < s.day) out.push(s.mcx ? `${name} ${a} expires ${dateOf(s.day)}; the chart moves to ${b} then`
                                                                         : `Contract switch ${dateOf(s.day)}: ${name} moves from ${a} to ${b}`);
    }
    return out.length ? `⚠ ${out.join(' · ')}. Chart only: check the contract and its expiry on the platform you trade on.` : '';
  }

  window.NsbRolls = { load, adjust, marks, warning };
})();
