import { NextResponse } from "next/server";
import { computePerformance } from "@/lib/performance";
import { AlpacaError } from "@/lib/alpaca";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await computePerformance());
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
