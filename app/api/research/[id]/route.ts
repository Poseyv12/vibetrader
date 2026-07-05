import { NextRequest, NextResponse } from "next/server";
import { deleteResearch } from "@/lib/research";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return deleteResearch(id)
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
