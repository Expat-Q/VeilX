import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { zallet } = await import("../src/lib/zcash.ts");

async function main() {
  console.log("=== Testing GetBlock RPC getblockchaininfo ===");
  const info = await zallet.getBlockchainInfo();
  console.log("GetBlock Blockchain Info:", info);
}

main().catch(console.error);
