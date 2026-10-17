import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFile } from "fs/promises";
import init, { derive_address_from_ufvk } from "../crates/veilx-wallet/pkg/veilx_wallet.js";

async function main() {
  const wasmBuffer = await readFile(new URL("../crates/veilx-wallet/pkg/veilx_wallet_bg.wasm", import.meta.url));
  await init(wasmBuffer);

  const ufvk = process.env.ESCROW_PLATFORM_UFVK;
  console.log("Using UFVK from .env.local:", ufvk?.slice(0, 20) + "...");

  for (const di of [0, 1, 42, 999]) {
    const addr = derive_address_from_ufvk(ufvk, di, "mainnet");
    console.log(`Diversifier #${di}:`, addr);
  }
}

main().catch(console.error);
