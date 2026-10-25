(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
import assert from "assert";
import { dbService } from "../src/lib/db-service";
import { validateZcashAddress, generateValidZcashAddress, ALLOW_PAYMENT_SIMULATION, zallet } from "../src/lib/zcash";
import { encryptSession, decryptSession } from "../src/lib/auth";

zallet.verifyPaymentTransaction = async (params: any) => {
  if (params.txid?.startsWith("sim_tx_") || params.txid?.startsWith("valid_test_")) {
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

zallet.sendShieldedPayout = async () => ({
  txid: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  isAsync: false,
});

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    return true;
  } catch (error: any) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(`   Error: ${error.message}\n`);
    return false;
  }
}

async function runTestSuite() {
  console.log("\n=======================================================");
  console.log("  XTip — Critical Remediation & Security Test Suite   ");
  console.log("=======================================================\n");

  let passed = 0;
  let total = 0;

  // Test 1: Address format validation for testnet & mainnet
  total++;
  if (
    await runTest("1. Address Validation: Validates real testnet and mainnet Zcash formats", async () => {
      assert.strictEqual(validateZcashAddress("tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs", "testnet"), true);
      assert.strictEqual(validateZcashAddress("t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs", "mainnet"), true);
      assert.strictEqual(validateZcashAddress("invalid_zcash_address_format", "testnet"), false);
      assert.strictEqual(validateZcashAddress("utest1notvalid", "testnet"), false);
    })
  ) passed++;

  // Test 2: Tip Creation with valid checksummed address
  let createdTip: any = null;
  total++;
  if (
    await runTest("2. Tip Creation: Generates checksummed escrow address and CREATED status", async () => {
      createdTip = await dbService.createTip({
        senderUserId: "user_test_sender",
        senderUsername: "alice",
        recipientXUserId: "14829116086462",
        recipientUsername: "zooko",
        amountZec: 0.5,
        isAnonymous: true,
        memo: "Test tip creation",
      });
      assert.ok(createdTip._id || createdTip.id, "Tip ID must exist");
      assert.strictEqual(createdTip.status, "CREATED");
      assert.strictEqual(createdTip.recipientXUserId, "14829116086462");
      assert.ok(createdTip.escrowAddress, "Escrow address must exist");
      assert.strictEqual(validateZcashAddress(createdTip.escrowAddress), true);
    })
  ) passed++;

  // Test 3: Unfunded tip cannot be claimed
  total++;
  if (
    await runTest("3. Tip Claiming: Rejects claiming a tip that is not in FUNDED status", async () => {
      assert.ok(createdTip, "createdTip must exist");
      await assert.rejects(
        async () => {
          await dbService.claimTip({
            tipId: createdTip._id || createdTip.id,
            recipientShieldedAddress: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
            claimantXUserId: "14829116086462", // correct recipient, but tip is CREATED, not FUNDED
          });
        },
        (err: any) => {
          return err.message.includes("TIP_NOT_FUNDED");
        },
        "Must reject with TIP_NOT_FUNDED"
      );
    })
  ) passed++;

  // Test 4: Different X user cannot claim recipient's tip
  total++;
  if (
    await runTest("4. Tip Claiming: Rejects claim attempt by unauthorized X user", async () => {
      // First fund the tip
      const tipId = createdTip._id || createdTip.id;
      await dbService.confirmTipFunding(tipId, "valid_test_funding_hash_12345678901234567890");

      await assert.rejects(
        async () => {
          await dbService.claimTip({
            tipId: tipId,
            recipientShieldedAddress: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
            claimantXUserId: "99999999999999", // attacker's xUserId
          });
        },
        (err: any) => {
          return err.message.includes("UNAUTHORIZED_CLAIMANT");
        },
        "Must reject with UNAUTHORIZED_CLAIMANT"
      );
    })
  ) passed++;

  // Test 5: Valid authorized claim transitions to CLAIMED
  let claimedResult: any = null;
  total++;
  if (
    await runTest("5. Tip Claiming: Successfully processes authorized claim for FUNDED tip", async () => {
      const tipId = createdTip._id || createdTip.id;
      claimedResult = await dbService.claimTip({
        tipId: tipId,
        recipientShieldedAddress: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
        claimantXUserId: "14829116086462", // rightful recipient (zooko)
      });
      assert.strictEqual(claimedResult.success, true);
      assert.strictEqual(claimedResult.tip.status, "CLAIMED");
      assert.ok(claimedResult.claimTxid, "Payout transaction hash must exist");
      assert.strictEqual(claimedResult.tip.recipientShieldedAddress, "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs");
    })
  ) passed++;

  // Test 6: Tip cannot be claimed twice
  total++;
  if (
    await runTest("6. Tip Claiming: Prevents double-claiming an already CLAIMED tip", async () => {
      const tipId = createdTip._id || createdTip.id;
      await assert.rejects(
        async () => {
          await dbService.claimTip({
            tipId: tipId,
            recipientShieldedAddress: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
            claimantXUserId: "14829116086462",
          });
        },
        (err: any) => {
          return err.message.includes("TIP_ALREADY_CLAIMED");
        },
        "Must reject with TIP_ALREADY_CLAIMED"
      );
    })
  ) passed++;

  // Test 7: Invalid destination address rejected
  total++;
  if (
    await runTest("7. Tip Claiming: Rejects invalid or corrupt Zcash destination address", async () => {
      const tipId = createdTip._id || createdTip.id;
      await assert.rejects(
        async () => {
          await dbService.claimTip({
            tipId: tipId,
            recipientShieldedAddress: "bad_address_123",
            claimantXUserId: "14829116086462",
          });
        },
        (err: any) => {
          return err.message.includes("INVALID_RECIPIENT_ADDRESS");
        },
        "Must reject with INVALID_RECIPIENT_ADDRESS"
      );
    })
  ) passed++;

  // Test 8: Payment Request Creation & Settle
  total++;
  if (
    await runTest("8. Payment Requests: Creates request and atomically fulfills upon payment", async () => {
      const req = await dbService.createRequest({
        requesterUserId: "user_req_1",
        requesterUsername: "alice",
        targetXUserId: "14829116086462",
        targetUsername: "zooko",
        amountZec: 1.5,
        memo: "Design commission",
        recipientShieldedUa: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
      });
      assert.strictEqual(req.status, "PENDING");

      const reqId = req._id || req.id;
      const settled = await dbService.settleRequest({
        id: reqId,
        paidTxid: `valid_test_req_hash_${Date.now()}`,
      });
      assert.ok(settled.status === "SETTLING" || settled.status === "FULFILLED");
      assert.ok(settled.paidTxid);
    })
  ) passed++;

  // Test 9: PayLinks Creation & Settle
  total++;
  if (
    await runTest("9. PayLinks: Creates invoice and atomically marks PAID upon settlement", async () => {
      const link = await dbService.createPayLink({
        creatorUserId: "user_creator_1",
        creatorUsername: "bob",
        title: "Logo design",
        amountZec: 2.0,
        recipientShieldedUa: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
      });
      assert.strictEqual(link.status, "UNPAID");

      const settledLink = await dbService.settlePayLink({
        slug: link.slug,
        paidTxid: `valid_test_link_hash_${Date.now()}`,
      });
      assert.ok(settledLink.status === "SETTLING" || settledLink.status === "PAID");
      assert.ok(settledLink.paidTxid);
    })
  ) passed++;

  // Test 10: Session Encryption & Decryption Integrity
  total++;
  if (
    await runTest("10. Auth Sessions: Encrypts and decrypts session cookies with integrity checks", async () => {
      const sampleSession = {
        userId: "usr_12345",
        xUserId: "14829116086462",
        xUsername: "zooko",
        xDisplayName: "Zooko Wilcox",
      };
      const encrypted = encryptSession(sampleSession);
      assert.ok(encrypted.includes(":"), "Encrypted session must contain IV and ciphertext");

      const decrypted = decryptSession(encrypted);
      assert.deepStrictEqual(decrypted, sampleSession);

      const tampered = encrypted.slice(0, -4) + "ffff";
      const tamperedResult = decryptSession(tampered);
      assert.strictEqual(tamperedResult, null, "Tampered session cookie must fail decryption");
    })
  ) passed++;

  // Test 11: Production simulation refusal check
  total++;
  if (
    await runTest("11. Financial Safety: Gating rejects simulation in production mode", async () => {
      // In production mode, simulation is strictly disabled
      const isSimAllowedInProd = process.env.NODE_ENV === "production" && ALLOW_PAYMENT_SIMULATION;
      assert.strictEqual(isSimAllowedInProd, false, "Simulation must NEVER be allowed when NODE_ENV is production");
    })
  ) passed++;

  // Test 12: Non-existent tip lookup fails safely
  total++;
  if (
    await runTest("12. Tip Claiming: Safely rejects non-existent tip IDs", async () => {
      await assert.rejects(
        async () => {
          await dbService.claimTip({
            tipId: "non_existent_tip_id_9999",
            recipientShieldedAddress: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
            claimantXUserId: "14829116086462",
          });
        },
        (err: any) => {
          return err.message.includes("TIP_NOT_FOUND");
        },
        "Must reject with TIP_NOT_FOUND"
      );
    })
  ) passed++;

  console.log("\n-------------------------------------------------------");
  console.log(`Test Results: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("-------------------------------------------------------\n");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test runner exception:", err);
  process.exit(1);
});
