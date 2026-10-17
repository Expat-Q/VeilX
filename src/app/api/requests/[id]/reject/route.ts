import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const updated = await dbService.rejectRequest({
      id: params.id,
      userXUserId: user.xUserId,
      userUsername: user.xUsername,
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error: any) {
    console.error("Reject request error:", error);
    const msg = error.message || "Failed to reject request";
    const status = msg.includes("UNAUTHORIZED") ? 403 : msg.includes("NOT_FOUND") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
