import { NextRequest } from "next/server";
import { runAgent, friendlyLlmError } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const content = await runAgent(messages, emit);
        emit({ type: "content", text: content });
        emit({ type: "done" });
      } catch (e) {
        emit({ type: "error", text: friendlyLlmError(e) });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
