import { NextRequest, NextResponse } from "next/server";
import { trading, AlpacaError } from "@/lib/alpaca";

/** Close an entire position with a market order. Symbol as reported by
 *  /positions (crypto arrives slashless, e.g. BTCUSD) — pass it through. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  try {
    const order = await trading.del(`/positions/${encodeURIComponent(symbol)}`);
    return NextResponse.json(order ?? { ok: true });
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
