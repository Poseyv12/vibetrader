import { NextRequest, NextResponse } from "next/server";
import { trading, AlpacaError, isCryptoSymbol } from "@/lib/alpaca";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "open";
  try {
    const orders = await trading.get(
      `/orders?status=${status}&limit=50&direction=desc`
    );
    return NextResponse.json(orders);
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, qty, notional, side, type, limit_price, take_profit, stop_loss } = body;

  if (!symbol || (!qty && !notional) || !["buy", "sell"].includes(side)) {
    return NextResponse.json(
      { error: "symbol, qty or notional, and side (buy/sell) are required" },
      { status: 400 }
    );
  }
  if (type === "limit" && !limit_price) {
    return NextResponse.json(
      { error: "limit orders require limit_price" },
      { status: 400 }
    );
  }

  const sym = String(symbol).toUpperCase();
  const bracket = take_profit != null || stop_loss != null;
  if (bracket) {
    if (isCryptoSymbol(sym)) {
      return NextResponse.json(
        { error: "bracket orders are equities-only on Alpaca" },
        { status: 400 }
      );
    }
    if (take_profit == null || stop_loss == null) {
      return NextResponse.json(
        { error: "bracket orders need both take_profit and stop_loss" },
        { status: 400 }
      );
    }
    if (!qty) {
      return NextResponse.json(
        { error: "bracket orders require share qty (not dollars)" },
        { status: 400 }
      );
    }
  }

  try {
    const order = await trading.post("/orders", {
      symbol: sym,
      ...(qty ? { qty: String(qty) } : { notional: String(notional) }),
      side,
      type: type === "limit" ? "limit" : "market",
      ...(type === "limit" ? { limit_price: String(limit_price) } : {}),
      // crypto only supports gtc/ioc — day is equities-only
      time_in_force: isCryptoSymbol(sym) ? "gtc" : "day",
      ...(bracket
        ? {
            order_class: "bracket",
            take_profit: { limit_price: String(take_profit) },
            stop_loss: { stop_price: String(stop_loss) },
          }
        : {}),
    });
    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
