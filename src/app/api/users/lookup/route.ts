import { NextRequest, NextResponse } from "next/server";
import { lookupTwitterUser } from "@/lib/twitter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username");
  if (!username?.trim()) {
    return NextResponse.json({ error: "Username parameter is required" }, { status: 400 });
  }

  try {
    const profile = await lookupTwitterUser(username.trim());
    return NextResponse.json({
      success: true,
      profile,
      user: profile,
    });
  } catch (error) {
    console.error("User lookup failed:", error);
    return NextResponse.json({ error: "User lookup failed" }, { status: 500 });
  }
}
