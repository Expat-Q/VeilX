import { NextRequest, NextResponse } from "next/server";
import { getBaseAppUrl } from "@/lib/twitter";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ success: true });
  res.cookies.delete("xtip_session");
  res.cookies.set("xtip_session", "", {
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    sameSite: "lax",
  });
  return res;
}

export async function GET(req: NextRequest) {
  // Prevent cross-origin session destruction via <img src="/api/auth/logout">
  const baseUrl = getBaseAppUrl(req);
  return NextResponse.redirect(new URL("/", baseUrl));
}
