(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import assert from "assert";
import {
  serializeV5ShieldingTransaction,
  writeCompactSize,
  getNetworkConfig,
  NETWORK_CONFIGS,
} from "../src/lib/zcash";
import crypto from "crypto";

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

/**
 * Parses raw serialized V5 transaction to extract protocol fields according to ZIP-225
 */
function parseV5TransactionWire(rawHex: string) {
  const buf = Buffer.from(rawHex, "hex");
  let offset = 0;

  // 1. Header (4 bytes)
  const header = buf.readUInt32LE(offset);
  const headerBytes = buf.subarray(offset, offset + 4);
  offset += 4;

  // 2. VersionGroupId (4 bytes)
  const versionGroupId = buf.readUInt32LE(offset);
  const versionGroupBytes = buf.subarray(offset, offset + 4);
  offset += 4;

  // 3. ConsensusBranchId (4 bytes)
  const consensusBranchId = buf.readUInt32LE(offset);
  offset += 4;

  // 4. LockTime (4 bytes)
  const lockTime = buf.readUInt32LE(offset);
  offset += 4;

  // 5. ExpiryHeight (4 bytes)
  const expiryHeight = buf.readUInt32LE(offset);
  offset += 4;

  // 6. Transparent Inputs
  const nInputs = buf[offset++];
  const inputs: Array<{ txid: string; vout: number; scriptSigLength: number; sequence: number }> = [];
  for (let i = 0; i < nInputs; i++) {
    const txidRev = buf.subarray(offset, offset + 32);
    offset += 32;
    const txid = Buffer.from(txidRev).reverse().toString("hex");
    const vout = buf.readUInt32LE(offset);
    offset += 4;
    const scriptLen = buf[offset++];
    offset += scriptLen; // skip scriptSig
    const seq = buf.readUInt32LE(offset);
    offset += 4;
    inputs.push({ txid, vout, scriptSigLength: scriptLen, sequence: seq });
  }

  // 7. Transparent Outputs
  const nOutputs = buf[offset++];

  // 8. Sapling Spends
  const saplingSpends = buf[offset++];

  // 9. Sapling Outputs
  const saplingOutputs = buf[offset++];

  // 10. Orchard Bundle
  const nOrchardActions = buf[offset++];
  const orchardActions: Array<{
    cv: string;
    nullifier: string;
    rk: string;
    cmx: string;
    ephemeralKey: string;
    encCiphertext: string;
    outCiphertext: string;
  }> = [];

  for (let i = 0; i < nOrchardActions; i++) {
    const actionBytes = buf.subarray(offset, offset + 820);
    assert.strictEqual(actionBytes.length, 820, `Action ${i} must be exactly 820 bytes`);
    const cv = actionBytes.subarray(0, 32).toString("hex");
    const nullifier = actionBytes.subarray(32, 64).toString("hex");
    const rk = actionBytes.subarray(64, 96).toString("hex");
    const cmx = actionBytes.subarray(96, 128).toString("hex");
    const ephemeralKey = actionBytes.subarray(128, 160).toString("hex");
    const encCiphertext = actionBytes.subarray(160, 740).toString("hex");
    const outCiphertext = actionBytes.subarray(740, 820).toString("hex");
    orchardActions.push({ cv, nullifier, rk, cmx, ephemeralKey, encCiphertext, outCiphertext });
    offset += 820;
  }

  // Flags: 1 byte
  const flags = buf[offset++];

  // ValueBalance: 8 bytes i64 LE
  const valueBalanceZats = buf.readBigInt64LE(offset);
  offset += 8;

  // Anchor: 32 bytes
  const anchor = buf.subarray(offset, offset + 32).toString("hex");
  offset += 32;

  // Proof
  const proofLen = buf[offset++];
  const proof = buf.subarray(offset, offset + proofLen).toString("hex");
  offset += proofLen;

  // BindingSig: 64 bytes
  const bindingSig = buf.subarray(offset, offset + 64).toString("hex");
  offset += 64;

  return {
    header,
    headerBytes,
    versionGroupId,
    versionGroupBytes,
    consensusBranchId,
    lockTime,
    expiryHeight,
    nInputs,
    inputs,
    nOutputs,
    saplingSpends,
    saplingOutputs,
    nOrchardActions,
    orchardActions,
    flags,
    valueBalanceZats,
    anchor,
    proof,
    bindingSig,
    totalWireBytes: offset,
  };
}

function createMockOrchardAction() {
  return {
    cv: crypto.randomBytes(32).toString("hex"),
    nullifier: crypto.randomBytes(32).toString("hex"),
    rk: crypto.randomBytes(32).toString("hex"),
    cmx: crypto.randomBytes(32).toString("hex"),
    ephemeralKey: crypto.randomBytes(32).toString("hex"),
    encCiphertext: crypto.randomBytes(580).toString("hex"),
    outCiphertext: crypto.randomBytes(80).toString("hex"),
  };
}

async function main() {
  console.log("\n==========================================================================");
  console.log("  VeilX QA-01 — Shielded Outflow (t -> z) Contract Verification Suite");
  console.log("==========================================================================\n");

  const EMPTY_TREE_ANCHOR = "0000000000000000000000000000000000000000000000000000000000000000";
  const TEST_PAYOUT_ZATS = 490000; // 0.0049 ZEC net payout
  const TEST_FEE_ZATS = 10000; // 0.0001 ZEC (ZIP-317)
  const TOTAL_INPUT_ZATS = TEST_PAYOUT_ZATS + TEST_FEE_ZATS; // 500,000 zats

  // 1. ZIP-225 Header and Version Group ID Compliance
  let serializedRaw: string = "";
  await runTest("1. ZIP-225 Header: Header is 0x80000005 and version group ID is 0x26A7270A", async () => {
    serializedRaw = serializeV5ShieldingTransaction({
      expiryHeight: 2850000,
      consensusBranchId: NETWORK_CONFIGS.mainnet.consensusBranchId,
      lockTime: 0,
      transparentInput: {
        txid: "99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa",
        vout: 0,
        scriptSigHex: "4730440220" + "aa".repeat(32) + "0220" + "bb".repeat(32) + "0121" + "cc".repeat(33),
      },
      orchardBundle: {
        actions: [createMockOrchardAction(), createMockOrchardAction()], // 1 recipient + 1 dummy padding
        flags: 0x01, // spendsDisabled = true, outputsEnabled = true
        valueBalanceZats: -TEST_PAYOUT_ZATS, // Negative payout zats outflow into Orchard
        anchorHex: EMPTY_TREE_ANCHOR,
        proofHex: crypto.randomBytes(192).toString("hex"),
        bindingSigHex: crypto.randomBytes(64).toString("hex"),
      },
    });

    assert(serializedRaw && serializedRaw.length > 0, "Transaction serialization must produce non-empty hex");

    const parsed = parseV5TransactionWire(serializedRaw);

    // ZIP-225 Section 3: Header is 0x80000005 (v5 overwintered)
    assert.strictEqual(parsed.header, 0x80000005, "Header must be 0x80000005");
    assert.deepStrictEqual(
      Array.from(parsed.headerBytes),
      [0x05, 0x00, 0x00, 0x80],
      "Header little-endian bytes must be [0x05, 0x00, 0x00, 0x80]"
    );

    // ZIP-225 Section 3: VersionGroupId is 0x26A7270A
    assert.strictEqual(parsed.versionGroupId, 0x26a7270a, "Version group ID must be 0x26A7270A");
    assert.deepStrictEqual(
      Array.from(parsed.versionGroupBytes),
      [0x0a, 0x27, 0xa7, 0x26],
      "Version group ID little-endian bytes must be [0x0a, 0x27, 0xa7, 0x26]"
    );
  });

  // 2. Zero Transparent Outputs Invariant (Pure Shielding)
  await runTest("2. Transparent Outputs: Strictly 0 transparent outputs (Pure Shielding Invariant)", async () => {
    const parsed = parseV5TransactionWire(serializedRaw);

    // Strict privacy guarantee: no transparent change or recipient output
    assert.strictEqual(parsed.nOutputs, 0, "Transparent outputs count (nOutputs) MUST be strictly 0");
    assert.strictEqual(parsed.nInputs, 1, "Must have exactly 1 transparent escrow input");
  });

  // 3. Orchard Bundle Action Cardinality (>= 2 Actions for Padding)
  await runTest("3. Orchard Bundle: Contains at least 2 actions (1 recipient + 1 dummy padding)", async () => {
    const parsed = parseV5TransactionWire(serializedRaw);

    assert(parsed.nOrchardActions >= 2, `Expected >= 2 Orchard actions for padding, got ${parsed.nOrchardActions}`);
    assert.strictEqual(parsed.orchardActions.length, 2);

    for (let i = 0; i < parsed.orchardActions.length; i++) {
      const act = parsed.orchardActions[i];
      assert.strictEqual(act.cv.length, 64, `Action ${i} cv must be 32 bytes hex`);
      assert.strictEqual(act.nullifier.length, 64, `Action ${i} nullifier must be 32 bytes hex`);
      assert.strictEqual(act.rk.length, 64, `Action ${i} rk must be 32 bytes hex`);
      assert.strictEqual(act.cmx.length, 64, `Action ${i} cmx must be 32 bytes hex`);
      assert.strictEqual(act.ephemeralKey.length, 64, `Action ${i} ephemeralKey must be 32 bytes hex`);
      assert.strictEqual(act.encCiphertext.length, 1160, `Action ${i} encCiphertext must be 580 bytes hex (1160 chars)`);
      assert.strictEqual(act.outCiphertext.length, 160, `Action ${i} outCiphertext must be 80 bytes hex (160 chars)`);
    }
  });

  // 4. Empty Tree Anchor (0x00...00)
  await runTest("4. Orchard Anchor: Empty tree anchor 0x00...00 (Never expires, no tree sync needed)", async () => {
    const parsed = parseV5TransactionWire(serializedRaw);

    assert.strictEqual(
      parsed.anchor,
      EMPTY_TREE_ANCHOR,
      "Anchor must be exactly 32 bytes of zeros (0x00...00, Anchor::empty_tree())"
    );
  });

  // 5. Value Balance is Negative Payout Zatoshis
  await runTest("5. Value Balance: v_balanceOrchard equals negative payout zatoshis (-payoutZats)", async () => {
    const parsed = parseV5TransactionWire(serializedRaw);

    // In Zcash V5: funds flowing into Orchard produce a negative value balance
    assert.strictEqual(
      parsed.valueBalanceZats,
      BigInt(-TEST_PAYOUT_ZATS),
      `valueBalanceOrchard must equal -${TEST_PAYOUT_ZATS}`
    );

    // Flags must be 0x01 (spendsDisabled = 1, outputsEnabled = 1)
    assert.strictEqual(parsed.flags, 0x01, "Flags must be 0x01 (spendsDisabled=true, outputsEnabled=true)");
  });

  // 6. Network Consensus Branch ID Verification (Nu5 Mainnet vs Testnet)
  await runTest("6. Consensus Branch ID: Accurately encodes Nu5 consensus branch ID", async () => {
    const mainnetTx = serializeV5ShieldingTransaction({
      expiryHeight: 2850000,
      consensusBranchId: NETWORK_CONFIGS.mainnet.consensusBranchId, // 0xc2d6d0b4
      transparentInput: {
        txid: "11".repeat(32),
        vout: 0,
        scriptSigHex: "00",
      },
      orchardBundle: {
        actions: [createMockOrchardAction(), createMockOrchardAction()],
        flags: 0x01,
        valueBalanceZats: -100000,
        anchorHex: EMPTY_TREE_ANCHOR,
        proofHex: "00",
        bindingSigHex: "00".repeat(64),
      },
    });

    const parsedMainnet = parseV5TransactionWire(mainnetTx);
    assert.strictEqual(parsedMainnet.consensusBranchId, NETWORK_CONFIGS.mainnet.consensusBranchId);

    const testnetTx = serializeV5ShieldingTransaction({
      expiryHeight: 3000000,
      consensusBranchId: NETWORK_CONFIGS.testnet.consensusBranchId, // 0xb5fbcc0c
      transparentInput: {
        txid: "22".repeat(32),
        vout: 0,
        scriptSigHex: "00",
      },
      orchardBundle: {
        actions: [createMockOrchardAction(), createMockOrchardAction()],
        flags: 0x01,
        valueBalanceZats: -100000,
        anchorHex: EMPTY_TREE_ANCHOR,
        proofHex: "00",
        bindingSigHex: "00".repeat(64),
      },
    });

    const parsedTestnet = parseV5TransactionWire(testnetTx);
    assert.strictEqual(parsedTestnet.consensusBranchId, NETWORK_CONFIGS.testnet.consensusBranchId);
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Shielded Outflow Contract Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
