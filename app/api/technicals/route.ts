import { NextRequest, NextResponse } from "next/server";
import { runChatTool } from "@/lib/chat-tools";

/** Server-computed technicals for the chart's stats strip (math never in the model or the browser). */
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol param required" }, { status: 400 });
  }
  try {
    const stats = await runChatTool("get_technicals", { symbol });
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
