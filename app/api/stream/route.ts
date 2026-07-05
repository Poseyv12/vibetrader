import { NextRequest } from "next/server";
import { getHub } from "@/lib/stream";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbols = (req.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const hub = getHub();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      hub.addClient(controller, symbols);
    },
    cancel() {
      if (ctrl) hub.removeClient(ctrl);
    },
  });

  req.signal.addEventListener("abort", () => {
    if (ctrl) hub.removeClient(ctrl);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
