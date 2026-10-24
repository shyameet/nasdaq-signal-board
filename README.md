[![Indra Quant Signal Board](brand/banner.png)](https://shyameet.github.io/nasdaq-signal-board/)

# Indra Quant Signal Board

Live Nasdaq-100 trend signals from Hyperliquid's 24/7 stock perps, beside the real CME futures, plus the India and
Commodities replays.

**Open it: https://shyameet.github.io/nasdaq-signal-board/**

Each series gets a gate, checked every second on the bars still forming:

| Gate | Condition |
|---|---|
| LONG | 5m, 9m and 11m MACD all above 0, and the 3m EMA 21 above the EMA 47 |
| SHORT | all three below 0, and the EMA 21 below the EMA 47 |
| NO TRADE | anything else |

The **Stocks** tab runs the gate on the stocks you pick: the ten largest Nasdaq-100 stocks that trade on Hyperliquid by default, plus AVGO, TSM and INTC to add, any 1 to 13 of them. Each picked stock gets its own gate on its own candles, and the page's gate is LONG only when every picked stock is LONG, SHORT only when every one is SHORT, NO TRADE otherwise. The chart is the picked stocks combined with equal weights (1000 = the 10/05/2026 close; each minute 1000 x the average of the stocks' moves since then). Its candles: each minute's close as above, open = the previous close, volume = the stocks' dollar volume; coloured by the Trend waves (green where every 5m/7m/9m/11m/15m MACD switched on is above 0, red where every one is below), with the composite's 3m EMA 21/47, and the Entry (2m/3m) and Trend (5m/7m/9m/11m/15m) MACD panes.

The **Nasdaq** tab shows that composite beside the Nasdaq-100 perp `xyz:XYZ100` (`replay.html`) or beside the CME MNQ future (`mnq.html`), picked in the tab's XYZ100 / MNQ switch. The **India** tab replays the Nifty and Bank Nifty setups on Dhan's saved 1-minute candles, and the **Commodities** tab the Crude (MCL with CRUDEOILM) and Nat Gas (NG with NATGASMINI) setups.

On every US chart a new day starts at the CME open, 17:00 Chicago: 03:30 IST, or 04:30 IST while Chicago is on winter time (first Sunday of November to the second Sunday of March).

Everything runs in your browser. Closed days come from the VPS's daily archives in `data/`, today from Hyperliquid's public API and its live candle stream. There is no server and no account; drawings and settings stay in your browser.

For information only, not investment advice. An independent project, not affiliated with Nasdaq, Inc., CME Group,
Hyperliquid or TradingView.

| File | What it is |
|---|---|
| `index.html` | the Stocks tab |
| `replay.html` | Nasdaq tab, XYZ100 section: one CME trading day at a time (from the CME open), your stocks' composite beside XYZ100, the gate, the 2m/3m entry signals with per-trend / gap / one-trend-per-day boxes; reads `data/1m/` and Hyperliquid's last ~3.5 days |
| `mnq.html` | Nasdaq tab, MNQ section: the composite beside CME MNQ (`data/futures/1m/`), both with the gate, tinted where the two gates disagree |
| `india-replay.html` | the India tab: one Indian trading day at a time from `data/india/1m/`; the Nifty setup (NIFTY 50 + GIFT NIFTY trend, then RELIANCE syncs as the odd man out, then its 2m/3m entry) and the Bank Nifty setup (NIFTY BANK, then HDFC BANK), candles aligned to each session's open as on TradingView |
| `commodities.html` | the Commodities tab: MCL / NG (CME, NinjaTrader on the VPS) in step 1 with CRUDEOILM / NATGASMINI (MCX, Dhan) in steps 2 and 3, from `data/futures/1m/` |
| `engine.js` | the signal calculation (and, on the Stocks tab, Hyperliquid's live stream) |
| `cme.js` | the CME trading day: where a US chart's day starts, whichever clock Chicago is on |
| `macd.js` | the Trend and Entry MACD panes, their on/off switches and shading, and the day separators (every page) |
| `draw.js` | the drawing tools (vertical and horizontal lines, measure), shared by a page's charts |
| `daypick.js` | the calendar that picks a day |
| `rolls.js` | the futures' contract switches (Commodities, MNQ): older candles moved by the gap so the chart runs on smoothly, a mark at each switch, and a warning on the switch day and the trading day before it |
| `labels.js` | the Labels switch (a short explanation on each control) |
| `basket.json` | the stocks on offer (the default 10 and the extra 3) and their reference prices |
| `data/1m/` | Hyperliquid 1-minute candles of the board's markets, one file per UTC day, from the VPS's daily archive (from 18 Oct 2026, that day only from its evening) |
| `data/india/1m/` | Dhan 1-minute candles of NIFTY, BANKNIFTY, GIFTNIFTY, RELIANCE and HDFCBANK, one file per Indian trading day, from 15 Oct 2026 |
| `data/futures/1m/` | 1-minute candles of MNQ, MCL and NG (NinjaTrader's front month) and CRUDEOILM, NATGASMINI (Dhan, the near month, moving to the next on its expiry day), one file per UTC day, from 15 Oct 2026, with the contract behind each stretch; `rolls.json`: each contract switch, the price gap between the two contracts, and the next switch |
| `data/live.json` | the address of the VPS's live stream of these markets (for live charts; no page reads it yet) |
| `divergence.html` | the old Divergence page's address, which now opens the Nasdaq tab's MNQ section |
| `lightweight-charts.js` | TradingView Lightweight Charts™ 4.2.3 |
| `brand/` | the official Indra Quant lockup, emblem and icons (copied as is from the brand kit, `rdx-quant-lab/branding/`), the app manifest and the link-preview pictures |
| `404.html` | the page for addresses that don't exist |

Charts: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/),
Copyright (c) 2025 TradingView, Inc., Apache License 2.0.
