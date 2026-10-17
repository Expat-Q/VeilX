import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import init, { WebWallet, UnifiedSpendingKey, generate_seed_phrase } from "../../../node_modules/zprotocol-webzjs-wallet/webzjs_wallet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../../../node_modules/zprotocol-webzjs-wallet/webzjs_wallet_bg.wasm");

console.log("Loading WebAssembly binary...");
const wasmBytes = fs.readFileSync(wasmPath);

console.log("Initializing WebZjs Wasm module...");
await init(wasmBytes);
console.log("✓ WebZjs Wasm module initialized successfully!");

console.log("Testing generate_seed_phrase():");
const phrase = generate_seed_phrase();
console.log("Generated 24-word phrase:", phrase);

console.log("Testing UnifiedSpendingKey derivation...");
const seedBytes = new Uint8Array(32);
const usk = new UnifiedSpendingKey("test", seedBytes, 0);
console.log("✓ UnifiedSpendingKey created for testnet!");

const ufvk = usk.to_unified_full_viewing_key();
const ufvkStr = ufvk.encode("test");
console.log("Derived UFVK:", ufvkStr.slice(0, 32) + "...");

const transparentAddr = ufvk.get_transparent_address("test");
console.log("Derived Transparent Address:", transparentAddr);

console.log("🎉 All Wasm primitives and key derivations functioning!");
