import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { ufvkWatcher } from "@/lib/escrow/ufvk-watcher";
import { zallet } from "@/lib/zcash";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let request = await dbService.getRequestById(params.id);
    if (!request) {
      return NextResponse.json(
        { success: false, error: "Payment request not found" },
        { status: 404 }
      );
    }

    // 1. Autonomous Mobile Detection: If request is PENDING, check if UFVK watcher detected incoming note
    if (request.status === "PENDING" && request.escrowDepositAddress) {
      try {
        const detected = ufvkWatcher.findNoteByAddressOrMemo({
          expectedAmountZec: request.amountZec,
          expectedMemo: request.memo,
          depositAddress: request.escrowDepositAddress,
        });
        if (detected?.txid) {
          const settled = await dbService.settleRequest({
            id: (request._id || request.id).toString(),
            paidTxid: detected.txid,
            payerUsername: request.targetUsernameSnapshot,
          });
          if (settled) request = settled;
        }
      } catch {
        // Continue to regular flow
      }
    }

    // 2. Lazy auto-reconciliation: if request is in SETTLING with paidTxid, check if block confirmed
    if (request.status === "SETTLING" && request.paidTxid) {
      try {
        const settled = await dbService.settleRequest({
          id: (request._id || request.id).toString(),
          paidTxid: request.paidTxid,
          payerUsername: request.targetUsernameSnapshot,
        });
        if (settled) request = settled;
      } catch {
        // Still pending in mempool
      }
    }

    const user = await getCurrentUser();
    const isOwner =
      user &&
      ((request.requesterUserId &&
        user.userId === request.requesterUserId.toString()) ||
        (request.requesterUsernameSnapshot &&
          user.xUsername?.toLowerCase() ===
            request.requesterUsernameSnapshot.toLowerCase()));

    const activeTransparentVault = zallet.getEscrowTransparentAddress();
    const activeEscrowDeposit =
      !request.escrowDepositAddress ||
      request.escrowDepositAddress.startsWith("u1") ||
      request.escrowDepositAddress.startsWith("utest1")
        ? activeTransparentVault
        : request.escrowDepositAddress;

    // Redact private shielded UA for non-owners to prevent PII/financial tracking
    const safeRequest: any = {
      _id: request._id,
      id: request.id || request._id,
      requesterUsernameSnapshot: request.requesterUsernameSnapshot,
      targetUsernameSnapshot: request.targetUsernameSnapshot,
      amountZec: request.amountZec,
      memo: request.memo,
      escrowDepositAddress: activeEscrowDeposit,
      status: request.status,
      paidTxid: request.paidTxid,
      forwardTxid: request.forwardTxid,
      paidAt: request.paidAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };

    if (isOwner) {
      safeRequest.recipientShieldedUa = request.recipientShieldedUa;
    }

    return NextResponse.json({ success: true, request: safeRequest });
  } catch (error: any) {
    console.error("Fetch request by id error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
