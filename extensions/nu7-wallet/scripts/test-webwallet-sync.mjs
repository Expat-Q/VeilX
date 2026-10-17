import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import init, { WebWallet } from "../../../node_modules/zprotocol-webzjs-wallet/webzjs_wallet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../../../node_modules/zprotocol-webzjs-wallet/webzjs_wallet_bg.wasm");

console.log("Initializing WebZjs Wasm...");
const wasmBytes = fs.readFileSync(wasmPath);
await init(wasmBytes);
console.log("✓ Wasm ready");

console.log("Connecting WebWallet to https://zcash-testnet.chainsafe.dev...");
const wallet = new WebWallet("test", "https://zcash-testnet.chainsafe.dev", 1, 1);
console.log("✓ WebWallet created!");

try {
  const latestBlock = await wallet.get_latest_block();
  console.log("Current Testnet Chain Tip Height from gRPC-Web:", latestBlock.toString());
} catch (e) {
  console.log("Latest block query error:", e.message || e);
}

wallet.free();
console.log("✓ WebWallet memory freed.");
