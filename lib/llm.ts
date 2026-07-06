/**
 * Provider-routed chat client. Everything (copilot, watchdog, auto-research)
 * calls lmChat()/pickModel(); the active provider — settings → llm.provider,
 * default lmstudio — decides where the call lands:
 *  - lmstudio  — OpenAI-compatible local server (LM Studio)
 *  - openai    — api.openai.com, same chat-completions wire format
 *  - anthropic — official SDK; converted to/from the OpenAI-style shapes the
 *                rest of the app speaks, so call sites don't change
 * Embeddings are NOT routed — lib/embeddings.ts always talks to LM Studio.
 */

import Anthropic from "@anthropic-ai/sdk";
import { resolved } from "./settings";

const BASE = () => resolved.llmUrl();

export interface LmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LmToolCall[];
  tool_call_id?: string;
  /**
   * anthropic only: the response's raw content blocks (incl. thinking).
   * Replayed verbatim on the next round — Claude requires its thinking
   * blocks back unmodified during a tool loop.
   */
  _raw?: Anthropic.ContentBlock[];
}

export interface LmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Curated list for the settings dropdown — Anthropic has no public models-list endpoint keyed like OpenAI's. */
export const ANTHROPIC_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-fable-5",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
];

export async function pickModel(): Promise<string> {
  const provider = resolved.llmProvider();
  if (provider === "openai") return resolved.openaiModel();
  if (provider === "anthropic") return resolved.anthropicModel();
  if (resolved.llmModel()) return resolved.llmModel();
  const res = await fetch(`${BASE()}/models`);
  if (!res.ok) throw new Error(`LM Studio /models: ${res.status}`);
  const { data } = (await res.json()) as { data: { id: string }[] };
  const chatModels = data.filter(
    (m) => !/embed|orpheus|whisper|tts/i.test(m.id)
  );
  const preferred = chatModels.find((m) => /qwen3/i.test(m.id));
  const model = preferred ?? chatModels[0];
  if (!model) throw new Error("no chat model loaded in LM Studio");
  return model.id;
}

export async function lmChat(body: {
  model: string;
  messages: LmMessage[];
  tools?: LmTool[];
  temperature?: number;
}): Promise<{ message: LmMessage }> {
  const provider = resolved.llmProvider();
  if (provider === "anthropic") return anthropicChat(body);

  const openai = provider === "openai";
  const url = openai ? "https://api.openai.com/v1" : BASE();
  const label = openai ? "OpenAI" : "LM Studio";
  const payload = openai
    ? {
        model: body.model,
        // GPT-5-era models reject non-default sampling params — omit temperature
        messages: body.messages.map(({ _raw: _, ...m }) => m),
        ...(body.tools?.length ? { tools: body.tools } : {}),
      }
    : body;

  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(openai ? { Authorization: `Bearer ${resolved.openaiKey()}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error(`${label} returned no message`);
  return { message };
}

/** Fold OpenAI-style history into Anthropic shape (system out-of-band, tool results as user blocks). */
function toAnthropicMessages(messages: LmMessage[]): {
  system?: string;
  messages: Anthropic.MessageParam[];
} {
  let system: string | undefined;
  const out: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      system = m.content ?? undefined;
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content ?? "" });
    } else if (m.role === "assistant") {
      if (m._raw) {
        // replay Claude's own turn verbatim (thinking blocks must survive)
        out.push({ role: "assistant", content: m._raw });
        continue;
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const call of m.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {}
        blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input });
      }
      if (blocks.length) out.push({ role: "assistant", content: blocks });
    } else {
      // role "tool" — parallel results must land in ONE user message
      const result: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "",
        content: m.content ?? "",
      };
      const prev = out[out.length - 1];
      if (
        prev?.role === "user" &&
        Array.isArray(prev.content) &&
        prev.content.every((b) => b.type === "tool_result")
      ) {
        (prev.content as Anthropic.ToolResultBlockParam[]).push(result);
      } else {
        out.push({ role: "user", content: [result] });
      }
    }
  }
  return { system, messages: out };
}

async function anthropicChat(body: {
  model: string;
  messages: LmMessage[];
  tools?: LmTool[];
}): Promise<{ message: LmMessage }> {
  const apiKey = resolved.anthropicKey();
  if (!apiKey) throw new Error("Anthropic API key missing — add it on /settings");
  const client = new Anthropic({ apiKey });
  const { system, messages } = toAnthropicMessages(body.messages);

  const response = await client.messages.create({
    model: body.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    ...(system ? { system } : {}),
    messages,
    ...(body.tools?.length
      ? {
          tools: body.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters as Anthropic.Tool["input_schema"],
          })),
        }
      : {}),
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined this request (safety refusal)");
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const toolCalls: LmToolCall[] = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));

  return {
    message: {
      role: "assistant",
      content: text || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      _raw: response.content,
    },
  };
}
