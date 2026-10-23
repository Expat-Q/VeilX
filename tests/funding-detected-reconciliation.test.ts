process.env.ALLOW_PAYMENT_SIMULATION = "true";
process.env.NODE_ENV = "test";
import assert from "node:assert";

async function run() {
  const { dbService } = await import("../src/lib/db-service");
  const memoryStore = (global as any).__memoryStore;
  assert.ok(memoryStore, "global.__memoryStore should be defined");

  console.log("==========================================================================");
  console.log("  XTip — FUNDING_DETECTED Auto-Reconciliation & 3-Min Grace Period Tests");
  console.log("==========================================================================");

  // 1. Create a tip
  const tip = await dbService.createTip({
    senderUsername: "bob",
    recipientXUserId: "test_alice_id",
    recipientUsername: "alice",
    amountZec: 0.5,
  });
  const tipId = (tip._id || tip.id).toString();

  // Test 1: Initially PENDING/CREATED
  assert.strictEqual(tip.status, "CREATED");
  console.log("✅ [PASS] 1. Tip starts in CREATED status");

  // Test 2: Manually set status to FUNDING_DETECTED with detected timestamp < 3 mins ago
  const now = Date.now();
  const inMem = memoryStore.tips.find((t: any) => (t._id || t.id).toString() === tipId);
  assert.ok(inMem, "Tip found in memoryStore");
  inMem.status = "FUNDING_DETECTED";
  inMem.fundingTxid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  inMem.updatedAt = new Date(now - 60 * 1000); // 1 minute ago

  // Check reconcilePendingTips: should remain in FUNDING_DETECTED because < 3 mins and no mined block
  const res1 = await dbService.reconcilePendingTips();
  const tipRes1 = res1.find((r) => r.tipId === tipId);
  assert.ok(tipRes1, "Tip found in reconciliation results");
  assert.strictEqual(tipRes1.status, "FUNDING_DETECTED");
  assert.strictEqual(inMem.status, "FUNDING_DETECTED");
  console.log("✅ [PASS] 2. Tip within 3-minute window remains in FUNDING_DETECTED");

  // Test 3: Set timestamp to 3.5 minutes ago (exceeding 3-minute grace period)
  inMem.updatedAt = new Date(now - 210 * 1000); // 3.5 minutes ago

  // Check reconcilePendingTips: should be promoted to FUNDED
  const res2 = await dbService.reconcilePendingTips();
  const tipRes2 = res2.find((r) => r.tipId === tipId);
  assert.ok(tipRes2, "Tip found in reconciliation results");
  assert.strictEqual(tipRes2.status, "FUNDED");
  assert.strictEqual(tipRes2.reason, "elapsed_3min_grace");
  assert.strictEqual(inMem.status, "FUNDED");
  console.log("✅ [PASS] 3. Tip exceeding 3-minute window automatically promoted to FUNDED via reconciliation");

  // Test 4: Dashboard getTips auto-promotes FUNDING_DETECTED tips >= 3 mins
  const tip2 = await dbService.createTip({
    senderUsername: "charlie",
    recipientXUserId: "test_alice_id",
    recipientUsername: "alice",
    amountZec: 0.25,
  });
  const tip2Id = (tip2._id || tip2.id).toString();
  const inMem2 = memoryStore.tips.find((t: any) => (t._id || t.id).toString() === tip2Id);
  inMem2.status = "FUNDING_DETECTED";
  inMem2.fundingTxid = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  inMem2.updatedAt = new Date(now - 240 * 1000); // 4 minutes ago

  const tipsList = await dbService.getTips("alice");
  const found2 = tipsList.find((t: any) => (t._id || t.id).toString() === tip2Id);
  assert.ok(found2, "Tip 2 found in getTips");
  assert.strictEqual(found2.status, "FUNDED", "Dashboard getTips promoted tip to FUNDED");
  console.log("✅ [PASS] 4. getTips automatically promotes stale FUNDING_DETECTED tip on dashboard read");

  console.log("\nAll FUNDING_DETECTED auto-reconciliation tests passed successfully!");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
