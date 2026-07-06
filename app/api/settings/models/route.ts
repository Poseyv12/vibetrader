import { NextRequest, NextResponse } from "next/server";
import { resolved } from "@/lib/settings";
import { ANTHROPIC_MODELS } from "@/lib/llm";

/** Model ids for the settings dropdowns, per provider. */
export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") ?? resolved.llmProvider();
  try {
    if (provider === "anthropic") {
      return NextResponse.json(ANTHROPIC_MODELS);
    }
    if (provider === "openai") {
      const key = resolved.openaiKey();
      if (!key) return NextResponse.json([]);
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const { data } = (await res.json()) as { data: { id: string }[] };
      return NextResponse.json(
        data
          .map((m) => m.id)
          .filter(
            (id) =>
              /^(gpt-|o\d)/.test(id) &&
              !/embed|audio|image|tts|realtime|transcribe|moderation/.test(id)
          )
          .sort()
      );
    }
    const res = await fetch(`${resolved.llmUrl()}/models`);
    if (!res.ok) throw new Error(`LM Studio ${res.status}`);
    const { data } = (await res.json()) as { data: { id: string }[] };
    return NextResponse.json(data.map((m) => m.id));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
