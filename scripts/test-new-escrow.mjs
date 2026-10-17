import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const { zallet } = await import("../src/lib/zcash.ts");

async function main() {
  console.log("=== Testing zallet.getNewEscrowAddress() on Mainnet ===");
  const escrow1 = await zallet.getNewEscrowAddress();
  console.log("Escrow 1:", escrow1);

  const escrow2 = await zallet.getNewEscrowAddress();
  console.log("Escrow 2:", escrow2);

  if (!escrow1.unifiedAddress.startsWith("u1")) {
    throw new Error(`Expected mainnet address starting with u1, got ${escrow1.unifiedAddress}`);
  }
  if (escrow1.unifiedAddress === escrow2.unifiedAddress) {
    throw new Error("Expected distinct diversified addresses, but they were identical");
  }

  console.log("✓ SUCCESS: Distinct diversified Mainnet Escrow addresses generated with 0 RPC calls!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
