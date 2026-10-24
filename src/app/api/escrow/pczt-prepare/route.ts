import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  zalletClient,
  validateZcashAddress,
  ZCASH_NETWORK,
  ALLOW_PAYMENT_SIMULATION,
  addressToP2pkhScriptHex,
  extractRawOrchardAddressHex,
} from "@/lib/zcash";
import { deriveTipEscrowKeypair } from "@/lib/escrow/tip-escrow-keys";
import { getWasmEngine } from "@/lib/escrow/ufvk-watcher";
import { connectToDatabase } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ShieldingPcztParams } from "@/types/pczt";
import { PcztPrepareResponse } from "@/types/api-contracts";
import crypto from "crypto";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tipId, paylinkSlug, requestId, destinationAddress: rawDest } = body;

    if (!tipId && !paylinkSlug && !requestId) {
      return NextResponse.json<PcztPrepareResponse>(
        { success: false, error: "Item reference (tipId, paylinkSlug, or requestId) is required" },
        { status: 400 }
      );
    }

    const wasm = await getWasmEngine();
    const mongooseConn = await connectToDatabase();
    const db = mongooseConn.connection.db!;

    let itemType: "tip" | "paylink" | "request" = "tip";
    let itemId = "";
    let fundingTxid = "";
    let itemExpectedAmount = 0;
    let memoText = "";
    let destinationAddress = rawDest?.trim() || "";
    let escrowAddress = "";

    // 1. Identify and authenticate item
    if (tipId) {
      itemType = "tip";
      itemId = tipId;

      const user = await getCurrentUser();
      if (!user || !user.xUserId) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Authentication required to claim tips." },
          { status: 401 }
        );
      }

      if (!destinationAddress) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Destination Zcash address is required" },
          { status: 400 }
        );
      }

      const tip = await db.collection("tips").findOne({ _id: new ObjectId(tipId) });
      if (!tip) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Tip not found" },
          { status: 404 }
        );
      }

      if (tip.status !== "FUNDED") {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: `Tip is in status '${tip.status}' and cannot be claimed.` },
          { status: 400 }
        );
      }

      const isRecipient =
        (tip.recipientXUserId && tip.recipientXUserId === user.xUserId) ||
        (tip.recipientUsername && tip.recipientUsername.toLowerCase() === user.xUsername?.toLowerCase());
      if (!isRecipient) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Unauthorized: You do not own this tip." },
          { status: 403 }
        );
      }

      if (!tip.fundingTxid) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Tip is missing funding transaction record." },
          { status: 400 }
        );
      }

      fundingTxid = tip.fundingTxid;
      itemExpectedAmount = tip.amountZec;
      memoText = tip.memo || `VeilX Shielded Tip Claim #${tipId}`;

      // Deterministic per-tip escrow address
      const escrowKey = deriveTipEscrowKeypair(tipId);
      escrowAddress = tip.transparentDepositAddress || tip.escrowDepositAddress || escrowKey.address;
    } else if (paylinkSlug) {
      itemType = "paylink";
      itemId = paylinkSlug;

      const paylink = await db.collection("paymentlinks").findOne({ slug: paylinkSlug });
      if (!paylink) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "PayLink not found" },
          { status: 404 }
        );
      }

      if (!paylink.paidTxid && !paylink.fundingTxid) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "PayLink has not received a confirmed transaction yet." },
          { status: 400 }
        );
      }

      destinationAddress = destinationAddress || paylink.recipientShieldedUa;
      if (destinationAddress !== paylink.recipientShieldedUa) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Destination address must match the merchant payout address." },
          { status: 403 }
        );
      }

      fundingTxid = paylink.paidTxid || paylink.fundingTxid;
      itemExpectedAmount = paylink.amountZec;
      memoText = `VeilX PayLink Settlement ${paylinkSlug}`;

      const escrowKey = deriveTipEscrowKeypair(paylinkSlug);
      escrowAddress = paylink.escrowDepositAddress || paylink.transparentDepositAddress || escrowKey.address;
    } else if (requestId) {
      itemType = "request";
      itemId = requestId;

      const request = await db.collection("paymentrequests").findOne({ _id: new ObjectId(requestId) });
      if (!request) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Payment request not found" },
          { status: 404 }
        );
      }

      if (!request.paidTxid && !request.fundingTxid) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Payment request has not received a confirmed transaction yet." },
          { status: 400 }
        );
      }

      destinationAddress = destinationAddress || request.recipientShieldedUa;
      if (destinationAddress !== request.recipientShieldedUa) {
        return NextResponse.json<PcztPrepareResponse>(
          { success: false, error: "Destination address must match the requester payout address." },
          { status: 403 }
        );
      }

      fundingTxid = request.paidTxid || request.fundingTxid;
      itemExpectedAmount = request.amountZec;
      memoText = `VeilX Payment Request #${requestId}`;

      const escrowKey = deriveTipEscrowKeypair(requestId);
      escrowAddress = request.escrowDepositAddress || request.transparentDepositAddress || escrowKey.address;
    }

    // 2. Validate destination address
    if (!validateZcashAddress(destinationAddress, ZCASH_NETWORK)) {
      return NextResponse.json<PcztPrepareResponse>(
        { success: false, error: `Invalid Zcash address for network '${ZCASH_NETWORK}'` },
        { status: 400 }
      );
    }

    // 3. Extract raw 43-byte Orchard address (86 hex chars) from destinationAddress
    let recipientRawOrchardHex = "";
    try {
      recipientRawOrchardHex = await extractRawOrchardAddressHex(destinationAddress, wasm);
    } catch (addrErr: any) {
      return NextResponse.json<PcztPrepareResponse>(
        { success: false, error: addrErr.message || "Destination address must contain an Orchard shielded receiver." },
        { status: 400 }
      );
    }

    if (!recipientRawOrchardHex || recipientRawOrchardHex.length !== 86) {
      return NextResponse.json<PcztPrepareResponse>(
        { success: false, error: "Destination address must contain a valid 43-byte Orchard shielded receiver." },
        { status: 400 }
      );
    }

    // 4. Discover the transparent escrow UTXO (t1_tip_xxx)
    // Note: Do NOT attempt trial-decryption or note commitment tree witness computation for transparent UTXOs!
    let foundUtxo: ShieldingPcztParams["transparentUtxo"] | null = null;
    let expectedScriptHex = "";
    try {
      expectedScriptHex = addressToP2pkhScriptHex(escrowAddress);
    } catch {
      // ignore
    }

    // Strategy A: Query funding transaction outputs via getrawtransaction
    if (fundingTxid) {
      try {
        const rawTx = await zalletClient.call<any>("getrawtransaction", [fundingTxid.trim(), 1]);
        if (rawTx && Array.isArray(rawTx.vout)) {
          for (let i = 0; i < rawTx.vout.length; i++) {
            const out = rawTx.vout[i];
            const addresses: string[] = [];
            if (Array.isArray(out.scriptPubKey?.addresses)) {
              addresses.push(...out.scriptPubKey.addresses);
            }
            if (typeof out.scriptPubKey?.address === "string") {
              addresses.push(out.scriptPubKey.address);
            }

            const scriptHex = out.scriptPubKey?.hex || "";
            const isMatch =
              addresses.includes(escrowAddress) ||
              (expectedScriptHex && scriptHex === expectedScriptHex);

            if (isMatch) {
              foundUtxo = {
                txid: fundingTxid.trim(),
                vout: typeof out.n === "number" ? out.n : i,
                amountZats: Math.round((out.value || 0) * 1e8),
                scriptPubKeyHex: scriptHex || expectedScriptHex,
                escrowAddress,
              };
              break;
            }
          }
        }
      } catch (err: any) {
        console.warn(`[pczt-prepare] getrawtransaction query failed for ${fundingTxid}:`, err?.message);
      }
    }

    // Strategy B: Query UTXOs for escrowAddress via getaddressutxos
    if (!foundUtxo && escrowAddress) {
      try {
        const utxos = await zalletClient.call<any[]>("getaddressutxos", [{ addresses: [escrowAddress] }]);
        if (Array.isArray(utxos) && utxos.length > 0) {
          // Select UTXO matching fundingTxid or first unspent
          const matched = fundingTxid
            ? utxos.find((u) => u.txid === fundingTxid.trim()) || utxos[0]
            : utxos[0];
          if (matched) {
            foundUtxo = {
              txid: matched.txid,
              vout: matched.outputIndex,
              amountZats: Number(matched.satoshis),
              scriptPubKeyHex: matched.script || expectedScriptHex,
              escrowAddress,
            };
          }
        }
      } catch (err: any) {
        // Node might not have address index enabled (-addressindex=1)
      }
    }

    // Strategy C: Simulation / Sandbox Mode fallback
    if (!foundUtxo && ALLOW_PAYMENT_SIMULATION) {
      foundUtxo = {
        txid: fundingTxid || `sim_tx_${crypto.randomBytes(28).toString("hex")}`,
        vout: 0,
        amountZats: Math.round(itemExpectedAmount * 1e8),
        scriptPubKeyHex: expectedScriptHex || addressToP2pkhScriptHex(escrowAddress),
        escrowAddress,
      };
    }

    if (!foundUtxo) {
      return NextResponse.json<PcztPrepareResponse>(
        {
          success: false,
          error: `Could not find confirmed transparent UTXO for escrow address ${escrowAddress}. Please ensure the funding transaction has confirmed on-chain.`,
        },
        { status: 400 }
      );
    }

    // 5. ZIP-317 Fee and Payout Value Calculation
    const feeZats = 10000; // Standard base fee: 10,000 zatoshis (0.0001 ZEC)
    const payoutValueZats = foundUtxo.amountZats - feeZats;

    if (payoutValueZats <= 0) {
      return NextResponse.json<PcztPrepareResponse>(
        {
          success: false,
          error: `Escrow UTXO amount (${foundUtxo.amountZats} zats) is insufficient to cover the ${feeZats} zats network mining fee.`,
        },
        { status: 400 }
      );
    }

    // 6. Network Height & Expiry
    const chainInfo = await zalletClient.getBlockchainInfo().catch(() => ({ blocks: 3520000 }));
    const expiryHeight = chainInfo.blocks + 50;

    // 7. Format 512-byte memo into 1024 hex characters
    const memoBuf = Buffer.alloc(512);
    memoBuf.write(memoText, 0, "utf8");
    const memoHex = memoBuf.toString("hex");

    // 8. Construct ShieldingPcztParams
    // Empty tree anchor: 64 zeros (Anchor::empty_tree() under ZIP-225 / Orchard spec)
    const pcztParams: ShieldingPcztParams = {
      itemType,
      itemId,
      transparentUtxo: foundUtxo,
      payoutValueZats,
      feeZats,
      recipientRawOrchardHex,
      memoHex,
      expiryHeight,
      network: ZCASH_NETWORK === "testnet" ? "testnet" : "mainnet",
    };

    return NextResponse.json<PcztPrepareResponse>({
      success: true,
      pcztParams,
    });
  } catch (err: any) {
    console.error("[pczt-prepare] Fatal error:", err);
    return NextResponse.json<PcztPrepareResponse>(
      { success: false, error: err.message || "Failed to prepare shielding PCZT parameters" },
      { status: 500 }
    );
  }
}
