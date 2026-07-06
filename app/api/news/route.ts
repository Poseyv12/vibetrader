import { NextRequest, NextResponse } from "next/server";
import { beta, AlpacaError } from "@/lib/alpaca";
import { NewsStory } from "@/lib/types";

export async function GET(req: NextRequest) {
  // news API wants crypto slashless (BTC/USD → BTCUSD)
  const symbols = (req.nextUrl.searchParams.get("symbols") ?? "")
    .toUpperCase()
    .replace(/\//g, "")
    .trim();
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 30, 1),
    50
  );
  const q = symbols ? `&symbols=${encodeURIComponent(symbols)}` : "";
  try {
    const r = await beta.get<{ news: NewsStory[] }>(
      `/news?limit=${limit}&sort=desc${q}`
    );
    return NextResponse.json(r.news ?? []);
  } catch (e) {
    const status = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status });
  }
}
