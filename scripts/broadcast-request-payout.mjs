import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFile } from "fs/promises";
import mongoose from "mongoose";
import init, {
  build_and_prove_orchard_spend,
  tree_import_state,
  tree_track_note,
  tree_append_commitments,
  tree_get_anchor,
  decode_unified_address,
} from "../crates/veilx-wallet/pkg/veilx_wallet.js";

function writeCompactSize(n) {
  if (n < 253) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 253;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 254;
  b.writeUInt32LE(n, 1);
  return b;
}

function serializeV6Transaction(params) {
  const chunks = [];

  // 1. Header: version 6 (4 bytes LE)
  const headerBuf = Buffer.alloc(4);
  headerBuf.writeUInt32LE(0x80000006, 0); // overwintered + v6
  chunks.push(headerBuf);

  // 2. VersionGroupId: 0x26e737c6 or 0xd884b698 (NU6.3)
  const vgBuf = Buffer.alloc(4);
  vgBuf.writeUInt32LE(0xd884b698, 0);
  chunks.push(vgBuf);

  // 3. ConsensusBranchId: 0x37A5165B (NU6.3 / Ironwood)
  const cbBuf = Buffer.alloc(4);
  cbBuf.writeUInt32LE(params.consensusBranchId || 0x37a5165b, 0);
  chunks.push(cbBuf);

  // 4. LockTime: 4 bytes LE
  const ltBuf = Buffer.alloc(4);
  ltBuf.writeUInt32LE(params.lockTime || 0, 0);
  chunks.push(ltBuf);

  // 5. ExpiryHeight: 4 bytes LE
  const expBuf = Buffer.alloc(4);
  expBuf.writeUInt32LE(params.expiryHeight, 0);
  chunks.push(expBuf);

  // 6. Transparent inputs count (0)
  chunks.push(writeCompactSize(0));
  // 7. Transparent outputs count (0)
  chunks.push(writeCompactSize(0));
  // 8. Sapling spends (0)
  chunks.push(writeCompactSize(0));
  // 9. Sapling outputs (0)
  chunks.push(writeCompactSize(0));
  // 10. Orchard actions (0)
  chunks.push(writeCompactSize(0));

  // 11. Ironwood actions count
  chunks.push(writeCompactSize(params.actions.length));

  // 10. Actions (820 bytes each)
  for (const act of params.actions) {
    chunks.push(Buffer.from(act.cv_net_hex, "hex"));
    chunks.push(Buffer.from(act.nullifier_hex, "hex"));
    chunks.push(Buffer.from(act.rk_hex, "hex"));
    chunks.push(Buffer.from(act.cmx_hex, "hex"));
    chunks.push(Buffer.from(act.epk_hex, "hex"));
    chunks.push(Buffer.from(act.enc_ciphertext_hex, "hex"));
    chunks.push(Buffer.from(act.out_ciphertext_hex, "hex"));
  }

  // 11. Flags: 1 byte
  chunks.push(Buffer.from([params.flags]));

  // 12. ValueBalance: 8 bytes i64 LE
  const valBuf = Buffer.alloc(8);
  valBuf.writeBigInt64LE(BigInt(params.valueBalanceZat), 0);
  chunks.push(valBuf);

  // 13. Anchor: 32 bytes wire format (tree_get_anchor returns canonical Pallas field bytes)
  chunks.push(Buffer.from(params.anchorHex, "hex"));

  // 14. Proof: compactSize length + proof bytes
  const proofBuf = Buffer.from(params.proofHex, "hex");
  chunks.push(writeCompactSize(proofBuf.length));
  chunks.push(proofBuf);

  // 15. SpendAuthSigs: 64 bytes per action
  for (const sig of params.spendAuthSigsHex) {
    chunks.push(Buffer.from(sig, "hex"));
  }

  // 16. BindingSig: 64 bytes
  chunks.push(Buffer.from(params.bindingSigHex, "hex"));

  return Buffer.concat(chunks).toString("hex");
}

const rpcUrl = process.env.ZALLET_RPC_URL;

async function callRpc(method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

async function main() {
  console.log("===============================================================================");
  console.log("  VeilX Autonomous Shielded Payout Engine: Live Mainnet Disbursement");
  console.log("===============================================================================\n");

  // 1. Load Wasm
  const wasmBuffer = await readFile(new URL("../crates/veilx-wallet/pkg/veilx_wallet_bg.wasm", import.meta.url));
  await init(wasmBuffer);
  console.log("[1/6] ✓ WebAssembly Engine loaded successfully!");

  // 2. Fetch Payment Request from MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("Missing MONGODB_URI");
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  const request = await db.collection("paymentrequests").findOne({ _id: new mongoose.Types.ObjectId("6ad5e9c0024211345894defd") });
  if (!request) throw new Error("Payment request 6ad5e9c0024211345894defd not found in MongoDB");

  const recipientUa = request.recipientShieldedUa;
  console.log("[2/6] ✓ Payment Request Loaded:", {
    id: request._id.toString(),
    creator: request.requesterUsernameSnapshot,
    payer: request.targetUsernameSnapshot,
    amountZec: request.amountZec,
    recipientUa: recipientUa.slice(0, 30) + "...",
    status: request.status,
  });

  const decodedTarget = decode_unified_address(recipientUa);
  console.log("      Creator @_Web3Central Orchard Address Validated ✓");

  // 3. Sync Orchard Tree State at block 3523115
  console.log("\n[3/6] ✓ Syncing tree state before deposit block (Height: 3523115)...");
  const tsData = await callRpc("z_gettreestate", ["3523115"]);
  const stateHex = tsData.ironwood.commitments.finalState;

  // Parse state into left, right, parents
  const buf = Buffer.from(stateHex, "hex");
  let offset = 0;
  const hasLeft = buf[offset++] === 1;
  const left = hasLeft ? buf.subarray(offset, offset + 32).toString("hex") : null;
  if (hasLeft) offset += 32;
  const hasRight = buf[offset++] === 1;
  const right = hasRight ? buf.subarray(offset, offset + 32).toString("hex") : null;
  if (hasRight) offset += 32;
  const parentsLen = buf[offset++];
  const parents = [];
  for (let i = 0; i < parentsLen; i++) {
    const hasP = buf[offset++] === 1;
    if (hasP) {
      parents.push(buf.subarray(offset, offset + 32).toString("hex"));
      offset += 32;
    } else {
      parents.push(null);
    }
  }

  // Import into Wasm Tree Manager
  tree_import_state({
    tree: { left, right, parents },
    witnesses: {},
    checkpoints: [],
  });
  console.log("      Tree imported successfully into Wasm memory ✓");

  // 4. Append Block 3523116 commitments and track note
  console.log("\n[4/6] ✓ Appending Block 3523116 note commitments & creating witness...");
  // First leaf in block 3523116
  tree_append_commitments(["7622650d5dc719ce123624837a104db0730b15474f15f80dc861dd74a1aac304"]);

  // Our escrow vault deposit note
  const depositCmx = "bd19a0b4e58356cd9263dcc85ee5a2fffe3f49aac598a2a99ba89c6e44970a20";
  tree_append_commitments([depositCmx]);
  tree_track_note(depositCmx);
  console.log(`      Tracked note commitment ${depositCmx.slice(0, 16)}... ✓`);

  // Remaining 6 commitments in block 3523116
  const remainingBlockLeaves = [
    "2977966e7b15741f0754f3dd877d780330b50ac20063659b6d205ba1486f0d17",
    "7108a8bb056cce3e4885308e7b4c8dcec6ad8b824c562e55981e7fffcd7e2b0e",
    "a0b51c345958baf396270035c95299b04a28e3332893b383b5a0aa02a9973c38",
    "3da04fded4480022dbd5495a09c4b8f42b103b859ea4b55a92df0cba1e324c2a",
    "5d163314911b65bb3288340b0e251cf7eac924e927e90e961e1ae81f8d33bf0b",
    "6d18fbddc1df916e25cce971276dc1622bd5983122715d0fca70b5738067d631",
  ];
  tree_append_commitments(remainingBlockLeaves);

  const blockAnchor = tree_get_anchor();
  console.log(`      Tree Anchor computed: ${blockAnchor}`);
  const expectedBlockAnchor = "83078912df63f79a9f9cf802e567acc8e61bd007212997da1cdd8163d92f5716";
  console.log(`      Matches On-Chain Block 3523116 Anchor? ${blockAnchor === expectedBlockAnchor} ✓`);
  if (blockAnchor !== expectedBlockAnchor) {
    throw new Error(`Anchor mismatch: computed ${blockAnchor}, expected ${expectedBlockAnchor}`);
  }

  // 5. Build and Prove Orchard Spend
  console.log("\n[5/6] ✓ Generating Halo 2 Zero-Knowledge Proof for Payout...");
  const blockchainInfo = await callRpc("getblockchaininfo");
  const currentHeight = blockchainInfo.blocks;
  const expiryHeight = currentHeight + 20;

  // Calculation:
  // Deposit Note: 12,000 zatoshis (0.00012 ZEC)
  // Miner Fee: 10,000 zatoshis (0.00010 ZEC standard ZIP-317)
  // Payout to @_Web3Central: 2,000 zatoshis (0.00002 ZEC)
  // Net Value Balance: +10,000 zatoshis (funds leaving shielded pool to miner fee)
  const payoutAmount = 2000n;
  const memoText = "VeilX Escrow Payout: Request 6ad5e9c0024211345894defd";

  const spendStartTime = Date.now();
  const spendBundle = build_and_prove_orchard_spend({
    spends: [
      {
        spending_key_hex: process.env.ESCROW_PLATFORM_SPENDING_KEY,
        recipient_raw_address_hex: "72886297e3dbaa3b65878814b7d1c4ccadd5fe5dfcf1d7ff9774790044d4fa58f9cd9abbd58232a28a429b",
        value_zatoshis: 12000n,
        rho_hex: "51dcb077f229347291bc9ed267fc8c732507ed59a8acee02bace023d3969a025",
        rseed_hex: "25d7d8df3ceed2061065ee3f8cbe4956d7148d3a46c49b44ea08254cc1b79c4d",
        cmx_hex: depositCmx,
        auth_path_hex: null, // automatic witness lookup from GLOBAL_ORCHARD_TREE
        position: null,
      },
    ],
    recipient_address: recipientUa,
    amount_zatoshis: payoutAmount,
    memo: memoText,
    change_address: null,
    change_zatoshis: 0n,
    anchor_hex: blockAnchor,
    expiry_height: expiryHeight,
    consensus_branch_id: 0x37a5165b,
    lock_time: 0,
  });
  console.log(`      Halo 2 Spend Proof Created in ${Date.now() - spendStartTime}ms! ✓`);
  console.log(`      Actions Count: ${spendBundle.actions.length}`);
  console.log(`      Value Balance: ${spendBundle.value_balance_zatoshis} zatoshis (Miner fee: 10,000 zatoshis)`);

  // 6. Serialize and Broadcast via sendrawtransaction
  console.log("\n[6/6] ✓ Serializing V6 Transaction and Broadcasting to Mainnet...");
  const rawTxHex = serializeV6Transaction({
    consensusBranchId: 0x37a5165b,
    expiryHeight,
    lockTime: 0,
    actions: spendBundle.actions,
    flags: 7, // Spends enabled (1) + Outputs enabled (2) + Cross-address enabled (4) = 7
    valueBalanceZat: spendBundle.value_balance_zatoshis,
    anchorHex: blockAnchor,
    proofHex: spendBundle.proof_hex,
    spendAuthSigsHex: spendBundle.spend_auth_sigs_hex,
    bindingSigHex: spendBundle.binding_sig_hex,
  });

  console.log(`      Serialized V6 Transaction Size: ${rawTxHex.length / 2} bytes`);

  // Broadcast to Live GetBlock Mainnet Node
  try {
    const broadcastTxid = await callRpc("sendrawtransaction", [rawTxHex]);
    console.log("\n===============================================================================");
    console.log(`  🎉 TRANSACTION BROADCAST SUCCESSFUL!`);
    console.log(`  REAL ON-CHAIN TXID: ${broadcastTxid}`);
    console.log(`  BLOCKCHAIR EXPLORER: https://blockchair.com/zcash/transaction/${broadcastTxid}`);
    console.log("===============================================================================\n");

    // Update MongoDB Payment Request with the REAL on-chain broadcast txid!
    await db.collection("paymentrequests").updateOne(
      { _id: new mongoose.Types.ObjectId("6ad5e9c0024211345894defd") },
      {
        $set: {
          status: "FORWARDED",
          forwardTxid: broadcastTxid,
          payoutError: null,
          forwardedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    console.log(`✓ MongoDB Payment Request 6ad5e9c0024211345894defd updated to FORWARDED with txid ${broadcastTxid}!`);
  } catch (rpcErr) {
    console.error("sendrawtransaction response / error:", rpcErr);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
