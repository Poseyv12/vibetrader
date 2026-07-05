import { NextResponse } from "next/server";
import { listTrades } from "@/lib/trade-log";

export async function GET() {
  return NextResponse.json(listTrades(50));
}
