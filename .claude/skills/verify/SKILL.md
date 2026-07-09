---
name: verify
description: How to runtime-verify VIBETRADER changes — launch, drive, and observe the terminal UI and API routes.
---

# Verifying VIBETRADER

## Launch

- Dev server: `npm run dev` on **port 3100** — check `lsof -nP -iTCP:3100 -sTCP:LISTEN` first; it's often already running and hot-reloads new API routes/lib code, no restart needed.
- AI features need a provider: check `data/settings.json` → `llm.provider` (lmstudio | openai | anthropic). LM Studio reachable = `curl http://localhost:1234/v1/models`. Without a provider, AI routes 502 with a friendly error — that's the designed fallback, not a failure.

## Drive the API surface

- Chat copilot streams SSE: `curl -sN -X POST localhost:3100/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"..."}]}'` — frames are `data: {"type":"status|tool|content|error|done",...}`. Tool calls (incl. `propose_trade`) appear as `type:"tool"` events with args.
- Scout: `POST /api/scout` with `{"watchlist":["SPY","BTC/USD"]}` — takes 30–90s (technicals per candidate + one LLM call).
- Journal check: `GET /api/research` lists notes newest-first.

## Drive the GUI headlessly

No Playwright in the repo, but browser binaries live in `~/Library/Caches/ms-playwright/` (arm64 paths: `chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`). `npm i playwright-core` in the scratchpad and launch with `executablePath`.

Gotchas:
- `page.goto(..., {waitUntil:"networkidle"})` **never resolves** — the app holds an SSE stream open. Use `"load"` + a settle timeout.
- Viewport ≥1900px wide gets the cockpit layout (rail + three columns).
- Useful hooks: ticket inputs have aria-labels (`Quantity`, `Take profit price`, `Stop loss price`); submit button classes `.btn-buy`/`.btn-sell`; order flow is two-click (first click ARMS — button text flips to `CONFIRM …` — second transmits). To verify order-adjacent changes WITHOUT trading, click once and assert the armed state + unchanged `GET /api/orders?status=open` count.
- AI draft cards dispatch `vt:draft-order`; button text `LOAD TICKET →`.

This is a paper account, but avoid placing orders during verification anyway — stop at the armed state.
