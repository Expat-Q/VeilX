import { NextRequest, NextResponse } from "next/server";
import { swapService } from "@/lib/swap-service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const orderId = params.id;
    if (!orderId) {
      return NextResponse.json({ error: "Swap order ID is required" }, { status: 400 });
    }

    const result = await swapService.getOrderStatus(orderId);

    return NextResponse.json({
      success: true,
      settled: result.settled,
      status: result.order.status,
      order: result.order,
      tip: result.tip,
    });
  } catch (error: any) {
    console.error("Get swap status error:", error);
    const msg = error.message || "Failed to retrieve swap order status";
    const status = msg.includes("NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
