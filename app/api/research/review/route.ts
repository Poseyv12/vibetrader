import { NextResponse } from "next/server";
import { lmChat, pickModel } from "@/lib/llm";
import { runChatTool } from "@/lib/chat-tools";
import { friendlyLlmError } from "@/lib/agent";
import { computePerformance } from "@/lib/performance";
import { listTrades } from "@/lib/trade-log";
import { addResearch, todayStr } from "@/lib/research";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * AI trade review. Same grounding rule as the daily briefing: the server
 * computes the stats (FIFO round-trips from fill history) and compacts the
 * journaled fills — including the market snapshot captured AT FILL TIME,
 * which can't be reconstructed later — and the model only writes the
 * assessment. Split into two compact calls so the bundle fits modest local
 * context windows.
 */

const SYNTH_RULES = `You are a trading coach reviewing a user's PAPER trades from a JSON data bundle. Use ONLY numbers and facts from the data — never add, estimate, or recall anything from memory. If data has an "error" or is empty, write one line saying it's unavailable. Be direct and specific: praise what the data supports, call out what it doesn't. Tight markdown bullets, bold key numbers, 2-decimal USD. No generic advice, no disclaimers.`;

async function safe<T>(p: Promise<T>): Promise<T | { error: string }> {
  try {
    return await p;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function synthesize(model: string, instruction: string, data: unknown): Promise<string> {
  const { message } = await lmChat({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYNTH_RULES },
      { role: "user", content: `${instruction}\n\nData:\n${JSON.stringify(data)}` },
    ],
  });
  return (message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** One compact row per journaled fill: what was traded + the tape at that moment. */
function compactFills() {
  return listTrades(20).map((t) => {
    const tech = ((t.snapshot as { technicals?: Record<string, unknown> })?.technicals ?? {}) as {
      rsi14?: number;
      vs_sma20_pct?: number;
      chg_5d_pct?: number;
    };
    return {
      t: new Date(t.ts).toISOString().slice(5, 16).replace("T", " "),
      sym: t.symbol,
      side: t.side,
      qty: t.qty,
      px: t.price,
      rsi_at_fill: tech.rsi14 ?? null,
      vs_sma20_pct_at_fill: tech.vs_sma20_pct ?? null,
      chg_5d_pct_at_fill: tech.chg_5d_pct ?? null,
    };
  });
}

export async function POST() {
  try {
    const model = await pickModel();

    // ── deterministic data gathering ──
    const [perf, positions] = await Promise.all([
      computePerformance(),
      safe(runChatTool("get_positions", {})),
    ]);
    const fills = compactFills();

    if (!perf.totals.fills && !fills.length) {
      return NextResponse.json(
        { error: "no fills to review yet — place some paper trades first" },
        { status: 400 }
      );
    }

    // ── two compact synthesis calls ──
    const scorecard = await synthesize(
      model,
      `Write a "## Scorecard" section: grade this trading record overall (realized P/L, win rate, round-trips, hold times, volume), then which symbols are making money and which are bleeding. End with a one-line take.`,
      { totals: perf.totals, by_symbol: perf.bySymbol.slice(0, 8) }
    );

    const habits = await synthesize(
      model,
      `Write an "## Entries & Habits" section: each journaled fill includes the market context captured at that exact moment (RSI, % above/below SMA20, 5-day change). Spot real patterns — chasing after run-ups, buying oversold, selling into weakness, sizing inconsistencies vs open positions. Quote specific fills as evidence. Then a "## Fix One Thing" section: the single most impactful improvement, grounded in the data.`,
      { journaled_fills_with_market_context_at_fill_time: fills, open_positions: positions }
    );

    const content = `${scorecard}\n\n${habits}`.trim();
    if (!content) throw new Error("model returned an empty review");

    const note = addResearch(`Trade review — ${todayStr()}`, content, "generated");
    return NextResponse.json(note, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: friendlyLlmError(e) }, { status: 502 });
  }
}
