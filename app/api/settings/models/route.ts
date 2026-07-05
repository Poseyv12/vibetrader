import { NextResponse } from "next/server";
import { resolved } from "@/lib/settings";

/** Model ids currently loaded in LM Studio, for the settings dropdowns. */
export async function GET() {
  try {
    const res = await fetch(`${resolved.llmUrl()}/models`);
    if (!res.ok) throw new Error(`LM Studio ${res.status}`);
    const { data } = (await res.json()) as { data: { id: string }[] };
    return NextResponse.json(data.map((m) => m.id));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
