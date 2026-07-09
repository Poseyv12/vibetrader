import { lmChat, pickModel } from "./llm";
import { runChatTool } from "./chat-tools";
import { compactTechnicals } from "./technicals";
import { addResearch, todayStr } from "./research";
import type { DraftOrder } from "./types";

/**
 * Scout: AI-suggested BUY setups the user confirms (or ignores) in the order
 * ticket. Same grounding rule as the briefing — the server gathers every
 * number deterministically (screeners, technicals, headlines, buying power)
 * and the model makes ONE synthesis-only call to pick candidates. All math
 * (position sizing, level sanity) happens here in code; a pick whose symbol
 * or levels don't check out against the data is dropped or repaired, never
 * trusted. Nothing is ever transmitted — picks become ticket drafts.
 */

export interface ScoutResult {
  summary: string;
  picks: DraftOrder[];
  journaled: boolean;
}

const MAX_PICKS = 3;
const MAX_CANDIDATES = 12;
/** per-pick budget: 2% of equity, capped by cash (non-marginable) buying power */
const BUDGET_PCT = 0.02;

const round2 = (n: number) => Math.round(n * 100) / 100;

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

const SYS = `You are the VIBETRADER scout: from a JSON data bundle you pick the best BUY setups in a paper-trading account. Use ONLY the bundle — never invent prices or recall anything from memory. You only suggest; the user personally confirms every trade.

Rules:
- Pick 0 to 3 symbols, ONLY from the bundle's candidates list. Zero picks is a fine answer.
- Every pick needs a reason visible in the data: trend (price vs SMAs), momentum (5d/20d change), RSI posture (skip anything with RSI above 75), or a fresh catalyst in the headlines.
- Prefer symbols not in already_held.
- If market_open is false, only crypto candidates (symbols with a slash) can fill at market — use a limit entry for stocks or skip them.
- entry: "market", or a limit price number close to the current price.
- stop_loss below the entry at a level supported by the data (near SMA20/SMA50 or the recent range); take_profit above the entry with reward at least ~1.5x the risk.
- reason: one plain sentence citing numbers from the data.

Respond with ONLY this JSON — no markdown fences, no commentary:
{"summary":"one-line market read","picks":[{"symbol":"XYZ","entry":"market","stop_loss":123.45,"take_profit":130.5,"conviction":"medium","reason":"..."}]}`;

interface RawPick {
  symbol?: unknown;
  entry?: unknown;
  stop_loss?: unknown;
  take_profit?: unknown;
  conviction?: unknown;
  reason?: unknown;
}

function parseScoutJson(text: string): { summary?: unknown; picks?: RawPick[] } {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("scout model did not return JSON");
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    throw new Error("scout model returned unparseable JSON");
  }
}

export async function runScout(watchlist: string[]): Promise<ScoutResult> {
  const model = await pickModel();

  // ── deterministic data gathering ──
  const [account, positions, movers, actives, clock] = await Promise.all([
    safe(runChatTool("get_account", {})),
    safe(runChatTool("get_positions", {})),
    safe(runChatTool("get_movers", {})),
    safe(runChatTool("get_most_actives", {})),
    safe(runChatTool("get_market_clock", {})),
  ]);

  const held = new Set(
    (Array.isArray(positions) ? positions : []).map((p) => (p as { symbol: string }).symbol)
  );

  const universe: string[] = [];
  const push = (s: unknown) => {
    const u = String(s ?? "").toUpperCase().trim();
    if (u && /^[A-Z0-9./]{1,12}$/.test(u) && !universe.includes(u)) universe.push(u);
  };
  watchlist.slice(0, 10).forEach(push);
  const mv = (movers ?? {}) as { gainers?: { symbol: string }[] };
  (mv.gainers ?? []).slice(0, 5).forEach((g) => push(g.symbol));
  (Array.isArray(actives) ? (actives as { symbol: string }[]) : [])
    .slice(0, 5)
    .forEach((a) => push(a.symbol));
  const symbols = universe.slice(0, MAX_CANDIDATES);
  if (!symbols.length) throw new Error("no candidate symbols — watchlist and screeners came back empty");

  const enriched = (
    await Promise.all(
      symbols.map(async (symbol) => {
        const tech = compactTechnicals(await safe(runChatTool("get_technicals", { symbol }))) as
          | ({ price?: unknown; error?: unknown } & Record<string, unknown>)
          | null;
        if (!tech || tech.error || typeof tech.price !== "number") return null;
        const news = await safe(runChatTool("get_news", { symbols: symbol, limit: 2 }));
        return {
          symbol,
          held: held.has(symbol),
          technicals: tech as { price: number } & Record<string, unknown>,
          headlines: Array.isArray(news)
            ? (news as { headline: string }[]).map((n) => n.headline).slice(0, 2)
            : [],
        };
      })
    )
  ).filter((c): c is NonNullable<typeof c> => c != null);
  if (!enriched.length) throw new Error("no market data available for any candidate");

  const acct = (account ?? {}) as { equity?: number; non_marginable_buying_power?: number };
  const bundle = {
    market_open: (clock as { is_open?: boolean } | null)?.is_open ?? null,
    account: { equity: acct.equity, cash_buying_power: acct.non_marginable_buying_power },
    already_held: [...held],
    candidates: enriched,
  };

  // ── one synthesis-only call ──
  const { message } = await lmChat({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: `Scout this bundle for long setups.\n\nData:\n${JSON.stringify(bundle)}` },
    ],
  });
  const parsed = parseScoutJson(message.content ?? "");

  // ── server-side validation + sizing (never the model's math) ──
  const equity = Number(acct.equity) || 0;
  const cashBp = Number(acct.non_marginable_buying_power) || 0;
  const budget = Math.max(Math.min(equity * BUDGET_PCT, cashBp), 0);

  const picks: DraftOrder[] = [];
  for (const raw of (parsed.picks ?? []).slice(0, MAX_PICKS)) {
    const cand = enriched.find((c) => c.symbol === String(raw?.symbol ?? "").toUpperCase().trim());
    if (!cand) continue; // symbol not in the bundle — hallucinated, drop it
    const price = cand.technicals.price;
    const crypto = cand.symbol.includes("/");

    // limit entries more than 5% from the last price are treated as noise
    const entryNum = typeof raw.entry === "number" ? raw.entry : NaN;
    const limit =
      Number.isFinite(entryNum) && entryNum > 0 && Math.abs(entryNum - price) / price <= 0.05
        ? crypto
          ? entryNum
          : round2(entryNum)
        : null;
    const e = limit ?? price;

    // keep the model's levels when sane, else derive conservative defaults
    let sl = Number(raw.stop_loss);
    let tp = Number(raw.take_profit);
    if (!(sl > e * 0.85 && sl < e)) sl = round2(e * 0.97);
    if (!(tp > e && tp < e * 1.4)) tp = round2(e + (e - sl) * 2);

    const conviction = (["low", "medium", "high"] as const).find((c) => c === raw.conviction);
    const reason = typeof raw.reason === "string" ? raw.reason.slice(0, 240) : undefined;
    const base = {
      symbol: cand.symbol,
      side: "buy" as const,
      rationale: reason,
      conviction,
      source: "scout" as const,
    };

    if (crypto) {
      // no brackets on crypto — surface the levels in the rationale instead
      const amt = round2(Math.max(budget, 12));
      if (amt < 10 || amt > cashBp) continue;
      picks.push({
        ...base,
        type: limit ? "limit" : "market",
        mode: "notional",
        amount: amt,
        ...(limit ? { limit_price: limit } : {}),
        rationale: `${reason ?? ""} (suggested SL ${sl} / TP ${tp} — crypto can't bracket, set alerts)`.trim(),
      });
    } else {
      const qty = Math.floor(budget / e);
      if (qty >= 1) {
        picks.push({
          ...base,
          type: limit ? "limit" : "market",
          mode: "qty",
          amount: qty,
          ...(limit ? { limit_price: limit } : {}),
          take_profit: tp,
          stop_loss: sl,
        });
      } else if (budget >= 1) {
        // share too expensive for the budget → fractional dollars (market-only, no bracket)
        picks.push({ ...base, type: "market", mode: "notional", amount: round2(budget) });
      }
    }
  }

  let journaled = false;
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "scout run complete";
  if (picks.length) {
    const md = [
      `**Scout** — ${summary}`,
      "",
      ...picks.map(
        (p) =>
          `- **BUY ${p.symbol}** ${p.mode === "qty" ? `${p.amount} sh` : `$${p.amount}`}${
            p.limit_price ? ` @ lmt ${p.limit_price}` : " @ mkt"
          }${p.take_profit ? ` · TP ${p.take_profit} / SL ${p.stop_loss}` : ""}${
            p.conviction ? ` · ${p.conviction}` : ""
          } — ${p.rationale ?? ""}`
      ),
      "",
      "_Suggestions only — nothing was placed. Load a pick into the ticket to decide._",
    ].join("\n");
    addResearch(`Scout picks — ${todayStr()}`, md, "generated");
    journaled = true;
  }

  return {
    summary: picks.length ? summary : `${summary} — no setups passed the data checks`,
    picks,
    journaled,
  };
}
