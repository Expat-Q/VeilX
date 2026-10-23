import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { ufvkWatcher } from "@/lib/escrow/ufvk-watcher";
import { zallet } from "@/lib/zcash";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let tip = await dbService.getTipById(params.id);
    if (!tip) {
      return NextResponse.json({ error: "Tip not found" }, { status: 404 });
    }

    // 1. Autonomous Mobile Detection: If tip is CREATED or PENDING, check if UFVK watcher detected incoming note
    const activeEscrowAddress = tip.escrowAddress || tip.escrowDepositAddress;
    if ((tip.status === "CREATED" || tip.status === "PENDING") && activeEscrowAddress) {
      try {
        const detected = ufvkWatcher.findNoteByAddressOrMemo({
          expectedAmountZec: tip.amountZec,
          depositAddress: activeEscrowAddress,
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

    // 2. Lazy auto-reconciliation: if tip is in FUNDING_DETECTED and has fundingTxid, check if block confirmed or >= 3 mins
    if (tip.status === "FUNDING_DETECTED" && tip.fundingTxid) {
      const detectedAt = new Date(tip.updatedAt || tip.createdAt || Date.now()).getTime();
      const elapsedMinutes = (Date.now() - detectedAt) / (60 * 1000);

      let confs = 0;
      try {
        const rawTx = await zallet.call<any>("getrawtransaction", [tip.fundingTxid, 1]);
        confs = rawTx?.confirmations || 0;
      } catch {
        // Node unavailable or 0-conf
      }

      if (confs >= 1 || elapsedMinutes >= 3) {
        try {
          const updated = await dbService.promoteTipToFunded(
            (tip._id || tip.id).toString(),
            tip.fundingTxid
          );
          if (updated) tip = updated;
        } catch {
          // Continue
        }
      } else {
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
    }

    // 3. Live confirmation tracking from Zcash node (matching PayLink/Request pattern)
    let confirmations = 0;
    const activeTxid = tip.fundingTxid;
    if (activeTxid) {
      try {
        const rawTx = await zallet.call<any>("getrawtransaction", [activeTxid, 1]);
        confirmations = rawTx?.confirmations || 0;
      } catch {
        // In mempool (0-conf)
      }
      if (tip.status === "FUNDED" && confirmations === 0) {
        confirmations = 1;
      }
    }

    return NextResponse.json({
      success: true,
      tip: {
        id: tip._id || tip.id,
        status: tip.status,
        amountZec: tip.amountZec,
        escrowAddress: tip.escrowDepositAddress || tip.escrowAddress,
        escrowDepositAddress: tip.escrowDepositAddress,
        fundingTxid: tip.fundingTxid,
        confirmations,
        claimTxid: tip.claimTxid,
        createdAt: tip.createdAt,
      },
    });
  } catch (err: any) {
    console.error("Fetch tip error:", err);
    return NextResponse.json({ error: "Failed to fetch tip" }, { status: 500 });
  }
}
