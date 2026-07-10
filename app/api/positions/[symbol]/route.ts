import { NextRequest, NextResponse } from "next/server";
import { trading, AlpacaError } from "@/lib/alpaca";
import { Position } from "@/lib/types";

/** Alpaca rejects crypto orders above $200k notional. */
const MAX_CRYPTO_NOTIONAL = 200_000;
/** Chunk size for split closes — headroom for price drift between chunks. */
const CHUNK_NOTIONAL = 190_000;

/** Close an entire position with a market order. Symbol as reported by
 *  /positions (crypto arrives slashless, e.g. BTCUSD) — pass it through.
 *  Crypto positions above Alpaca's $200k per-order notional cap are closed
 *  in exact-qty chunks (DELETE /positions would be rejected wholesale). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  try {
    const pos = await trading.get<Position>(`/positions/${encodeURIComponent(symbol)}`);
    const price = parseFloat(pos.current_price);
    const notional = Math.abs(parseFloat(pos.market_value));

    if (pos.asset_class === "crypto" && notional > MAX_CRYPTO_NOTIONAL && price > 0) {
      const side = parseFloat(pos.qty) >= 0 ? "sell" : "buy";
      const chunkQty = CHUNK_NOTIONAL / price;
      const orders: unknown[] = [];
      let remaining = Math.abs(parseFloat(pos.qty));
      while (remaining > 1e-9) {
        let q = Math.min(remaining, chunkQty);
        // never leave a tail below Alpaca's $10 crypto minimum — fold it in
        if ((remaining - q) * price < 10) q = remaining;
        orders.push(
          await trading.post("/orders", {
            symbol: pos.symbol,
            side,
            type: "market",
            qty: q.toFixed(9),
            time_in_force: "gtc",
          })
        );
        remaining -= q;
      }
      return NextResponse.json({ ok: true, chunks: orders.length, orders });
    }

    const order = await trading.del(`/positions/${encodeURIComponent(symbol)}`);
    return NextResponse.json(order ?? { ok: true });
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
