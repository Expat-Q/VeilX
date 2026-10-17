import { readFile, writeFile } from "fs/promises";
import fs from "fs";
import path from "path";
import init, {
  generate_seed_phrase,
  derive_orchard_account,
  export_unified_full_viewing_key,
} from "../crates/veilx-wallet/pkg/veilx_wallet.js";

async function getLiveBlockHeight(rpcUrl) {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "height_check",
        method: "getblockchaininfo",
        params: [],
      }),
    });
    const data = await res.json();
    return data.result?.blocks || 3519944;
  } catch (err) {
    console.warn("Could not reach GetBlock for live height, using fallback height 3519944:", err.message);
    return 3519944;
  }
}

async function main() {
  const wasmBuffer = await readFile(new URL("../crates/veilx-wallet/pkg/veilx_wallet_bg.wasm", import.meta.url));
  await init(wasmBuffer);

  const envPath = path.resolve(".env.local");
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  // Extract GetBlock RPC URL from .env.local
  const rpcMatch = envContent.match(/ZALLET_RPC_URL=(.+)/);
  const rpcUrl = rpcMatch ? rpcMatch[1].trim() : "https://shared.eu-central-1.getblock.io/";

  // Check if user provided an existing mnemonic as CLI arg
  const inputMnemonic = process.argv.slice(2).join(" ").trim();
  const mnemonic = inputMnemonic || generate_seed_phrase(24);

  console.log("\n================================================================================");
  console.log("                  VEILX ESCROW VAULT GENERATION (MAINNET)                       ");
  console.log("================================================================================\n");

  const account = derive_orchard_account(mnemonic, 0, "mainnet");
  const ufvk = export_unified_full_viewing_key(mnemonic, 0, "mainnet");
  const birthdayHeight = await getLiveBlockHeight(rpcUrl);

  console.log("1. SECRET RECOVERY PHRASE (Write down on paper and store securely):");
  console.log("   " + mnemonic);
  console.log("\n2. PRIMARY VAULT MAINNET UNIFIED ADDRESS:");
  console.log("   " + account.unified_address);
  console.log("\n3. PLATFORM UNIFIED FULL VIEWING KEY (UFVK - Watch & Address Generation):");
  console.log("   " + ufvk);
  console.log("\n4. PLATFORM SPENDING KEY (Spend & Payout Authorization):");
  console.log("   " + account.spending_key_hex);
  console.log("\n5. ESCROW BIRTHDAY HEIGHT:");
  console.log("   " + birthdayHeight);
  console.log("\n================================================================================");

  // Check if .env.local already has the keys or update it
  let updatedEnv = envContent;
  
  const updateOrAppend = (key, value) => {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(updatedEnv)) {
      updatedEnv = updatedEnv.replace(regex, `${key}=${value}`);
    } else {
      updatedEnv += `\n${key}=${value}`;
    }
  };

  updateOrAppend("ESCROW_PLATFORM_SPENDING_KEY", account.spending_key_hex);
  updateOrAppend("ESCROW_PLATFORM_UFVK", ufvk);
  updateOrAppend("ESCROW_BIRTHDAY_HEIGHT", birthdayHeight);
  updateOrAppend("ZCASH_NETWORK", "mainnet");
  updateOrAppend("NEXT_PUBLIC_ZCASH_NETWORK", "mainnet");
  updateOrAppend("ENABLE_TESTNET_SIMULATION", "false");

  await writeFile(envPath, updatedEnv.trim() + "\n", "utf8");
  console.log("✓ Successfully configured .env.local with live Mainnet Escrow parameters!\n");
}

main().catch((err) => {
  console.error("Escrow key generation failed:", err);
  process.exit(1);
});
