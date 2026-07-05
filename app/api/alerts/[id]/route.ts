import { NextRequest, NextResponse } from "next/server";
import { deleteAlert } from "@/lib/alerts";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return deleteAlert(id)
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
