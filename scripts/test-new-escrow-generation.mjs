import { zallet, validateZcashAddress, ZCASH_NETWORK } from "../src/lib/zcash.ts";
import { validateZcashAddressFull } from "../src/lib/zcash-address.ts";
import { getWasmEngine } from "../src/lib/escrow/ufvk-watcher.js";

async function main() {
  console.log("===============================================================================");
  console.log("          Testing Direct Escrow Address Generation & Validation               ");
  console.log("===============================================================================\n");

  const wasm = await getWasmEngine();
  console.log("1. Generating 3 fresh diversified escrow addresses via zallet.getNewEscrowAddress():");

  for (let i = 1; i <= 3; i++) {
    const escrow = await zallet.getNewEscrowAddress();
    console.log(`\nAddress #${i}:`);
    console.log(`  Address          : ${escrow.unifiedAddress}`);
    console.log(`  Diversifier Index: ${escrow.diversifierIndex}`);

    // Check with validateZcashAddress
    const isValidBasic = validateZcashAddress(escrow.unifiedAddress, "mainnet");
    console.log(`  validateZcashAddress: ${isValidBasic ? "VALID ✓" : "INVALID ✗"}`);

    // Check with validateZcashAddressFull
    const fullVal = validateZcashAddressFull(escrow.unifiedAddress, "mainnet");
    console.log(`  validateZcashAddressFull: isValid=${fullVal.isValid}, type=${fullVal.type}, network=${fullVal.network}`);

    // Decode with Wasm
    try {
      const decoded = wasm.decode_unified_address(escrow.unifiedAddress);
      console.log(`  Wasm Decoded Receivers: P2PKH=${decoded.p2pkh_hex ? "Yes ✓" : "No"}, Orchard=${decoded.orchard_raw_hex ? "Yes ✓" : "No"}`);
    } catch (err) {
      console.error(`  Wasm Decode FAILED: ${err.message}`);
    }
  }

  console.log("\n===============================================================================");
}

main().catch(console.error);
