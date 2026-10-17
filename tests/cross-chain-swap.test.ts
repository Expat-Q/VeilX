import { dbService } from "../src/lib/db-service";
import { swapService, SUPPORTED_SWAP_TOKENS } from "../src/lib/swap-service";
import { generateValidZcashAddress } from "../src/lib/zcash";

async function runCrossChainSwapTest() {
  console.log("==========================================================");
  console.log("   TESTING MULTI-CURRENCY CROSS-CHAIN SWAP & SETTLEMENT   ");
  console.log("==========================================================");

  // 1. Verify Supported Tokens
  const tokens = swapService.getSupportedTokens();
  console.log(`[1] Supported Tokens count: ${tokens.length}`);
  if (tokens.length < 4) {
    throw new Error("Expected at least 4 supported tokens (USDC Base, USDC Arb, USDT, ETH)");
  }
  const usdcBase = swapService.getTokenById("usdc-base");
  if (!usdcBase || usdcBase.network !== "base") {
    throw new Error("Missing or invalid usdc-base token definition");
  }
  console.log("  ✓ Supported tokens validated (Base, Arbitrum, Ethereum)");

  // 2. Create a Tip in MongoDB
  const testUser = "swap_test_creator_" + Date.now();
  console.log(`\n[2] Creating Shielded Escrow Tip for @${testUser}...`);
  const tip = await dbService.createTip({
    senderUserId: "tipper_evm_user",
    recipientXUserId: "x_id_" + testUser,
    recipientUsername: testUser,
    amountZec: 0.75,
    memo: "VeilX Cross-Chain Test Tip",
    isAnonymous: true,
  });
  console.log(`  ✓ Tip created in DB. Tip ID: ${tip._id}, Status: ${tip.status}, Escrow: ${tip.escrowAddress}`);

  // 3. Generate Cross-Chain Swap Order
  console.log("\n[3] Generating Cross-Chain Swap Order for USDC on Base...");
  const order = await swapService.createSwapOrder({
    fromTokenId: "usdc-base",
    zecAmount: 0.75,
    targetZecAddress: tip.escrowAddress,
    tipId: tip._id.toString(),
    zecPriceUsd: 50.0,
  });

  console.log(`  ✓ Order ID: ${order.orderId}`);
  console.log(`  ✓ Deposit Amount: ${order.depositAmount} ${order.fromToken.symbol} on ${order.fromToken.networkName}`);
  console.log(`  ✓ EVM Vault Deposit Address: ${order.depositAddress}`);
  console.log(`  ✓ Status: ${order.status}`);
  console.log(`  ✓ Estimated Time: ${order.estimatedMinutes} minutes`);

  if (!order.depositAddress.startsWith("0x")) {
    throw new Error("Expected valid EVM deposit address starting with 0x");
  }
  if (order.status !== "WAITING_DEPOSIT") {
    throw new Error(`Expected status WAITING_DEPOSIT, got ${order.status}`);
  }

  // 4. Settle Swap Order via Solver
  console.log("\n[4] Simulating Non-Custodial Cross-Chain Solver Settlement...");
  const customSettlementTxid = "cross_zec_txid_" + Date.now();
  const settleResult = await swapService.settleOrder(order.orderId, customSettlementTxid);

  console.log(`  ✓ Swap Order Status: ${settleResult.order.status}`);
  console.log(`  ✓ Settlement ZEC Txid: ${settleResult.order.settlementZecTxid}`);

  if (settleResult.order.status !== "SETTLED") {
    throw new Error(`Expected order status SETTLED, got ${settleResult.order.status}`);
  }

  // 5. Verify Tip Funding in Database
  console.log("\n[5] Verifying MongoDB Tip Status Transition...");
  const updatedTip = await dbService.getTipById(tip._id.toString());
  if (!updatedTip) throw new Error("Updated tip not found in DB");

  console.log(`  ✓ Database Tip Status: ${updatedTip.status}`);
  console.log(`  ✓ Database Funding Txid: ${updatedTip.fundingTxid}`);

  if (updatedTip.status !== "FUNDED") {
    throw new Error(`Expected tip status FUNDED, got ${updatedTip.status}`);
  }
  if (updatedTip.fundingTxid !== customSettlementTxid) {
    throw new Error(`Expected fundingTxid ${customSettlementTxid}, got ${updatedTip.fundingTxid}`);
  }

  // 6. Verify Creator Batch Claim works for this funded tip
  console.log("\n[6] Testing Creator Batch Claim on the cross-chain funded tip...");
  const claimResult = await dbService.claimAllTips({
    claimantXUserId: "x_id_" + testUser,
    recipientShieldedAddress: generateValidZcashAddress(),
    claimantUsername: testUser,
  });

  console.log(`  ✓ Claimed Tips Count: ${claimResult.count}`);
  console.log(`  ✓ Total ZEC Claimed: ${claimResult.totalAmountZec}`);
  console.log(`  ✓ Claim Txid: ${claimResult.claimTxid}`);

  if (claimResult.count !== 1 || claimResult.totalAmountZec !== 0.75) {
    throw new Error("Batch claim failed for cross-chain funded tip");
  }

  const finalizedTip = await dbService.getTipById(tip._id.toString());
  console.log(`  ✓ Finalized Tip Status in DB: ${finalizedTip?.status}`);
  if (finalizedTip?.status !== "CLAIMED") {
    throw new Error(`Expected finalized status CLAIMED, got ${finalizedTip?.status}`);
  }

  console.log("\n==========================================================");
  console.log("   ✅ ALL MULTI-CURRENCY CROSS-CHAIN TESTS PASSED!        ");
  console.log("==========================================================");
  process.exit(0);
}

runCrossChainSwapTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
