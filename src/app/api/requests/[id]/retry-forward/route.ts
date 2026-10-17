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

    const user = await getCurrentUser();
    if (!user || !user.xUsername) {
      return NextResponse.json(
        { error: "UNAUTHORIZED: You must be signed in to retry payment request payout forwarding." },
        { status: 401 }
      );
    }

    const result = await dbService.retryForwardRequest(requestId.trim(), user.xUsername);

    return NextResponse.json({
      success: true,
      message: "Payment request payout successfully forwarded!",
      result,
    });
  } catch (error: any) {
    const message = error.message || "Failed to retry request forward payout";
    console.error("Retry forward request error:", message);

    if (message.includes("REQUEST_NOT_FOUND")) {
      return NextResponse.json({ error: "Payment request not found." }, { status: 404 });
    }

    if (message.includes("UNAUTHORIZED")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    if (message.includes("CANNOT_RETRY_PAYOUT")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
