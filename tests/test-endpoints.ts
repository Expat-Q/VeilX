import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { ZalletClient } from "../src/lib/zcash";

async function runDiagnostics() {
  console.log("=================================================");
  console.log("  Live Zcash Node Connectivity Test              ");
  console.log("=================================================\n");

  // 1. GetBlock Test
  console.log("1. Testing GetBlock Endpoint...");
  try {
    const res = await fetch("https://shared.eu-central-1.getblock.io/e73b4962668a4b4e9f75e4c2c8fe06d2/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "getblock-test",
        method: "getblockchaininfo",
        params: [],
      }),
    });
    console.log(`   HTTP Status: ${res.status}`);
    const data = await res.json();
    if (data.result) {
      console.log("   ✅ [GETBLOCK CONNECTED]");
      console.log(`      • Chain:                 ${data.result.chain}`);
      console.log(`      • Current Block Height:  ${data.result.blocks}`);
      console.log(`      • Verification Progress: ${(data.result.verificationprogress * 100).toFixed(2)}%`);
      console.log(`      • Best Block Hash:       ${data.result.bestblockhash.slice(0, 24)}...`);
    } else {
      console.log("   Response Error:", data.error);
    }
  } catch (err: any) {
    console.error("   ❌ GetBlock Error:", err.message);
  }

  // 2. NOWNodes Test
  console.log("\n2. Testing NOWNodes Endpoint...");
  try {
    const res2 = await fetch("https://zec.nownodes.io", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": "251231d5-d115-4624-9130-6cff51c998a8",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nownodes-test",
        method: "getblockchaininfo",
        params: [],
      }),
    });
    console.log(`   HTTP Status: ${res2.status}`);
    const data2 = await res2.json();
    if (data2.result) {
      console.log("   ✅ [NOWNODES CONNECTED]");
      console.log(`      • Chain:                 ${data2.result.chain}`);
      console.log(`      • Current Block Height:  ${data2.result.blocks}`);
      console.log(`      • Verification Progress: ${(data2.result.verificationprogress * 100).toFixed(2)}%`);
    } else {
      console.log("   Response Error:", data2.error);
    }
  } catch (err: any) {
    console.error("   ❌ NOWNodes Error:", err.message);
  }

  // 3. ZalletClient Class Integration Test
  console.log("\n3. Testing XTip ZalletClient Class Instance...");
  try {
    const client = new ZalletClient();
    const info = await client.call("getblockchaininfo");
    if (info) {
      console.log("   ✅ [ZALLET CLIENT CONNECTED VIA ENV]");
      console.log(`      • Active URL:            ${process.env.ZALLET_RPC_URL}`);
      console.log(`      • Chain:                 ${info.chain}`);
      console.log(`      • Height:                ${info.blocks}`);
    }
  } catch (err: any) {
    console.error("   ❌ ZalletClient Error:", err.message);
  }

  console.log("\n=================================================\n");
}

runDiagnostics();

