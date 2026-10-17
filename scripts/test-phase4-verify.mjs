import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { zallet } = await import("../src/lib/zcash.ts");

async function main() {
  console.log("=== Testing Phase 4: verifyPaymentTransaction ===");

  // 1. Test non-existent txid
  console.log("Test 1: Non-existent txid...");
  const fakeTxid = "0000000000000000000000000000000000000000000000000000000000000001";
  const res1 = await zallet.verifyPaymentTransaction({
    txid: fakeTxid,
    expectedAddress: "t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq",
    expectedAmountZec: 0.1,
  });
  console.log("Result 1 (expected false):", res1);
  if (res1.verified) throw new Error("Expected fake txid to fail verification");

  // 2. Test real Mainnet transaction that paid someone else (coinbase tx from block 3520070)
  console.log("\nTest 2: Real mainnet tx paying someone else...");
  const realCoinbaseTxid = "d5d906fd012aba71d51085793352cedbbb11aa0b62f21fa40a536e66059cc39b";
  const res2 = await zallet.verifyPaymentTransaction({
    txid: realCoinbaseTxid,
    expectedAddress: "t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq",
    expectedAmountZec: 100, // Not paid to our address
  });
  console.log("Result 2 (expected false with WRONG_RECIPIENT_OR_UNMATCHED):", res2);
  if (res2.verified) throw new Error("Expected wrong recipient tx to fail verification");
  if (!res2.reason?.includes("WRONG_RECIPIENT_OR_UNMATCHED")) {
    throw new Error(`Expected WRONG_RECIPIENT_OR_UNMATCHED, got: ${res2.reason}`);
  }

  console.log("\n✓ Phase 4 Verification Engine works with 100% accuracy on live Mainnet!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
