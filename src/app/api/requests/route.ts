import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const requests = await dbService.getRequests(user.xUsername);
    return NextResponse.json({ success: true, requests });
  } catch (error) {
    console.error("Fetch requests error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const { targetXUserId, targetUsername, amountZec, memo, recipientShieldedUa } = body;

    const parsedAmount = typeof amountZec === "number" ? amountZec : parseFloat(amountZec);
    if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount <= 0.0001) {
      return NextResponse.json(
        { error: "Amount must be a valid number greater than the 0.0001 ZEC network miner fee." },
        { status: 400 }
      );
    }

    const request = await dbService.createRequest({
      requesterUserId: user.userId,
      requesterUsername: user.xUsername,
      targetXUserId,
      targetUsername: targetUsername.trim(),
      amountZec: parsedAmount,
      memo: memo?.trim(),
      recipientShieldedUa: recipientShieldedUa.trim(),
    });

    return NextResponse.json({ success: true, request });
  } catch (error: any) {
    console.error("Create request error:", error);
    const msg = error.message || "Failed to create request";
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("INVALID_RECIPIENT_ADDRESS") || msg.includes("INVALID_AMOUNT") ? 400 : 500 }
    );
  }
}
