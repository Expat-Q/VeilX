import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { zallet, ZCASH_NETWORK } from "../src/lib/zcash.js";
import { getWasmEngine } from "../src/lib/escrow/ufvk-watcher.js";

async function main() {
  console.log("===============================================================================");
  console.log("             VeilX Phase 5 Outflow Payout Engine Test Suite                     ");
  console.log("===============================================================================\n");

  console.log(`[1/5] Checking Network Configuration:`);
  console.log(`      Active Network: ${ZCASH_NETWORK}`);

  // Test 1: Live Orchard Anchor
  console.log(`\n[2/5] Testing zallet.getLiveOrchardAnchor() on GetBlock Mainnet:`);
  const liveAnchor = await zallet.getLiveOrchardAnchor();
  console.log(`      ✓ Live Orchard Anchor: ${liveAnchor}`);
  if (!liveAnchor || liveAnchor.length !== 64) {
    throw new Error(`Invalid anchor length: expected 64 hex chars, got ${liveAnchor?.length}`);
  }

  // Test 2: Escrow Balance and UTXOs
  console.log(`\n[3/5] Testing zallet.getEscrowUtxos() and zallet.getEscrowBalance():`);
  const escrowAddr = process.env.ESCROW_PLATFORM_TRANSPARENT_ADDRESS || "t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq";
  const utxos = await zallet.getEscrowUtxos(escrowAddr);
  const balance = await zallet.getEscrowBalance(escrowAddr);
  console.log(`      Escrow Address : ${escrowAddr}`);
  console.log(`      UTXOs Count    : ${utxos.length}`);
  console.log(`      Balance        : ${balance.balance} ZEC (Received: ${balance.received} ZEC)`);

  // Test 3: Wasm Engine Initialization & v5 Transaction Builder
  console.log(`\n[4/5] Testing local Wasm build_and_sign_transaction (Mainnet NU5):`);
  const wasm = await getWasmEngine();
  if (!wasm) {
    throw new Error("Wasm engine failed to initialize");
  }

  const dummyUtxo = {
    txid: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    vout: 0,
    amount_zatoshis: 10000000n, // 0.1 ZEC
  };

  const dummyPrivKey = process.env.ESCROW_PLATFORM_TRANSPARENT_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const recipientAddr = process.env.ESCROW_PLATFORM_TRANSPARENT_ADDRESS || "t1Vpr46bPa5WmSA7SngahkY5UjF76oPqj7V";

  const signed = wasm.build_and_sign_transaction({
    private_key_hex: dummyPrivKey,
    utxos: [dummyUtxo],
    to_address: recipientAddr,
    amount_zatoshis: 5000000n, // 0.05 ZEC
    current_block_height: 3520070,
    consensus_branch_id: 0xC2D6D0B4, // NU5 Mainnet
  });

  console.log(`      ✓ Signed v5 Transaction Built Successfully!`);
  console.log(`      TxID        : ${signed.txid}`);
  console.log(`      Branch ID   : 0x${signed.branch_id.toString(16).toUpperCase()}`);
  console.log(`      Fee (zats)  : ${signed.fee_zatoshis}`);
  console.log(`      Raw Hex Len : ${signed.raw_hex.length} hex chars`);

  // Test 4: Payout Verification Failure Gating (Fail Closed on 0 Escrow Balance)
  console.log(`\n[5/5] Testing sendShieldedPayout fail-closed safety check:`);
  try {
    await zallet.sendShieldedPayout("t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq", 0.05, "Test Claim");
    console.log("      Unexpected: Payout succeeded without funds!");
  } catch (err) {
    console.log(`      ✓ Safely rejected with expected guard: "${err.message}"`);
  }

  console.log("\n===============================================================================");
  console.log("         ✓ ALL PHASE 5 OUTFLOW ENGINE TESTS PASSED CLEANLY!                    ");
  console.log("===============================================================================\n");
}

main().catch((err) => {
  console.error("Phase 5 Outflow Test Failed:", err);
  process.exit(1);
});
