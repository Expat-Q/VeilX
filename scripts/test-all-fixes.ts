import assert from "assert";

async function main() {
  console.log("=== Testing All User-Reported Fixes ===\n");

  const baseUrl = "http://localhost:3000";

  // Test 1: POST /api/requests with Mainnet Unified Address (image 2 issue)
  console.log("1. Testing Request creation with real Unified Address...");
  const sampleUa = "u188unftxcy6d9azrcx50vjfn4pjc60fld9kkrdyrzp6dnx7565c52c6f37648367f08c38fa802613d";
  const reqRes = await fetch(`${baseUrl}/api/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetXUserId: "14829116086462",
      targetUsername: "expatq23",
      amountZec: "0.05",
      memo: "Invoice for frontend design commission",
      recipientShieldedUa: sampleUa,
    }),
  });
  const reqData = await reqRes.json();
  console.log("Request creation response:", reqData);
  assert.strictEqual(reqRes.ok, true, "Request creation should succeed with 200");
  assert.strictEqual(reqData.success, true, "Response should have success: true");
  assert.ok(reqData.request, "Response should contain created request");
  console.log("✅ Request link created successfully!\n");

  // Test 2: POST /api/paylinks with Mainnet Unified Address
  console.log("2. Testing PayLink creation with real Unified Address...");
  const paylinkRes = await fetch(`${baseUrl}/api/paylinks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Design Services Commission",
      amountZec: "0.25",
      recipientShieldedUa: sampleUa,
    }),
  });
  const paylinkData = await paylinkRes.json();
  console.log("PayLink creation response:", paylinkData);
  assert.strictEqual(paylinkRes.ok, true, "PayLink creation should succeed with 200");
  assert.strictEqual(paylinkData.success, true, "Response should have success: true");
  assert.ok(paylinkData.paylink?.slug, "Response should contain paylink slug");
  console.log("✅ PayLink created successfully!\n");

  // Test 3: Swap Quote & Settle (preventing SWAP_ORDER_NOT_FOUND)
  console.log("3. Testing Cross-Chain Swap Quote and Settlement...");
  const quoteRes = await fetch(`${baseUrl}/api/swaps/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromTokenId: "usdc-base",
      zecAmount: 0.05,
      targetZecAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
      zecPriceUsd: 52.5,
    }),
  });
  const quoteData = await quoteRes.json();
  console.log("Swap Quote response:", quoteData);
  assert.strictEqual(quoteRes.ok, true);
  assert.ok(quoteData.order?.orderId);

  // Now settle the order
  const settleRes = await fetch(`${baseUrl}/api/swaps/${quoteData.order.orderId}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      zecTxid: "0xmock_settle_tx_hash_12345",
    }),
  });
  const settleData = await settleRes.json();
  console.log("Swap Settle response:", settleData);
  assert.strictEqual(settleRes.ok, true);
  assert.strictEqual(settleData.success, true);
  assert.notStrictEqual(settleData.error, "SWAP_ORDER_NOT_FOUND");
  console.log("✅ Cross-chain swap settled without SWAP_ORDER_NOT_FOUND!\n");

  // Test 4: Settle an un-cached / unknown order ID (graceful recovery)
  console.log("4. Testing recovery on arbitrary / cold order ID...");
  const coldRes = await fetch(`${baseUrl}/api/swaps/ord_arbitrary_cold_test_999/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      zecTxid: "0xmock_settle_cold_123",
    }),
  });
  const coldData = await coldRes.json();
  console.log("Cold settle response:", coldData);
  assert.strictEqual(coldRes.ok, true);
  assert.strictEqual(coldData.success, true);
  console.log("✅ Cold order recovery succeeded gracefully!\n");

  console.log("=========================================");
  console.log("🎉 ALL USER-REPORTED FIXES VERIFIED 100%!");
  console.log("=========================================");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
