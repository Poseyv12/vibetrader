# Security Policy

## Supported scope

VIBETRADER is an open-source Alpaca **paper-trading** terminal with local runtime state and optional local-LLM research features.

Security-sensitive areas include:

- Alpaca paper API keys
- local `.env.local` files
- runtime `data/` state
- account, order, position, and trade-log data
- server-side API routes and websocket/SSE relays
- local LLM tool access

## Reporting a vulnerability

Please open a private security advisory on GitHub if available, or contact the maintainer through GitHub before disclosing publicly.

Include:

- affected files/routes
- reproduction steps
- expected vs actual behavior
- impact and suggested fix if known

## Secrets policy

Never commit:

- `.env.local`
- Alpaca API keys or secret keys
- real account IDs
- runtime `data/` files
- screenshots showing secrets or account identifiers
- local LM Studio/private model tokens if used

The repo intentionally keeps `.env.example` committed and ignores `.env*` except that example file.

## AI/tool safety model

The local LLM research tools should remain read-only by default. Any feature that lets an AI place, modify, or cancel orders must be treated as a major safety-sensitive change and should require explicit maintainer review.

## Trading safety disclaimer

VIBETRADER is for education, local experimentation, and paper trading. It is not financial advice and is not designed for unattended real-money trading.
