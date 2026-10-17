import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const paylink = await dbService.getPayLinkBySlug(params.slug);
    if (!paylink) {
      return NextResponse.json(
        { success: false, error: "PayLink not found" },
        { status: 404 }
      );
    }

    const user = await getCurrentUser();
    const isOwner =
      user &&
      ((paylink.creatorUserId &&
        user.userId === paylink.creatorUserId.toString()) ||
        (paylink.creatorUsernameSnapshot &&
          user.xUsername?.toLowerCase() ===
            paylink.creatorUsernameSnapshot.toLowerCase()));

    const safePaylink: any = {
      _id: paylink._id,
      id: paylink.id || paylink._id,
      slug: paylink.slug,
      title: paylink.title,
      description: paylink.description,
      creatorUsernameSnapshot: paylink.creatorUsernameSnapshot,
      amountZec: paylink.amountZec,
      escrowDepositAddress: paylink.escrowDepositAddress,
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
