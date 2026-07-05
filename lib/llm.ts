/**
 * LM Studio client — OpenAI-compatible local server.
 * Configure with LMSTUDIO_URL / LMSTUDIO_MODEL in .env.local if defaults
 * don't fit; otherwise auto-picks a loaded chat model (prefers Qwen3 for
 * reliable tool calling).
 */

import { resolved } from "./settings";

const BASE = () => resolved.llmUrl();

export interface LmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LmToolCall[];
  tool_call_id?: string;
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

export async function pickModel(): Promise<string> {
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
  const res = await fetch(`${BASE()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`LM Studio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error("LM Studio returned no message");
  return { message };
}
