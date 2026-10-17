import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const slug = params.slug;
    if (!slug?.trim()) {
      return NextResponse.json({ error: "PayLink slug is required." }, { status: 400 });
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
    const updated = await dbService.settlePayLink({
      slug: slug.trim(),
      paidTxid: paidTxid.trim(),
      payerUsername: user?.xUsername,
    });

    return NextResponse.json({
      success: true,
      paylink: updated,
      message: "PayLink invoice successfully settled!",
    });
  } catch (error: any) {
    const message = error.message || "Failed to settle PayLink invoice";
    console.error("Settle PayLink error:", message);

    if (message.includes("PAYLINK_NOT_FOUND")) {
      return NextResponse.json({ error: "PayLink invoice not found." }, { status: 404 });
    }

    if (
      message.includes("PAYLINK_CANNOT_BE_SETTLED") ||
      message.includes("PAYMENT_VERIFICATION_FAILED") ||
      message.includes("DUPLICATE_TXID_REUSE")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
