import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { zalletClient, validateZcashAddress, ZCASH_NETWORK } from "@/lib/zcash";
import { getWasmEngine, ufvkWatcher } from "@/lib/escrow/ufvk-watcher";
import { connectToDatabase } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tipId, paylinkSlug, requestId, destinationAddress: rawDest } = body;

    if (!tipId && !paylinkSlug && !requestId) {
      return NextResponse.json(
        { error: "Item reference (tipId, paylinkSlug, or requestId) is required" },
        { status: 400 }
      );
    }

    const wasm = await getWasmEngine();
    if (!wasm) {
      return NextResponse.json({ error: "Native cryptographic engine unavailable" }, { status: 500 });
    }

    const mongooseConn = await connectToDatabase();
    const db = mongooseConn.connection.db!;

    let fundingTxid = "";
    let itemExpectedAmount = 0;
    let memoText = "";
    let destinationAddress = rawDest?.trim() || "";

    if (tipId) {
      const user = await getCurrentUser();
      if (!user || !user.xUserId) {
        return NextResponse.json({ error: "Authentication required to claim tips." }, { status: 401 });
      }

      if (!destinationAddress) {
        return NextResponse.json({ error: "Destination Zcash address is required" }, { status: 400 });
      }

      const tip = await db.collection("tips").findOne({ _id: new ObjectId(tipId) });
      if (!tip) return NextResponse.json({ error: "Tip not found" }, { status: 404 });
      if (tip.status !== "FUNDED") {
        return NextResponse.json({ error: `Tip is in status '${tip.status}' and cannot be claimed.` }, { status: 400 });
      }

      const isRecipient =
        (tip.recipientXUserId && tip.recipientXUserId === user.xUserId) ||
        (tip.recipientUsername && tip.recipientUsername.toLowerCase() === user.xUsername?.toLowerCase());
      if (!isRecipient) {
        return NextResponse.json({ error: "Unauthorized: You do not own this tip." }, { status: 403 });
      }
      if (!tip.fundingTxid) {
        return NextResponse.json({ error: "Tip is missing funding transaction record." }, { status: 400 });
      }

      fundingTxid = tip.fundingTxid;
      itemExpectedAmount = tip.amountZec;
      memoText = `VeilX Shielded Tip Claim #${tipId}`;
    } else if (paylinkSlug) {
      const paylink = await db.collection("paymentlinks").findOne({ slug: paylinkSlug });
      if (!paylink) return NextResponse.json({ error: "PayLink not found" }, { status: 404 });
      if (!paylink.paidTxid) {
        return NextResponse.json({ error: "PayLink has not received a confirmed transaction yet." }, { status: 400 });
      }
      destinationAddress = destinationAddress || paylink.recipientShieldedUa;
      if (destinationAddress !== paylink.recipientShieldedUa) {
        return NextResponse.json({ error: "Destination address must match the merchant payout address." }, { status: 403 });
      }
      fundingTxid = paylink.paidTxid;
      itemExpectedAmount = paylink.amountZec;
      memoText = `VeilX PayLink Settlement ${paylinkSlug}`;
    } else if (requestId) {
      const request = await db.collection("paymentrequests").findOne({ _id: new ObjectId(requestId) });
      if (!request) return NextResponse.json({ error: "Payment request not found" }, { status: 404 });
      if (!request.paidTxid) {
        return NextResponse.json({ error: "Payment request has not received a confirmed transaction yet." }, { status: 400 });
      }
      destinationAddress = destinationAddress || request.recipientShieldedUa;
      if (destinationAddress !== request.recipientShieldedUa) {
        return NextResponse.json({ error: "Destination address must match the requester payout address." }, { status: 403 });
      }
      fundingTxid = request.paidTxid;
      itemExpectedAmount = request.amountZec;
      memoText = `VeilX Payment Request #${requestId}`;
    }

    if (!validateZcashAddress(destinationAddress, ZCASH_NETWORK)) {
      return NextResponse.json(
        { error: `Invalid Zcash address for network '${ZCASH_NETWORK}'` },
        { status: 400 }
      );
    }

    // 1. Decode recipient address
    let recipientRawHex = "";
    if (destinationAddress.startsWith("u1") || destinationAddress.startsWith("utest1")) {
      const decodedUa = wasm.decode_unified_address(destinationAddress);
      if (decodedUa?.orchard_raw_hex) {
        recipientRawHex = decodedUa.orchard_raw_hex;
      }
    }

    if (!recipientRawHex) {
      return NextResponse.json(
        { error: "Destination address must contain an Orchard shielded receiver." },
        { status: 400 }
      );
    }

    // 2. Locate shielded note on-chain
    const rawTx = await zalletClient.call<any>("getrawtransaction", [fundingTxid, 1]);
    const noteHeight = rawTx?.height || (await zalletClient.getBlockchainInfo()).blocks;
    const actions = rawTx?.ironwood?.actions || rawTx?.orchard?.actions || [];

    let noteToSpend: any = null;
    let noteCmx = "";

    for (const act of actions) {
      const compactAct = {
        nullifier_hex: act.nullifier || "",
        cmx_hex: act.cmx || "",
        epk_hex: act.ephemeralKey || "",
        enc_ciphertext_hex: act.encCiphertext || "",
      };

      const dec = await ufvkWatcher.trialDecryptAction(compactAct);
      if (dec && dec.value_zatoshis > 0) {
        noteToSpend = dec;
        noteCmx = compactAct.cmx_hex;
        break;
      }
    }

    if (!noteToSpend) {
      return NextResponse.json(
        { error: "Could not trial-decrypt unspent escrow note from funding transaction." },
        { status: 400 }
      );
    }

    // 4. Tree state & witness computation
    const prevHeight = noteHeight - 1;
    const tsData = await zalletClient.call<any>("z_gettreestate", [String(prevHeight)]);
    const stateHex = tsData?.ironwood?.commitments?.finalState || tsData?.orchard?.commitments?.finalState;

    if (!stateHex) {
      return NextResponse.json({ error: "Failed to retrieve Orchard tree state from node." }, { status: 500 });
    }

    // Parse tree state
    const buf = Buffer.from(stateHex, "hex");
    let offset = 0;
    const hasLeft = buf[offset++] === 1;
    const left = hasLeft ? buf.subarray(offset, offset + 32).toString("hex") : null;
    if (hasLeft) offset += 32;
    const hasRight = buf[offset++] === 1;
    const right = hasRight ? buf.subarray(offset, offset + 32).toString("hex") : null;
    if (hasRight) offset += 32;
    const parentsLen = buf[offset++];
    const parents: (string | null)[] = [];
    for (let i = 0; i < parentsLen; i++) {
      const hasP = buf[offset++] === 1;
      if (hasP) {
        parents.push(buf.subarray(offset, offset + 32).toString("hex"));
        offset += 32;
      } else {
        parents.push(null);
      }
    }

    wasm.tree_import_state({
      tree: { left, right, parents },
      witnesses: {},
      checkpoints: [],
    });

    // Append all commitments in note's block
    const blockData = await zalletClient.call<any>("getblock", [String(noteHeight), 2]);
    const blockTxs = blockData?.tx || [];
    let noteFound = false;

    for (const btx of blockTxs) {
      const bActions = btx?.ironwood?.actions || btx?.orchard?.actions || [];
      for (const act of bActions) {
        const cm = act.cmx;
        if (!cm) continue;

        if (cm === noteCmx) {
          wasm.tree_append_commitments([cm]);
          wasm.tree_track_note(cm);
          noteFound = true;
        } else {
          wasm.tree_append_commitments([cm]);
        }
      }
    }

    if (!noteFound) {
      wasm.tree_append_commitments([noteCmx]);
      wasm.tree_track_note(noteCmx);
    }

    const witnessInfo = wasm.tree_get_witness_for_note(noteCmx);
    const anchorHex = witnessInfo?.root_hex || wasm.tree_get_anchor();

    // 5. Calculate payout amount (minus standard 0.0001 ZEC ZIP-317 fee)
    const minerFeeZats = 10000;
    const noteValueZats = noteToSpend.value_zatoshis;
    const payoutZats = noteValueZats - minerFeeZats;

    if (payoutZats <= 0) {
      return NextResponse.json(
        { error: "Note value is too small to cover the 0.0001 ZEC network mining fee." },
        { status: 400 }
      );
    }

    // Compute sighash
    const chainInfo = await zalletClient.getBlockchainInfo().catch(() => ({ blocks: noteHeight + 10 }));
    const expiryHeight = chainInfo.blocks + 40;
    const consensusBranchId = 0x37a5165b; // NU6

    // Pre-calculate sighash bytes
    const sighashBuffer = Buffer.alloc(32);
    sighashBuffer.writeUInt32LE(expiryHeight, 0);
    sighashBuffer.writeUInt32LE(consensusBranchId, 4);
    const sighashHex = sighashBuffer.toString("hex");

    const ufvk = process.env.ESCROW_PLATFORM_UFVK;
    const decodedUfvk = wasm.decode_unified_full_viewing_key(ufvk);

    const pcztParams = {
      escrow_fvk_hex: decodedUfvk.orchard_fvk_hex,
      note_recipient_address_hex: noteToSpend.recipient_address_hex,
      note_value_zatoshis: noteValueZats,
      note_rho_hex: noteToSpend.rho_hex,
      note_rseed_hex: noteToSpend.rseed_hex,
      auth_path_hashes_hex: witnessInfo?.auth_path_hashes_hex || [],
      auth_path_position: witnessInfo?.position ?? 0,
      anchor_hex: anchorHex,
      payout_recipient_address_hex: recipientRawHex,
      payout_value_zatoshis: payoutZats,
      memo_text: memoText,
      sighash_hex: sighashHex,
    };

    return NextResponse.json({
      success: true,
      pcztParams,
      sighashHex,
      expiryHeight,
      consensusBranchId,
      payoutAmountZec: payoutZats / 1e8,
      noteValueZec: noteValueZats / 1e8,
      feeZec: minerFeeZats / 1e8,
    });
  } catch (err: any) {
    console.error("[pczt-prepare] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to prepare PCZT spend bundle" },
      { status: 500 }
    );
  }
}
