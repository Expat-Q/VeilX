(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import assert from "assert";
import { zallet, generateValidZcashAddress } from "../src/lib/zcash";
import * as authModule from "../src/lib/auth";
import { NextRequest } from "next/server";
import crypto from "crypto";

// Setup in-memory document collections for route testing
const inMemoryDb = {
  tips: new Map<string, any>(),
  paymentlinks: new Map<string, any>(),
  paymentrequests: new Map<string, any>(),
};

function createMockCollection(map: Map<string, any>) {
  return {
    findOne: async (query: any) => {
      for (const doc of map.values()) {
        let match = true;
        if (query._id && query._id.toString() !== (doc._id?.toString() || doc.id)) match = false;
        if (query.slug && query.slug !== doc.slug) match = false;
        if (query.status && query.status !== doc.status) match = false;
        if (match) return { ...doc };
      }
      return null;
    },
    findOneAndUpdate: async (filter: any, update: any, options?: any) => {
      for (const [key, doc] of map.entries()) {
        let match = true;
        if (filter._id && filter._id.toString() !== (doc._id?.toString() || doc.id)) match = false;
        if (filter.slug && filter.slug !== doc.slug) match = false;
        if (filter.status && filter.status !== doc.status) match = false;
        if (filter.forwardTxid && filter.forwardTxid.$exists === false && doc.forwardTxid) match = false;

        if (match) {
          if (update.$set) {
            Object.assign(doc, update.$set);
          }
          map.set(key, doc);
          return { ...doc };
        }
      }
      return null;
    },
    updateOne: async (filter: any, update: any) => {
      for (const [key, doc] of map.entries()) {
        let match = true;
        if (filter._id && filter._id.toString() !== (doc._id?.toString() || doc.id)) match = false;
        if (filter.slug && filter.slug !== doc.slug) match = false;
        if (match) {
          if (update.$set) Object.assign(doc, update.$set);
          map.set(key, doc);
          return { modifiedCount: 1 };
        }
      }
      return { modifiedCount: 0 };
    },
  };
}

const mockMongoose: any = {
  connection: {
    db: {
      collection: (name: string) => {
        if (name === "tips") return createMockCollection(inMemoryDb.tips);
        if (name === "paymentlinks") return createMockCollection(inMemoryDb.paymentlinks);
        if (name === "paymentrequests") return createMockCollection(inMemoryDb.paymentrequests);
        return createMockCollection(new Map());
      },
    },
  },
  models: {},
};

if (!(global as any).mongooseCache) {
  (global as any).mongooseCache = { conn: mockMongoose, promise: Promise.resolve(mockMongoose) };
} else {
  (global as any).mongooseCache.conn = mockMongoose;
  (global as any).mongooseCache.promise = Promise.resolve(mockMongoose);
}

// Stubs for Zcash node interactions
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

function createDummyProofBundle(valueBalanceZats: number, actionCount: number = 2) {
  const actions = [];
  for (let i = 0; i < actionCount; i++) {
    actions.push({
      cv: crypto.randomBytes(32).toString("hex"),
      nullifier: crypto.randomBytes(32).toString("hex"),
      rk: crypto.randomBytes(32).toString("hex"),
      cmx: crypto.randomBytes(32).toString("hex"),
      ephemeralKey: crypto.randomBytes(32).toString("hex"),
      encCiphertext: crypto.randomBytes(580).toString("hex"),
      outCiphertext: crypto.randomBytes(80).toString("hex"),
    });
  }

  return {
    actions,
    flags: 0x02,
    valueBalanceZats,
    anchorHex: "0000000000000000000000000000000000000000000000000000000000000000",
    proofHex: crypto.randomBytes(192).toString("hex"),
    spendAuthSigs: [],
  };
}

async function main() {
  console.log("\n==========================================================================");
  console.log("  VeilX QA-02 — PCZT Anti-Tamper & Replay Resistance Verification Suite");
  console.log("==========================================================================\n");

  // Dynamically import route handlers after mock db injection
  const { POST: postPrepare } = await import("../src/app/api/escrow/pczt-prepare/route");
  const { POST: postFinalize } = await import("../src/app/api/escrow/pczt-finalize/route");

  const VALID_MAINNET_ADDR = generateValidZcashAddress("mainnet"); // e.g. t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs
  const TAMPERED_MALFORMED_ADDR = "0xDeadBeefNotAZcashAddress";
  const TEST_SLUG = "inv_tamper_test_01";
  const INVOICE_AMOUNT_ZEC = 0.5; // 50,000,000 zats
  const EXPECTED_PAYOUT_ZATS = Math.round(INVOICE_AMOUNT_ZEC * 1e8) - 10000; // 49,990,000 zats

  // Setup test invoice in mock collection
  function resetTestInvoice() {
    inMemoryDb.paymentlinks.set(TEST_SLUG, {
      _id: "link_test_tamper_1",
      id: "link_test_tamper_1",
      slug: TEST_SLUG,
      creatorUsernameSnapshot: "merchant_alice",
      amountZec: INVOICE_AMOUNT_ZEC,
      recipientShieldedUa: VALID_MAINNET_ADDR,
      escrowDepositAddress: VALID_MAINNET_ADDR,
      paidTxid: "valid_test_paid_txid_" + Date.now(),
      status: "PAID",
      createdAt: new Date(),
    });
  }
  resetTestInvoice();

  // 1. Destination Address Tampering in /api/escrow/pczt-prepare (Redirection attack)
  await runTest("1. Tamper Defense: /api/escrow/pczt-prepare rejects redirected destination address with HTTP 403", async () => {
    resetTestInvoice();
    // Attacker tries to redirect merchant's payout to attacker's address
    const ATTACKER_ADDR = "t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq";
    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-prepare", {
      method: "POST",
      body: JSON.stringify({
        paylinkSlug: TEST_SLUG,
        destinationAddress: ATTACKER_ADDR,
      }),
    });

    const res = await postPrepare(req);
    const data = await res.json();

    assert.strictEqual(res.status, 403, "Should return HTTP 403 Forbidden on destination address tampering");
    assert.strictEqual(data.success, false);
    assert(data.error?.includes("Destination address must match"), "Error message must block address redirection");
  });

  // 2. Malformed Address Defense in /api/escrow/pczt-prepare
  await runTest("2. Tamper Defense: /api/escrow/pczt-prepare rejects missing item reference with HTTP 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-prepare", {
      method: "POST",
      body: JSON.stringify({
        destinationAddress: TAMPERED_MALFORMED_ADDR,
      }),
    });

    const res = await postPrepare(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400, "Should return HTTP 400 Bad Request for missing item reference");
    assert.strictEqual(data.success, false);
  });

  // 3. Destination Address Tampering in /api/escrow/pczt-finalize
  await runTest("3. Tamper Defense: /api/escrow/pczt-finalize rejects non-Zcash destination address with HTTP 400", async () => {
    resetTestInvoice();
    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-finalize", {
      method: "POST",
      body: JSON.stringify({
        paylinkSlug: TEST_SLUG,
        destinationAddress: TAMPERED_MALFORMED_ADDR,
        proofBundle: createDummyProofBundle(-EXPECTED_PAYOUT_ZATS, 2),
      }),
    });

    const res = await postFinalize(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400, "Should return HTTP 400 Bad Request for invalid address");
    assert.strictEqual(data.success, false);
    assert(data.error?.toLowerCase().includes("invalid destination"), "Must report invalid destination address");
  });

  // 4. Payout Amount Tampering: Inflated Payout Value
  await runTest("4. Tamper Defense: /api/escrow/pczt-finalize rejects inflated payout amount with HTTP 400", async () => {
    resetTestInvoice();
    // Attacker inflates payout from 49,990,000 zats to 99,990,000 zats
    const INFLATED_PAYOUT_ZATS = EXPECTED_PAYOUT_ZATS + 50000000;
    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-finalize", {
      method: "POST",
      body: JSON.stringify({
        paylinkSlug: TEST_SLUG,
        destinationAddress: VALID_MAINNET_ADDR,
        proofBundle: createDummyProofBundle(-INFLATED_PAYOUT_ZATS, 2),
      }),
    });

    const res = await postFinalize(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400, "Should return HTTP 400 Bad Request on payout inflation");
    assert.strictEqual(data.success, false);
    assert(data.error?.includes("Anti-tamper violation: Payout value mismatch"), "Must reject with anti-tamper violation");
  });

  // 5. Payout Amount Tampering: Reduced / Modified Payout Value
  await runTest("5. Tamper Defense: /api/escrow/pczt-finalize rejects modified payout amount with HTTP 400", async () => {
    resetTestInvoice();
    const TAMPERED_PAYOUT_ZATS = 10000;
    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-finalize", {
      method: "POST",
      body: JSON.stringify({
        paylinkSlug: TEST_SLUG,
        destinationAddress: VALID_MAINNET_ADDR,
        proofBundle: createDummyProofBundle(-TAMPERED_PAYOUT_ZATS, 2),
      }),
    });

    const res = await postFinalize(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400, "Should return HTTP 400 Bad Request on value mismatch");
    assert.strictEqual(data.success, false);
    assert(data.error?.includes("Anti-tamper violation: Payout value mismatch"), "Must reject with anti-tamper violation");
  });

  // 6. Stripped Orchard Dummy Actions (Padding Tampering)
  await runTest("6. Tamper Defense: /api/escrow/pczt-finalize rejects bundle with < 2 Orchard actions (HTTP 400)", async () => {
    resetTestInvoice();
    // Attacker strips dummy action and submits only 1 action
    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-finalize", {
      method: "POST",
      body: JSON.stringify({
        paylinkSlug: TEST_SLUG,
        destinationAddress: VALID_MAINNET_ADDR,
        proofBundle: createDummyProofBundle(-EXPECTED_PAYOUT_ZATS, 1), // Only 1 action!
      }),
    });

    const res = await postFinalize(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400, "Should return HTTP 400 Bad Request for < 2 actions");
    assert.strictEqual(data.success, false);
    assert(data.error?.includes("must contain at least 2 Orchard actions"), "Must enforce minimum 2 actions");
  });

  // 7. Replay Attack: Replaying an already-forwarded PayLink invoice in /api/escrow/pczt-finalize
  await runTest("7. Replay Defense: /api/escrow/pczt-finalize rejects replaying already-forwarded invoice with HTTP 409", async () => {
    const REPLAY_SLUG = "inv_already_forwarded_01";
    inMemoryDb.paymentlinks.set(REPLAY_SLUG, {
      _id: "link_replay_1",
      id: "link_replay_1",
      slug: REPLAY_SLUG,
      creatorUsernameSnapshot: "merchant_bob",
      amountZec: 0.25,
      recipientShieldedUa: VALID_MAINNET_ADDR,
      forwardTxid: "forward_txid_already_settled_1234567890abcdef1234567890abcdef12345678",
      status: "SETTLED",
      createdAt: new Date(),
    });

    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-finalize", {
      method: "POST",
      body: JSON.stringify({
        paylinkSlug: REPLAY_SLUG,
        destinationAddress: VALID_MAINNET_ADDR,
        proofBundle: createDummyProofBundle(-24000000, 2),
      }),
    });

    const res = await postFinalize(req);
    const data = await res.json();

    assert.strictEqual(res.status, 409, "Must return HTTP 409 Conflict when replaying an already-settled invoice");
    assert.strictEqual(data.success, false);
    assert(data.error?.includes("already been forwarded"), "Error message must state item has already been forwarded");
  });

  // 8. Auth Defense: /api/escrow/pczt-finalize rejects unauthenticated tip claim with HTTP 401
  await runTest("8. Auth Defense: /api/escrow/pczt-finalize rejects unauthenticated tip claim with HTTP 401", async () => {
    const TIP_ID = "507f1f77bcf86cd799439011";
    inMemoryDb.tips.set(TIP_ID, {
      _id: TIP_ID,
      id: TIP_ID,
      status: "FUNDED",
      amountZec: 0.1,
      recipientShieldedAddress: VALID_MAINNET_ADDR,
    });

    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-finalize", {
      method: "POST",
      body: JSON.stringify({
        tipId: TIP_ID,
        destinationAddress: VALID_MAINNET_ADDR,
        proofBundle: createDummyProofBundle(-9990000, 2),
      }),
    });

    const res = await postFinalize(req);
    const data = await res.json();

    assert.strictEqual(res.status, 401, "Must return HTTP 401 Unauthorized when tip claim lacks valid auth session");
    assert.strictEqual(data.success, false);
    assert(data.error?.includes("Authentication required"), "Error message must state authentication required");
  });

  // 9. Replay Attack: Replaying an already-forwarded Payment Request in /api/escrow/pczt-finalize
  await runTest("9. Replay Defense: /api/escrow/pczt-finalize rejects replaying already-forwarded request with HTTP 409", async () => {
    const REPLAY_REQ_ID = "507f1f77bcf86cd799439022";
    inMemoryDb.paymentrequests.set(REPLAY_REQ_ID, {
      _id: REPLAY_REQ_ID,
      id: REPLAY_REQ_ID,
      status: "SETTLED",
      amountZec: 0.2,
      forwardTxid: "forward_txid_already_settled_54321",
      recipientShieldedUa: VALID_MAINNET_ADDR,
    });

    const req = new NextRequest("http://localhost:3000/api/escrow/pczt-finalize", {
      method: "POST",
      body: JSON.stringify({
        requestId: REPLAY_REQ_ID,
        destinationAddress: VALID_MAINNET_ADDR,
        proofBundle: createDummyProofBundle(-19990000, 2),
      }),
    });

    const res = await postFinalize(req);
    const data = await res.json();

    assert.strictEqual(res.status, 409, "Must return HTTP 409 Conflict when replaying an already-forwarded request");
    assert.strictEqual(data.success, false);
    assert(data.error?.includes("already been forwarded"), "Error message must state request already forwarded");
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`PCZT Tamper Resistance Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
