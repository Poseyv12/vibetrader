import { NextRequest, NextResponse } from "next/server";
import { listAlerts, addAlert } from "@/lib/alerts";
import { getHub } from "@/lib/stream";

export async function GET() {
  return NextResponse.json(listAlerts());
}

export async function POST(req: NextRequest) {
  const { symbol, op, price } = await req.json();
  const p = parseFloat(price);
  if (!symbol || !["above", "below"].includes(op) || !(p > 0)) {
    return NextResponse.json(
      { error: "symbol, op (above/below), and a positive price are required" },
      { status: 400 }
    );
  }
  const alert = addAlert(String(symbol), op, p);
  // make sure the stream is watching this symbol even if no client subscribes it
  getHub().watch([alert.symbol]);
  return NextResponse.json(alert, { status: 201 });
}
