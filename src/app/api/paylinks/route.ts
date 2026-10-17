import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const paylinks = await dbService.getPayLinks(user.xUsername);
    return NextResponse.json({ success: true, paylinks });
  } catch (error) {
    console.error("Fetch paylinks error:", error);
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
    const { title, amountZec, recipientShieldedUa } = body;

    const parsedAmount = typeof amountZec === "number" ? amountZec : parseFloat(amountZec);
    if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount <= 0.0001) {
      return NextResponse.json(
        { error: "Amount must be a valid number greater than the 0.0001 ZEC network miner fee." },
        { status: 400 }
      );
    }

    const paylink = await dbService.createPayLink({
      creatorUserId: user.userId,
      creatorUsername: user.xUsername,
      title: title.trim(),
      amountZec: parsedAmount,
      recipientShieldedUa: recipientShieldedUa.trim(),
    });

    return NextResponse.json({ success: true, paylink });
  } catch (error: any) {
    console.error("Create paylink error:", error);
    const msg = error.message || "Failed to create paylink";
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("INVALID_RECIPIENT_ADDRESS") || msg.includes("INVALID_AMOUNT") ? 400 : 500 }
    );
  }
}
