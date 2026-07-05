import { NextResponse } from "next/server";
import { lmChat, pickModel } from "@/lib/llm";
import { runChatTool } from "@/lib/chat-tools";
import { friendlyLlmError } from "@/lib/agent";
import { compactTechnicals } from "@/lib/technicals";
import { addResearch, todayStr } from "@/lib/research";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily briefing generation. The server gathers ALL data deterministically —
 * small local models hallucinate when left to plan tool use for a task this
 * broad. Synthesis is split into two compact LLM calls so the bundle fits
 * modest LM Studio context windows (4k).
 */

async function safe<T>(p: Promise<T>): Promise<T | { error: string }> {
  try {
    return await p;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type News = { headline: string; source: string }[];
const compactNews = (n: unknown, limit: number): News | unknown =>
  Array.isArray(n) ? n.slice(0, limit).map((x) => ({ headline: x.headline, source: x.source })) : n;

const SYNTH_RULES = `You write sections of a daily trading briefing from a JSON data bundle. Use ONLY numbers and facts from the data — never add, estimate, or recall anything from memory. If data has an "error" or is empty, write one line saying it's unavailable. Tight markdown bullets, bold key numbers, 2-decimal USD.`;

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

export async function POST() {
  try {
    const model = await pickModel();

    // ── deterministic data gathering ──
    const [account, positions, movers, actives, marketNews, alerts] = await Promise.all([
      safe(runChatTool("get_account", {})),
      safe(runChatTool("get_positions", {})),
      safe(runChatTool("get_movers", {})),
      safe(runChatTool("get_most_actives", {})),
      safe(runChatTool("get_news", { limit: 6 })),
      safe(runChatTool("get_alerts", {})),
    ]);

    const holdings = Array.isArray(positions) ? positions : [];
    const perPosition = await Promise.all(
      holdings.slice(0, 6).map(async (p: { symbol: string }) => ({
        symbol: p.symbol,
        technicals: compactTechnicals(await safe(runChatTool("get_technicals", { symbol: p.symbol }))),
        news: compactNews(await safe(runChatTool("get_news", { symbols: p.symbol, limit: 3 })), 3),
      }))
    );

    const mv = movers as { gainers?: unknown[]; losers?: unknown[] };

    // ── two compact synthesis calls ──
    const marketSection = await synthesize(
      model,
      `Write a "## Market" section: last session's notable gainers/losers, most-active names, and the headlines that matter. End with a one-line take.`,
      {
        movers_last_session: {
          gainers: mv.gainers?.slice(0, 5) ?? mv,
          losers: mv.losers?.slice(0, 5) ?? [],
        },
        most_active: Array.isArray(actives) ? actives.slice(0, 5) : actives,
        news: compactNews(marketNews, 6),
      }
    );

    const bookSection = await synthesize(
      model,
      `Write a "## My Book" section (each position: price, unrealized P/L, trend read from technicals — vs SMAs, RSI, momentum — plus any symbol news; one-line take each) followed by a "## Watch" section (each price alert vs its symbol's current price).`,
      { account, positions, per_position_research: perPosition, price_alerts: alerts }
    );

    const content = `${marketSection}\n\n${bookSection}`.trim();
    if (!content) throw new Error("model returned empty briefing");

    const note = addResearch(`Daily briefing — ${todayStr()}`, content, "generated");
    return NextResponse.json(note, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: friendlyLlmError(e) }, { status: 502 });
  }
}
