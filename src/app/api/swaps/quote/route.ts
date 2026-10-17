import { NextRequest, NextResponse } from "next/server";
import { swapService } from "@/lib/swap-service";
import { getLiveZecPriceUsd } from "@/lib/server-price";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { fromTokenId, zecAmount, targetZecAddress, tipId } = body;

    if (!fromTokenId || !zecAmount || !targetZecAddress) {
      return NextResponse.json(
        { error: "fromTokenId, zecAmount, and targetZecAddress are required." },
        { status: 400 }
      );
    }

    const numericAmount = parseFloat(zecAmount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid zecAmount. Must be greater than 0." },
        { status: 400 }
      );
    }

    // Derive authoritative price server-side (prevent client price injection)
    const serverZecPrice = await getLiveZecPriceUsd();

    const order = await swapService.createSwapOrder({
      fromTokenId,
      zecAmount: numericAmount,
      targetZecAddress,
      tipId: tipId || undefined,
      zecPriceUsd: serverZecPrice,
    });

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error: any) {
    console.error("Create swap quote error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate cross-chain quote" },
      { status: 500 }
    );
  }
}
