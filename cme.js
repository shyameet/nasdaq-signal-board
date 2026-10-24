/* Indra Quant Signal Board: the CME trading day, shared by every page.

   Owner 24/10/2026: a US market's new day starts at the CME open, 17:00 Chicago - 03:30 IST while Chicago is on
   summer time, 04:30 IST in its winter time (from the first Sunday of November) - not at midnight. Trading day
   "YYYY-MM-DD" runs from 17:00 Chicago the evening before that date to 17:00 Chicago on it, so every candle of one
   Globex session (17:00 to 16:00 the next afternoon, then the one-hour break) falls in one trading day; the stock
   perps, which trade around the clock, are split at the same moment.
     NsbCme.key(t)    the trading day of ms t ("YYYY-MM-DD")
     NsbCme.open(k)   ms: when trading day k begins
     NsbCme.day0(t)   ms: when the trading day of t began;  NsbCme.dayEnd(t): when it ends (the next one begins)
     NsbCme.dayNo(t)  the trading day of t as a number (days since 1 Jan 1970), for quick comparisons
     NsbCme.next(k), NsbCme.prev(k)   the calendar day after / before k
   A market's `origin` of 'cme' (instead of ms after 00:00 UTC) means: its bars restart at the CME open. */
(() => {
'use strict';
const H = 3600000, DAY = 86400000;
let yLo = 0, yHi = -1, sLo = 0, sHi = 0;  // the year last asked about, and its summer time
function summer(t) {  // Chicago on summer time (UTC-5): 2nd Sunday of March 02:00 CST to 1st Sunday of November 02:00 CDT
  if (t < yLo || t >= yHi) {
    const y = new Date(t).getUTCFullYear();
    const sunday = (m, n) => { const w = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + (7 - w) % 7 + 7 * (n - 1)); };
    yLo = Date.UTC(y, 0, 1); yHi = Date.UTC(y + 1, 0, 1);
    sLo = sunday(2, 2) + 8 * H; sHi = sunday(10, 1) + 7 * H;  // 02:00 CST = 08:00 UTC; 02:00 CDT = 07:00 UTC
  }
  return t >= sLo && t < sHi;
}
const dayNo = t => Math.floor((t - (summer(t) ? 5 : 6) * H + 7 * H) / DAY);  // Chicago's clock; from 17:00 it is the next day
const openNo = n => { const g = n * DAY - 2 * H; return summer(g) ? g : g + H; };  // 17:00 CDT = 22:00 UTC, 17:00 CST = 23:00 UTC
const iso = n => new Date(n * DAY).toISOString().slice(0, 10);
const no = k => Math.round(Date.parse(k + 'T00:00:00Z') / DAY);
window.NsbCme = {
  dayNo,
  key: t => iso(dayNo(t)),
  open: k => openNo(no(k)),
  day0: t => openNo(dayNo(t)),
  dayEnd: t => openNo(dayNo(t) + 1),
  next: k => iso(no(k) + 1),
  prev: k => iso(no(k) - 1),
};
})();
