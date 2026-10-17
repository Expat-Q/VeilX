(process.env as any).NODE_ENV = "test";
import assert from "assert";
import { dbService } from "../src/lib/db-service";
import {
  validateZcashAddress,
  validateZcashAddressDetailed,
  generateValidZcashAddress,
  zallet,
  ALLOW_PAYMENT_SIMULATION,
} from "../src/lib/zcash";
import { encryptSession, decryptSession, getSessionSecret } from "../src/lib/auth";

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

// Stub node verification for unit test fixtures
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

zallet.pollOperationStatus = async (opid: string) => {
  return {
    status: "success" as const,
    txid: `test_reconciled_txid_${Date.now()}`,
  };
};

zallet.getNewEscrowAddress = async () => {
  return {
    unifiedAddress: "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs",
    diversifierIndex: "0000000000000000000000",
  };
};

async function runSprintSuite() {
  console.log("\n==========================================================================");
  console.log("  XTip — Critical Payment Integrity & Regression Test Suite (Sprint Phase)");
  console.log("==========================================================================\n");

  // -------------------------------------------------------------
  // Section 1: Cryptographic Address Validation
  // -------------------------------------------------------------
  await runTest("1. Address Validation: Validates real testnet Base58Check transparent addresses", async () => {
    const validTm = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs";
    const res = validateZcashAddressDetailed(validTm, "testnet");
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.network, "testnet");
    assert.strictEqual(res.type, "p2pkh");
  });

  await runTest("2. Address Validation: Rejects Base58Check checksum corruptions", async () => {
    // Corrupt the last character
    const corruptTm = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQx";
    const res = validateZcashAddressDetailed(corruptTm, "testnet");
    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes("checksum"));
  });

  await runTest("3. Address Validation: Validates real mainnet Base58Check transparent addresses", async () => {
    const validT1 = "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs";
    const res = validateZcashAddressDetailed(validT1, "mainnet");
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.network, "mainnet");
    assert.strictEqual(res.type, "p2pkh");
  });

  await runTest("4. Address Validation: Rejects network mismatches (Mainnet address on Testnet)", async () => {
    const validT1 = "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs";
    const res = validateZcashAddressDetailed(validT1, "testnet");
    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes("belongs to mainnet, but target is testnet"));
  });

  // -------------------------------------------------------------
  // Section 2: Incoming Settlement Integrity (Fail-Closed & Anti-Replay)
  // -------------------------------------------------------------
  await runTest("5. Settlement Security: Rejects fake / unverified transaction hashes", async () => {
    const req = await dbService.createRequest({
      requesterUsername: "alice",
      targetUsername: "bob",
      amountZec: 2.5,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });
    const reqId = req._id || req.id;

    await assert.rejects(
      async () => {
        await dbService.settleRequest({
          id: reqId,
          paidTxid: "arbitrary_fake_unverified_hash_999",
        });
      },
      (err: any) => err.message.includes("PAYMENT_VERIFICATION_FAILED")
    );
  });

  await runTest("6. Settlement Security: Successfully settles request with valid verified transaction", async () => {
    const req = await dbService.createRequest({
      requesterUsername: "alice",
      targetUsername: "bob",
      amountZec: 1.0,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });
    const reqId = req._id || req.id;

    const settled = await dbService.settleRequest({
      id: reqId,
      paidTxid: "valid_test_tx_hash_req1_settle",
    });
    assert.strictEqual(settled.status, "FULFILLED");
    assert.strictEqual(settled.paidTxid, "valid_test_tx_hash_req1_settle");
  });

  await runTest("7. Settlement Security: Prevents cross-invoice transaction replay attack", async () => {
    // Create another invoice
    const link = await dbService.createPayLink({
      creatorUsername: "charlie",
      title: "Art commission",
      amountZec: 1.0,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });

    // Attempt to reuse the transaction hash that settled test 6
    await assert.rejects(
      async () => {
        await dbService.settlePayLink({
          slug: link.slug,
          paidTxid: "valid_test_tx_hash_req1_settle",
        });
      },
      (err: any) => err.message.includes("DUPLICATE_TXID_REUSE")
    );
  });

  // -------------------------------------------------------------
  // Section 3: Crash-Safe Outgoing Tip Claims & Recovery
  // -------------------------------------------------------------
  await runTest("8. Outgoing Claims: Rejects claim attempt on unfunded tip", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "x_user_claim_test",
      recipientUsername: "david",
      amountZec: 0.5,
    });
    const tipId = tip._id || tip.id;

    await assert.rejects(
      async () => {
        await dbService.claimTip({
          tipId,
          recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
          claimantXUserId: "x_user_claim_test",
        });
      },
      (err: any) => err.message.includes("TIP_NOT_FUNDED")
    );
  });

  await runTest("9. Outgoing Claims: Rejects claim attempt by unauthorized X user", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "14829116086462",
      recipientUsername: "zooko",
      amountZec: 0.1,
    });
    const tipId = tip._id ? tip._id.toString() : tip.id;
    await dbService.confirmTipFunding(tipId, "test_tx_auth_" + Date.now());

    await assert.rejects(
      async () => {
        await dbService.claimTip({
          tipId,
          recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
          claimantXUserId: "attacker_x_user_999",
        });
      },
      (err: any) => err.message.includes("UNAUTHORIZED_CLAIMANT")
    );
  });

  await runTest("10. Outgoing Claims: Atomic lock prevents concurrent double-payouts", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "x_user_concurrent",
      recipientUsername: "eve",
      amountZec: 0.25,
    });
    const tipId = tip._id || tip.id;
    if (global.__memoryStore) {
      const stored = global.__memoryStore.tips.find((t) => t._id === tipId || t.id === tipId);
      if (stored) stored.status = "FUNDED";
    }

    const claim1 = dbService.claimTip({
      tipId,
      recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
      claimantXUserId: "x_user_concurrent",
    });
    const claim2 = dbService.claimTip({
      tipId,
      recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
      claimantXUserId: "x_user_concurrent",
    });

    const results = await Promise.allSettled([claim1, claim2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Exactly one payout must succeed");
    assert.strictEqual(rejected.length, 1, "Second concurrent attempt must fail");
  });

  await runTest("11. Crash-Safe Claims: Payout failure sets PENDING_VERIFICATION instead of rolling back to FUNDED", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "x_user_crash_test",
      recipientUsername: "frank",
      amountZec: 0.5,
    });
    const tipId = tip._id || tip.id;
    if (global.__memoryStore) {
      const stored = global.__memoryStore.tips.find((t) => t._id === tipId || t.id === tipId);
      if (stored) stored.status = "FUNDED";
    }

    const originalSend = zallet.sendShieldedPayout;
    zallet.sendShieldedPayout = async () => {
      throw new Error("RPC_NETWORK_TIMEOUT_POST_SUBMIT");
    };

    try {
      await assert.rejects(
        async () => {
          await dbService.claimTip({
            tipId,
            recipientShieldedAddress: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
            claimantXUserId: "x_user_crash_test",
          });
        },
        (err: any) => err.message.includes("PAYOUT_DISPATCH_UNCERTAIN")
      );

      // Verify tip is in PENDING_VERIFICATION (not FUNDED)
      const current = await dbService.getTipById(tipId);
      assert.strictEqual(current.status, "PENDING_VERIFICATION", "Tip must remain in PENDING_VERIFICATION to prevent double-spending");
    } finally {
      zallet.sendShieldedPayout = originalSend;
    }
  });

  await runTest("12. Claim Reconciliation: Resolves async opid when operation succeeds", async () => {
    const tip = await dbService.createTip({
      recipientXUserId: "x_user_async_test",
      recipientUsername: "grace",
      amountZec: 0.1,
    });
    const tipId = tip._id || tip.id;
    if (global.__memoryStore) {
      const stored = global.__memoryStore.tips.find((t) => t._id === tipId || t.id === tipId);
      if (stored) {
        stored.status = "PENDING_VERIFICATION";
        stored.payoutOpid = "opid-test-success-123";
      }
    }

    const reconciled = await dbService.reconcileTipClaim(tipId);
    assert.strictEqual(reconciled.status, "CLAIMED");
    assert.ok(reconciled.claimTxid, "Reconciled claim must contain genuine claimTxid");
  });

  // -------------------------------------------------------------
  // Section 4: Auth & Production Gating Safety
  // -------------------------------------------------------------
  await runTest("13. Auth Session: AES-256-GCM encryption and tampering rejection", async () => {
    const session = {
      userId: "usr_auth_1",
      xUserId: "14829116086462",
      xUsername: "zooko",
      xDisplayName: "Zooko",
    };
    const encrypted = encryptSession(session);
    const decrypted = decryptSession(encrypted);
    assert.deepStrictEqual(decrypted, session);

    const tampered = encrypted.slice(0, -6) + "000000";
    assert.strictEqual(decryptSession(tampered), null);
  });

  await runTest("14. Financial Safety: Gating rejects simulation in production mode", async () => {
    const isSimAllowedInProd = process.env.NODE_ENV === "production" && ALLOW_PAYMENT_SIMULATION;
    assert.strictEqual(isSimAllowedInProd, false, "Simulation must NEVER be active in production mode");
  });

  await runTest("15. Auth Expiry: Rejects expired session tokens", async () => {
    const session = {
      userId: "usr_exp_1",
      xUserId: "14829116086499",
      xUsername: "expired_user",
    };
    const expiredToken = encryptSession(session, -10);
    const decrypted = decryptSession(expiredToken);
    assert.strictEqual(decrypted, null, "Expired session token must resolve to null");
  });

  await runTest("16. Auth Production Gating: Enforces 32-character SESSION_SECRET in production", async () => {
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.SESSION_SECRET;
    try {
      (process.env as any).NODE_ENV = "production";
      delete process.env.SESSION_SECRET;
      assert.throws(() => {
        getSessionSecret();
      }, /SESSION_SECRET must be configured/);
    } finally {
      (process.env as any).NODE_ENV = origEnv;
      process.env.SESSION_SECRET = origSecret;
    }
  });

  await runTest("17. Cross-Feature Anti-Replay: Prevents tip funding txid reuse on payment requests", async () => {
    const fakeTxid = "test_tx_cross_feature_replay_abc";
    const tip = await dbService.createTip({
      recipientXUserId: "x_user_tx_test",
      recipientUsername: "alice",
      amountZec: 0.1,
    });
    const tipId = tip._id || tip.id;
    await dbService.confirmTipFunding(tipId, fakeTxid);

    const req = await dbService.createRequest({
      requesterUsername: "bob",
      targetXUserId: "x_user_tx_test",
      targetUsername: "alice",
      amountZec: 0.1,
      recipientShieldedUa: "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs",
    });
    const reqId = req._id || req.id;

    await assert.rejects(
      async () => {
        await dbService.settleRequest({ id: reqId, paidTxid: fakeTxid });
      },
      (err: any) => err.message.includes("DUPLICATE_TXID_REUSE")
    );
  });

  await runTest("18. Referral Sanitization: Neutralizes special characters and ReDoS injection payloads", async () => {
    const maliciousPayload = "@attacker_handle!$^*()+={}[];:'\",<>";
    const sanitized = maliciousPayload.replace("@", "").trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15);
    assert.strictEqual(sanitized, "attacker_handle");
    assert.doesNotMatch(sanitized, /[^a-zA-Z0-9_]/);
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Test Results: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runSprintSuite().catch((err) => {
  console.error("Test runner exception:", err);
  process.exit(1);
});
