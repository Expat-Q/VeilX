import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { lookupTwitterUser } from "@/lib/twitter";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: true, tips: [] });
    }
    const tips = await dbService.getTips(user.xUsername, user.userId);
    return NextResponse.json({ success: true, tips });
  } catch (error) {
    console.error("Fetch tips error:", error);
    return NextResponse.json({ success: true, tips: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      recipientXUserId,
      recipientUsername,
      amountZec,
      isAnonymous = true,
      memo,
    } = body;

    const numericAmount = typeof amountZec === "number" ? amountZec : parseFloat(amountZec);
    if (!recipientUsername || typeof recipientUsername !== "string" || !recipientUsername.trim()) {
      return NextResponse.json(
        { error: "Recipient username is required." },
        { status: 400 }
      );
    }

    if (isNaN(numericAmount) || !isFinite(numericAmount) || numericAmount < 0.0001 || numericAmount > 100000) {
      return NextResponse.json(
        { error: "Invalid amount. Must be a valid number between 0.0001 and 100,000 ZEC." },
        { status: 400 }
      );
    }

    const cleanUsername = recipientUsername.replace("@", "").trim();
    let resolvedXUserId = recipientXUserId;

    if (!resolvedXUserId) {
      try {
        const twitterProfile = await lookupTwitterUser(cleanUsername);
        if (twitterProfile?.xUserId) {
          resolvedXUserId = twitterProfile.xUserId;
        }
      } catch (err) {
        console.warn("Could not lookup numeric X user ID for recipient:", err);
      }
    }

    const user = await getCurrentUser();

    const tip = await dbService.createTip({
      senderUserId: user?.userId,
      senderUsername: user?.xUsername,
      recipientXUserId: resolvedXUserId || cleanUsername,
      recipientUsername: cleanUsername,
      amountZec: numericAmount,
      isAnonymous,
      memo,
    });

    return NextResponse.json({ success: true, tip });
  } catch (error) {
    console.error("Create tip error:", error);
    return NextResponse.json({ error: "Failed to create tip" }, { status: 500 });
  }
}
