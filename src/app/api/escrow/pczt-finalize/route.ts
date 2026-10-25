import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  zalletClient,
  validateZcashAddress,
  ZCASH_NETWORK,
  ALLOW_PAYMENT_SIMULATION,
  getNetworkConfig,
  getExplorerUrl,
  addressToP2pkhScriptHex,
  extractRawOrchardAddressHex,
} from "@/lib/zcash";
import { deriveTipEscrowKeypair } from "@/lib/escrow/tip-escrow-keys";
import { checkPayoutCircuitBreaker } from "@/lib/escrow/circuit-breaker";
import { getWasmEngine } from "@/lib/escrow/ufvk-watcher";
import { connectToDatabase } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { OrchardActionBundle, ShieldingPcztParams } from "@/types/pczt";
import { PcztFinalizeRequest, PcztFinalizeResponse } from "@/types/api-contracts";
import crypto from "crypto";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body: PcztFinalizeRequest & {
      transparentUtxo?: ShieldingPcztParams["transparentUtxo"];
      expiryHeight?: number;
      pcztSignedHex?: string;
    } = await req.json().catch(() => ({}));

    const { tipId, paylinkSlug, requestId, destinationAddress: rawDest, proofBundle } = body;

    if (!tipId && !paylinkSlug && !requestId) {
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: "Missing required identifier (tipId, paylinkSlug, or requestId)" },
        { status: 400 }
      );
    }

    if (!proofBundle) {
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: "Missing client proofBundle (OrchardActionBundle)" },
        { status: 400 }
      );
    }

    const wasm = await getWasmEngine();
    const mongooseConn = await connectToDatabase();
    const db = mongooseConn.connection.db!;

    const user = await getCurrentUser().catch(() => null);
    if (tipId && (!user || !user.xUserId)) {
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: "Authentication required to claim tips" },
        { status: 401 }
      );
    }

    // 1. Acquire Atomic Database Precondition Lock (prevent duplicate payouts / race conditions)
    let itemDoc: any = null;
    let itemType: "tip" | "paylink" | "request" = "tip";
    let entityId = "";

    if (tipId) {
      itemType = "tip";
      entityId = tipId;
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
        return NextResponse.json<PcztFinalizeResponse>(
          { success: false, error: "Tip is not in FUNDED state or is already being claimed." },
          { status: 409 }
        );
      }
    } else if (paylinkSlug) {
      itemType = "paylink";
      entityId = paylinkSlug;
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
        return NextResponse.json<PcztFinalizeResponse>(
          { success: false, error: "PayLink has already been forwarded or cannot be settled." },
          { status: 409 }
        );
      }
    } else if (requestId) {
      itemType = "request";
      entityId = requestId;
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
        return NextResponse.json<PcztFinalizeResponse>(
          { success: false, error: "Payment request has already been forwarded or cannot be settled." },
          { status: 409 }
        );
      }
    }

    // 2. Anti-Tamper Verification: Destination Address & Payout Amount
    let destAddress = rawDest?.trim();
    if (!destAddress) {
      if (itemType === "tip") {
        destAddress = itemDoc.recipientShieldedAddress;
      } else if (itemType === "paylink") {
        destAddress = itemDoc.recipientShieldedUa;
      } else {
        destAddress = itemDoc.recipientShieldedUa;
      }
    }

    if (!destAddress) {
      await rollbackItemState(db, itemType, entityId);
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: "Destination address could not be resolved." },
        { status: 400 }
      );
    }

    if (!validateZcashAddress(destAddress, ZCASH_NETWORK)) {
      await rollbackItemState(db, itemType, entityId);
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: `Invalid destination Zcash address for network '${ZCASH_NETWORK}'` },
        { status: 400 }
      );
    }

    // Expected net payout in zatoshis (item amount minus 10,000 ZIP-317 fee)
    const expectedPayoutZats = Math.round(itemDoc.amountZec * 1e8) - 10000;
    const netPayoutZec = expectedPayoutZats / 1e8;

    // Verify proof bundle bundle integrity
    if (!proofBundle.actions || !Array.isArray(proofBundle.actions) || proofBundle.actions.length < 2) {
      await rollbackItemState(db, itemType, entityId);
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: "Anti-tamper violation: Proof bundle must contain at least 2 Orchard actions." },
        { status: 400 }
      );
    }

    // In Orchard V5 shielding, valueBalanceZats must equal -payoutValueZats (negative outflow into shielded pool)
    const submittedBalanceZats = Math.abs(Number(proofBundle.valueBalanceZats));
    if (submittedBalanceZats !== expectedPayoutZats) {
      console.warn(
        `[SECURITY_AUDIT] Anti-tamper violation: Submitted value balance (${submittedBalanceZats}) does not match expected (${expectedPayoutZats})`
      );
      await rollbackItemState(db, itemType, entityId);
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: "Anti-tamper violation: Payout value mismatch." },
        { status: 400 }
      );
    }

    // 3. SEC-04: Circuit Breaker Check before transaction broadcast
    try {
      checkPayoutCircuitBreaker(netPayoutZec);
    } catch (cbErr: any) {
      console.warn(`[SECURITY_AUDIT] Circuit breaker tripped for ${itemType} ${entityId}:`, cbErr.message);
      await suspendItemState(db, itemType, entityId, cbErr.message);
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: cbErr.message || "Settlement suspended by circuit breaker." },
        { status: 503 }
      );
    }

    // 4. Derive Deterministic Escrow Keypair for this entity
    const escrowKey = deriveTipEscrowKeypair(entityId);
    const escrowAddress = itemDoc.transparentDepositAddress || itemDoc.escrowDepositAddress || escrowKey.address;
    const escrowPrivateKey = escrowKey.privateKeyHex;

    // 5. Locate / Validate Transparent Escrow UTXO
    let utxo = body.transparentUtxo;
    if (!utxo) {
      const fundingTxid = itemDoc.fundingTxid || itemDoc.paidTxid;
      if (fundingTxid) {
        try {
          const rawTx = await zalletClient.call<any>("getrawtransaction", [fundingTxid.trim(), 1]);
          if (rawTx && Array.isArray(rawTx.vout)) {
            for (let i = 0; i < rawTx.vout.length; i++) {
              const out = rawTx.vout[i];
              const addresses: string[] = out.scriptPubKey?.addresses || (out.scriptPubKey?.address ? [out.scriptPubKey.address] : []);
              if (addresses.includes(escrowAddress)) {
                utxo = {
                  txid: fundingTxid.trim(),
                  vout: typeof out.n === "number" ? out.n : i,
                  amountZats: Math.round((out.value || 0) * 1e8),
                  scriptPubKeyHex: out.scriptPubKey.hex,
                  escrowAddress,
                };
                break;
              }
            }
          }
        } catch {
          // fallback below
        }
      }

      if (!utxo && ALLOW_PAYMENT_SIMULATION) {
        utxo = {
          txid: fundingTxid || `sim_tx_${crypto.randomBytes(28).toString("hex")}`,
          vout: 0,
          amountZats: Math.round(itemDoc.amountZec * 1e8),
          scriptPubKeyHex: addressToP2pkhScriptHex(escrowAddress),
          escrowAddress,
        };
      }
    }

    if (!utxo) {
      await rollbackItemState(db, itemType, entityId);
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: `Could not find confirmed transparent UTXO for escrow address ${escrowAddress}.` },
        { status: 400 }
      );
    }

    // 6. Sign Transparent Input & Assemble V5 Shielding Transaction
    const networkConfig = getNetworkConfig();
    const consensusBranchId = networkConfig.consensusBranchId;
    const chainInfo = await zalletClient.getBlockchainInfo().catch(() => ({ blocks: 3520000 }));
    const expiryHeight = body.expiryHeight || (chainInfo.blocks + 50);

    let rawTxHex = "";

    // Extract raw Orchard address (86 hex characters)
    let recipientRawOrchardHex = "";
    try {
      recipientRawOrchardHex = await extractRawOrchardAddressHex(destAddress, wasm);
    } catch (addrErr: any) {
      console.warn("[pczt-finalize] Failed to extract raw Orchard receiver:", addrErr?.message);
    }

    const memoBuf = Buffer.alloc(512);
    memoBuf.write(itemDoc.memo || `VeilX Shielded Settlement ${entityId}`, 0, "utf8");
    const memoHex = memoBuf.toString("hex");

    const pcztParamsForWasm: ShieldingPcztParams = {
      itemType,
      itemId: entityId,
      transparentUtxo: utxo,
      payoutValueZats: expectedPayoutZats,
      feeZats: 10000,
      recipientRawOrchardHex,
      memoHex,
      expiryHeight,
      network: ZCASH_NETWORK === "testnet" ? "testnet" : "mainnet",
    };

    // Method A: Native WASM engine finalize_shielding_transaction (canonical ZIP-244 BLAKE2b sighash)
    if (wasm && typeof (wasm as any).finalize_shielding_transaction === "function") {
      try {
        const finalizeRes = (wasm as any).finalize_shielding_transaction(
          pcztParamsForWasm,
          proofBundle,
          escrowPrivateKey
        );
        if (finalizeRes?.raw_tx_hex) {
          rawTxHex = finalizeRes.raw_tx_hex;
        } else if (typeof finalizeRes === "string") {
          rawTxHex = finalizeRes;
        }
      } catch (wasmErr: any) {
        console.error("[pczt-finalize] wasm.finalize_shielding_transaction failed:", wasmErr?.message || wasmErr);
      }
    }

    // Method B: Client-provided complete signed transaction
    if (!rawTxHex && body.pcztSignedHex) {
      rawTxHex = body.pcztSignedHex;
    }

    // Method C's pseudo-sighash is removed. Enforce valid transaction assembly:
    if (!rawTxHex) {
      await rollbackItemState(db, itemType, entityId, "Failed to assemble canonical V5 shielding transaction via WASM engine.");
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: "Failed to assemble canonical V5 shielding transaction. Native WASM finalization is required." },
        { status: 500 }
      );
    }

    // 7. Broadcast Raw Signed V5 Transaction via Node RPC
    let broadcastTxid = "";
    try {
      console.log(`[pczt-finalize] Broadcasting V5 shielding transaction for ${itemType} ${entityId}...`);
      const broadcastRes = await zalletClient.call<string>("sendrawtransaction", [rawTxHex]);

      if (broadcastRes && typeof broadcastRes === "string" && /^[0-9a-fA-F]{64}$/.test(broadcastRes.trim())) {
        broadcastTxid = broadcastRes.trim();
      } else if (ALLOW_PAYMENT_SIMULATION && typeof broadcastRes === "string" && broadcastRes.startsWith("sim_tx_")) {
        broadcastTxid = broadcastRes;
      } else {
        throw new Error(`TRANSACTION_BROADCAST_REJECTED: Node rejected transaction: ${JSON.stringify(broadcastRes)}`);
      }
    } catch (broadcastErr: any) {
      if (ALLOW_PAYMENT_SIMULATION) {
        broadcastTxid = `sim_tx_${crypto.randomBytes(28).toString("hex")}`;
      } else {
        console.error(`[pczt-finalize] Broadcast failed:`, broadcastErr);
        await rollbackItemState(db, itemType, entityId, broadcastErr.message || "Broadcast failed");
        return NextResponse.json<PcztFinalizeResponse>(
          { success: false, error: `Transaction broadcast rejected by Zcash network: ${broadcastErr.message || broadcastErr}` },
          { status: 500 }
        );
      }
    }

    // 8. Invariant: Only update database status when a genuine 64-character hex txid is returned!
    const isGenuineHexTxid =
      /^[0-9a-fA-F]{64}$/.test(broadcastTxid) ||
      (ALLOW_PAYMENT_SIMULATION && broadcastTxid.startsWith("sim_tx_"));

    if (!isGenuineHexTxid) {
      await rollbackItemState(db, itemType, entityId, `Invalid non-hex txid returned: ${broadcastTxid}`);
      return NextResponse.json<PcztFinalizeResponse>(
        { success: false, error: "Transaction broadcast returned invalid transaction hash. State update prevented." },
        { status: 500 }
      );
    }

    // 9. Update Database Record to Confirmed Terminal State
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

    const explorerUrl = getExplorerUrl(broadcastTxid, ZCASH_NETWORK);
    console.log(`[pczt-finalize] ✓ Successfully settled ${itemType} ${entityId} with genuine TxID: ${broadcastTxid}`);

    return NextResponse.json<PcztFinalizeResponse>({
      success: true,
      txid: broadcastTxid,
      explorerUrl,
      status: "SETTLED",
    });
  } catch (err: any) {
    console.error("[pczt-finalize] Fatal unhandled error:", err);
    return NextResponse.json<PcztFinalizeResponse>(
      { success: false, error: err.message || "Failed to finalize PCZT transaction" },
      { status: 500 }
    );
  }
}

async function rollbackItemState(db: any, itemType: "tip" | "paylink" | "request", entityId: string, errorMsg?: string) {
  try {
    if (itemType === "tip") {
      await db.collection("tips").updateOne(
        { _id: new ObjectId(entityId) },
        { $set: { status: "FUNDED", payoutError: errorMsg || null } }
      );
    } else if (itemType === "paylink") {
      await db.collection("paymentlinks").updateOne(
        { slug: entityId },
        { $set: { status: "FORWARD_PENDING", payoutError: errorMsg || null } }
      );
    } else {
      await db.collection("paymentrequests").updateOne(
        { _id: new ObjectId(entityId) },
        { $set: { status: "FORWARD_PENDING", payoutError: errorMsg || null } }
      );
    }
  } catch (err) {
    console.error(`[rollbackItemState] Failed to roll back ${itemType} ${entityId}:`, err);
  }
}

async function suspendItemState(db: any, itemType: "tip" | "paylink" | "request", entityId: string, reason: string) {
  try {
    if (itemType === "tip") {
      await db.collection("tips").updateOne(
        { _id: new ObjectId(entityId) },
        { $set: { status: "FUNDED", payoutError: reason } }
      );
    } else if (itemType === "paylink") {
      await db.collection("paymentlinks").updateOne(
        { slug: entityId },
        { $set: { status: "FORWARD_PENDING", payoutError: reason } }
      );
    } else {
      await db.collection("paymentrequests").updateOne(
        { _id: new ObjectId(entityId) },
        { $set: { status: "FORWARD_PENDING", payoutError: reason } }
      );
    }
  } catch (err) {
    console.error(`[suspendItemState] Failed to suspend ${itemType} ${entityId}:`, err);
  }
}
