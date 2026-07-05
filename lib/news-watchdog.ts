import { lmChat, pickModel } from "./llm";
import { addResearch } from "./research";
import { getSettings } from "./settings";

/**
 * AI triage for streamed news. Stories touching subscribed symbols get a
 * sentiment/impact read from the local LLM; high-impact stories are
 * journaled. Bounded concurrency so a news burst can't stampede LM Studio.
 */

export interface NewsItem {
  id?: number;
  headline: string;
  summary?: string;
  symbols?: string[];
  source?: string;
  url?: string;
}

export interface Triage {
  sentiment: "bullish" | "bearish" | "neutral";
  impact: "low" | "medium" | "high";
  note: string;
}

export const IMPACT_RANK = { low: 0, medium: 1, high: 2 } as const;

let inFlight = 0;
const queue: (() => void)[] = [];
const MAX_IN_FLIGHT = 1;
const MAX_QUEUE = 5;

export async function triageNews(item: NewsItem, holdings: string[]): Promise<Triage> {
  const model = await pickModel();
  const { message } = await lmChat({
    model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          'You triage market news for a trader. Reply with ONLY a JSON object, no prose: {"sentiment":"bullish"|"bearish"|"neutral","impact":"low"|"medium"|"high","note":"<one sentence: why it matters to the symbols>"}. Impact is about likely price effect on the listed symbols, not general newsworthiness.',
      },
      {
        role: "user",
        content: `Symbols the trader holds/watches: ${holdings.join(", ")}\nHeadline: ${item.headline}\n${
          item.summary ? `Summary: ${item.summary.slice(0, 300)}\n` : ""
        }Tagged symbols: ${(item.symbols ?? []).join(", ")}`,
      },
    ],
  });

  const text = (message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match?.[0] ?? "");
    return {
      sentiment: ["bullish", "bearish", "neutral"].includes(parsed.sentiment)
        ? parsed.sentiment
        : "neutral",
      impact: ["low", "medium", "high"].includes(parsed.impact) ? parsed.impact : "low",
      note: String(parsed.note ?? "").slice(0, 200),
    };
  } catch {
    return { sentiment: "neutral", impact: "low", note: "triage unparseable" };
  }
}

/**
 * Queue a news item for triage. Calls back with the result only when the
 * story clears the configured impact floor; journals high-impact stories.
 */
export function queueNewsTriage(
  item: NewsItem,
  holdings: string[],
  onResult: (item: NewsItem, triage: Triage) => void
) {
  if (queue.length >= MAX_QUEUE) return; // burst — drop quietly

  const run = async () => {
    inFlight++;
    try {
      const triage = await triageNews(item, holdings);
      const floor = IMPACT_RANK[getSettings().watchdog.minImpact];
      if (IMPACT_RANK[triage.impact] >= floor) onResult(item, triage);
      if (triage.impact === "high") {
        addResearch(
          `📰 ${(item.symbols ?? []).slice(0, 3).join(", ")}: ${item.headline.slice(0, 60)}`,
          `**${item.headline}**\n\n- Sentiment: **${triage.sentiment}** · impact **${triage.impact}**\n- ${triage.note}\n- Source: ${item.source ?? "?"}${item.url ? ` — [link](${item.url})` : ""}`,
          "generated"
        );
      }
    } catch (e) {
      console.error("[watchdog]", e instanceof Error ? e.message : e);
    } finally {
      inFlight--;
      queue.shift()?.();
    }
  };

  if (inFlight < MAX_IN_FLIGHT) void run();
  else queue.push(() => void run());
}
