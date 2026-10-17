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

    const user = await getCurrentUser();
    if (!user || !user.xUsername) {
      return NextResponse.json(
        { error: "UNAUTHORIZED: You must be signed in to retry invoice payout forwarding." },
        { status: 401 }
      );
    }

    const result = await dbService.retryForwardPayLink(slug.trim(), user.xUsername);

    return NextResponse.json({
      success: true,
      message: "Invoice payout successfully forwarded!",
      result,
    });
  } catch (error: any) {
    const message = error.message || "Failed to retry invoice forward payout";
    console.error("Retry forward PayLink error:", message);

    if (message.includes("PAYLINK_NOT_FOUND")) {
      return NextResponse.json({ error: "PayLink invoice not found." }, { status: 404 });
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
