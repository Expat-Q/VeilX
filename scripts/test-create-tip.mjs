import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const { dbService } = await import("../src/lib/db-service.ts");

async function main() {
  console.log("=== Testing dbService.createTip() ===");
  const tip = await dbService.createTip({
    recipientXUserId: "12345678",
    recipientUsername: "TestUser",
    amountZec: 0.05,
    memo: "Phase 2 Escrow Verification",
  });

  console.log("Created tip successfully!");
  console.log("Tip ID:", tip._id || tip.id);
  console.log("Escrow Address:", tip.escrowAddress);
  console.log("Diversifier Index:", tip.diversifierIndex);

  if (!tip.escrowAddress.startsWith("u1")) {
    throw new Error(`Expected Mainnet u1 address, got: ${tip.escrowAddress}`);
  }

  console.log("✓ Phase 2 escrow address verification passed 100%!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
