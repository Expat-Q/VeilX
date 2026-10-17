import { NextResponse } from "next/server";
import { swapService } from "@/lib/swap-service";

export async function GET() {
  try {
    const tokens = swapService.getSupportedTokens();
    return NextResponse.json({
      success: true,
      tokens,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to get supported swap tokens" }, { status: 500 });
  }
}
