(process.env as any).NODE_ENV = "test";
import assert from "assert";
import { swapService } from "../src/lib/swap-service";
import { dbService } from "../src/lib/db-service";
import { zallet } from "../src/lib/zcash";

// Stubs for unit test execution
zallet.getNewEscrowAddress = async () => ({
  unifiedAddress: "u1testfakeescrowaddress0000000000000000000000000000000000000000000000000000000000000000",
  diversifierIndex: "0",
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
  console.log("  XTip — Phase 1 Cross-Chain Solver Settlement Test Suite");
  console.log("==========================================================================\n");

  // 1. Create a tip and a cross-chain swap order
  let tip: any;
  let swapOrder: any;

  await runTest("1. Cross-Chain Order Creation: Generates order linked to tip", async () => {
    tip = await dbService.createTip({
      recipientXUserId: "test_solver_recipient_id",
      recipientUsername: "solver_recipient",
      amountZec: 0.25,
      isAnonymous: true,
    });
    assert(tip && tip._id, "Tip should be created");

    swapOrder = await swapService.createSwapOrder({
      fromTokenId: "usdc-base",
      zecAmount: 0.25,
      targetZecAddress: tip.escrowAddress,
      tipId: tip._id.toString(),
      zecPriceUsd: 50,
    });

    assert(swapOrder, "Swap order should be created");
    assert.strictEqual(swapOrder.status, "WAITING_DEPOSIT");
    assert(swapOrder.depositAddress, "Deposit vault address should be present");
    assert.strictEqual(swapOrder.tipId, tip._id);
  });

  // 2. Settle with an EVM tx hash in simulation mode
  await runTest("2. Cross-Chain Settle: Handles EVM tx hash without crashing Zcash verifier", async () => {
    const evmTxHash = "0x89abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678";
    const res = await swapService.settleOrder(swapOrder.orderId, { evmTxHash });

    assert(res.order, "Result should contain updated order");
    assert.strictEqual(res.order.status, "SETTLED");
    assert.strictEqual(res.order.depositTxHash, evmTxHash);
    assert(res.order.settlementZecTxid, "Settlement ZEC txid should be recorded");
    assert(res.tip, "Associated tip should be funded");
    assert.strictEqual(res.tip.status, "FUNDED");
  });

  // 3. Status retrieval
  await runTest("3. Cross-Chain Status Polling: Returns settled state for completed order", async () => {
    const status = await swapService.getOrderStatus(swapOrder.orderId);
    assert.strictEqual(status.settled, true);
    assert.strictEqual(status.order.status, "SETTLED");
    assert(status.tip, "Associated tip should be present");
  });

  // 4. Legacy settle with direct ZEC txid
  await runTest("4. Cross-Chain Settle: Direct ZEC transaction hash settles order", async () => {
    const tip2 = await dbService.createTip({
      recipientXUserId: "test_solver_recipient_2",
      recipientUsername: "solver_recipient_2",
      amountZec: 0.5,
      isAnonymous: false,
    });

    const order2 = await swapService.createSwapOrder({
      fromTokenId: "eth-base",
      zecAmount: 0.5,
      targetZecAddress: tip2.escrowAddress,
      tipId: tip2._id.toString(),
    });

    const directZecTxid = `valid_test_zec_txid_${Date.now()}`;
    const res = await swapService.settleOrder(order2.orderId, { zecTxid: directZecTxid });

    assert.strictEqual(res.order.status, "SETTLED");
    assert.strictEqual(res.order.settlementZecTxid, directZecTxid);
    assert.strictEqual(res.tip.status, "FUNDED");
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Swap Settlement Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
