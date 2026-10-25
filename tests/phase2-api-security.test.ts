(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
import assert from "assert";
import { dbService } from "../src/lib/db-service";
import { GET as getTips, POST as createTip } from "../src/app/api/tips/route";
import { GET as getRequest } from "../src/app/api/requests/[id]/route";
import { GET as getPaylink } from "../src/app/api/paylinks/[slug]/route";
import { NextRequest } from "next/server";
import { zallet } from "../src/lib/zcash";

// Stubs for test fixtures
zallet.verifyPaymentTransaction = async (params: any) => {
  if (params.txid?.startsWith("sim_tx_") || params.txid?.startsWith("valid_test_") || params.txid?.startsWith("test_")) {
    return {
      verified: true,
      actualAmountZec: params.expectedAmountZec,
      confirmations: 1,
    };
  }
  return {
    verified: false,
    reason: "TRANSACTION_NOT_FOUND_OR_UNVERIFIED: Could not verify transaction on Zcash node.",
  };
};

let passed = 0;
let total = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  total++;
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    passed++;
    return true;
  } catch (error: any) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(`   Error: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log("\n==========================================================================");
  console.log("  XTip — Phase 2 API Security & Privacy Verification Suite");
  console.log("==========================================================================\n");

  const VALID_DEST_ADDR = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs";

  // 1. Anti-Scraping: GET /api/tips returns empty list for unauthenticated callers
  await runTest("1. Privacy: GET /api/tips returns empty list for unauthenticated guests", async () => {
    const req = new NextRequest("http://localhost:3000/api/tips");
    const res = await getTips(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.deepStrictEqual(data.tips, [], "Unauthenticated visitor must receive empty array, not global database tips");
  });

  // 2. Input Validation: POST /api/tips rejects NaN and Infinity amounts
  await runTest("2. Input Validation: POST /api/tips rejects NaN, Infinity, and invalid amounts", async () => {
    // Test NaN
    const reqNaN = new NextRequest("http://localhost:3000/api/tips", {
      method: "POST",
      body: JSON.stringify({ recipientUsername: "bob", amountZec: "not_a_number" }),
    });
    const resNaN = await createTip(reqNaN);
    assert.strictEqual(resNaN.status, 400);

    // Test Infinity
    const reqInf = new NextRequest("http://localhost:3000/api/tips", {
      method: "POST",
      body: JSON.stringify({ recipientUsername: "bob", amountZec: "Infinity" }),
    });
    const resInf = await createTip(reqInf);
    assert.strictEqual(resInf.status, 400);

    // Test sub-minimum amount (< 0.0001)
    const reqSmall = new NextRequest("http://localhost:3000/api/tips", {
      method: "POST",
      body: JSON.stringify({ recipientUsername: "bob", amountZec: 0.00001 }),
    });
    const resSmall = await createTip(reqSmall);
    assert.strictEqual(resSmall.status, 400);
  });

  // 3. IDOR Redaction: GET /api/requests/[id] redacts private recipientShieldedUa for non-owners
  await runTest("3. IDOR / Privacy: GET /api/requests/[id] redacts private recipientShieldedUa", async () => {
    const testReq = await dbService.createRequest({
      requesterUsername: "private_alice",
      targetUsername: "bob",
      amountZec: 1.0,
      recipientShieldedUa: VALID_DEST_ADDR,
      memo: "Confidential Consulting Invoice",
    });
    const reqId = (testReq._id || testReq.id).toString();

    // Call route as an unauthenticated guest
    const req = new NextRequest(`http://localhost:3000/api/requests/${reqId}`);
    const res = await getRequest(req, { params: { id: reqId } });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert(data.request, "Request data must be returned");
    assert.strictEqual(data.request.recipientShieldedUa, undefined, "Private recipientShieldedUa must be redacted for non-owners");
    assert.strictEqual(data.request.amountZec, 1.0);
    assert.strictEqual(data.request.memo, "Confidential Consulting Invoice");
  });

  // 4. Missing Resource: GET /api/requests/[id] returns 404 for nonexistent id
  await runTest("4. Protocol Integrity: GET /api/requests/[id] returns 404 for nonexistent id", async () => {
    const req = new NextRequest("http://localhost:3000/api/requests/nonexistent_id_999");
    const res = await getRequest(req, { params: { id: "nonexistent_id_999" } });
    const data = await res.json();

    assert.strictEqual(res.status, 404);
    assert.strictEqual(data.success, false);
  });

  // 5. Missing Resource: GET /api/paylinks/[slug] returns 404 for nonexistent slug
  await runTest("5. Protocol Integrity: GET /api/paylinks/[slug] returns 404 for nonexistent slug", async () => {
    const req = new NextRequest("http://localhost:3000/api/paylinks/nonexistent_slug_999");
    const res = await getPaylink(req, { params: { slug: "nonexistent_slug_999" } });
    const data = await res.json();

    assert.strictEqual(res.status, 404);
    assert.strictEqual(data.success, false);
  });

  // 6. 30-Day Tip Expiration Sweeper
  await runTest("6. Lifecycle: expireOldTips transitions expired tips to EXPIRED", async () => {
    const oldTip = await dbService.createTip({
      recipientXUserId: "expire_target_p2",
      recipientUsername: "expire_target_p2",
      amountZec: 0.25,
    });
    const tipId = (oldTip._id || oldTip.id).toString();
    await dbService.confirmTipFunding(tipId, `valid_test_expire_p2_${Date.now()}`);

    // Artificially age the tip to 31 days ago
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const inMem = (await dbService.getTipById(tipId)) as any;
    inMem.expiresAt = thirtyOneDaysAgo;

    const expireRes = await dbService.expireOldTips();
    assert(expireRes.expiredCount >= 1, "At least one tip should be expired");

    const checked = (await dbService.getTipById(tipId)) as any;
    assert.strictEqual(checked.status, "EXPIRED", "Stale tip must transition to EXPIRED");
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Phase 2 Verification Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal test runner error:", e);
  process.exit(1);
});
