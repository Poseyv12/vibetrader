import { NextRequest, NextResponse } from "next/server";
import { searchJournal } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q param required" }, { status: 400 });
  try {
    return NextResponse.json(await searchJournal(q, 6));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
