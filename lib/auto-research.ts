import { lmChat, pickModel } from "./llm";
import { runChatTool } from "./chat-tools";
import { compactTechnicals } from "./technicals";
import { addResearch, ResearchNote } from "./research";
import type { Alert } from "./alerts";

/**
 * Fired when a price alert triggers: gather quote/technicals/news for the
 * symbol deterministically, have the LLM write a quick note, save it to the
 * research journal. Same grounding rules as the daily briefing — the model
 * only synthesizes, it never picks tools.
 */

async function safe<T>(p: Promise<T>): Promise<T | { error: string }> {
  try {
    return await p;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function autoResearch(alert: Alert, hit: number): Promise<ResearchNote> {
  const symbol = alert.symbol;
  const [quote, technicals, newsRaw] = await Promise.all([
    safe(runChatTool("get_quote", { symbol })),
    safe(runChatTool("get_technicals", { symbol })),
    safe(runChatTool("get_news", { symbols: symbol, limit: 4 })),
  ]);
  const news = Array.isArray(newsRaw)
    ? newsRaw.map((n) => ({ headline: n.headline, source: n.source }))
    : newsRaw;

  const model = await pickModel();
  const { message } = await lmChat({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You write short research notes from a JSON data bundle. Use ONLY numbers and facts from the data — never add, estimate, or recall anything from memory. If data has an error or is empty, say it's unavailable. Tight markdown bullets, bold key numbers.",
      },
      {
        role: "user",
        content: `The user's price alert just TRIGGERED: ${symbol} crossed ${alert.op} ${alert.price} (hit ${hit}). Write a quick note: what's the current picture, trend read from the technicals, any news that might explain the move, and what to watch next.\n\nData:\n${JSON.stringify(
          { quote, technicals: compactTechnicals(technicals), news }
        )}`,
      },
    ],
  });

  const content = (message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!content) throw new Error("empty auto-research note");

  return addResearch(
    `⚡ ${symbol} ${alert.op === "above" ? "≥" : "≤"} ${alert.price} triggered`,
    content,
    "generated"
  );
}
