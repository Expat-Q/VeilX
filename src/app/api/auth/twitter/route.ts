import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generatePkcePair, getTwitterAuthUrl, getEffectiveTwitterCallbackUrl } from "@/lib/twitter";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = crypto.randomBytes(16).toString("hex");

  // Determine dynamic callback URL matching Render deployment
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  let dynamicCallback: string | undefined = undefined;
  if (host.includes("veilxapp.onrender.com")) {
    dynamicCallback = "https://veilxapp.onrender.com/api/auth/callback/twitter";
  } else if (host.includes("veilx.thearchive1111.xyz")) {
    dynamicCallback = "https://veilx.thearchive1111.xyz/api/auth/callback/twitter";
  } else if (host.includes("veilxapp.vercel.app")) {
    dynamicCallback = "https://veilxapp.vercel.app/api/auth/callback/twitter";
  }

  const effectiveCallback = getEffectiveTwitterCallbackUrl(dynamicCallback);

  // Save verifier, state, and callback URL in temporary cookies
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

  cookieStore.set("oauth_callback_url", effectiveCallback, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  const authUrl = getTwitterAuthUrl(state, codeChallenge, effectiveCallback);
  return NextResponse.redirect(authUrl);
}
