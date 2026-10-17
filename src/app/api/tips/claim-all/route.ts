import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { validateZcashAddress, ZCASH_NETWORK } from "@/lib/zcash";

export async function POST(req: NextRequest) {
  try {
    // 1. Enforce Authenticated 𝕏 Session
    const user = await getCurrentUser();
    if (!user || !user.xUserId) {
      return NextResponse.json(
        { error: "Authentication required: Please sign in with your 𝕏 account to claim tips." },
        { status: 401 }
      );
    }

    // 2. Parse & Validate Payload
    const body = await req.json().catch(() => ({}));
    const { recipientShieldedAddress } = body;

    if (!recipientShieldedAddress?.trim()) {
      return NextResponse.json(
        { error: "Recipient Zcash payout address is required." },
        { status: 400 }
      );
    }

    if (!validateZcashAddress(recipientShieldedAddress.trim(), ZCASH_NETWORK)) {
      return NextResponse.json(
        { error: `Invalid Zcash address for network '${ZCASH_NETWORK}': Must be a valid shielded (u1..., zs1...) or transparent address.` },
        { status: 400 }
      );
    }

    // 3. Process Concurrency-Safe Batch Claim
    const result = await dbService.claimAllTips({
      claimantXUserId: user.xUserId,
      claimantUsername: user.xUsername,
      recipientShieldedAddress: recipientShieldedAddress.trim(),
    });

    return NextResponse.json({
      success: true,
      count: result.count,
      totalAmountZec: result.totalAmountZec,
      claimTxid: result.claimTxid,
      tips: result.tips,
      message: `Successfully claimed ${result.count} tips (${result.totalAmountZec} ZEC) in a single shielded payout!`,
    });
  } catch (error: any) {
    const message = error.message || "Failed to process batch claim";
    console.error("Claim all tips error:", message);

    if (message.includes("NO_CLAIMABLE_TIPS")) {
      return NextResponse.json({ error: "You do not have any claimable funded tips." }, { status: 404 });
    }

    if (message.includes("INVALID_RECIPIENT_ADDRESS")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
