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

const ORDER_TYPES = ["market", "limit", "stop", "stop_limit", "trailing_stop"] as const;
type OrderType = (typeof ORDER_TYPES)[number];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    symbol,
    qty,
    notional,
    side,
    limit_price,
    stop_price,
    trail_percent,
    take_profit,
    stop_loss,
  } = body;
  const type: OrderType = ORDER_TYPES.includes(body.type) ? body.type : "market";

  if (!symbol || (!qty && !notional) || !["buy", "sell"].includes(side)) {
    return NextResponse.json(
      { error: "symbol, qty or notional, and side (buy/sell) are required" },
      { status: 400 }
    );
  }
  if ((type === "limit" || type === "stop_limit") && !limit_price) {
    return NextResponse.json(
      { error: `${type} orders require limit_price` },
      { status: 400 }
    );
  }
  if ((type === "stop" || type === "stop_limit") && !stop_price) {
    return NextResponse.json(
      { error: `${type} orders require stop_price` },
      { status: 400 }
    );
  }
  if (type === "trailing_stop" && !trail_percent) {
    return NextResponse.json(
      { error: "trailing_stop orders require trail_percent" },
      { status: 400 }
    );
  }
  if ((type === "stop" || type === "trailing_stop") && isCryptoSymbol(String(symbol).toUpperCase())) {
    return NextResponse.json(
      { error: "Alpaca crypto supports stop_limit only — no plain stop or trailing stop" },
      { status: 400 }
    );
  }
  if (type !== "market" && type !== "limit" && notional) {
    return NextResponse.json(
      { error: "stop orders need share qty, not dollars" },
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
    if (type !== "market" && type !== "limit") {
      return NextResponse.json(
        { error: "bracket entries must be market or limit orders" },
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
      type,
      ...(limit_price != null && (type === "limit" || type === "stop_limit")
        ? { limit_price: String(limit_price) }
        : {}),
      ...(stop_price != null && (type === "stop" || type === "stop_limit")
        ? { stop_price: String(stop_price) }
        : {}),
      ...(type === "trailing_stop" ? { trail_percent: String(trail_percent) } : {}),
      // crypto only supports gtc/ioc — day is equities-only. Stops are gtc so
      // a protective stop doesn't silently expire at the close.
      time_in_force:
        isCryptoSymbol(sym) || (type !== "market" && type !== "limit") ? "gtc" : "day",
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
