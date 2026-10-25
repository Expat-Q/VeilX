import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { zallet, getNetworkConfig } from "../src/lib/zcash";
import { getWasmEngine } from "../src/lib/escrow/ufvk-watcher";

async function main() {
  console.log("=== Testing Option A: Pure Shielded V6 Ironwood Outflow ===");

  const wasm = await getWasmEngine();
  if (!wasm) {
    throw new Error("Failed to load Wasm engine");
  }
  console.log("1. Wasm engine loaded successfully.");

  const recipientAddress = "u188unftxcy6d9azrcx50vjfn4pjc60fld9kkrdyrzp6dnx75t79xwfcc8nyw69r8huaw3uja2qtget4m9u25hlz5az94uajd6fjpa6z4rxp2r6w0sqea2607hsdem964u7g28435cnfsc4cdcr9cc450eg8n5qmu3s0hj0tq79yc85gqn";
  
  // Live anchor from blockchain
  const liveAnchor = await zallet.getLiveOrchardAnchor();
  console.log("2. Live Ironwood anchor from GetBlock:", liveAnchor);

  const blockInfo = await zallet.getBlockchainInfo().catch(() => ({ blocks: 3529900 }));
  console.log("3. Current block height:", blockInfo.blocks);

  const privHex = "1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a";
  const dummyUtxo = [{
    txid: "99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa",
    vout: 0,
    amount_zatoshis: BigInt(20000), // 0.0002 ZEC
  }];

  const payoutZats = 10000n; // 20000 - 10000 fee
  const branchId = getNetworkConfig().consensusBranchId; // 0x37a5165b

  console.log("4. Building and signing V6 Ironwood shielding transaction via Wasm...");
  const signed = wasm.build_and_sign_transaction({
    private_key_hex: privHex,
    utxos: dummyUtxo,
    to_address: recipientAddress,
    amount_zatoshis: payoutZats,
    current_block_height: blockInfo.blocks,
    consensus_branch_id: branchId,
    anchor_hex: liveAnchor,
  });

  console.log("5. Signed Transaction Output:");
  console.log("   TxID:", signed.txid);
  console.log("   Fee (zats):", signed.fee_zatoshis);
  console.log("   Branch ID: 0x" + signed.branch_id.toString(16));
  console.log("   Raw hex length:", signed.raw_hex.length, "chars (" + signed.raw_hex.length / 2 + " bytes)");

  // Inspect raw hex bytes
  const raw = Buffer.from(signed.raw_hex, "hex");
  const version = raw.readUInt32LE(0);
  const versionGroup = raw.readUInt32LE(4);
  const consensusBranch = raw.readUInt32LE(8);
  console.log("6. Inspecting transaction header:");
  console.log("   Version: 0x" + version.toString(16), "(Expected 0x80000006)");
  console.log("   Version Group: 0x" + versionGroup.toString(16), "(Expected 0xd884b698)");
  console.log("   Branch ID: 0x" + consensusBranch.toString(16), "(Expected 0x37a5165b)");

  // Check transparent inputs and outputs
  let offset = 20;
  const nInputs = raw[offset++];
  console.log("   Transparent Inputs:", nInputs);
  offset += 36; // txid + vout
  const scriptLen = raw[offset++];
  offset += scriptLen + 4; // script + sequence

  const nOutputs = raw[offset++];
  console.log("   Transparent Outputs:", nOutputs, "(MUST BE 0)");

  const nSaplingSpends = raw[offset++];
  const nSaplingOutputs = raw[offset++];
  console.log("   Sapling Spends:", nSaplingSpends, "Outputs:", nSaplingOutputs);

  const nOrchardActions = raw[offset++];
  console.log("   Orchard Actions:", nOrchardActions, "(Expected 0 in V6)");

  const nIronwoodActions = raw[offset++];
  console.log("   Ironwood Actions:", nIronwoodActions, "(Expected 2: 1 real + 1 dummy)");

  offset += nIronwoodActions * 820; // 2 * 820
  const flags = raw[offset++];
  console.log("   Ironwood Flags: 0x" + flags.toString(16), "(Expected 0x02 = SPENDS_DISABLED)");

  const valBal = raw.readBigInt64LE(offset);
  offset += 8;
  console.log("   Ironwood Value Balance:", valBal.toString(), "zats (Expected -10000)");

  const anchorHex = raw.subarray(offset, offset + 32).toString("hex");
  offset += 32;
  console.log("   Ironwood Anchor:", anchorHex);
  console.log("   Matches live anchor?", anchorHex === liveAnchor);

  if (version === 0x80000006 && nOutputs === 0 && nIronwoodActions === 2 && flags === 0x02 && valBal === -10000n && anchorHex === liveAnchor) {
    console.log("\n>>> SUCCESS: OPTION A PURE SHIELDED V6 IRONWOOD OUTFLOW VERIFIED 100%! <<<");
  } else {
    throw new Error("Verification failed: wire format did not match expected invariants");
  }
}

main().catch(console.error);
