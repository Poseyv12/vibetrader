# VIBETRADER — agent guide

Alpaca **paper-trading** terminal with an AI research layer — local LM Studio by
default, switchable to OpenAI or Anthropic (frontier models) on /settings.
Next.js App Router + TypeScript. Dev server runs on **port 3100** (`npm run dev`).

## Architecture in one pass

- `lib/alpaca.ts` — REST clients (trading / stock data / crypto data / v1beta1 news+screeners). Keys resolve from `lib/settings.ts` (data/settings.json) with `.env.local` fallback. Crypto symbols use slash pairs (`BTC/USD`); positions/activities may return them slashless.
- `lib/stream.ts` — server-side hub: ONE upstream websocket each for stocks (IEX), crypto, trade updates, and news (free tier allows a single data connection). Fans out to browsers via SSE at `/api/stream`. Also evaluates price alerts per tick, triggers auto-research, journals fills, and runs news triage.
- `lib/agent.ts` + `lib/chat-tools.ts` — the copilot's tool loop. Tools are **deliberately read-only** (no order placement); write access must be a separate, explicitly-confirmed feature. The sole draft-shaped tool, `propose_trade`, and the scout (`lib/scout.ts`, `POST /api/scout`) only emit `DraftOrder`s that ride the `vt:draft-order` event into the order ticket, where the user must still arm + confirm. Keep it that way: the AI suggests, the user decides.
- `lib/llm.ts` — provider-routed chat: all LLM calls go through `lmChat()`/`pickModel()`, which dispatch to LM Studio (default), OpenAI (same wire format), or Anthropic (official SDK; messages converted, Claude's raw content blocks — incl. thinking — replayed via `_raw` during tool loops). Embeddings always hit LM Studio regardless of provider.
- Grounding rule for broad tasks (briefings, auto-research, news triage): the server gathers data deterministically and the LLM makes a **synthesis-only** call. Small local models hallucinate when allowed to plan tool use for broad prompts, and math is done server-side (`lib/technicals.ts`), never by the model.
- Runtime state lives in `data/` (gitignored): settings, alerts, research journal, trade log, embeddings.
- UI: panels in `components/`, terminal aesthetic via CSS vars in `app/globals.css` (theme editable at `/settings`; chart listens for `vt:theme`). Client/server boundary: never import fs-touching libs (`lib/settings.ts` etc.) from client components — shared constants go in `lib/theme-shared.ts`-style modules.

## Gotchas

- Alpaca crypto: $10 minimum order; fees charged in the base asset (buys land smaller than ordered); `DELETE /positions/{symbol}` closes the ENTIRE position — sell exact quantities instead.
- Margin is account-level and automatic — no per-order leverage flag. `buying_power` is intraday (equity × multiplier, 4× when equity ≥ $25k); overnight holds must fit `regt_buying_power` (2×). Crypto and fractional/notional orders are non-marginable (cash only).
- Brackets are equities-only; crypto time-in-force must be `gtc`.
- Turbopack's file watcher on Windows sometimes misses edits — restart the dev server if changes don't apply.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
