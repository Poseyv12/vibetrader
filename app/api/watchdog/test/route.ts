import { NextRequest, NextResponse } from "next/server";
import { triageNews } from "@/lib/news-watchdog";

export const dynamic = "force-dynamic";

/** Dev helper: run the triage pipeline on a synthetic headline. */
export async function POST(req: NextRequest) {
  const { headline, summary, symbols } = await req.json();
  if (!headline) {
    return NextResponse.json({ error: "headline required" }, { status: 400 });
  }
  try {
    const triage = await triageNews(
      { headline, summary, symbols: symbols ?? [] },
      symbols ?? []
    );
    return NextResponse.json(triage);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
