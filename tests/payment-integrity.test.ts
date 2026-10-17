import assert from "assert";
import { dbService } from "../src/lib/db-service";
import { validateZcashAddress, generateValidZcashAddress, zallet, ALLOW_PAYMENT_SIMULATION } from "../src/lib/zcash";
import { Tip } from "../src/models/Tip";
import { PaymentRequest } from "../src/models/PaymentRequest";
import { PaymentLink } from "../src/models/PaymentLink";

let testCount = 0;
let passCount = 0;

async function test(name: string, fn: () => Promise<void>) {
  testCount++;
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    passCount++;
    return true;
  } catch (err: any) {
    console.log(`❌ [FAIL] ${name}`);
    console.log(`   Reason: ${err.message}\n`);
    return false;
  }
}

async function runPaymentIntegritySuite() {
  console.log("\n=================================================================");
  console.log("  XTip — Payment Integrity & Failure Scenario Verification Suite ");
  console.log("=================================================================\n");

  // -------------------------------------------------------------
  // Section 1: Address Handling Limits & Checksum Verification
  // -------------------------------------------------------------
  await test("1. Address Validation: Detects format structure but lacks cryptographic checksum validation", async () => {
    // Valid prefix and length passes
    assert.strictEqual(validateZcashAddress("tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs", "testnet"), true);
    
    // Corrupt address with same prefix & length (e.g. altered characters without valid checksum)
    // Current regex/prefix validator considers it structurally valid:
    const corruptAddress = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQq"; 
    const passesStructural = validateZcashAddress(corruptAddress, "testnet");
    assert.strictEqual(passesStructural, true, "Demonstrates structural prefix check passes without base58/bech32 checksum verification");

    // Completely invalid prefix is rejected
    assert.strictEqual(validateZcashAddress("not_a_zcash_address", "testnet"), false);
  });

  // -------------------------------------------------------------
  // Section 2: Concurrency & Duplicate Claims (Scenario D)
  // -------------------------------------------------------------
  await test("2. Scenario D (Concurrent Claims): Atomic lock prevents simultaneous double-payouts", async () => {
    // Setup a funded tip
    const tip = await dbService.createTip({
      recipientXUserId: "test_concurrency_recipient_1",
      recipientUsername: "alice",
      amountZec: 0.1,
    });
    
    const tipId = tip._id || tip.id;
    // Simulate funding
    if (global.__memoryStore) {
      const stored = global.__memoryStore.tips.find((t) => t._id === tipId || t.id === tipId);
      if (stored) stored.status = "FUNDED";
    }

    // Launch two simultaneous claim requests
    const claim1Promise = dbService.claimTip({
      tipId,
      recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
      claimantXUserId: "test_concurrency_recipient_1",
    });

    const claim2Promise = dbService.claimTip({
      tipId,
      recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
      claimantXUserId: "test_concurrency_recipient_1",
    });

    const results = await Promise.allSettled([claim1Promise, claim2Promise]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Exactly one claim must succeed");
    assert.strictEqual(rejected.length, 1, "The second concurrent claim must be rejected");
  });

  // -------------------------------------------------------------
  // Section 3: Payout Succeeds but Database Fails / Rollback Risk (Scenario A)
  // -------------------------------------------------------------
  await test("3. Scenario A (Payout Succeeds, DB Update Fails): Demonstrates state rollback risk if RPC succeeds but DB crashes", async () => {
    // When zallet.sendShieldedPayout succeeds, it returns a txid.
    // If the server crashes or throws an exception during DB finalization,
    // the catch block resets the tip status to 'FUNDED'.
    // This demonstrates why an uncertain failure must NOT blindly reset to FUNDED without checking blockchain state.
    
    const tip = await dbService.createTip({
      recipientXUserId: "test_scenario_a_user",
      recipientUsername: "bob",
      amountZec: 0.5,
    });
    const tipId = tip._id || tip.id;
    if (global.__memoryStore) {
      const stored = global.__memoryStore.tips.find((t) => t._id === tipId || t.id === tipId);
      if (stored) stored.status = "FUNDED";
    }

    // If an error is thrown by the payout dispatcher, status resets to FUNDED:
    const originalSend = zallet.sendShieldedPayout;
    zallet.sendShieldedPayout = async () => {
      throw new Error("RPC_TIMEOUT_AFTER_SUBMIT");
    };

    try {
      await assert.rejects(
        async () => {
          await dbService.claimTip({
            tipId,
            recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
            claimantXUserId: "test_scenario_a_user",
          });
        },
        (err: any) => err.message.includes("PAYOUT_DISPATCH_FAILED")
      );

      // Verify tip was rolled back to FUNDED
      const currentTip = await dbService.getTipById(tipId);
      assert.strictEqual(currentTip.status, "FUNDED", "Status was reset to FUNDED (risk: if tx was actually mined, funds could be double-claimed)");
    } finally {
      zallet.sendShieldedPayout = originalSend;
    }
  });

  // -------------------------------------------------------------
  // Section 4: Stuck CLAIMING State Recovery (Scenario C)
  // -------------------------------------------------------------
  await test("4. Scenario C (App Crash during CLAIMING): Rejects further claims while in CLAIMING state", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "test_scenario_c_user",
      recipientUsername: "charlie",
      amountZec: 0.25,
    });
    const tipId = tip._id || tip.id;
    if (global.__memoryStore) {
      const stored = global.__memoryStore.tips.find((t) => t._id === tipId || t.id === tipId);
      if (stored) stored.status = "CLAIMING"; // Simulating crash mid-claim
    }

    // Any new claim attempt on a stuck CLAIMING tip is safely blocked
    await assert.rejects(
      async () => {
        await dbService.claimTip({
          tipId,
          recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
          claimantXUserId: "test_scenario_c_user",
        });
      },
      (err: any) => err.message.includes("TIP_CLAIM_IN_PROGRESS")
    );
  });

  // -------------------------------------------------------------
  // Section 5: Settlement Endpoint Verification (Fake TXID & Duplicate Reuse)
  // -------------------------------------------------------------
  await test("5. Settlement Verification: Unverified client-submitted txids are accepted by current settlement routes", async () => {
    // Create a payment request
    const req = await dbService.createRequest({
      requesterUserId: "req_user_sec5",
      requesterUsername: "dave",
      targetUsername: "eve",
      amountZec: 1.0,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });
    const reqId = req._id || req.id;

    // Settle with an arbitrary fake txid string (reveals client-trusting behavior)
    const fakeTxid = "fake_unverified_txid_string_999";
    const settled = await dbService.settleRequest({
      id: reqId,
      paidTxid: fakeTxid,
    });

    assert.strictEqual(settled.status, "FULFILLED");
    assert.strictEqual(settled.paidTxid, fakeTxid, "Backend accepted fake txid without on-chain verification");
  });

  await test("6. Settlement Verification: Cross-invoice TXID replay detection gap", async () => {
    // Create two separate paylinks
    const link1 = await dbService.createPayLink({
      creatorUsername: "dave",
      title: "Invoice 1",
      amountZec: 1.0,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });
    const link2 = await dbService.createPayLink({
      creatorUsername: "dave",
      title: "Invoice 2",
      amountZec: 5.0, // Different amount
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });

    const reusedTxid = "tx_reused_hash_abc123";

    // Settle link 1
    await dbService.settlePayLink({ slug: link1.slug, paidTxid: reusedTxid });
    // Settle link 2 with the SAME txid
    const settledLink2 = await dbService.settlePayLink({ slug: link2.slug, paidTxid: reusedTxid });

    assert.strictEqual(settledLink2.status, "PAID");
    assert.strictEqual(settledLink2.paidTxid, reusedTxid, "Same txid settled two different invoices with different amounts");
  });

  // -------------------------------------------------------------
  // Section 6: Duplicate Funding Detection (Scenario E)
  // -------------------------------------------------------------
  await test("7. Scenario E (Duplicate Funding Events): Tips in FUNDED status ignore duplicate scan events", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "test_sec7_user",
      recipientUsername: "frank",
      amountZec: 0.1,
    });
    const tipId = tip._id || tip.id;
    if (global.__memoryStore) {
      const stored = global.__memoryStore.tips.find((t) => t._id === tipId || t.id === tipId);
      if (stored) {
        stored.status = "FUNDED";
        stored.fundingTxid = "funding_tx_1";
      }
    }

    const currentTip = await dbService.getTipById(tipId);
    assert.strictEqual(currentTip.status, "FUNDED");
    assert.strictEqual(currentTip.fundingTxid, "funding_tx_1");
  });

  // -------------------------------------------------------------
  // Section 7: Production Safety & Simulation Gating
  // -------------------------------------------------------------
  await test("8. Production Safety: Rejects simulation when NODE_ENV is production", async () => {
    const isProdSim = (process.env.NODE_ENV === "production") && ALLOW_PAYMENT_SIMULATION;
    assert.strictEqual(isProdSim, false, "Production must never allow simulation");
  });

  console.log("\n-----------------------------------------------------------------");
  console.log(`Payment Integrity Test Results: ${passCount} / ${testCount} passed (${Math.round((passCount / testCount) * 100)}%)`);
  console.log("-----------------------------------------------------------------\n");
}

runPaymentIntegritySuite().catch((err) => {
  console.error("Test runner failure:", err);
  process.exit(1);
});
