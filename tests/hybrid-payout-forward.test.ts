(process.env as any).NODE_ENV = "test";
import assert from "node:assert";
import { dbService } from "../src/lib/db-service";
import { zallet } from "../src/lib/zcash";

const VALID_UA = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs";

zallet.getNewEscrowAddress = async () => ({
  unifiedAddress: "u1hybridtestescrowaddress8888888888888888888888888888888888888888888888888888888888888888",
  diversifierIndex: "88",
});

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

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
  } catch (error: any) {
    console.error(`❌ [FAIL] ${name}`);
    console.error("   Error:", error.message || error);
    process.exit(1);
  }
}

async function main() {
  console.log("\n==========================================================================");
  console.log("  XTip — Hybrid Payout Engine & Forward Reconciliation Test Suite");
  console.log("==========================================================================\n");

  // 1. Settle PayLink with failing payout enters FORWARD_PENDING instead of dropping
  await runTest("1. Hybrid Policy: PayLink settlement enters FORWARD_PENDING when payout fails", async () => {
    const paylink = await dbService.createPayLink({
      creatorUsername: "creator_hybrid_1",
      title: "Invoice Hybrid Test",
      amountZec: 0.5,
      recipientShieldedUa: VALID_UA,
    });

    const origPayout = zallet.sendShieldedPayout;
    try {
      // Mock payout failure (e.g. node down or temporary out-of-sync)
      zallet.sendShieldedPayout = async () => {
        throw new Error("RPC_SIMULATED_OUTAGE: Escrow node is temporarily unreachable");
      };

      const settled = await dbService.settlePayLink({
        slug: paylink.slug,
        paidTxid: `valid_test_paylink_hybrid_${Date.now()}`,
      });

      assert.strictEqual(settled.status, "FORWARD_PENDING");
      assert(settled.payoutError?.includes("RPC_SIMULATED_OUTAGE"), "Payout error must be recorded");
      assert(settled.paidTxid, "Payer deposit txid must be preserved");
    } finally {
      zallet.sendShieldedPayout = origPayout;
    }
  });

  // 2. Creator manual retry succeeds when node recovers
  await runTest("2. Manual Fallback: Creator can manually retry payout for FORWARD_PENDING invoice", async () => {
    const paylink = await dbService.createPayLink({
      creatorUsername: "creator_hybrid_2",
      title: "Invoice Manual Retry Test",
      amountZec: 0.25,
      recipientShieldedUa: VALID_UA,
    });

    const origPayout = zallet.sendShieldedPayout;
    try {
      zallet.sendShieldedPayout = async () => {
        throw new Error("TEMPORARY_NETWORK_FAILURE");
      };

      await dbService.settlePayLink({
        slug: paylink.slug,
        paidTxid: `valid_test_paylink_manual_${Date.now()}`,
      });

      // Restore payout mock to success
      zallet.sendShieldedPayout = async () => ({
        txid: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        isAsync: false,
      });

      // Non-creator retry must fail with UNAUTHORIZED
      await assert.rejects(
        async () => {
          await dbService.retryForwardPayLink(paylink.slug, "unauthorized_imposter");
        },
        (err: any) => err.message.includes("UNAUTHORIZED")
      );

      // Creator retry must succeed
      const retryRes = await dbService.retryForwardPayLink(paylink.slug, "creator_hybrid_2");
      assert.strictEqual(retryRes?.status, "PAID");
      assert.strictEqual(retryRes?.forwardTxid, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

      const after = await dbService.getPayLinkBySlug(paylink.slug);
      assert.strictEqual(after?.status, "PAID");
      assert.strictEqual(after?.forwardTxid, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    } finally {
      zallet.sendShieldedPayout = origPayout;
    }
  });

  // 3. Request settlement enters FORWARD_PENDING and manual retry resolves to FULFILLED
  await runTest("3. Request Hybrid Payout: Enters FORWARD_PENDING on failure and resolves on retry", async () => {
    const request = await dbService.createRequest({
      requesterUsername: "requester_hybrid_3",
      targetUsername: "payer_hybrid_3",
      amountZec: 0.4,
      recipientShieldedUa: VALID_UA,
    });
    const reqId = (request._id || request.id).toString();

    const origPayout = zallet.sendShieldedPayout;
    try {
      zallet.sendShieldedPayout = async () => {
        throw new Error("RPC_OUTAGE_ON_REQUEST");
      };

      const settled = await dbService.settleRequest({
        id: reqId,
        paidTxid: `valid_test_request_hybrid_${Date.now()}`,
        payerUsername: "payer_hybrid_3",
      });

      assert.strictEqual(settled.status, "FORWARD_PENDING");
      assert(settled.payoutError?.includes("RPC_OUTAGE_ON_REQUEST"));

      // Restore payout mock
      zallet.sendShieldedPayout = async () => ({
        txid: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef",
        isAsync: false,
      });

      // Unauthorized user rejected
      await assert.rejects(
        async () => {
          await dbService.retryForwardRequest(reqId, "random_person");
        },
        (err: any) => err.message.includes("UNAUTHORIZED")
      );

      // Requester retries
      const retryRes = await dbService.retryForwardRequest(reqId, "requester_hybrid_3");
      assert.strictEqual(retryRes?.status, "FULFILLED");
      assert.strictEqual(retryRes?.forwardTxid, "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef");

      const after = await dbService.getRequestById(reqId);
      assert.strictEqual(after?.status, "FULFILLED");
      assert.strictEqual(after?.forwardTxid, "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef");
    } finally {
      zallet.sendShieldedPayout = origPayout;
    }
  });

  // 4. Background Robot reconciliation sweeps FORWARD_PENDING items
  await runTest("4. Robot Queue: reconcilePendingForwards automatically sweeps and resolves forwards", async () => {
    const link = await dbService.createPayLink({
      creatorUsername: "robot_creator",
      title: "Robot Swept Invoice",
      amountZec: 0.1,
      recipientShieldedUa: VALID_UA,
    });

    const origPayout = zallet.sendShieldedPayout;
    try {
      // Step 1: Force into FORWARD_PENDING
      zallet.sendShieldedPayout = async () => {
        throw new Error("TEMPORARY_WALLET_LOCK");
      };

      await dbService.settlePayLink({
        slug: link.slug,
        paidTxid: `valid_test_robot_link_${Date.now()}`,
      });

      const pendingCheck = await dbService.getPayLinkBySlug(link.slug);
      assert.strictEqual(pendingCheck?.status, "FORWARD_PENDING");

      // Step 2: Wallet recovers
      zallet.sendShieldedPayout = async () => ({
        txid: "9999999999999999999999999999999999999999999999999999999999999999",
        isAsync: false,
      });

      // Step 3: Run the robot worker
      const sweepResults = await dbService.reconcilePendingForwards();
      const sweptLink = sweepResults.find((r: any) => r.slug === link.slug);
      assert(sweptLink, "Link must be processed by background reconciler");
      assert.strictEqual(sweptLink.status, "PAID");

      const finalLink = await dbService.getPayLinkBySlug(link.slug);
      assert.strictEqual(finalLink?.status, "PAID");
      assert.strictEqual(finalLink?.forwardTxid, "9999999999999999999999999999999999999999999999999999999999999999");
    } finally {
      zallet.sendShieldedPayout = origPayout;
    }
  });

  // 5. Deficit Protection: Net payout caps nominal amount to actual verified amount received
  await runTest("5. Deficit Protection: Escrow payout is capped at actual amount received (HIGH-01)", async () => {
    const link = await dbService.createPayLink({
      creatorUsername: "creator_deficit",
      title: "Deficit Protection Invoice",
      amountZec: 1.0,
      recipientShieldedUa: VALID_UA,
    });

    let payoutAmountCaptured = 0;
    const origPayout = zallet.sendShieldedPayout;
    const origVerify = zallet.verifyPaymentTransaction;
    try {
      // Suppose payer paid 0.9995 ZEC (within 0.1% tolerance)
      zallet.verifyPaymentTransaction = async () => ({
        verified: true,
        actualAmountZec: 0.9995,
      });

      zallet.sendShieldedPayout = async (_addr, amount) => {
        payoutAmountCaptured = amount;
        return { txid: "1111111111111111111111111111111111111111111111111111111111111111", isAsync: false };
      };

      await dbService.settlePayLink({
        slug: link.slug,
        paidTxid: `valid_test_deficit_${Date.now()}`,
      });

      // Net payout should be 0.9995 - 0.0001 = 0.9994 ZEC, NOT 1.0 - 0.0001 = 0.9999 ZEC
      assert.strictEqual(payoutAmountCaptured, 0.9994);
    } finally {
      zallet.sendShieldedPayout = origPayout;
      zallet.verifyPaymentTransaction = origVerify;
    }
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log("Hybrid Payout Engine Tests: 5 / 5 passed (100%)");
  console.log("--------------------------------------------------------------------------\n");
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
