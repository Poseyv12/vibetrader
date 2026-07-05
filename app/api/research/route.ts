import { NextRequest, NextResponse } from "next/server";
import { listResearch, addResearch } from "@/lib/research";

export async function GET() {
  return NextResponse.json(listResearch());
}

/** Pin a copilot answer (or any markdown) into the research journal. */
export async function POST(req: NextRequest) {
  const { title, content } = await req.json();
  if (!title || !content) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 });
  }
  return NextResponse.json(addResearch(String(title), String(content), "copilot"), {
    status: 201,
  });
}
