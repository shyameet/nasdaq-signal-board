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

The combined gate is LONG only when both series are LONG and SHORT only when both are SHORT. It shades the charts
and the MACD panes, and sets the BUY/SELL marks and the alerts. MACD is 12/26/9.

- **NDX10**: the ten largest Nasdaq-100 weights that trade on Hyperliquid, as one composite (official index
  weights rescaled to 100%; 1000 = the 10/05/2026 close).
  On the Divergence page you can instead tick any 1 to 10 of those stocks (**Stocks** button, top right):
  their weights are rescaled to 100%, so the composite is still 1000 at the reference close, and the signal,
  marks and scoreboard are rebuilt from the candles already loaded. The choice is saved in your browser.
- **NAS100**: the Nasdaq-100 perp itself, `xyz:XYZ100`, plus a 1m MACD shown for information.

Everything runs in your browser. The page loads two days of 1-minute candles from Hyperliquid's public API,
then follows its live candle stream. There is no server and no account; drawings and settings stay in your
browser.

For information only, not investment advice. An independent project, not affiliated with Nasdaq, Inc.,
Hyperliquid or TradingView.

| File | What it is |
|---|---|
| `index.html` | the Signals page |
| `divergence.html` | the Divergence page: where the two signals disagree, and a scoreboard of what followed |
| `engine.js` | the signal calculation |
| `macd.js` | the Trend and Entry MACD panes, their on/off switches and shading, and the day separators (both pages) |
| `basket.json` | the NDX10 basket: stocks, weights and reference prices |
| `lightweight-charts.js` | TradingView Lightweight Charts™ 4.2.3 |
| `brand/` | logo, icons, app manifest and the link-preview banner (made by `make_brand.py`) |
| `404.html` | the page for addresses that don't exist |

Charts: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/),
Copyright (c) 2025 TradingView, Inc., Apache License 2.0.
