(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
import assert from "assert";
import { dbService } from "../src/lib/db-service";
import { zallet } from "../src/lib/zcash";
import { Tip } from "../src/models/Tip";

const VALID_ADDR = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs";

// Stubs for unit test execution
zallet.getNewEscrowAddress = async () => ({
  unifiedAddress: "u1phase4escrowaddress0000000000000000000000000000000000000000000000000000000000000000",
  diversifierIndex: "77",
});

zallet.verifyPaymentTransaction = async (params: any) => {
  if (params.txid?.startsWith("partial_payment_")) {
    return {
      verified: true,
      actualAmountZec: 0.15, // Underpayment: expected 0.5 ZEC, but only 0.15 ZEC received!
      confirmations: 1,
    };
  }
  if (params.txid?.startsWith("sim_tx_") || params.txid?.startsWith("valid_test_") || params.txid?.startsWith("test_")) {
    return {
      verified: true,
      actualAmountZec: params.expectedAmountZec,
      confirmations: 1,
    };
  }
  return {
    verified: false,
    reason: "TRANSACTION_NOT_FOUND_OR_UNVERIFIED",
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
  console.log("  XTip — Phase 4 Financial Math, Validation & Schema Hardening");
  console.log("==========================================================================\n");

  // --- BUG-06: Strict Positive Amount Validation ---
  await runTest("1. Input Validation: Rejects zero amount on Payment Requests (BUG-06)", async () => {
    await assert.rejects(
      async () => {
        await dbService.createRequest({
          requesterUsername: "alice",
          targetUsername: "bob",
          amountZec: 0,
          recipientShieldedUa: VALID_ADDR,
        });
      },
      (err: any) => err.message.includes("INVALID_AMOUNT")
    );
  });

  await runTest("2. Input Validation: Rejects negative amount on PayLinks (BUG-06)", async () => {
    await assert.rejects(
      async () => {
        await dbService.createPayLink({
          creatorUsername: "carol",
          title: "Malicious Invoice",
          amountZec: -1.5,
          recipientShieldedUa: VALID_ADDR,
        });
      },
      (err: any) => err.message.includes("INVALID_AMOUNT")
    );
  });

  await runTest("3. Input Validation: Rejects amounts <= 0.0001 miner fee (BUG-06)", async () => {
    await assert.rejects(
      async () => {
        await dbService.createPayLink({
          creatorUsername: "carol",
          title: "Dust Invoice",
          amountZec: 0.0001,
          recipientShieldedUa: VALID_ADDR,
        });
      },
      (err: any) => err.message.includes("INVALID_AMOUNT")
    );
  });

  // --- BUG-07: Escrow Pool Underpayment Deficit Prevention ---
  await runTest("4. Financial Safety: Caps nominal tip amount to verified actual received funds (BUG-07)", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "test_recipient_partial",
      recipientUsername: "recipient_partial",
      amountZec: 0.5, // Expected 0.5 ZEC
      isAnonymous: false,
    });

    const tipId = (tip._id || tip.id).toString();
    const partialTxid = `partial_payment_${Date.now()}`;

    // Verifier reports actualAmountZec = 0.15 ZEC
    const funded = await dbService.confirmTipFunding(tipId, partialTxid);
    assert.strictEqual(funded.status, "FUNDED");
    assert.strictEqual(funded.amountZec, 0.15, "Tip nominal amount must be adjusted down to actual received on-chain funds");
  });

  // --- BUG-08: Regex Sanitization in Batch Claims ---
  await runTest("5. Regex Safety: Treats special characters literally in batch claim lookups (BUG-08)", async () => {
    // Attempt claimAllTips with a regex injection pattern that shouldn't match arbitrary users
    await assert.rejects(
      async () => {
        await dbService.claimAllTips({
          claimantXUserId: "non_existent_id",
          claimantUsername: "attacker.*+?^${}()|[]",
          recipientShieldedAddress: VALID_ADDR,
        });
      },
      (err: any) => err.message.includes("NO_CLAIMABLE_TIPS")
    );
  });

  // --- BUG-09: Schema Format Constraints ---
  await runTest("6. Schema Constraints: Validates 64-hex transaction hash format (BUG-09)", async () => {
    const invalidTip = new Tip({
      recipientXUserId: "user1",
      recipientUsernameSnapshot: "user1",
      amountZats: 10000000,
      amountZec: 0.1,
      escrowAddress: "u1testdummy000",
      diversifierIndex: "00",
      fundingTxid: "not_a_valid_hex_txid_too_short",
    });

    const validationError = invalidTip.validateSync();
    assert(validationError && validationError.errors["fundingTxid"], "Validation error should trigger for malformed txid");
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Phase 4 Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
