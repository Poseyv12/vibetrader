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

/** Re-price an open order (Alpaca order replace) — used by chart line drags. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, string> = {};
  if (Number(body.limit_price) > 0) patch.limit_price = String(body.limit_price);
  if (Number(body.stop_price) > 0) patch.stop_price = String(body.stop_price);
  if (!Object.keys(patch).length) {
    return NextResponse.json(
      { error: "limit_price or stop_price required" },
      { status: 400 }
    );
  }
  try {
    const order = await trading.patch(`/orders/${id}`, patch);
    return NextResponse.json(order);
  } catch (e) {
    const code = e instanceof AlpacaError ? e.status : 500;
    return NextResponse.json({ error: String(e) }, { status: code });
  }
}
