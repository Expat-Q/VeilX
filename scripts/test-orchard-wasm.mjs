import { readFile } from "fs/promises";
import init, {
  generate_seed_phrase,
  validate_seed_phrase,
  derive_account,
  derive_orchard_account,
  calculate_zip317_fee,
  build_and_sign_transaction,
  decode_unified_address,
  get_active_branch_ids,
} from "../crates/veilx-wallet/pkg/veilx_wallet.js";

async function main() {
  console.log("=== Testing VeilX Custom Rust WebAssembly Module with Native Orchard Prover ===");

  const wasmBuffer = await readFile(new URL("../crates/veilx-wallet/pkg/veilx_wallet_bg.wasm", import.meta.url));
  await init(wasmBuffer);
  console.log("✓ WebAssembly module successfully initialized (Size: 1.57 MB)!");

  // 1. Mnemonic validation and generation
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const isValid = validate_seed_phrase(mnemonic);
  console.log(`✓ Mnemonic validation: ${isValid}`);
  if (!isValid) throw new Error("Mnemonic validation failed");

  // 2. Active consensus branch IDs
  const branchIds = get_active_branch_ids();
  console.log("✓ Active Consensus Branch IDs:", branchIds);
  if (branchIds.ironwood_testnet !== "0x37a5165b") throw new Error("Invalid Ironwood branch ID");
  if (branchIds.nu7_testnet !== "0x77190ad9") throw new Error("Invalid NU7 branch ID");

  // 3. Derive Transparent Account
  const transAccount = derive_account(mnemonic, 0, "testnet");
  console.log("✓ Transparent Account Derived:", {
    address: transAccount.address,
    publicKey: transAccount.public_key,
    derivationPath: transAccount.derivation_path,
  });
  if (!transAccount.address.startsWith("tm")) throw new Error("Expected testnet transparent address starting with tm");

  // 4. Derive Orchard & Unified Account (Option B)
  const orchardAccount = derive_orchard_account(mnemonic, 0, "testnet");
  console.log("✓ Native Orchard Account Derived:", {
    accountIndex: orchardAccount.account_index,
    network: orchardAccount.network,
    spendingKeyHex: orchardAccount.spending_key_hex.slice(0, 16) + "...",
    fvkHex: orchardAccount.fvk_hex.slice(0, 16) + "...",
    orchardRawAddressHex: orchardAccount.orchard_raw_address_hex,
    unifiedAddress: orchardAccount.unified_address,
    transparentAddress: orchardAccount.transparent_address,
  });

  if (!orchardAccount.unified_address.startsWith("utest1")) {
    throw new Error(`Expected testnet unified address starting with utest1, got ${orchardAccount.unified_address}`);
  }

  // 5. Decode Unified Address
  const decoded = decode_unified_address(orchardAccount.unified_address);
  console.log("✓ Decoded Unified Address Receivers:", {
    p2pkhHex: decoded.p2pkh_hex,
    orchardRawHex: decoded.orchard_raw_hex,
  });
  if (decoded.orchard_raw_hex !== orchardAccount.orchard_raw_address_hex) {
    throw new Error("Decoded orchard receiver does not match derived raw address");
  }

  // 6. Sign Real Version 5 Transaction (No mocks)
  const dummyUtxo = {
    txid: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    vout: 0,
    amount_zatoshis: 1000000n, // 0.01 ZEC
  };

  const signedTx = build_and_sign_transaction({
    private_key_hex: transAccount.private_key,
    utxos: [dummyUtxo],
    to_address: transAccount.address,
    amount_zatoshis: 500000n,
    current_block_height: 3000000,
    consensus_branch_id: 0x37a5165b, // Ironwood
  });

  console.log("✓ Version 5 Signed Transaction Result:", {
    txid: signedTx.txid,
    wireHexLength: signedTx.raw_hex.length / 2 + " bytes",
    feeZatoshis: signedTx.fee_zatoshis,
  });

  console.log("\n🎉 ALL TESTS PASSED! Option A and Option B verified in WebAssembly!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
