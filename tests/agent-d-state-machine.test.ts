(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
import assert from "assert";
import { Tip } from "../src/models/Tip";
import { PaymentLink } from "../src/models/PaymentLink";
import { PaymentRequest } from "../src/models/PaymentRequest";
import { dbService } from "../src/lib/db-service";

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
  console.log("  VeilX Agent D — Database, Idempotency & State Machine Verification Suite");
  console.log("==========================================================================\n");

  // 1. DB-01 Schema Index Verification
  await runTest("1. DB-01: Tip schema defines unique sparse indexes on claimTxid & fundingTxid", async () => {
    const paths = (Tip.schema as any).paths;
    assert.strictEqual(paths.fundingTxid.options.unique, true, "fundingTxid must be unique");
    assert.strictEqual(paths.fundingTxid.options.sparse, true, "fundingTxid must be sparse");
    assert.strictEqual(paths.claimTxid.options.unique, true, "claimTxid must be unique");
    assert.strictEqual(paths.claimTxid.options.sparse, true, "claimTxid must be sparse");
  });

  await runTest("2. DB-01: PaymentLink schema defines forwardTxid (unique, sparse) and paidTxid (sparse)", async () => {
    const paths = (PaymentLink.schema as any).paths;
    assert.strictEqual(paths.forwardTxid.options.unique, true, "forwardTxid must be unique");
    assert.strictEqual(paths.forwardTxid.options.sparse, true, "forwardTxid must be sparse");
    assert.strictEqual(paths.paidTxid.options.sparse, true, "paidTxid must be sparse");
  });

  await runTest("3. DB-01: PaymentRequest schema defines forwardTxid (unique, sparse) and paidTxid (sparse)", async () => {
    const paths = (PaymentRequest.schema as any).paths;
    assert.strictEqual(paths.forwardTxid.options.unique, true, "forwardTxid must be unique");
    assert.strictEqual(paths.forwardTxid.options.sparse, true, "forwardTxid must be sparse");
    assert.strictEqual(paths.paidTxid.options.sparse, true, "paidTxid must be sparse");
  });

  // 2. DB-02 Atomic CAS Claim Transition
  await runTest("4. DB-02: transitionTipToClaiming executes atomic CAS { status: 'FUNDED' } -> { status: 'CLAIMING', claimAttemptAt }", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "cas_user_1",
      recipientUsername: "alice",
      amountZec: 0.5,
    });
    const tipId = (tip._id || tip.id).toString();

    // Rejects if not FUNDED (currently CREATED)
    await assert.rejects(
      async () => {
        await dbService.transitionTipToClaiming(tipId);
      },
      (err: any) => err.message.includes("CONCURRENT_CLAIM_PREVENTED") || err.message.includes("status is 'CREATED'")
    );

    // Promote to FUNDED
    await dbService.promoteTipToFunded(tipId, "valid_test_funding_" + Date.now());

    // Atomic CAS transition
    const claiming = await dbService.transitionTipToClaiming(tipId, { claimantXUserId: "cas_user_1" });
    assert.strictEqual(claiming.status, "CLAIMING");
    assert.ok(claiming.claimAttemptAt, "claimAttemptAt timestamp must be recorded");

    // Second concurrent call fails with conflict
    await assert.rejects(
      async () => {
        await dbService.transitionTipToClaiming(tipId);
      },
      (err: any) => err.message.includes("TIP_CLAIM_IN_PROGRESS") || err.message.includes("CONCURRENT_CLAIM_PREVENTED")
    );
  });

  // 3. DB-03 Settlement Finalization
  await runTest("5. DB-03: finalizeSettlement sets status: 'SETTLED', stores genuine txid, clears errors", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "settle_user_1",
      recipientUsername: "bob",
      amountZec: 0.25,
    });
    const tipId = (tip._id || tip.id).toString();
    await dbService.promoteTipToFunded(tipId, "valid_test_funding_settle_" + Date.now());
    await dbService.transitionTipToClaiming(tipId);

    const genuineTxid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const settled = await dbService.finalizeSettlement(tipId, "tip", genuineTxid);

    assert.strictEqual(settled.status, "SETTLED");
    assert.strictEqual(settled.claimTxid, genuineTxid);
    assert.ok(settled.claimedAt, "claimedAt timestamp must be recorded");

    // Duplicate txid reuse must be rejected across items
    const tip2 = await dbService.createTip({
      recipientXUserId: "settle_user_2",
      recipientUsername: "charlie",
      amountZec: 0.1,
    });
    const tip2Id = (tip2._id || tip2.id).toString();
    await dbService.promoteTipToFunded(tip2Id, "valid_test_funding_2_" + Date.now());
    await dbService.transitionTipToClaiming(tip2Id);

    await assert.rejects(
      async () => {
        await dbService.finalizeSettlement(tip2Id, "tip", genuineTxid);
      },
      (err: any) => err.message.includes("DUPLICATE_TXID_REUSE")
    );
  });

  // 4. DB-02 PayLink Forward Transition: PAID -> FORWARD_PENDING -> SETTLED
  await runTest("6. DB-02: PayLink forward transition: Atomic CAS PAID -> FORWARD_PENDING -> SETTLED", async () => {
    const paylink = await dbService.createPayLink({
      creatorUsername: "merchant",
      title: "Invoice #999",
      amountZec: 0.8,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });

    // In-memory or DB simulate payment
    const inMem = (global as any).__memoryStore?.paylinks?.find((p: any) => p.slug === paylink.slug);
    if (inMem) {
      inMem.status = "PAID";
      inMem.paidTxid = "valid_test_paid_txid_" + Date.now();
    }

    const pending = await dbService.transitionPayLinkToForwardPending(paylink.slug);
    assert.strictEqual(pending.status, "FORWARD_PENDING");
    assert.ok(pending.forwardAttemptAt, "forwardAttemptAt must be recorded");

    // Finalize to SETTLED
    const forwardTxid = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const settled = await dbService.finalizeSettlement(paylink.slug, "paylink", forwardTxid);
    assert.strictEqual(settled.status, "SETTLED");
    assert.strictEqual(settled.forwardTxid, forwardTxid);
  });

  // 5. DB-02 PaymentRequest Forward Transition: FULFILLED -> FORWARD_PENDING -> SETTLED
  await runTest("7. DB-02: PaymentRequest forward transition: Atomic CAS FULFILLED -> FORWARD_PENDING -> SETTLED", async () => {
    const request = await dbService.createRequest({
      requesterUsername: "dave",
      targetUsername: "eve",
      amountZec: 0.3,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });
    const reqId = (request._id || request.id).toString();

    // Simulate fulfillment
    const inMem = (global as any).__memoryStore?.requests?.find((r: any) => (r._id || r.id) === reqId);
    if (inMem) {
      inMem.status = "FULFILLED";
      inMem.paidTxid = "valid_test_req_paid_" + Date.now();
    }

    const pending = await dbService.transitionRequestToForwardPending(reqId);
    assert.strictEqual(pending.status, "FORWARD_PENDING");
    assert.ok(pending.forwardAttemptAt, "forwardAttemptAt must be recorded");

    // Finalize to SETTLED
    const forwardTxid = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";
    const settled = await dbService.finalizeSettlement(reqId, "request", forwardTxid);
    assert.strictEqual(settled.status, "SETTLED");
    assert.strictEqual(settled.forwardTxid, forwardTxid);
  });

  // 6. DB-04 Auto-Recovery Sweeper
  await runTest("8. DB-04: recoverOrphanedSettlements reverts abandoned CLAIMING and FORWARD_PENDING items older than 5 minutes", async () => {
    // 1. Stuck Tip
    const stuckTip = await dbService.createTip({
      recipientXUserId: "sweeper_user",
      recipientUsername: "frank",
      amountZec: 0.2,
    });
    const stuckTipId = (stuckTip._id || stuckTip.id).toString();
    await dbService.promoteTipToFunded(stuckTipId, "valid_test_funding_sweeper_" + Date.now());
    await dbService.transitionTipToClaiming(stuckTipId);

    // Backdate claimAttemptAt to 6 minutes ago
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    const inMemTip = (global as any).__memoryStore?.tips?.find((t: any) => (t._id || t.id) === stuckTipId);
    if (inMemTip) {
      inMemTip.claimAttemptAt = sixMinutesAgo;
      inMemTip.payoutSubmittedAt = sixMinutesAgo;
    }

    // 2. Stuck PayLink
    const stuckLink = await dbService.createPayLink({
      creatorUsername: "sweeper_merchant",
      title: "Stuck Invoice",
      amountZec: 0.4,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });
    const inMemLink = (global as any).__memoryStore?.paylinks?.find((p: any) => p.slug === stuckLink.slug);
    if (inMemLink) {
      inMemLink.status = "PAID";
    }
    await dbService.transitionPayLinkToForwardPending(stuckLink.slug);
    if (inMemLink) {
      inMemLink.forwardAttemptAt = sixMinutesAgo;
    }

    // Run recovery
    const recoveryResult = await dbService.recoverOrphanedSettlements(5 * 60 * 1000);
    assert.ok(recoveryResult.recoveredTips >= 1, "Must recover orphaned tip");
    assert.ok(recoveryResult.recoveredPaylinks >= 1, "Must recover orphaned paylink");

    // Verify tip reverted to FUNDED
    const recoveredTip = await dbService.getTipById(stuckTipId);
    assert.strictEqual(recoveredTip?.status, "FUNDED", "Stuck tip must be reverted to FUNDED");

    // Verify paylink reverted to PAID
    const recoveredLink = await dbService.getPayLinkBySlug(stuckLink.slug);
    assert.strictEqual(recoveredLink?.status, "PAID", "Stuck paylink must be reverted to PAID");
  });

  console.log("--------------------------------------------------------------------------");
  console.log(`Agent D State Machine Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failure:", err);
  process.exit(1);
});
