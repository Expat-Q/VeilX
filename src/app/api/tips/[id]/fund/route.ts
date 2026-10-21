import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`fund_tip_${ip}`, { limit: 20, windowMs: 60000 });
    if (!rl.success) {
      return NextResponse.json(
        { error: `RATE_LIMIT_EXCEEDED: Too many funding verification requests. Please retry in ${rl.resetSeconds}s.` },
        { status: 429 }
      );
    }

    const tipId = params.id;
    if (!tipId?.trim()) {
      return NextResponse.json({ error: "Tip ID is required." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { fundingTxid, blockHeight } = body;

    if (!fundingTxid || typeof fundingTxid !== "string" || !fundingTxid.trim()) {
      return NextResponse.json(
        { error: "Transaction ID (fundingTxid) is required to confirm tip funding." },
        { status: 400 }
      );
    }

    const updated = await dbService.confirmTipFunding(
      tipId.trim(),
      fundingTxid.trim(),
      typeof blockHeight === "number" ? blockHeight : undefined
    );

    return NextResponse.json({
      success: true,
      tip: updated,
      message: "Tip funding confirmed and recorded on-chain!",
    });
  } catch (error: any) {
    const message = error.message || "Failed to confirm tip funding";
    console.error("Fund tip error:", message);

    if (message.includes("TIP_NOT_FOUND")) {
      return NextResponse.json({ error: "Tip not found." }, { status: 404 });
    }

    if (message.includes("TRANSACTION_HASH_REQUIRED")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
