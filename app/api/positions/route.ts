import { NextResponse } from "next/server";
import { trading, AlpacaError } from "@/lib/alpaca";

export async function GET() {
  try {
    const positions = await trading.get("/positions");
    return NextResponse.json(positions);
  } catch (e) {
    const status = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status });
  }
}
