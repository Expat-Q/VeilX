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

    let order = swapService.getOrder(orderId);
    if (!order) {
      order = await swapService.getOrderAsync(orderId);
    }
    if (!order) {
      return NextResponse.json({ error: "Swap order not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch swap order" }, { status: 500 });
  }
}
