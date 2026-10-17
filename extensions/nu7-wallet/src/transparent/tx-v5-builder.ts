import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  ACTIVE_TESTNET_BRANCH_ID,
  DEFAULT_EXPIRY_DELTA_BLOCKS,
  GRACE_ACTIONS,
  MARGINAL_FEE_ZATOSHIS,
  NU7_BRANCH_ID,
  SIGHASH_ALL,
  TX_V5_HEADER,
  TX_V5_VERSION_GROUP_ID,
} from "../core/constants.ts";
import { addressToScriptPubKey } from "../core/address.ts";
import {
  computeZip244SignatureDigest,
  computeZip244TxId,
  concatBytes,
  encodeCompactSize,
  reverseBytes,
  writeInt64LE,
  writeUint32LE,
} from "./sighash-zip244.ts";
import type {
  DerivedAccount,
  SignedV5Transaction,
  TransparentOutput,
  TransparentUTXO,
  UnsignedV5Transaction,
} from "../types.ts";

/**
 * Calculate ZIP 317 / ZIP 235 compliant transaction fee in zatoshis
 */
export function calculateZip317Fee(inputCount: number, outputCount: number): bigint {
  const logicalActions = BigInt(Math.max(inputCount, outputCount));
  const billableActions = logicalActions > GRACE_ACTIONS ? logicalActions : GRACE_ACTIONS;
  return billableActions * MARGINAL_FEE_ZATOSHIS;
}

/**
 * Encode an ECDSA (r, s) signature into strict ASN.1 DER format + 1-byte sighash flag
 */
export function encodeDerSignatureWithSighash(
  r: bigint,
  s: bigint,
  sighashType: number = SIGHASH_ALL
): Uint8Array {
  const toAsn1Int = (n: bigint): Uint8Array => {
    let hex = n.toString(16);
    if (hex.length % 2 !== 0) hex = "0" + hex;
    const raw = hexToBytes(hex);
    // If MSB has bit 7 set (>= 0x80), prepend 0x00 for positive ASN.1 integer
    if (raw[0] & 0x80) {
      const padded = new Uint8Array(raw.length + 1);
      padded[0] = 0x00;
      padded.set(raw, 1);
      return padded;
    }
    return raw;
  };

  const rBytes = toAsn1Int(r);
  const sBytes = toAsn1Int(s);
  const seqLen = 2 + rBytes.length + 2 + sBytes.length;

  const out = new Uint8Array(2 + seqLen + 1);
  let offset = 0;
  out[offset++] = 0x30; // ASN.1 SEQUENCE
  out[offset++] = seqLen;
  out[offset++] = 0x02; // ASN.1 INTEGER (r)
  out[offset++] = rBytes.length;
  out.set(rBytes, offset);
  offset += rBytes.length;
  out[offset++] = 0x02; // ASN.1 INTEGER (s)
  out[offset++] = sBytes.length;
  out.set(sBytes, offset);
  offset += sBytes.length;
  out[offset++] = sighashType & 0xff;
  return out;
}

/**
 * Build P2PKH unlocking scriptSig: <push sigWithSighash> <push compressedPubKey>
 */
export function buildP2PKHScriptSig(sigWithSighash: Uint8Array, compressedPubKey: Uint8Array): Uint8Array {
  return concatBytes(
    new Uint8Array([sigWithSighash.length]),
    sigWithSighash,
    new Uint8Array([compressedPubKey.length]),
    compressedPubKey
  );
}

/**
 * Serialize a signed ZIP 225 Version 5 transaction into wire-format bytes
 */
export function serializeSignedV5Transaction(
  tx: UnsignedV5Transaction,
  scriptSigs: Uint8Array[]
): Uint8Array {
  if (scriptSigs.length !== tx.inputs.length) {
    throw new Error("scriptSigs count must match tx.inputs count");
  }

  const parts: Uint8Array[] = [
    // Common Transaction Header Fields (20 bytes)
    writeUint32LE(tx.version),
    writeUint32LE(tx.versionGroupId),
    writeUint32LE(tx.consensusBranchId),
    writeUint32LE(tx.lockTime),
    writeUint32LE(tx.expiryHeight),
    // Transparent Inputs
    encodeCompactSize(tx.inputs.length),
  ];

  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    const sigScript = scriptSigs[i];
    const txidWire = reverseBytes(hexToBytes(inp.utxo.txid));
    parts.push(
      txidWire,
      writeUint32LE(inp.utxo.vout),
      encodeCompactSize(sigScript.length),
      sigScript,
      writeUint32LE(inp.sequence)
    );
  }

  // Transparent Outputs
  parts.push(encodeCompactSize(tx.outputs.length));
  for (const out of tx.outputs) {
    const pkScript = hexToBytes(out.scriptPubKeyHex);
    parts.push(
      writeInt64LE(out.satoshis),
      encodeCompactSize(pkScript.length),
      pkScript
    );
  }

  // Empty Sapling & Orchard bundle counts (per ZIP 225: when 0, no further fields are present)
  parts.push(
    encodeCompactSize(0), // nSpendsSapling = 0
    encodeCompactSize(0), // nOutputsSapling = 0
    encodeCompactSize(0) // nActionsOrchard = 0
  );

  return concatBytes(...parts);
}

/**
 * Build and sign a complete Zcash Version 5 (ZIP 225 / ZIP 244) transaction for NU7 (0x77190AD9)
 */
export function buildAndSignNU7Transaction(params: {
  account: DerivedAccount;
  utxos: TransparentUTXO[];
  toAddress: string;
  amountZatoshis: bigint;
  currentBlockHeight: number;
  consensusBranchId?: number;
  feeZatoshis?: bigint;
}): SignedV5Transaction {
  const {
    account,
    utxos,
    toAddress,
    amountZatoshis,
    currentBlockHeight,
    consensusBranchId = NU7_BRANCH_ID,
  } = params;

  if (amountZatoshis <= 0n) {
    throw new Error("Transfer amount must be greater than 0 zatoshis");
  }
  if (utxos.length === 0) {
    throw new Error("No UTXOs available to fund transaction");
  }

  const normalizedUtxos: TransparentUTXO[] = utxos.map((u: any) => ({
    txid: u.txid || u.outpoint_txid,
    vout: u.vout !== undefined ? u.vout : (u.outpoint_index !== undefined ? u.outpoint_index : 0),
    satoshis: BigInt(u.satoshis !== undefined ? u.satoshis : (u.value_zat !== undefined ? u.value_zat : 0)),
    scriptPubKeyHex: u.scriptPubKeyHex || account.scriptPubKeyHex,
  }));

  // Sort UTXOs largest-first for clean selection
  const sorted = [...normalizedUtxos].sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1));
  const selected: TransparentUTXO[] = [];
  let accumulated = 0n;

  for (const utxo of sorted) {
    selected.push(utxo);
    accumulated += utxo.satoshis;
    const tentativeFee = params.feeZatoshis ?? calculateZip317Fee(selected.length, 2);
    if (accumulated >= amountZatoshis + tentativeFee) {
      break;
    }
  }

  const recipientScriptHex = bytesToHex(addressToScriptPubKey(toAddress));
  const outputs: TransparentOutput[] = [
    {
      address: toAddress,
      scriptPubKeyHex: recipientScriptHex,
      satoshis: amountZatoshis,
    },
  ];

  // Determine exact fee and whether a change output is needed
  let fee = params.feeZatoshis ?? calculateZip317Fee(selected.length, 2);
  if (accumulated < amountZatoshis + fee) {
    throw new Error(
      `Insufficient funds: have ${accumulated} zatoshis, need ${amountZatoshis + fee} zatoshis (amount + fee)`
    );
  }

  const changeZatoshis = accumulated - amountZatoshis - fee;
  // Only add change output if above dust threshold (500 zatoshis)
  if (changeZatoshis >= 500n) {
    outputs.push({
      address: account.address,
      scriptPubKeyHex: account.scriptPubKeyHex,
      satoshis: changeZatoshis,
    });
  } else {
    // Fold tiny dust into fee
    fee += changeZatoshis;
  }

  const expiryHeight = currentBlockHeight + DEFAULT_EXPIRY_DELTA_BLOCKS;

  const unsignedTx: UnsignedV5Transaction = {
    version: TX_V5_HEADER,
    versionGroupId: TX_V5_VERSION_GROUP_ID,
    consensusBranchId,
    lockTime: 0,
    expiryHeight,
    inputs: selected.map((utxo) => ({
      utxo,
      sequence: 0xffffffff,
    })),
    outputs,
  };

  const privKeyBytes = hexToBytes(account.privateKeyHex);
  const pubKeyBytes = hexToBytes(account.publicKeyHex);
  const scriptSigs: Uint8Array[] = [];
  const inputDigests: string[] = [];

  for (let i = 0; i < unsignedTx.inputs.length; i++) {
    const sighash = computeZip244SignatureDigest(unsignedTx, i, SIGHASH_ALL);
    inputDigests.push(bytesToHex(sighash));

    // Sign with canonical low-S enforced by @noble/curves/secp256k1
    const sig = secp256k1.sign(sighash, privKeyBytes, { lowS: true });
    const derWithSighash = encodeDerSignatureWithSighash(sig.r, sig.s, SIGHASH_ALL);
    scriptSigs.push(buildP2PKHScriptSig(derWithSighash, pubKeyBytes));
  }

  const rawBytes = serializeSignedV5Transaction(unsignedTx, scriptSigs);
  const txid = computeZip244TxId(unsignedTx);

  return {
    txid,
    rawHex: bytesToHex(rawBytes),
    feeZatoshis: fee,
    consensusBranchIdHex: (consensusBranchId >>> 0).toString(16),
    expiryHeight,
    inputDigests,
  };
}
