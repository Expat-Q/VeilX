import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const requestId = params.id;
    if (!requestId?.trim()) {
      return NextResponse.json({ error: "Request ID is required." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { paidTxid } = body;

    if (!paidTxid || typeof paidTxid !== "string" || !paidTxid.trim()) {
      return NextResponse.json(
        { error: "Transaction ID (paidTxid) is required to record payment." },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    if (!user || !user.xUsername) {
      return NextResponse.json(
        { error: "UNAUTHORIZED: You must be signed in to settle a direct payment request." },
        { status: 401 }
      );
    }

    const updated = await dbService.settleRequest({
      id: requestId.trim(),
      paidTxid: paidTxid.trim(),
      payerUsername: user.xUsername,
    });

    return NextResponse.json({
      success: true,
      request: updated,
      message: "Payment request successfully fulfilled!",
    });
  } catch (error: any) {
    const message = error.message || "Failed to settle payment request";
    console.error("Settle request error:", message);

    if (message.includes("REQUEST_NOT_FOUND")) {
      return NextResponse.json({ error: "Payment request not found." }, { status: 404 });
    }

    if (message.includes("UNAUTHORIZED_SETTLER")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    if (
      message.includes("REQUEST_CANNOT_BE_SETTLED") ||
      message.includes("PAYMENT_VERIFICATION_FAILED") ||
      message.includes("DUPLICATE_TXID_REUSE")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
