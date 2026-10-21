import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { ufvkWatcher } from "@/lib/escrow/ufvk-watcher";
import { zallet } from "@/lib/zcash";

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

    // 1. Autonomous Mobile Detection: If paylink is UNPAID, check if UFVK watcher detected incoming note
    if (paylink.status === "UNPAID" && paylink.escrowDepositAddress) {
      try {
        const detected = ufvkWatcher.findNoteByAddressOrMemo({
          expectedAmountZec: paylink.amountZec,
          expectedMemo: paylink.title,
          depositAddress: paylink.escrowDepositAddress,
        });
        if (detected?.txid) {
          const settled = await dbService.settlePayLink({
            slug: paylink.slug,
            paidTxid: detected.txid,
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

    const activeTransparentVault = zallet.getEscrowTransparentAddress();
    const activeEscrowDeposit =
      !paylink.escrowDepositAddress ||
      paylink.escrowDepositAddress.startsWith("u1") ||
      paylink.escrowDepositAddress.startsWith("utest1")
        ? activeTransparentVault
        : paylink.escrowDepositAddress;

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
