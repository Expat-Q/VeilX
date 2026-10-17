import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { Tip } from "@/models/Tip";
import { zalletClient } from "@/lib/zcash";
import crypto from "crypto";

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

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "SERVER_MISCONFIGURATION: CRON_SECRET is not configured." },
        { status: 500 }
      );
    }
  } else {
    const authHeader = req.headers.get("authorization") || "";
    const customHeader = req.headers.get("x-cron-secret") || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!safeCompare(bearerToken, cronSecret) && !safeCompare(customHeader, cronSecret)) {
      return NextResponse.json({ error: "UNAUTHORIZED: Invalid sync authorization token." }, { status: 401 });
    }
  }
  try {
    await connectToDatabase();

    // 1. Query received notes from Zallet wallet daemon
    const receivedNotes = await zalletClient.listReceivedNotes();

    let updatedCount = 0;

    for (const note of receivedNotes) {
      // 2. Find matching tip by escrow address
      const tip = await Tip.findOne({
        escrowAddress: note.address,
        status: { $in: ["CREATED", "FUNDING_DETECTED"] },
      });

      if (tip) {
        if (note.confirmations >= 3) {
          // 3. Mark as FUNDED (Ready to Claim)
          tip.status = "FUNDED";
          tip.fundingTxid = note.txid;
          tip.fundingBlockHeight = note.blockHeight;
          await tip.save();
          updatedCount++;
        } else if (tip.status === "CREATED") {
          // Mark as Detecting (mempool / 1-2 conf)
          tip.status = "FUNDING_DETECTED";
          tip.fundingTxid = note.txid;
          await tip.save();
          updatedCount++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      scannedNotes: receivedNotes.length,
      updatedTips: updatedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Sync worker error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
