import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const request = await dbService.getRequestById(params.id);
    if (!request) {
      return NextResponse.json(
        { success: false, error: "Payment request not found" },
        { status: 404 }
      );
    }

    const user = await getCurrentUser();
    const isOwner =
      user &&
      ((request.requesterUserId &&
        user.userId === request.requesterUserId.toString()) ||
        (request.requesterUsernameSnapshot &&
          user.xUsername?.toLowerCase() ===
            request.requesterUsernameSnapshot.toLowerCase()));

    // Redact private shielded UA for non-owners to prevent PII/financial tracking
    const safeRequest: any = {
      _id: request._id,
      id: request.id || request._id,
      requesterUsernameSnapshot: request.requesterUsernameSnapshot,
      targetUsernameSnapshot: request.targetUsernameSnapshot,
      amountZec: request.amountZec,
      memo: request.memo,
      escrowDepositAddress: request.escrowDepositAddress,
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
