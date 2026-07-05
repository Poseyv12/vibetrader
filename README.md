# VIBETRADER

A dark, CRT-flavored **paper-trading terminal** for [Alpaca](https://alpaca.markets), with a local-LLM research copilot powered by [LM Studio](https://lmstudio.ai). Stocks and crypto, streaming quotes, one-click trading — and an AI analyst that researches tickers, watches the news, and journals everything it learns.

> **Paper trading only.** This project talks to Alpaca's paper API and is for learning and fun. It is not financial advice and is not built for real money.

## Features

**Trading terminal**
- Live streaming quotes, candles, and order fills (server-side websocket relay → SSE; your keys never reach the browser)
- Candlestick chart with SMA 20/50/200 overlays, volume, and click-anywhere-to-set-a-price-alert
- Market, limit, and bracket (take-profit/stop-loss) orders; one-click position close with arm/confirm safety
- Stocks + crypto (24/7), watchlist, ticker tape, price alerts with desktop notifications and sound

**AI layer (all local — LM Studio)**
- Research copilot with read-only tools: account, positions, orders, quotes, computed technicals (SMA/RSI/volatility/52-week), news, screeners
- Daily briefing generator: deterministic data gathering, LLM synthesis-only (grounded — the model can't invent numbers)
- Alert-triggered auto-research: an alert fires → the agent researches why → note lands in your journal
- News watchdog: streams market news, AI-triages stories touching your symbols for sentiment/impact
- Research journal with semantic search (local embeddings)
- Trade journal capturing market-context snapshots at fill time

**Dashboards**
- Performance page: equity vs SPY, FIFO round-trip stats, win rate, per-symbol P/L, trade log
- Settings page: API keys, model selection, news watchdog, and full UI color theming

## Setup

1. **Alpaca paper keys** — free at [alpaca.markets](https://app.alpaca.markets). Copy `.env.example` to `.env.local` and fill in `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` (paper keys start with `PK`).
2. **LM Studio** — install from [lmstudio.ai](https://lmstudio.ai), then load:
   - a **tool-capable chat model** (Qwen3-4B works well; anything with function calling)
   - the **`nomic-embed-text`** embedding model (for journal search)
   - start the local server (Developer tab → Start Server, default port 1234)
3. **Run it**
   ```bash
   npm install
   npm run dev
   ```
   Open [http://localhost:3100](http://localhost:3100). The app works without LM Studio (trading, charts, alerts) — the AI features just tell you to start the server.

## Notes

- Free-tier Alpaca market data uses the IEX feed; crypto data is free and streams 24/7.
- Alpaca enforces a $10 minimum on crypto orders and takes crypto fees in the base asset.
- Bracket orders are equities-only (Alpaca limitation).
- Runtime state (alerts, journal, settings, embeddings) lives in `data/` — gitignored, machine-local.
- Small local models are great at fetching and summarizing real data, and mediocre at math — computed indicators are done server-side in exact arithmetic and handed to the model.

## Stack

Next.js (App Router) · TypeScript · lightweight-charts · Alpaca REST + websockets · LM Studio (OpenAI-compatible) · SSE relay

## License

MIT — see [LICENSE](LICENSE).
