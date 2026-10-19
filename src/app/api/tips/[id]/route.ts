import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { ufvkWatcher } from "@/lib/escrow/ufvk-watcher";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let tip = await dbService.getTipById(params.id);
    if (!tip) {
      return NextResponse.json({ error: "Tip not found" }, { status: 404 });
    }

    // 1. Autonomous Mobile Detection: If tip is PENDING, check if UFVK watcher detected incoming note
    if (tip.status === "PENDING" && tip.escrowAddress) {
      try {
        const detected = ufvkWatcher.findNoteByAddressOrMemo({
          expectedAmountZec: tip.amountZec,
          depositAddress: tip.escrowAddress,
        });
        if (detected?.txid) {
          const updated = await dbService.confirmTipFunding(
            (tip._id || tip.id).toString(),
            detected.txid
          );
          if (updated) tip = updated;
        }
      } catch {
        // Continue to regular flow
      }
    }

    // 2. Lazy auto-reconciliation: if tip is in FUNDING_DETECTED and has fundingTxid, check if block confirmed
    if (tip.status === "FUNDING_DETECTED" && tip.fundingTxid) {
      try {
        const updated = await dbService.confirmTipFunding(
          (tip._id || tip.id).toString(),
          tip.fundingTxid
        );
        if (updated) tip = updated;
      } catch {
        // Still pending in mempool
      }
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
