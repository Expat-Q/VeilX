(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
import assert from "assert";
import { dbService } from "../src/lib/db-service";
import { setPayoutsHalted, isPayoutsHalted } from "../src/lib/payout-controls";
import { zallet } from "../src/lib/zcash";

// Stub node verification for test fixtures
zallet.verifyPaymentTransaction = async (params: any) => {
  if (params.txid?.startsWith("valid_test_") || params.txid?.startsWith("test_")) {
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

zallet.sendShieldedPayout = async (params: any) => {
  return {
    txid: `test_payout_txid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    isAsync: false,
  };
};

zallet.getNewEscrowAddress = async () => {
  return {
    unifiedAddress: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
    diversifierIndex: "0000000000000000000000",
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

async function runFailureSuite() {
  console.log("\n==========================================================================");
  console.log("  XTip — Failure Scenarios & Edge Cases Test Suite");
  console.log("==========================================================================\n");

  // -------------------------------------------------------------
  // Scenario 1: Emergency Payout Circuit Breaker
  // -------------------------------------------------------------
  await runTest("1. Circuit Breaker: Halts individual tip claim when active", async () => {
    try {
      setPayoutsHalted(true, "Emergency test freeze");
      assert.strictEqual(isPayoutsHalted(), true);

      const tip = await dbService.createTip({
        recipientXUserId: "cb_user_1",
        recipientUsername: "cb_target",
        amountZec: 0.1,
      });
      const tipId = tip._id ? tip._id.toString() : tip.id;
      await dbService.confirmTipFunding(tipId, "test_tx_cb_" + Date.now());

      await assert.rejects(
        async () => {
          await dbService.claimTip({
            tipId,
            recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
            claimantXUserId: "cb_user_1",
          });
        },
        (err: any) => err.message.includes("PAYOUTS_HALTED")
      );
    } finally {
      setPayoutsHalted(false);
      assert.strictEqual(isPayoutsHalted(), false);
    }
  });

  await runTest("2. Circuit Breaker: Halts batch claim-all payouts when active", async () => {
    try {
      setPayoutsHalted(true, "Batch emergency freeze");

      await assert.rejects(
        async () => {
          await dbService.claimAllTips({
            claimantXUserId: "cb_user_batch",
            recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
          });
        },
        (err: any) => err.message.includes("PAYOUTS_HALTED")
      );
    } finally {
      setPayoutsHalted(false);
    }
  });

  // -------------------------------------------------------------
  // Scenario 2: Tip Expiration (30-day lifecycle)
  // -------------------------------------------------------------
  await runTest("3. Tip Expiration: Expired tips cannot be claimed", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "expire_user_1",
      recipientUsername: "expire_target",
      amountZec: 0.25,
    });
    const tipId = tip._id ? tip._id.toString() : tip.id;
    await dbService.confirmTipFunding(tipId, "test_tx_expire_" + Date.now());

    // Artificially expire the tip in memory store / db
    const inMem = (global as any).__memoryStore?.tips?.find((t: any) => (t._id || t.id) === tipId);
    if (inMem) {
      inMem.status = "EXPIRED";
      inMem.expiredAt = new Date();
    }

    await assert.rejects(
      async () => {
        await dbService.claimTip({
          tipId,
          recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
          claimantXUserId: "expire_user_1",
        });
      },
      (err: any) => err.message.includes("TIP_EXPIRED")
    );
  });

  await runTest("4. Tip Expiration: Batch expireOldTips transitions FUNDED tips older than 30 days", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "batch_expire_user",
      recipientUsername: "batch_target",
      amountZec: 0.15,
    });
    const tipId = tip._id ? tip._id.toString() : tip.id;
    await dbService.confirmTipFunding(tipId, "test_tx_bexpire_" + Date.now());

    // Backdate createdAt to 31 days ago
    const inMem = (global as any).__memoryStore?.tips?.find((t: any) => (t._id || t.id) === tipId);
    if (inMem) {
      inMem.createdAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      inMem.expiresAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    }

    const { expiredCount } = await dbService.expireOldTips();
    assert.ok(expiredCount >= 1);

    const updatedTip = await dbService.getTipById(tipId);
    assert.strictEqual(updatedTip?.status, "EXPIRED");
  });

  // -------------------------------------------------------------
  // Scenario 3: Double Funding Replay Protection
  // -------------------------------------------------------------
  await runTest("5. Funding Anti-Replay: Prevents replaying same txid on two different tips", async () => {
    const txid = "test_tx_funding_unique_" + Date.now();
    const tip1 = await dbService.createTip({
      recipientXUserId: "replay_user_1",
      recipientUsername: "user1",
      amountZec: 0.1,
    });
    const tip2 = await dbService.createTip({
      recipientXUserId: "replay_user_2",
      recipientUsername: "user2",
      amountZec: 0.1,
    });
    const tip1Id = tip1._id ? tip1._id.toString() : tip1.id;
    const tip2Id = tip2._id ? tip2._id.toString() : tip2.id;

    await dbService.confirmTipFunding(tip1Id, txid);

    await assert.rejects(
      async () => {
        await dbService.confirmTipFunding(tip2Id, txid);
      },
      (err: any) => err.message.includes("DUPLICATE_TXID_REUSE")
    );
  });

  // -------------------------------------------------------------
  // Scenario 4: Request Rejection Authorization
  // -------------------------------------------------------------
  await runTest("6. Request Rejection: Recipient or Creator can reject a pending request", async () => {
    const req = await dbService.createRequest({
      requesterUserId: "creator_id",
      requesterUsername: "creator_user",
      targetXUserId: "target_id",
      targetUsername: "target_user",
      amountZec: 0.5,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });
    const reqId = req._id ? req._id.toString() : req.id;

    // Unauthorized third party cannot reject
    await assert.rejects(
      async () => {
        await dbService.rejectRequest({
          id: reqId,
          userXUserId: "stranger_id",
          userUsername: "stranger_user",
        });
      },
      (err: any) => err.message.includes("UNAUTHORIZED")
    );

    // Target recipient can reject
    const rejected = await dbService.rejectRequest({
      id: reqId,
      userXUserId: "target_id",
      userUsername: "target_user",
    });
    assert.strictEqual(rejected.status, "CANCELLED");

    // Once rejected/cancelled, cannot settle
    await assert.rejects(
      async () => {
        await dbService.settleRequest({
          id: reqId,
          paidTxid: "test_tx_settle_after_cancel",
        });
      },
      (err: any) => err.message.includes("REQUEST_CANNOT_BE_SETTLED")
    );
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Failure Scenarios: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runFailureSuite().catch((err) => {
  console.error("Unhandled Failure Suite Error:", err);
  process.exit(1);
});
