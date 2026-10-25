import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { zallet } from "@/lib/zcash";
import { deriveTipEscrowKeypair } from "@/lib/escrow/tip-escrow-keys";

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

    // 1. Autonomous Inflow Detection: If request is PENDING, check per-request transparent escrow UTXOs
    const reqEscrowKey = deriveTipEscrowKeypair((request._id || request.id).toString(), "mainnet");
    const activeTransparentVault = reqEscrowKey.address;
    if (request.status === "PENDING" && activeTransparentVault) {
      try {
        const utxos = await zallet.getEscrowUtxos(activeTransparentVault);
        const targetZats = Math.round(request.amountZec * 1e8);
        const totalZats = utxos.reduce((acc: bigint, u: any) => acc + BigInt(u.satoshis), 0n);
        if (utxos.length > 0 && totalZats >= BigInt(targetZats)) {
          const matchingTxid = utxos[0].txid;
          const settled = await dbService.settleRequest({
            id: (request._id || request.id).toString(),
            paidTxid: matchingTxid,
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

    const activeEscrowDeposit =
      request.escrowDepositAddress ||
      request.shieldedEscrowAddress ||
      activeTransparentVault;

    let confirmations = 0;
    if (request.paidTxid) {
      try {
        const rawTx = await zallet.call<any>("getrawtransaction", [request.paidTxid, 1]);
        confirmations = rawTx?.confirmations || 0;
      } catch {
        // In mempool (0-conf)
      }

      if (confirmations >= 1 && (request.status === "SETTLING" || request.status === "PENDING")) {
        try {
          const reqIdStr = (request._id || request.id).toString();
          const updated = await dbService.promoteRequestToFulfilled(reqIdStr, request.paidTxid);
          if (updated) request = updated;
        } catch {
          request.status = "FULFILLED";
        }
      }
    }

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
      confirmations,
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
