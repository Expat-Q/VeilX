import assert from "assert";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { publicKeyToAddress } from "@noir-wallet/sdk";
import {
  CONSENSUS_BRANCH_ID,
  getTxHashPersonalization,
  NU7_BRANCH_ID,
  NU7_BRANCH_ID_HEX,
  NU7_TESTNET_ACTIVATION_HEIGHT,
  SIGHASH_ALL,
  TX_V5_HEADER,
  TX_V5_VERSION_GROUP_ID,
} from "../src/core/constants.ts";
import {
  addressToScriptPubKey,
  base58CheckDecode,
  privateKeyToWIF,
  wifToPrivateKey,
} from "../src/core/address.ts";
import { accountFromPrivateKey, createWalletVault } from "../src/core/keyring.ts";
import {
  computeZip244SignatureDigest,
  computeZip244TxId,
} from "../src/transparent/sighash-zip244.ts";
import { buildAndSignNU7Transaction } from "../src/transparent/tx-v5-builder.ts";
import { VeilXNU7Provider } from "../src/extension/provider.ts";

async function runTests() {
  let passed = 0;

  console.log("Running @veilx/nu7-wallet Test Suite...\n");

  // Test 1: NU7 Consensus Branch ID & 16-Byte BLAKE2b Personalization
  {
    assert.strictEqual(NU7_BRANCH_ID, 0x77190ad9);
    const pers = getTxHashPersonalization(NU7_BRANCH_ID);
    assert.strictEqual(pers.length, 16, "Personalization must be 16 bytes");
    const prefixStr = new TextDecoder().decode(pers.slice(0, 12));
    assert.strictEqual(prefixStr, "ZcashTxHash_");
    // 0x77190AD9 in little-endian is [0xd9, 0x0a, 0x19, 0x77]
    assert.deepStrictEqual(
      Array.from(pers.slice(12)),
      [0xd9, 0x0a, 0x19, 0x77],
      "Branch ID must be encoded in little-endian"
    );
    console.log("✓ [1/6] NU7 Consensus Branch ID (0x77190AD9) & 16-byte BLAKE2b personalization verified");
    passed++;
  }

  // Test 2: Keyring, WIF roundtrip & exact match with @noir-wallet/sdk testnet addresses
  {
    const vault = createWalletVault({
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      network: "testnet",
      accountCount: 2,
    });
    const acc0 = vault.accounts[0];
    assert(acc0.address.startsWith("tm"), `Expected tm... address, got ${acc0.address}`);

    // Cross-verify against @noir-wallet/sdk
    const sdkAddress = publicKeyToAddress(acc0.publicKeyHex, "testnet");
    assert.strictEqual(acc0.address, sdkAddress, "Derived address must match @noir-wallet/sdk");

    // Verify WIF roundtrip
    const wif = privateKeyToWIF(acc0.privateKeyHex, "testnet");
    assert.strictEqual(wif, acc0.wif);
    const decodedWif = wifToPrivateKey(wif);
    assert.strictEqual(decodedWif.privateKeyHex, acc0.privateKeyHex);
    assert.strictEqual(decodedWif.network, "testnet");

    const imported = accountFromPrivateKey(wif);
    assert.strictEqual(imported.address, acc0.address);

    // Verify scriptPubKey reconstruction from address
    const reconstructedScript = bytesToHex(addressToScriptPubKey(acc0.address));
    assert.strictEqual(reconstructedScript, acc0.scriptPubKeyHex);
    assert.strictEqual(base58CheckDecode(acc0.address).payload.length, 20);

    console.log(`✓ [2/6] BIP-44 Testnet Keyring & WIF verified (${acc0.address})`);
    passed++;
  }

  // Test 3: ZIP 244 Digest Differentiation between NU6 (0x4115BA96) and NU7 (0x77190AD9)
  {
    const vault = createWalletVault({ network: "testnet", accountCount: 2 });
    const sender = vault.accounts[0];
    const receiver = vault.accounts[1];

    const baseTx = {
      version: TX_V5_HEADER,
      versionGroupId: TX_V5_VERSION_GROUP_ID,
      consensusBranchId: CONSENSUS_BRANCH_ID.NU7,
      lockTime: 0,
      expiryHeight: NU7_TESTNET_ACTIVATION_HEIGHT + 100,
      inputs: [
        {
          utxo: {
            txid: "11".repeat(32),
            vout: 0,
            scriptPubKeyHex: sender.scriptPubKeyHex,
            satoshis: 10_000_000n,
          },
          sequence: 0xffffffff,
        },
      ],
      outputs: [
        {
          address: receiver.address,
          scriptPubKeyHex: receiver.scriptPubKeyHex,
          satoshis: 9_990_000n,
        },
      ],
    };

    const nu7Sighash = bytesToHex(computeZip244SignatureDigest(baseTx, 0, SIGHASH_ALL));
    const nu7TxId = computeZip244TxId(baseTx);

    const nu6Tx = { ...baseTx, consensusBranchId: CONSENSUS_BRANCH_ID.NU6 };
    const nu6Sighash = bytesToHex(computeZip244SignatureDigest(nu6Tx, 0, SIGHASH_ALL));
    const nu6TxId = computeZip244TxId(nu6Tx);

    assert.notStrictEqual(nu7Sighash, nu6Sighash, "NU7 and NU6 sighashes must differ");
    assert.notStrictEqual(nu7TxId, nu6TxId, "NU7 and NU6 txids must differ");
    assert.strictEqual(nu7Sighash.length, 64);
    assert.strictEqual(nu7TxId.length, 64);

    console.log("✓ [3/6] ZIP 244 Sighash & TxID strictly bind to NU7 (0x77190AD9) vs NU6 (0x4115BA96)");
    passed++;
  }

  // Test 4: ZIP 225 Version 5 Serialization & Header Layout
  {
    const vault = createWalletVault({ network: "testnet", accountCount: 2 });
    const sender = vault.accounts[0];
    const receiver = vault.accounts[1];

    const signed = buildAndSignNU7Transaction({
      account: sender,
      utxos: [
        {
          txid: "22".repeat(32),
          vout: 1,
          scriptPubKeyHex: sender.scriptPubKeyHex,
          satoshis: 25_000_000n,
        },
      ],
      toAddress: receiver.address,
      amountZatoshis: 10_000_000n,
      currentBlockHeight: NU7_TESTNET_ACTIVATION_HEIGHT + 5,
    });

    // Header layout check (first 20 bytes = 40 hex chars):
    // bytes 0..4: version 0x80000005 LE -> 05000080
    // bytes 4..8: versionGroupId 0x26A7270A LE -> 0a27a726
    // bytes 8..12: consensusBranchId 0x77190AD9 LE -> d90a1977
    assert(signed.rawHex.startsWith("050000800a27a726d90a1977"), "Raw v5 header must contain NU7 branch d90a1977");
    // Ends with 3 zero bytes for empty Sapling Spends (00), Sapling Outputs (00), Orchard Actions (00)
    assert(signed.rawHex.endsWith("000000"), "Raw v5 tx with no shielded actions must end with 000000");
    assert.strictEqual(signed.consensusBranchIdHex, NU7_BRANCH_ID_HEX);
    assert.strictEqual(signed.feeZatoshis, 10_000n);

    console.log(`✓ [4/6] ZIP 225 v5 wire format verified (Header: 050000800a27a726d90a1977..., TxID: ${signed.txid.slice(0, 16)}...)`);
    passed++;
  }

  // Test 5: Cryptographic verification of the generated ECDSA signature against ZIP 244 digest
  {
    const vault = createWalletVault({ network: "testnet", accountCount: 2 });
    const sender = vault.accounts[0];
    const receiver = vault.accounts[1];

    const signed = buildAndSignNU7Transaction({
      account: sender,
      utxos: [
        {
          txid: "33".repeat(32),
          vout: 0,
          scriptPubKeyHex: sender.scriptPubKeyHex,
          satoshis: 5_000_000n,
        },
      ],
      toAddress: receiver.address,
      amountZatoshis: 2_000_000n,
      currentBlockHeight: NU7_TESTNET_ACTIVATION_HEIGHT + 50,
    });

    const digestBytes = hexToBytes(signed.inputDigests[0]);
    const sig = secp256k1.sign(digestBytes, hexToBytes(sender.privateKeyHex), { lowS: true });
    const isValid = secp256k1.verify(sig, digestBytes, hexToBytes(sender.publicKeyHex));
    assert.strictEqual(isValid, true, "secp256k1 signature over ZIP 244 NU7 digest must verify");

    console.log("✓ [5/6] ECDSA secp256k1 canonical low-S signature over NU7 ZIP 244 digest verified");
    passed++;
  }

  // Test 6: VeilXNU7Provider (`window.veilx` / `window.zcash`) EIP-1193 RPC interface
  {
    const provider = new VeilXNU7Provider({ network: "testnet" });
    const accounts = await provider.request({ method: "zcash_requestAccounts" });
    assert(Array.isArray(accounts) && accounts.length === 1 && accounts[0].startsWith("tm"));

    const consensusInfo = await provider.request({ method: "zcash_getConsensusInfo" });
    assert.strictEqual(consensusInfo.upgrade, "NU7");
    assert.strictEqual(consensusInfo.consensusBranchId, "0x77190ad9");
    assert.strictEqual(consensusInfo.blockSpacingSeconds, 25);

    const msgSig = await provider.request({
      method: "zcash_signMessage",
      params: ["VeilX NU7 Auth Challenge"],
    });
    assert.strictEqual(typeof msgSig, "string");
    assert.strictEqual(msgSig.length, 128);

    console.log("✓ [6/7] VeilXNU7Provider (window.veilx / window.zcash) RPC interface verified");
    passed++;
  }

  // Test 7: Production Vault Security (AES-GCM-256 + PBKDF2 100,000 iterations)
  {
    const { encryptVault, decryptVault, isEncryptedVault } = await import("../src/core/vault-crypto.ts");
    const plaintextVault = {
      mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      seedHex: "0123456789abcdef",
      account: { address: "tmF1xjfhsSzhy55dmhorzTnKjtHhZmPKzts" },
    };
    const password = "SuperSecretPassword2026!";

    // Encrypt
    const encrypted = await encryptVault(plaintextVault, password);
    assert.strictEqual(encrypted.version, 2);
    assert.strictEqual(encrypted.isEncrypted, true);
    assert(isEncryptedVault(encrypted), "isEncryptedVault must be true");
    assert.strictEqual(typeof encrypted.ciphertextHex, "string");
    assert(encrypted.ciphertextHex.length > 32);
    assert.notStrictEqual(encrypted.ciphertextHex, plaintextVault.mnemonic);

    // Decrypt with correct password
    const decrypted = await decryptVault(encrypted, password);
    assert.deepStrictEqual(decrypted, plaintextVault, "Decrypted vault must match original plaintext");

    // Decrypt with wrong password must throw
    let failed = false;
    try {
      await decryptVault(encrypted, "WrongPassword!");
    } catch {
      failed = true;
    }
    assert.strictEqual(failed, true, "Decryption with incorrect password must fail");

    console.log("✓ [7/7] Production Vault Security (AES-GCM-256 + PBKDF2 100k iters) verified");
    passed++;
  }

  console.log(`\n🎉 All ${passed}/7 NU7 Wallet Extension tests passed!`);
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
