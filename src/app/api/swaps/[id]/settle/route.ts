import { NextRequest, NextResponse } from "next/server";
import { swapService } from "@/lib/swap-service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const orderId = params.id;
    if (!orderId) {
      return NextResponse.json({ error: "Swap order ID is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { zecTxid, evmTxHash } = body;

    const result = await swapService.settleOrder(orderId, { zecTxid, evmTxHash });

    if (result.pending) {
      return NextResponse.json({
        success: true,
        pending: true,
        status: result.order.status,
        order: result.order,
        message: "EVM deposit registered. SideShift liquidity solver is processing shielded ZEC payout.",
      });
    }

    return NextResponse.json({
      success: true,
      pending: false,
      status: "SETTLED",
      order: result.order,
      tip: result.tip,
      message: "Cross-chain swap settled and converted to shielded ZEC!",
    });
  } catch (error: any) {
    console.error("Settle swap error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to settle swap order" },
      { status: 500 }
    );
  }
}
