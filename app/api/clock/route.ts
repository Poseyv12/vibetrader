import { NextResponse } from "next/server";
import { trading, AlpacaError } from "@/lib/alpaca";

export async function GET() {
  try {
    const clock = await trading.get("/clock");
    return NextResponse.json(clock);
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
