import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { validateZcashAddress, ZCASH_NETWORK } from "@/lib/zcash";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tipId = params.id;
    if (!tipId?.trim()) {
      return NextResponse.json({ error: "Tip ID is required." }, { status: 400 });
    }

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
        { error: "Recipient shielded Zcash address is required." },
        { status: 400 }
      );
    }

    if (!validateZcashAddress(recipientShieldedAddress.trim(), ZCASH_NETWORK)) {
      return NextResponse.json(
        { error: `Invalid Zcash address for network '${ZCASH_NETWORK}': Must be a valid shielded or transparent address.` },
        { status: 400 }
      );
    }

    // 3. Process Concurrency-Safe Claim
    const result = await dbService.claimTip({
      tipId: tipId.trim(),
      recipientShieldedAddress: recipientShieldedAddress.trim(),
      claimantXUserId: user.xUserId,
      claimantUsername: user.xUsername,
    });

    return NextResponse.json({
      success: true,
      tip: result.tip,
      claimTxid: result.claimTxid,
      message: "Tip successfully claimed and broadcasted to Zcash network!",
    });
  } catch (error: any) {
    const message = error.message || "Failed to process tip claim";
    console.error("Claim tip error:", message);

    if (message.includes("UNAUTHORIZED_CLAIMANT")) {
      return NextResponse.json(
        { error: "Forbidden: You cannot claim a tip intended for a different 𝕏 account." },
        { status: 403 }
      );
    }

    if (message.includes("TIP_NOT_FOUND")) {
      return NextResponse.json({ error: "Tip not found." }, { status: 404 });
    }

    if (message.includes("SHIELDED_ESCROW_CONFIRMING") || message.includes("PAYOUT_DISPATCH_UNCERTAIN")) {
      return NextResponse.json(
        {
          error: "Escrow funds are confirming on-chain. Please wait 1–2 minutes for the note witness to synchronize, then retry.",
          retryable: true,
        },
        { status: 409 }
      );
    }

    if (message.includes("TIP_CLAIM_IN_PROGRESS")) {
      return NextResponse.json(
        {
          error: "A claim for this tip is currently processing or confirming on-chain. Please check back shortly.",
          retryable: true,
        },
        { status: 409 }
      );
    }

    if (
      message.includes("TIP_NOT_FUNDED") ||
      message.includes("TIP_ALREADY_CLAIMED") ||
      message.includes("INVALID_RECIPIENT_ADDRESS")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
