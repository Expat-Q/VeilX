(process.env as any).NODE_ENV = "test";
import assert from "assert";
import { dbService } from "../src/lib/db-service";
import { zallet } from "../src/lib/zcash";

// Stubs for unit test execution
zallet.getNewEscrowAddress = async () => ({
  unifiedAddress: "u1testescrowaddress999999999999999999999999999999999999999999999999999999999999999999",
  diversifierIndex: "42",
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

let lastForwardPayout: { toAddress: string; amountZec: number; memo?: string } | any = null;
zallet.sendShieldedPayout = async (toAddress: string, amountZec: number, memo?: string): Promise<{ opid?: string; txid?: string; isAsync: boolean }> => {
  lastForwardPayout = { toAddress, amountZec, memo };
  return {
    txid: `forward_txid_${Date.now()}`,
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
  console.log("  XTip — Phase 2 Shielded Escrow-Forwarder Test Suite");
  console.log("==========================================================================\n");

  const VALID_DEST_ADDR = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs";

  // Test 1: Payment Request creation generates diversified escrow address
  let request: any;
  await runTest("1. Request Creation: Generates and records diversified escrow address", async () => {
    request = await dbService.createRequest({
      requesterUsername: "alice",
      targetUsername: "bob",
      amountZec: 0.5,
      recipientShieldedUa: VALID_DEST_ADDR,
      memo: "Consulting Fee",
    });

    assert(request, "Request should be created");
    assert.strictEqual(request.escrowDepositAddress, "u1testescrowaddress999999999999999999999999999999999999999999999999999999999999999999");
    assert.strictEqual(request.diversifierIndex, "42");
    assert.strictEqual(request.status, "PENDING");
  });

  // Test 2: Payment Request settlement auto-forwards net amount to recipient
  await runTest("2. Request Settlement: Auto-forwards net payout (amountZec - 0.0001) to recipient", async () => {
    lastForwardPayout = null;
    const testPaidTxid = `valid_test_deposit_${Date.now()}`;
    const reqId = (request._id || request.id).toString();
    const settled = await dbService.settleRequest({ id: reqId, paidTxid: testPaidTxid });

    assert.strictEqual(settled.status, "FULFILLED");
    assert.strictEqual(settled.paidTxid, testPaidTxid);
    assert(settled.forwardTxid && settled.forwardTxid.startsWith("forward_txid_"), "forwardTxid should be recorded");
    
    assert(lastForwardPayout, "sendShieldedPayout should have been invoked");
    assert.strictEqual(lastForwardPayout.toAddress, VALID_DEST_ADDR);
    // 0.5 - 0.0001 miner fee = 0.4999
    assert.strictEqual(lastForwardPayout.amountZec, 0.4999);
  });

  // Test 3: PayLink creation generates diversified escrow address
  let paylink: any;
  await runTest("3. PayLink Creation: Generates and records diversified escrow address", async () => {
    paylink = await dbService.createPayLink({
      creatorUsername: "carol",
      title: "Invoice #101",
      amountZec: 1.0,
      recipientShieldedUa: VALID_DEST_ADDR,
    });

    assert(paylink, "PayLink should be created");
    assert.strictEqual(paylink.escrowDepositAddress, "u1testescrowaddress999999999999999999999999999999999999999999999999999999999999999999");
    assert.strictEqual(paylink.diversifierIndex, "42");
    assert.strictEqual(paylink.status, "UNPAID");
  });

  // Test 4: PayLink settlement auto-forwards net amount to creator
  await runTest("4. PayLink Settlement: Auto-forwards net payout (amountZec - 0.0001) to creator", async () => {
    lastForwardPayout = null;
    const testPaidTxid = `valid_test_deposit_paylink_${Date.now()}`;
    const settled = await dbService.settlePayLink({ slug: paylink.slug, paidTxid: testPaidTxid });

    assert.strictEqual(settled.status, "PAID");
    assert.strictEqual(settled.paidTxid, testPaidTxid);
    assert(settled.forwardTxid && settled.forwardTxid.startsWith("forward_txid_"), "forwardTxid should be recorded");

    assert(lastForwardPayout, "sendShieldedPayout should have been invoked");
    assert.strictEqual(lastForwardPayout.toAddress, VALID_DEST_ADDR);
    // 1.0 - 0.0001 miner fee = 0.9999
    assert.strictEqual(lastForwardPayout.amountZec, 0.9999);
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Escrow-Forwarder Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
