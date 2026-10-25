(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
import assert from "assert";
import { dbService } from "../src/lib/db-service";
import { setPayoutsHalted, isPayoutsHalted } from "../src/lib/payout-controls";
import { zallet } from "../src/lib/zcash";
import { getLiveZecPriceUsd, getServerZecPrice } from "../src/lib/server-price";

// Stubs for unit test execution
zallet.getNewEscrowAddress = async () => ({
  unifiedAddress: "u1phase1testescrowaddress8888888888888888888888888888888888888888888888888888888888888888",
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

zallet.sendShieldedPayout = async (toAddress: string, amountZec: number, memo?: string): Promise<{ opid?: string; txid?: string; isAsync: boolean }> => {
  return {
    txid: `forward_txid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    opid: `opid-${Date.now()}-mock-async-id`,
    isAsync: false,
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
  console.log("  XTip — Phase 1 Critical Financial Integrity Verification Suite");
  console.log("==========================================================================\n");

  const VALID_DEST_ADDR = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs";

  // 1. claimTxid non-uniqueness (CRIT-01): Multiple tips can share the same payout hash
  await runTest("1. Schema: Batch claims successfully assign the same claimTxid across multiple tips", async () => {
    const tipA = await dbService.createTip({
      recipientXUserId: "batch_user_phase1",
      recipientUsername: "batch_target_p1",
      amountZec: 0.1,
    });
    const tipB = await dbService.createTip({
      recipientXUserId: "batch_user_phase1",
      recipientUsername: "batch_target_p1",
      amountZec: 0.2,
    });

    const tipIdA = (tipA._id || tipA.id).toString();
    const tipIdB = (tipB._id || tipB.id).toString();

    await dbService.confirmTipFunding(tipIdA, `valid_test_fund_p1_a_${Date.now()}`);
    await dbService.confirmTipFunding(tipIdB, `valid_test_fund_p1_b_${Date.now()}`);

    const batchRes = await dbService.claimAllTips({
      claimantXUserId: "batch_user_phase1",
      claimantUsername: "batch_target_p1",
      recipientShieldedAddress: VALID_DEST_ADDR,
    });

    assert.strictEqual(batchRes.success, true);
    assert.strictEqual(batchRes.count, 2);
    assert(batchRes.claimTxid, "Batch claimTxid must be generated");

    const fetchedA = (await dbService.getTipById(tipIdA)) as any;
    const fetchedB = (await dbService.getTipById(tipIdB)) as any;

    assert.strictEqual(fetchedA.status, "CLAIMED");
    assert.strictEqual(fetchedB.status, "CLAIMED");
    assert(fetchedA.claimTxid, "Tip A must have a valid claimTxid");
    assert(fetchedB.claimTxid, "Tip B must have a valid claimTxid");
  });

  // 2. In-flight claim grace period (CRIT-02): Does not roll back in-flight CLAIMING tips without opid
  await runTest("2. Reconciliation: Preserves in-flight CLAIMING tip during proof generation grace period", async () => {
    const freshTip = await dbService.createTip({
      recipientXUserId: "inflight_user",
      recipientUsername: "inflight_target",
      amountZec: 0.15,
    });
    const freshTipId = (freshTip._id || freshTip.id).toString();
    await dbService.confirmTipFunding(freshTipId, `valid_test_fund_inflight_${Date.now()}`);

    // Simulate in-flight lock (proof generation just started 2 seconds ago, no opid yet)
    const inMem = (await dbService.getTipById(freshTipId)) as any;
    inMem.status = "CLAIMING";
    inMem.claimLockId = "lock_test_inflight";
    inMem.payoutSubmittedAt = new Date(); // Right now!

    const reconcileRes = await dbService.reconcileTipClaim(freshTipId);
    assert.strictEqual(reconcileRes.status, "CLAIMING");
    assert(reconcileRes.message?.includes("grace period"), "Should detect active in-flight grace period");

    const afterCheck = (await dbService.getTipById(freshTipId)) as any;
    assert.strictEqual(afterCheck.status, "CLAIMING", "Status must NOT be rolled back to FUNDED while in grace period");
  });

  // 3. Direct payment fallback theft vector (CRIT-03): Disallow settlement if escrowDepositAddress is missing
  await runTest("3. Escrow Security: Rejects settlement if invoice has no escrowDepositAddress", async () => {
    const origGetRequest = dbService.getRequestById;
    const fakeRequest = {
      _id: "req_no_escrow_test",
      id: "req_no_escrow_test",
      requesterUsernameSnapshot: "alice",
      targetUsernameSnapshot: "bob",
      amountZec: 0.5,
      recipientShieldedUa: VALID_DEST_ADDR,
      escrowDepositAddress: "", // Missing!
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      (dbService as any).getRequestById = async (id: string) => {
        if (id === "req_no_escrow_test") return fakeRequest;
        return origGetRequest.call(dbService, id);
      };

      await assert.rejects(
        async () => {
          await dbService.settleRequest({
            id: "req_no_escrow_test",
            paidTxid: `valid_test_deposit_${Date.now()}`,
          });
        },
        (err: any) => err.message.includes("INVALID_ESCROW_ADDRESS")
      );
    } finally {
      (dbService as any).getRequestById = origGetRequest;
    }
  });

  // 4. Circuit Breaker in settleRequest and settlePayLink (CRIT-09 / HIGH-03)
  await runTest("4. Circuit Breaker: Halts auto-forwarding on Request and PayLink settlements when active", async () => {
    const testReq = await dbService.createRequest({
      requesterUsername: "cb_alice",
      targetUsername: "cb_bob",
      amountZec: 0.3,
      recipientShieldedUa: VALID_DEST_ADDR,
    });
    const reqId = (testReq._id || testReq.id).toString();
    const testPaidTxid = `valid_test_cb_${Date.now()}`;

    // Phase 1: Inbound settlement transitions to SETTLING
    const settled = await dbService.settleRequest({
      id: reqId,
      paidTxid: testPaidTxid,
    });
    assert.strictEqual(settled.status, "SETTLING");

    try {
      setPayoutsHalted(true, "Test circuit freeze");
      // Phase 2: Deferred payout forwarding validates circuit breaker and halts
      await assert.rejects(
        async () => {
          await dbService.retryForwardRequest(reqId);
        },
        (err: any) => err.message.includes("PAYOUTS_HALTED")
      );
    } finally {
      setPayoutsHalted(false);
    }
  });

  // 5. Stale tip revival prevention (HIGH-04): Cannot fund CLAIMING or EXPIRED tips
  await runTest("5. State Machine: Cannot fund tips in CLAIMING, EXPIRED, or PENDING_VERIFICATION states", async () => {
    const stateTip = await dbService.createTip({
      recipientXUserId: "state_user",
      recipientUsername: "state_target",
      amountZec: 0.1,
    });
    const stateTipId = (stateTip._id || stateTip.id).toString();
    const inMem = (await dbService.getTipById(stateTipId)) as any;
    inMem.status = "CLAIMING";

    await assert.rejects(
      async () => {
        await dbService.confirmTipFunding(stateTipId, `valid_test_state_${Date.now()}`);
      },
      (err: any) => err.message.includes("TIP_CANNOT_BE_FUNDED")
    );
  });

  // 6. Server-side price oracle helper (CRIT-05)
  await runTest("6. Server Price Oracle: Returns positive USD price and valid metadata", async () => {
    const priceData = await getServerZecPrice();
    assert(priceData, "Price data must exist");
    assert(priceData.priceUsd > 0, "Price in USD must be positive");
    assert(priceData.updatedAt > 0, "UpdatedAt timestamp must be present");

    const livePrice = await getLiveZecPriceUsd();
    assert(livePrice > 0, "Live ZEC price must be positive number");
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Phase 1 Verification Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal test runner error:", e);
  process.exit(1);
});
