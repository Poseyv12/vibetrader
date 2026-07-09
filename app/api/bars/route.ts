import { NextRequest, NextResponse } from "next/server";
import { data, crypto, AlpacaError, FEED, isCryptoSymbol } from "@/lib/alpaca";
import { Bar } from "@/lib/types";

/** UI range presets → Alpaca bar params (the AUTO timeframe). */
const RANGES: Record<string, { timeframe: string; days: number }> = {
  "1D": { timeframe: "5Min", days: 5 }, // reach back over weekends/holidays
  "1W": { timeframe: "30Min", days: 8 },
  "1M": { timeframe: "1Day", days: 32 },
  "3M": { timeframe: "1Day", days: 95 },
  "1Y": { timeframe: "1Day", days: 370 },
  "5Y": { timeframe: "1Week", days: 1830 },
};

/** Crypto trades 24/7, so intraday ranges don't need weekend reach-back. */
const CRYPTO_RANGES: Record<string, { timeframe: string; days: number }> = {
  ...RANGES,
  "1D": { timeframe: "5Min", days: 1 },
  "1W": { timeframe: "30Min", days: 7 },
};

/**
 * Explicit timeframes the picker can request, with a max lookback window
 * that keeps the response under Alpaca's 10k-bars-per-request cap even for
 * 24/7 crypto (1440 one-minute bars/day).
 */
const TIMEFRAME_CAP_DAYS: Record<string, number> = {
  "1Min": 6,
  "5Min": 30,
  "10Min": 60,
  "15Min": 90,
  "30Min": 180,
  "1Hour": 370,
  "3Hour": 1100,
  "1Day": 1830,
  "1Week": 1830,
};

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const range = req.nextUrl.searchParams.get("range") ?? "3M";
  const tfParam = req.nextUrl.searchParams.get("timeframe");
  if (!symbol) {
    return NextResponse.json({ error: "symbol param required" }, { status: 400 });
  }

  const presets = isCryptoSymbol(symbol) ? CRYPTO_RANGES : RANGES;
  const preset = presets[range] ?? presets["3M"];
  // explicit timeframe overrides the preset's; the range still sets the
  // window, clamped so fine resolutions stay under the per-request bar cap
  const timeframe = tfParam && TIMEFRAME_CAP_DAYS[tfParam] ? tfParam : preset.timeframe;
  const days =
    tfParam && TIMEFRAME_CAP_DAYS[tfParam]
      ? Math.min(preset.days, TIMEFRAME_CAP_DAYS[tfParam])
      : preset.days;
  const start = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    if (isCryptoSymbol(symbol)) {
      const res = await crypto.get<{ bars: Record<string, Bar[]> }>(
        `/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${timeframe}&start=${encodeURIComponent(start)}&limit=10000`
      );
      return NextResponse.json({ bars: res.bars?.[symbol] ?? [] });
    }

    const res = await data.get<{ bars: Bar[] }>(
      `/stocks/${symbol}/bars?timeframe=${timeframe}&start=${encodeURIComponent(
        start
      )}&limit=10000&adjustment=split&feed=${FEED}`
    );
    return NextResponse.json(res);
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
