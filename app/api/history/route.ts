import { NextRequest, NextResponse } from "next/server";
import { trading, AlpacaError } from "@/lib/alpaca";

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") ?? "1M";
  try {
    const history = await trading.get(
      `/account/portfolio/history?period=${encodeURIComponent(period)}&timeframe=1D`
    );
    return NextResponse.json(history);
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
