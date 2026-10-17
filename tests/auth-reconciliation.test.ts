(process.env as any).NODE_ENV = "test";
import assert from "assert";
import { dbService } from "../src/lib/db-service";
import { zallet } from "../src/lib/zcash";

const VALID_ADDR = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs";

// Stubs for unit test execution
zallet.getNewEscrowAddress = async () => ({
  unifiedAddress: "u1phase3escrowaddress0000000000000000000000000000000000000000000000000000000000000000",
  diversifierIndex: "99",
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
    txid: `payout_txid_${Date.now()}`,
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
  console.log("  XTip — Phase 3 Auth, Idempotency & Reconciliation Test Suite");
  console.log("==========================================================================\n");

  // --- BUG-03: Authorization Enforcement on Payment Requests ---
  let request: any;
  await runTest("1. Settle Request Auth: Rejects settlement by unauthorized user (BUG-03)", async () => {
    request = await dbService.createRequest({
      requesterUsername: "creator_user",
      targetUsername: "intended_payer",
      amountZec: 0.1,
      recipientShieldedUa: VALID_ADDR,
      memo: "Invoice 123",
    });

    const reqId = (request._id || request.id).toString();

    // Attacker tries to settle Bob's request
    await assert.rejects(
      async () => {
        await dbService.settleRequest({
          id: reqId,
          paidTxid: `valid_test_deposit_${Date.now()}`,
          payerUsername: "attacker_user",
        });
      },
      (err: any) => err.message.includes("UNAUTHORIZED_SETTLER")
    );
  });

  await runTest("2. Settle Request Auth: Allows designated recipient to settle request (BUG-03)", async () => {
    const reqId = (request._id || request.id).toString();
    const testTxid = `valid_test_deposit_p3_${Date.now()}`;

    const settled = await dbService.settleRequest({
      id: reqId,
      paidTxid: testTxid,
      payerUsername: "intended_payer",
    });

    assert.strictEqual(settled.status, "FULFILLED");
    assert.strictEqual(settled.paidTxid, testTxid);
  });

  // --- BUG-05: Idempotency Order in confirmTipFunding ---
  let tip: any;
  const fundingTxid = `valid_test_funding_idemp_${Date.now()}`;

  await runTest("3. Tip Funding Idempotency: Returns funded tip on repeat calls with same txid (BUG-05)", async () => {
    tip = await dbService.createTip({
      recipientXUserId: "test_recipient_idemp",
      recipientUsername: "recipient_idemp",
      amountZec: 0.25,
      isAnonymous: false,
    });

    const tipId = (tip._id || tip.id).toString();

    // First call: funds the tip
    const funded1 = await dbService.confirmTipFunding(tipId, fundingTxid);
    assert.strictEqual(funded1.status, "FUNDED");
    assert.strictEqual(funded1.fundingTxid, fundingTxid);

    // Second call: repeat with exact same txid (idempotent retry)
    // Previously this threw DUPLICATE_TXID_REUSE because isTxidAlreadyUsed was called before checking tip.status === "FUNDED"
    const funded2 = await dbService.confirmTipFunding(tipId, fundingTxid);
    assert.strictEqual(funded2.status, "FUNDED");
    assert.strictEqual(funded2.fundingTxid, fundingTxid);
  });

  // --- BUG-04: Background Payout Reconciliation Worker ---
  await runTest("4. Reconciliation Worker: Reconciles PENDING_VERIFICATION tips via pollOperationStatus (BUG-04)", async () => {
    const pendingTip = await dbService.createTip({
      recipientXUserId: "test_recipient_pending",
      recipientUsername: "recipient_pending",
      amountZec: 0.5,
      isAnonymous: false,
    });

    const tipId = (pendingTip._id || pendingTip.id).toString();
    const fundTx = `valid_test_fund_rec_${Date.now()}`;
    await dbService.confirmTipFunding(tipId, fundTx);

    // Simulate async payout: set to PENDING_VERIFICATION with an opid
    const testOpid = `opid_test_reconcile_${Date.now()}`;
    const inMemTip = (await dbService.getTipById(tipId)) as any;
    inMemTip.status = "PENDING_VERIFICATION";
    inMemTip.payoutOpid = testOpid;

    // Stub zallet.pollOperationStatus to return success
    const mockMinedTxid = `mined_claim_txid_${Date.now()}`;
    zallet.pollOperationStatus = async (opid: string) => {
      if (opid === testOpid) {
        return { status: "success", txid: mockMinedTxid };
      }
      return { status: "executing" };
    };

    // Run reconciliation worker
    const results = await dbService.reconcilePendingTips();
    const reconciledItem = results.find((r) => r.tipId === tipId);

    assert(reconciledItem, "Reconciliation worker should have processed the pending tip");
    assert.strictEqual(reconciledItem.status, "CLAIMED");
    assert.strictEqual((reconciledItem as any).claimTxid, mockMinedTxid);

    const verifiedTip = (await dbService.getTipById(tipId)) as any;
    assert.strictEqual(verifiedTip.status, "CLAIMED");
    assert.strictEqual(verifiedTip.claimTxid, mockMinedTxid);
  });

  await runTest("5. Reconciliation Worker: Rolls back failed payout to FUNDED state (BUG-04)", async () => {
    const failedTip = await dbService.createTip({
      recipientXUserId: "test_recipient_failed_payout",
      recipientUsername: "recipient_failed",
      amountZec: 0.75,
      isAnonymous: false,
    });

    const tipId = (failedTip._id || failedTip.id).toString();
    const fundTx = `valid_test_fund_fail_${Date.now()}`;
    await dbService.confirmTipFunding(tipId, fundTx);

    // Simulate failed payout: set to PENDING_VERIFICATION with an opid
    const testOpid = `opid_test_failed_${Date.now()}`;
    const inMemTip = (await dbService.getTipById(tipId)) as any;
    inMemTip.status = "PENDING_VERIFICATION";
    inMemTip.payoutOpid = testOpid;

    // Stub zallet.pollOperationStatus to return failed
    zallet.pollOperationStatus = async (opid: string) => {
      if (opid === testOpid) {
        return { status: "failed", error: "Node mempool rejection: insufficient fee" };
      }
      return { status: "executing" };
    };

    // Run reconciliation worker
    const results = await dbService.reconcilePendingTips();
    const reconciledItem = results.find((r) => r.tipId === tipId);

    assert(reconciledItem, "Reconciliation worker should have processed the failed tip");
    assert.strictEqual(reconciledItem.status, "FUNDED");
    assert((reconciledItem as any).error.includes("mempool rejection"), "Error message should be recorded");

    const verifiedTip = (await dbService.getTipById(tipId)) as any;
    assert.strictEqual(verifiedTip.status, "FUNDED");
    assert.strictEqual(verifiedTip.payoutOpid, undefined);
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Phase 3 Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
