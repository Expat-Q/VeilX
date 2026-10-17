import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generatePkcePair, getTwitterAuthUrl } from "@/lib/twitter";
import crypto from "crypto";

export async function GET() {
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = crypto.randomBytes(16).toString("hex");

  // Save verifier and state in temporary cookies
  const cookieStore = cookies();
  cookieStore.set("oauth_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });

  cookieStore.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  const authUrl = getTwitterAuthUrl(state, codeChallenge);
  return NextResponse.redirect(authUrl);
}
