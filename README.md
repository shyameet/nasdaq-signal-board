[![Nasdaq Signal Board](brand/banner.png)](https://shyameet.github.io/nasdaq-signal-board/)

# Nasdaq Signal Board

Live Nasdaq-100 trend signals from Hyperliquid's 24/7 stock perps.

**Open it: https://shyameet.github.io/nasdaq-signal-board/**

Each series gets a gate, checked every second on the bars still forming:

| Gate | Condition |
|---|---|
| LONG | 5m, 9m and 11m MACD all above 0, and the 3m EMA 21 above the EMA 47 |
| SHORT | all three below 0, and the EMA 21 below the EMA 47 |
| NO TRADE | anything else |

The **Signals** page runs the gate on your own composite of the stocks you pick: the ten largest Nasdaq-100
weights that trade on Hyperliquid by default, plus AVGO, TSM and INTC to add, any 1 to 13 of them (Nasdaq-100 weights
rescaled to 100% over your pick; TSM, not in the index, gets the weight Nasdaq gives a company its size; how each was
set is in `basket.json`; 1000 = the 10/05/2026 close). The chart is that composite's own candles (each minute: the weighted sum of the stocks'
closes; open = the previous close; volume = the stocks' dollar volume), with the gate's zones, its
3m EMA 21/47, and the Entry (2m/3m) and Trend (1m/5m/7m/9m/11m/15m) MACD panes. The **Divergence** page (unchanged
for now) still compares the stocks' gate with the gate of the Nasdaq-100 perp, `xyz:XYZ100`.

Everything runs in your browser. The page loads two days of 1-minute candles from Hyperliquid's public API,
then follows its live candle stream. There is no server and no account; drawings and settings stay in your
browser.

For information only, not investment advice. An independent project, not affiliated with Nasdaq, Inc.,
Hyperliquid or TradingView.

| File | What it is |
|---|---|
| `index.html` | the Signals page |
| `divergence.html` | the Divergence page: where the two signals disagree, and a scoreboard of what followed |
| `replay.html` | the Replay page: one UTC day at a time, your stocks' composite beside XYZ100, the gate, the 2m/3m entry signals with per-trend / gap / one-trend-per-day boxes, whole-day view or candle-by-candle playback; reads `data/1m/` (the VPS's daily archive) and Hyperliquid's last ~3.5 days |
| `engine.js` | the signal calculation |
| `macd.js` | the Trend and Entry MACD panes, their on/off switches and shading, and the day separators (both pages) |
| `basket.json` | the stocks on offer (the default 10 and the extra 3), their weights and reference prices |
| `lightweight-charts.js` | TradingView Lightweight Charts™ 4.2.3 |
| `brand/` | logo, icons, app manifest and the link-preview banner (made by `make_brand.py`) |
| `404.html` | the page for addresses that don't exist |

Charts: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/),
Copyright (c) 2025 TradingView, Inc., Apache License 2.0.
