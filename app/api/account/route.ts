import { NextResponse } from "next/server";
import { trading, AlpacaError } from "@/lib/alpaca";

export async function GET() {
  try {
    const account = await trading.get("/account");
    return NextResponse.json(account);
  } catch (e) {
    const status = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status });
  }
}
