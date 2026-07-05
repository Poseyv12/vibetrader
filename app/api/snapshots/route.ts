import { NextRequest, NextResponse } from "next/server";
import { data, crypto, AlpacaError, FEED, isCryptoSymbol } from "@/lib/alpaca";
import { Snapshot } from "@/lib/types";

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get("symbols");
  if (!symbols) {
    return NextResponse.json({ error: "symbols param required" }, { status: 400 });
  }

  const all = symbols.split(",").filter(Boolean);
  const stocks = all.filter((s) => !isCryptoSymbol(s));
  const cryptos = all.filter(isCryptoSymbol);

  try {
    const [stockSnaps, cryptoSnaps] = await Promise.all([
      stocks.length
        ? data.get<Record<string, Snapshot>>(
            `/stocks/snapshots?symbols=${encodeURIComponent(stocks.join(","))}&feed=${FEED}`
          )
        : Promise.resolve({}),
      cryptos.length
        ? crypto
            .get<{ snapshots: Record<string, Snapshot> }>(
              `/snapshots?symbols=${encodeURIComponent(cryptos.join(","))}`
            )
            .then((r) => r.snapshots ?? {})
        : Promise.resolve({}),
    ]);
    return NextResponse.json({ ...stockSnaps, ...cryptoSnaps });
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
