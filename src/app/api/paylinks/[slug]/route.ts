import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { zallet } from "@/lib/zcash";
import { deriveTipEscrowKeypair } from "@/lib/escrow/tip-escrow-keys";

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    let paylink = await dbService.getPayLinkBySlug(params.slug);
    if (!paylink) {
      return NextResponse.json(
        { success: false, error: "PayLink not found" },
        { status: 404 }
      );
    }

    // 1. Autonomous Inflow Detection: If paylink is UNPAID, check per-paylink transparent escrow UTXOs
    const paylinkEscrowKey = deriveTipEscrowKeypair(paylink.slug, "mainnet");
    const activeTransparentVault = paylinkEscrowKey.address;
    if (paylink.status === "UNPAID" && activeTransparentVault) {
      try {
        const utxos = await zallet.getEscrowUtxos(activeTransparentVault);
        const targetZats = Math.round(paylink.amountZec * 1e8);
        const totalZats = utxos.reduce((acc: bigint, u: any) => acc + BigInt(u.satoshis), 0n);
        if (utxos.length > 0 && totalZats >= BigInt(targetZats)) {
          const matchingTxid = utxos[0].txid;
          const settled = await dbService.settlePayLink({
            slug: paylink.slug,
            paidTxid: matchingTxid,
            payerUsername: paylink.creatorUsernameSnapshot,
          });
          if (settled) paylink = settled;
        }
      } catch {
        // Continue to regular flow
      }
    }

    // 2. Lazy auto-reconciliation: if paylink is in SETTLING with paidTxid, check if block confirmed
    if (paylink.status === "SETTLING" && paylink.paidTxid) {
      try {
        const settled = await dbService.settlePayLink({
          slug: paylink.slug,
          paidTxid: paylink.paidTxid,
          payerUsername: paylink.creatorUsernameSnapshot,
        });
        if (settled) paylink = settled;
      } catch {
        // Still pending in mempool
      }
    }

    const user = await getCurrentUser();
    const isOwner =
      user &&
      ((paylink.creatorUserId &&
        user.userId === paylink.creatorUserId.toString()) ||
        (paylink.creatorUsernameSnapshot &&
          user.xUsername?.toLowerCase() ===
            paylink.creatorUsernameSnapshot.toLowerCase()));

    const activeEscrowDeposit =
      paylink.escrowDepositAddress ||
      paylink.shieldedEscrowAddress ||
      activeTransparentVault;

    let confirmations = 0;
    if (paylink.paidTxid) {
      try {
        const rawTx = await zallet.call<any>("getrawtransaction", [paylink.paidTxid, 1]);
        confirmations = rawTx?.confirmations || 0;
      } catch {
        // In mempool (0-conf)
      }

      if (confirmations >= 1 && (paylink.status === "SETTLING" || paylink.status === "UNPAID")) {
        try {
          const updated = await dbService.promotePayLinkToPaid(paylink.slug, paylink.paidTxid);
          if (updated) paylink = updated;
        } catch {
          paylink.status = "PAID";
        }
      }
    }

    const safePaylink: any = {
      _id: paylink._id,
      id: paylink.id || paylink._id,
      slug: paylink.slug,
      title: paylink.title,
      description: paylink.description,
      creatorUsernameSnapshot: paylink.creatorUsernameSnapshot,
      amountZec: paylink.amountZec,
      escrowDepositAddress: activeEscrowDeposit,
      status: paylink.status,
      paidTxid: paylink.paidTxid,
      confirmations,
      forwardTxid: paylink.forwardTxid,
      paidAt: paylink.paidAt,
      createdAt: paylink.createdAt,
      updatedAt: paylink.updatedAt,
    };

    if (isOwner) {
      safePaylink.recipientShieldedUa = paylink.recipientShieldedUa;
    }

    return NextResponse.json({ success: true, paylink: safePaylink });
  } catch (error: any) {
    console.error("Fetch paylink by slug error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
