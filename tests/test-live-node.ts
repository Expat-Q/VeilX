import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { zallet, ZCASH_NETWORK } from "../src/lib/zcash";

async function testLiveNode() {
  console.log("\n=======================================================");
  console.log("  XTip — Live Zcash Remote Node Diagnostic Tool        ");
  console.log("=======================================================\n");

  const rpcUrl = process.env.ZALLET_RPC_URL;
  const apiKey = process.env.ZALLET_RPC_API_KEY || process.env.NOWNODES_API_KEY;

  console.log(`📡 Configured Network: ${ZCASH_NETWORK}`);
  console.log(`🌐 Target Endpoint:   ${rpcUrl}`);
  console.log(`🔑 API Key Present:   ${apiKey ? "YES (Redacted)" : "NO"}\n`);

  if (!apiKey && !process.env.ZALLET_RPC_USER) {
    console.error("❌ ERROR: No API Key or RPC credentials found in .env.local");
    console.error("Please add ZALLET_RPC_API_KEY=your_key to .env.local\n");
    process.exit(1);
  }

  console.log("⏳ Connecting to live Zcash node and querying blockchain info...\n");

  try {
    const blockchainInfo = await zallet.call<any>("getblockchaininfo", []);
    console.log("✅ [SUCCESS] Connected to live Zcash node!");
    console.log(`   • Chain:                 ${blockchainInfo.chain}`);
    console.log(`   • Block Height:          ${blockchainInfo.blocks}`);
    console.log(`   • Verification Progress: ${(blockchainInfo.verificationprogress * 100).toFixed(2)}%`);
    console.log(`   • Best Block Hash:       ${blockchainInfo.bestblockhash}`);

    const networkInfo = await zallet.call<any>("getnetworkinfo", []);
    console.log(`   • Node Version:          ${networkInfo.subversion || networkInfo.version}`);
    console.log(`   • Protocol Version:      ${networkInfo.protocolversion}\n`);

    console.log("🎉 Remote Zcash Node is fully connected and ready for XTip!\n");
  } catch (error: any) {
    console.error("❌ Node Connection Failed:");
    console.error(`   ${error.message}\n`);
  }
}

testLiveNode();
