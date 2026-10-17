import { NextResponse } from "next/server";
import { getServerZecPrice } from "@/lib/server-price";

export async function GET() {
  try {
    const data = await getServerZecPrice();
    return NextResponse.json({
      success: true,
      data,
      cached: Date.now() - data.updatedAt < 60000,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to retrieve ZEC price",
      },
      { status: 500 }
    );
  }
}
