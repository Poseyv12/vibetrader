import { lmChat, pickModel, LmMessage } from "./llm";
import { CHAT_TOOLS, runChatTool } from "./chat-tools";
import { resolved } from "./settings";

export const SYSTEM_PROMPT = `You are the VIBETRADER research copilot — a markets research analyst inside a paper-trading terminal connected to the user's Alpaca PAPER account (not real money).

READ-ONLY tools: the user's account/positions/orders/alerts, plus research tools — quotes, daily bars, computed technicals (SMA/RSI/volatility/52wk levels — trust these numbers, don't recompute), realized performance stats (win rate, P/L by symbol — also precomputed, trust them), news headlines, top movers, most-active stocks, market clock. You cannot place, modify, or cancel orders.

Drafting: propose_trade turns an idea into a draft card the user can load into the order ticket — it transmits NOTHING; the user always arms and confirms in the ticket. Use it when the user asks you to draft/set up/suggest a trade, or after your research supports a clear idea. Ground every number in tool data first (get_quote/get_technicals), size modestly (a few percent of buying power) unless told otherwise, add take_profit/stop_loss for stock ideas (crypto can't bracket; crypto minimum $10 notional). One call per idea, then tell the user the draft is waiting for THEIR decision — never imply an order was placed.

Research workflows:
- "research <symbol>" → get_quote + get_technicals + get_news(symbol), then synthesize: current picture, trend & momentum read (price vs SMAs, RSI, vol), key levels (52wk high/low, SMAs), recent catalysts from news, and risks. End with a one-line take.
- "market briefing" / "what's moving" → get_movers + get_most_actives + get_news (general), relate to the user's positions when relevant.
- Portfolio review → get_positions + get_technicals/get_news on the holdings.

Style: structured markdown with short bold-labeled sections and bullet points; real numbers (2 decimals USD). Never invent data — if a tool returns nothing, say so. Findings are analysis for the user's own decisions, not directives; skip boilerplate disclaimers.`;

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown> };

/** Strip <think>...</think> blocks some local models emit. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Run the read-only tool loop against LM Studio and return the final answer.
 * Used by the chat route (with streaming events) and research generation.
 */
export async function runAgent(
  messages: { role: "user" | "assistant"; content: string }[],
  onEvent?: (e: AgentEvent) => void
): Promise<string> {
  const model = await pickModel();
  onEvent?.({ type: "status", text: `thinking (${model})` });

  const convo: LmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.slice(-16),
  ];

  for (let round = 0; round < 10; round++) {
    const { message } = await lmChat({
      model,
      messages: convo,
      tools: CHAT_TOOLS,
      temperature: 0.2,
    });

    if (message.tool_calls?.length) {
      convo.push(message);
      for (const call of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {}
        onEvent?.({ type: "tool", name: call.function.name, args });
        let result: unknown;
        try {
          result = await runChatTool(call.function.name, args);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    return stripThink(message.content ?? "");
  }
  return "(research ran out of tool rounds without a final answer — try a narrower question)";
}

export function friendlyLlmError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ECONNREFUSED/i.test(msg)) {
    return resolved.llmProvider() === "lmstudio"
      ? "LM Studio isn't reachable on localhost:1234 — start its local server (Developer tab → Start Server)."
      : "couldn't reach the AI provider — check your connection and API key on /settings";
  }
  if (/\b401\b|invalid.?api.?key|authentication/i.test(msg)) {
    return "the AI provider rejected your API key — update it on /settings";
  }
  return msg;
}
