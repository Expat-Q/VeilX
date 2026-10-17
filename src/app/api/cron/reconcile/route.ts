import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { dbService } from "@/lib/db-service";

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // If no CRON_SECRET is configured, allow in development/test, fail-closed in production
    return process.env.NODE_ENV !== "production";
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (safeCompare(token, secret)) return true;
  }

  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader && safeCompare(cronHeader, secret)) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  return handleReconcile(req);
}

export async function POST(req: NextRequest) {
  return handleReconcile(req);
}

async function handleReconcile(req: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(req)) {
      return NextResponse.json(
        { error: "UNAUTHORIZED: Invalid or missing CRON_SECRET." },
        { status: 401 }
      );
    }

    // Run both pending tip settlement reconciliation and 30-day tip expiration sweeps
    const [reconciledResults, expiredResults] = await Promise.all([
      dbService.reconcilePendingTips(),
      dbService.expireOldTips(),
    ]);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      reconciledCount: reconciledResults.length,
      expiredCount: expiredResults.expiredCount || 0,
      reconciledResults,
      expiredResults,
    });
  } catch (error: any) {
    console.error("Cron reconciliation worker error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal error during payout reconciliation." },
      { status: 500 }
    );
  }
}
