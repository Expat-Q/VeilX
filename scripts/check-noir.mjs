import { readFile } from "fs/promises";
import init, {
  derive_account,
  derive_orchard_account,
  decode_unified_address,
} from "../crates/veilx-wallet/pkg/veilx_wallet.js";

async function main() {
  const wasmBuffer = await readFile(new URL("../crates/veilx-wallet/pkg/veilx_wallet_bg.wasm", import.meta.url));
  await init(wasmBuffer);

  const mnemonic = "unit cute catalog boat diary boring either prefer scorpion prison acoustic road profit believe glove permit march dog beyond clarify thumb obvious galaxy upgrade";

  const noirShielded = "u174uudp7hcd2fz2qslsmsxrh8zt34ctq9fm500lgujgujfeyy86tudjyc8p2uthyta26q4pexj04sv5j86kmur53y03wwcd4x9h588cnv06lzatytryhtdpmceuq297n6q7ptxk9ptnllmq67u9fc5djmj8uz2sas0a4ncvkx3g6a7fjz";
  const noirTransparent = "t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq";

  const orchardAccount = derive_orchard_account(mnemonic, 0, "mainnet");
  console.log("Our Orchard raw address hex:", orchardAccount.orchard_raw_address_hex);
  console.log("Our Unified address:", orchardAccount.unified_address);
  console.log("Our UFVK:", orchardAccount.unified_full_viewing_key);

  try {
    const decodedNoir = decode_unified_address(noirShielded);
    console.log("Decoded Noir UA:", decodedNoir);
  } catch (err) {
    console.log("Decode Noir error:", err);
  }

  // Let's check transparent address derivation across accounts/indices
  console.log("\n=== Checking BIP-44 Transparent Derivation ===");
  for (let acc = 0; acc < 3; acc++) {
    const derived = derive_account(mnemonic, acc, "mainnet");
    console.log(`Account ${acc}:`, derived.address, derived.address === noirTransparent ? "MATCH!" : "");
  }
}

main().catch(console.error);
