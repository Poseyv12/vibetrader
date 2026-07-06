import { NextRequest, NextResponse } from "next/server";
import { publicSettings, updateSettings } from "@/lib/settings";

export async function GET() {
  return NextResponse.json(publicSettings());
}

export async function PUT(req: NextRequest) {
  const patch = await req.json();

  // never persist masked placeholders back as real values
  if (patch.alpaca) {
    for (const k of ["apiKey", "secretKey"] as const) {
      if (typeof patch.alpaca[k] === "string" && patch.alpaca[k].includes("••")) {
        delete patch.alpaca[k];
      }
      if (patch.alpaca[k] === "") delete patch.alpaca[k];
    }
  }
  if (patch.llm) {
    for (const k of ["openaiApiKey", "anthropicApiKey"] as const) {
      if (typeof patch.llm[k] === "string" && patch.llm[k].includes("••")) {
        delete patch.llm[k];
      }
      if (patch.llm[k] === "") delete patch.llm[k];
    }
  }

  updateSettings(patch);
  return NextResponse.json(publicSettings());
}
