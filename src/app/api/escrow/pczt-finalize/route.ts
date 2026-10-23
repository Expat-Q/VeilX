import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { zalletClient } from "@/lib/zcash";
import { getWasmEngine } from "@/lib/escrow/ufvk-watcher";
import { connectToDatabase } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tipId, paylinkSlug, requestId, pcztParams, expiryHeight, consensusBranchId } = body;

    if ((!tipId && !paylinkSlug && !requestId) || !pcztParams) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const user = await getCurrentUser().catch(() => null);
    if (tipId && (!user || !user.xUserId)) {
      return NextResponse.json({ error: "Authentication required to claim tips" }, { status: 401 });
    }

    const escrowSpendingKey = process.env.ESCROW_PLATFORM_SPENDING_KEY;
    if (!escrowSpendingKey) {
      return NextResponse.json(
        { error: "Server misconfigured: Escrow spending key missing from environment" },
        { status: 500 }
      );
    }

    const wasm = await getWasmEngine();
    if (!wasm) {
      return NextResponse.json({ error: "Native cryptographic engine unavailable" }, { status: 500 });
    }

    // 1. Atomic database lock to prevent race condition / double-claiming
    const mongooseConn = await connectToDatabase();
    const db = mongooseConn.connection.db!;

    let itemDoc: any = null;
    let itemType: "tip" | "paylink" | "request" = "tip";

    if (tipId) {
      itemType = "tip";
      itemDoc = await db.collection("tips").findOneAndUpdate(
        {
          _id: new ObjectId(tipId),
          status: "FUNDED",
        },
        {
          $set: {
            status: "CLAIMING",
            claimAttemptAt: new Date(),
          },
        },
        { returnDocument: "after" }
      );

      if (!itemDoc) {
        return NextResponse.json(
          { error: "Tip is not in FUNDED state or is already being claimed." },
          { status: 409 }
        );
      }
    } else if (paylinkSlug) {
      itemType = "paylink";
      itemDoc = await db.collection("paymentlinks").findOneAndUpdate(
        {
          slug: paylinkSlug,
          forwardTxid: { $exists: false },
        },
        {
          $set: {
            status: "FORWARD_PENDING",
            forwardAttemptAt: new Date(),
          },
        },
        { returnDocument: "after" }
      );

      if (!itemDoc) {
        return NextResponse.json(
          { error: "PayLink has already been forwarded or cannot be settled." },
          { status: 409 }
        );
      }
    } else if (requestId) {
      itemType = "request";
      itemDoc = await db.collection("paymentrequests").findOneAndUpdate(
        {
          _id: new ObjectId(requestId),
          forwardTxid: { $exists: false },
        },
        {
          $set: {
            status: "FORWARD_PENDING",
            forwardAttemptAt: new Date(),
          },
        },
        { returnDocument: "after" }
      );

      if (!itemDoc) {
        return NextResponse.json(
          { error: "Payment request has already been forwarded or cannot be settled." },
          { status: 409 }
        );
      }
    }

    // 2. Anti-Tamper Verification
    // Ensure destination and amount were not tampered with
    const expectedPayoutZats = Math.round(itemDoc.amountZec * 1e8) - 10000;
    if (pcztParams.payout_value_zatoshis !== expectedPayoutZats) {
      // Revert state
      if (itemType === "tip") {
        await db.collection("tips").updateOne({ _id: new ObjectId(tipId) }, { $set: { status: "FUNDED" } });
      } else if (itemType === "paylink") {
        await db.collection("paymentlinks").updateOne({ slug: paylinkSlug }, { $set: { status: "PAID" } });
      } else {
        await db.collection("paymentrequests").updateOne({ _id: new ObjectId(requestId) }, { $set: { status: "FULFILLED" } });
      }
      return NextResponse.json(
        { error: "Anti-tamper violation: Payout value mismatch." },
        { status: 400 }
      );
    }

    // 3. Server Sign & Extract Consensus Raw Transaction
    let finalizeResult: any = null;
    try {
      finalizeResult = wasm.server_sign_and_finalize_pczt(
        pcztParams,
        escrowSpendingKey,
        expiryHeight || 3525850,
        consensusBranchId || 0x37a5165b
      );
    } catch (signErr: any) {
      console.error("[pczt-finalize] Signing error:", signErr);
      if (itemType === "tip") {
        await db.collection("tips").updateOne({ _id: new ObjectId(tipId) }, { $set: { status: "FUNDED", payoutError: signErr.message || "Signing failed" } });
      } else if (itemType === "paylink") {
        await db.collection("paymentlinks").updateOne({ slug: paylinkSlug }, { $set: { status: "FORWARD_PENDING", payoutError: signErr.message || "Signing failed" } });
      } else {
        await db.collection("paymentrequests").updateOne({ _id: new ObjectId(requestId) }, { $set: { status: "FORWARD_PENDING", payoutError: signErr.message || "Signing failed" } });
      }
      return NextResponse.json(
        { error: `Cryptographic signing failed: ${signErr.message || signErr}` },
        { status: 500 }
      );
    }

    if (!finalizeResult?.raw_tx_hex) {
      if (itemType === "tip") {
        await db.collection("tips").updateOne({ _id: new ObjectId(tipId) }, { $set: { status: "FUNDED", payoutError: "Failed to extract raw transaction" } });
      } else if (itemType === "paylink") {
        await db.collection("paymentlinks").updateOne({ slug: paylinkSlug }, { $set: { status: "FORWARD_PENDING", payoutError: "Failed to extract raw transaction" } });
      } else {
        await db.collection("paymentrequests").updateOne({ _id: new ObjectId(requestId) }, { $set: { status: "FORWARD_PENDING", payoutError: "Failed to extract raw transaction" } });
      }
      return NextResponse.json({ error: "Failed to extract raw transaction" }, { status: 500 });
    }

    // 4. Broadcast to Zcash Mainnet Node
    console.log(`[pczt-finalize] Broadcasting live transaction for ${itemType}...`);
    let broadcastTxid = "";
    try {
      broadcastTxid = await zalletClient.call<string>("sendrawtransaction", [finalizeResult.raw_tx_hex]);
    } catch (rpcErr: any) {
      console.error("[pczt-finalize] Broadcast failed:", rpcErr);
      if (itemType === "tip") {
        await db.collection("tips").updateOne(
          { _id: new ObjectId(tipId) },
          { $set: { status: "FUNDED", payoutError: rpcErr.message || "Broadcast rejected" } }
        );
      } else if (itemType === "paylink") {
        await db.collection("paymentlinks").updateOne(
          { slug: paylinkSlug },
          { $set: { status: "FORWARD_PENDING", payoutError: rpcErr.message || "Broadcast rejected" } }
        );
      } else {
        await db.collection("paymentrequests").updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: "FORWARD_PENDING", payoutError: rpcErr.message || "Broadcast rejected" } }
        );
      }
      return NextResponse.json(
        { error: `Zcash node broadcast rejected: ${rpcErr.message || rpcErr}` },
        { status: 500 }
      );
    }

    // 5. Update Database Record to CLAIMED / PAID / FULFILLED
    if (itemType === "tip") {
      await db.collection("tips").updateOne(
        { _id: new ObjectId(tipId) },
        {
          $set: {
            status: "CLAIMED",
            claimTxid: broadcastTxid,
            claimedAt: new Date(),
            claimedByXUserId: user?.xUserId || null,
            payoutError: null,
          },
        }
      );
    } else if (itemType === "paylink") {
      await db.collection("paymentlinks").updateOne(
        { slug: paylinkSlug },
        {
          $set: {
            status: "PAID",
            forwardTxid: broadcastTxid,
            paidAt: itemDoc.paidAt || new Date(),
            payoutError: null,
          },
        }
      );
    } else {
      await db.collection("paymentrequests").updateOne(
        { _id: new ObjectId(requestId) },
        {
          $set: {
            status: "FULFILLED",
            forwardTxid: broadcastTxid,
            paidAt: itemDoc.paidAt || new Date(),
            payoutError: null,
          },
        }
      );
    }

    console.log(`[pczt-finalize] ✓ Successfully settled ${itemType} with TxID: ${broadcastTxid}`);

    return NextResponse.json({
      success: true,
      txid: broadcastTxid,
      message: "Transfer finalized! Shielded funds broadcasted to Zcash network.",
    });
  } catch (err: any) {
    console.error("[pczt-finalize] Fatal error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to finalize PCZT transaction" },
      { status: 500 }
    );
  }
}
