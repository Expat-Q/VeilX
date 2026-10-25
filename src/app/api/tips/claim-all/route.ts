import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { validateZcashAddress, ZCASH_NETWORK } from "@/lib/zcash";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const maxDuration = 120; // Allow sufficient time for sequential individual proof/disbursement sweep

/**
 * Sequential Claim Queue / Sweep Endpoint:
 * Sweeps all funded tips for the authenticated recipient sequentially.
 * Each tip's unique transparent escrow UTXO is individually prepared, proven,
 * signed with its unique deterministic key, and disbursed into the recipient's shielded Orchard pool.
 * This completely prevents UTXO stranding across different transparent addresses.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`claim_all_${ip}`, { limit: 10, windowMs: 60000 });
    if (!rl.success) {
      return NextResponse.json(
        { error: `RATE_LIMIT_EXCEEDED: Too many claim requests. Please retry in ${rl.resetSeconds}s.` },
        { status: 429 }
      );
    }

    // 1. Enforce Authenticated Session
    const user = await getCurrentUser();
    if (!user || !user.xUserId) {
      return NextResponse.json(
        { error: "Authentication required: Please sign in with your 𝕏 account to claim tips." },
        { status: 401 }
      );
    }

    // 2. Validate Payload
    const body = await req.json().catch(() => ({}));
    const { recipientShieldedAddress } = body;

    if (!recipientShieldedAddress || typeof recipientShieldedAddress !== "string" || !recipientShieldedAddress.trim()) {
      return NextResponse.json(
        { error: "Recipient shielded Zcash address is required." },
        { status: 400 }
      );
    }

    const cleanAddress = recipientShieldedAddress.trim();
    if (!validateZcashAddress(cleanAddress, ZCASH_NETWORK)) {
      return NextResponse.json(
        { error: `Invalid Zcash address for network '${ZCASH_NETWORK}': Must be a valid shielded or transparent address.` },
        { status: 400 }
      );
    }

    // 3. Process Sequential Sweep Queue
    const result = await dbService.claimAllTips({
      claimantXUserId: user.xUserId,
      recipientShieldedAddress: cleanAddress,
      claimantUsername: user.xUsername,
    });

    return NextResponse.json({
      success: result.success,
      count: result.count,
      totalCount: result.totalCount,
      totalAmountZec: result.totalAmountZec,
      results: result.results,
      tips: result.tips,
      message: `Successfully processed sequential sweep for ${result.count} tip(s).`,
    });
  } catch (error: any) {
    const message = error.message || "Failed to process batch claim sweep";
    console.error("[claim-all] Error:", message);

    if (message.includes("NO_CLAIMABLE_TIPS")) {
      return NextResponse.json({ error: "You do not have any pending funded tips to claim." }, { status: 404 });
    }

    if (message.includes("PAYOUTS_HALTED") || message.includes("CIRCUIT_BREAKER")) {
      return NextResponse.json({ error: message }, { status: 503 });
    }

    if (message.includes("INVALID_RECIPIENT_ADDRESS") || message.includes("AMOUNT_TOO_SMALL")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: "An error occurred while processing claims. Please try claiming individual tips." }, { status: 500 });
  }
}
