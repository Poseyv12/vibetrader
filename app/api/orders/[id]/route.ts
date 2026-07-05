import { NextRequest, NextResponse } from "next/server";
import { trading, AlpacaError } from "@/lib/alpaca";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await trading.del(`/orders/${id}`);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
