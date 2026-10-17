import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tip = await dbService.getTipById(params.id);
    if (!tip) {
      return NextResponse.json({ error: "Tip not found" }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      tip: {
        id: tip._id || tip.id,
        status: tip.status,
        amountZec: tip.amountZec,
        escrowAddress: tip.escrowAddress,
        fundingTxid: tip.fundingTxid,
        createdAt: tip.createdAt,
      },
    });
  } catch (err: any) {
    console.error("Fetch tip error:", err);
    return NextResponse.json({ error: "Failed to fetch tip" }, { status: 500 });
  }
}
