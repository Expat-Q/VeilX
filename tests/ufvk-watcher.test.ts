import assert from "assert";
import { ufvkWatcher, UFVKWatcherService } from "../src/lib/escrow/ufvk-watcher";
import { readFile } from "fs/promises";
import path from "path";

async function runUfvkWatcherTests() {
  console.log("===============================================================================");
  console.log("  VeilX Escrow Backend: Event-Driven UFVK Watcher Test Suite (Phase 5)");
  console.log("===============================================================================\n");

  const wasmPath = path.resolve(process.cwd(), "crates/veilx-wallet/pkg/veilx_wallet_bg.wasm");
  const jsPath = path.resolve(process.cwd(), "crates/veilx-wallet/pkg/veilx_wallet.js");

  const wasmModule = await import(`file://${jsPath.replace(/\\/g, "/")}`);
  const wasmBuffer = await readFile(wasmPath);
  await wasmModule.default(wasmBuffer);
  console.log("[1/4] ✓ Wasm engine loaded in test runner");

  // Step 1: Derive account and UFVK
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const account = wasmModule.derive_orchard_account(mnemonic, 0, "testnet");
  console.log(`[2/4] ✓ Account UFVK derived: ${account.unified_full_viewing_key.slice(0, 32)}...`);

  const watcher = new UFVKWatcherService();
  const ok = await watcher.setPlatformUFVK(account.unified_full_viewing_key);
  assert.strictEqual(ok, true, "Platform UFVK registration must succeed");
  assert.strictEqual(watcher.getPlatformUFVK(), account.unified_full_viewing_key);
  assert.ok(watcher.getOrchardFvkHex()?.length === 192, "Orchard FVK hex should be 96 bytes (192 hex chars)");
  console.log("      Platform UFVK registered with Orchard FVK extracted ✓");

  // Step 2: Build a real shielded deposit bundle using Halo 2
  console.log("\n[3/4] ✓ Proving an Orchard deposit bundle with recipient matching the UFVK...");
  const depositAmount = 500000n; // 0.005 ZEC
  const memoText = "VeilX Escrow Order #9912";
  const anchor = wasmModule.tree_get_anchor();
  const sighash = "55".repeat(32);

  const bundle = wasmModule.build_and_prove_orchard_bundle({
    spending_key_hex: account.spending_key_hex,
    recipient_address: account.unified_address,
    amount_zatoshis: depositAmount,
    memo: memoText,
    anchor_hex: anchor,
    sighash_hex: sighash,
  });

  assert.ok(bundle.actions.length >= 2, "Bundle must have at least 2 actions");
  console.log(`      Halo 2 bundle created (${bundle.actions.length} actions, ${bundle.proof_hex.length / 2} bytes proof)`);

  // Step 3: Verify the deposit via UFVK Watcher (zero spending keys)
  console.log("\n[4/4] ✓ Testing event-driven watch-only payment verification...");
  let verified = false;

  for (const act of bundle.actions) {
    const res = await watcher.verifyPayment({
      txid: "44".repeat(32),
      expectedAmountZec: 0.005,
      expectedMemo: "Order #9912",
      action: act,
    });

    if (res.verified) {
      verified = true;
      assert.strictEqual(res.actualAmountZec, 0.005);
      assert.strictEqual(res.decryptedNote?.memo_text, memoText);
      console.log(`      ✓ Action trial-decrypted! Recipient: ${res.decryptedNote?.recipient_address_hex.slice(0, 24)}...`);
      console.log(`      ✓ Value verified: ${res.decryptedNote?.value_zatoshis} zatoshis (${res.actualAmountZec} ZEC)`);
      console.log(`      ✓ Memo verified: "${res.decryptedNote?.memo_text}"`);
      break;
    }
  }

  assert.strictEqual(verified, true, "Escrow watcher must verify note belonging to platform UFVK");

  // Test failure case: Underpaid or wrong memo
  for (const act of bundle.actions) {
    const underpaidRes = await watcher.verifyPayment({
      txid: "44".repeat(32),
      expectedAmountZec: 0.01, // Expecting 0.01 ZEC but only paid 0.005
      action: act,
    });
    if (underpaidRes.decryptedNote) {
      assert.strictEqual(underpaidRes.verified, false);
      assert.ok(underpaidRes.reason?.includes("UNDERPAID"));
      console.log(`      ✓ Underpayment successfully detected and rejected: ${underpaidRes.reason}`);
      break;
    }
  }

  console.log("\n===============================================================================");
  console.log("  🎉 ALL UFVK ESCROW WATCHER TESTS PASSED SUCCESSFULLY!");
  console.log("  - Zero server spending keys required for shielded payment detection");
  console.log("  - Halo 2 Orchard trial-decryption verified in Node.js backend");
  console.log("===============================================================================");
}

runUfvkWatcherTests().catch((err) => {
  console.error("❌ UFVK Watcher Test Failed:", err);
  process.exit(1);
});
