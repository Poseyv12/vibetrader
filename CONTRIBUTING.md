# Contributing to VIBETRADER

Thanks for checking out VIBETRADER. This project is an AI-assisted **paper-trading** terminal for learning market-data workflows, local LLM research, alerts, and dashboard design.

## Ground rules

- Keep it paper-trading focused.
- Do not add real-money trading features without a clear safety design and maintainer approval.
- Never commit API keys, `.env.local`, runtime `data/`, screenshots containing secrets, or account identifiers.
- Prefer small PRs with a clear before/after.
- Run the production build before opening a PR.

## Local setup

```bash
git clone https://github.com/Poseyv12/vibetrader.git
cd vibetrader
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3100
```

LM Studio is optional. Trading/dashboard features can run without it; AI research features require a local OpenAI-compatible LM Studio server.

## Useful commands

```bash
npm run lint
npm run build
```

## Good first contributions

- README and docs improvements
- UI polish and accessibility fixes
- safer confirmation flows for paper orders
- clearer error states for missing Alpaca or LM Studio config
- tests around market-data parsing and API route behavior
- local-model prompt improvements that keep responses grounded in fetched data

## Pull request checklist

Before opening a PR:

- [ ] I did not commit secrets or runtime `data/` files.
- [ ] I ran `npm run build`.
- [ ] I documented any user-facing behavior change.
- [ ] I kept AI tools read-only unless explicitly discussed.

## Safety note

VIBETRADER is not financial advice, not a signal service, and not designed for unattended real-money trading. Keep contributions aligned with education, research, and paper-trading workflows.
