import { NextRequest, NextResponse } from "next/server";
import { data, crypto, AlpacaError, FEED, isCryptoSymbol } from "@/lib/alpaca";
import { Bar } from "@/lib/types";

/** UI range presets → Alpaca bar params. */
const RANGES: Record<string, { timeframe: string; days: number }> = {
  "1D": { timeframe: "5Min", days: 5 }, // reach back over weekends/holidays
  "1W": { timeframe: "30Min", days: 8 },
  "1M": { timeframe: "1Day", days: 32 },
  "3M": { timeframe: "1Day", days: 95 },
  "1Y": { timeframe: "1Day", days: 370 },
};

/** Crypto trades 24/7, so intraday ranges don't need weekend reach-back. */
const CRYPTO_RANGES: Record<string, { timeframe: string; days: number }> = {
  ...RANGES,
  "1D": { timeframe: "5Min", days: 1 },
  "1W": { timeframe: "30Min", days: 7 },
};

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const range = req.nextUrl.searchParams.get("range") ?? "3M";
  if (!symbol) {
    return NextResponse.json({ error: "symbol param required" }, { status: 400 });
  }

  try {
    if (isCryptoSymbol(symbol)) {
      const preset = CRYPTO_RANGES[range] ?? CRYPTO_RANGES["3M"];
      const start = new Date(Date.now() - preset.days * 86_400_000).toISOString();
      const res = await crypto.get<{ bars: Record<string, Bar[]> }>(
        `/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${preset.timeframe}&start=${encodeURIComponent(start)}&limit=10000`
      );
      return NextResponse.json({ bars: res.bars?.[symbol] ?? [] });
    }

    const preset = RANGES[range] ?? RANGES["3M"];
    const start = new Date(Date.now() - preset.days * 86_400_000).toISOString();
    const res = await data.get<{ bars: Bar[] }>(
      `/stocks/${symbol}/bars?timeframe=${preset.timeframe}&start=${encodeURIComponent(
        start
      )}&limit=10000&adjustment=split&feed=${FEED}`
    );
    return NextResponse.json(res);
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
