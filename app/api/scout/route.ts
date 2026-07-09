import { NextRequest, NextResponse } from "next/server";
import { runScout } from "@/lib/scout";
import { friendlyLlmError } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** AI scout: suggests buy setups as ticket DRAFTS — it never places orders. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { watchlist?: unknown };
  const watchlist = Array.isArray(body.watchlist)
    ? body.watchlist.filter((s): s is string => typeof s === "string")
    : [];
  try {
    return NextResponse.json(await runScout(watchlist));
  } catch (e) {
    return NextResponse.json({ error: friendlyLlmError(e) }, { status: 502 });
  }
}
