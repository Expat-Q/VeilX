import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { dbService } from "@/lib/db-service";

export const maxDuration = 60;

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
    // If no CRON_SECRET is explicitly configured, permit Vercel's internal cron invocations or non-production
    const isVercelCron =
      req.headers.get("x-vercel-cron") === "1" ||
      (req.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron");
    return isVercelCron || process.env.NODE_ENV !== "production";
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

    // Run pending tip claims, pending invoice/request forwards, and 30-day tip expiration sweeps safely
    const [tipsSettled, forwardsSettled, expiredSettled] = await Promise.allSettled([
      dbService.reconcilePendingTips(),
      dbService.reconcilePendingForwards(),
      dbService.expireOldTips(),
    ]);

    const reconciledTips = tipsSettled.status === "fulfilled" ? tipsSettled.value : [];
    const reconciledForwards = forwardsSettled.status === "fulfilled" ? forwardsSettled.value : [];
    const expiredResults = expiredSettled.status === "fulfilled" ? expiredSettled.value : { expiredCount: 0 };

    if (tipsSettled.status === "rejected") {
      console.warn("[Cron Reconcile] Pending tips sweep warning:", tipsSettled.reason);
    }
    if (forwardsSettled.status === "rejected") {
      console.warn("[Cron Reconcile] Pending forwards sweep warning:", forwardsSettled.reason);
    }
    if (expiredSettled.status === "rejected") {
      console.warn("[Cron Reconcile] Expired tips sweep warning:", expiredSettled.reason);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      reconciledTipsCount: Array.isArray(reconciledTips) ? reconciledTips.length : 0,
      reconciledForwardsCount: Array.isArray(reconciledForwards) ? reconciledForwards.length : 0,
      expiredCount: expiredResults?.expiredCount || 0,
      reconciledTips,
      reconciledForwards,
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
