import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  getTxHashPersonalization,
  SIGHASH_ALL,
  SIGHASH_ANYONECANPAY,
  SIGHASH_NONE,
  SIGHASH_SINGLE,
  ZIP244_PERSONALIZATION,
} from "../core/constants.ts";
import type { UnsignedV5Transaction } from "../types.ts";

/**
 * Helper to compute BLAKE2b-256 with a 16-byte ASCII or raw byte personalization
 */
export function blake2b256(personalization: string | Uint8Array, data: Uint8Array): Uint8Array {
  const persBytes =
    typeof personalization === "string"
      ? new TextEncoder().encode(personalization)
      : personalization;
  if (persBytes.length !== 16) {
    throw new Error(`BLAKE2b personalization must be exactly 16 bytes (got ${persBytes.length})`);
  }
  return blake2b(data, { dkLen: 32, personalization: persBytes });
}

/**
 * Encode integer as Zcash/Bitcoin CompactSize
 */
export function encodeCompactSize(n: number): Uint8Array {
  if (n < 0xfd) {
    return new Uint8Array([n]);
  } else if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, n, true);
    return buf;
  } else if (n <= 0xffffffff) {
    const buf = new Uint8Array(5);
    buf[0] = 0xfe;
    new DataView(buf.buffer).setUint32(1, n, true);
    return buf;
  } else {
    const buf = new Uint8Array(9);
    buf[0] = 0xff;
    new DataView(buf.buffer).setBigUint64(1, BigInt(n), true);
    return buf;
  }
}

export function writeUint32LE(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val >>> 0, true);
  return buf;
}

export function writeInt64LE(val: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, val, true);
  return buf;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

/**
 * Reverse byte order (used for converting display-order txid to wire little-endian outpoint hash)
 */
export function reverseBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[bytes.length - 1 - i];
  }
  return out;
}

/**
 * T.1 / S.1: header_digest
 * BLAKE2b-256("ZTxIdHeadersHash", version || version_group_id || consensus_branch_id || lock_time || expiry_height)
 */
export function computeHeaderDigest(tx: UnsignedV5Transaction): Uint8Array {
  const data = concatBytes(
    writeUint32LE(tx.version),
    writeUint32LE(tx.versionGroupId),
    writeUint32LE(tx.consensusBranchId),
    writeUint32LE(tx.lockTime),
    writeUint32LE(tx.expiryHeight)
  );
  return blake2b256(ZIP244_PERSONALIZATION.HEADERS, data);
}

/**
 * T.2a: prevouts_digest
 */
export function computePrevoutsDigest(tx: UnsignedV5Transaction): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const input of tx.inputs) {
    const txidWire = reverseBytes(hexToBytes(input.utxo.txid));
    if (txidWire.length !== 32) {
      throw new Error(`Invalid input txid length: ${input.utxo.txid}`);
    }
    chunks.push(txidWire, writeUint32LE(input.utxo.vout));
  }
  return blake2b256(ZIP244_PERSONALIZATION.PREVOUTS, concatBytes(...chunks));
}

/**
 * T.2b: sequence_digest
 */
export function computeSequenceDigest(tx: UnsignedV5Transaction): Uint8Array {
  const chunks = tx.inputs.map((inp) => writeUint32LE(inp.sequence));
  return blake2b256(ZIP244_PERSONALIZATION.SEQUENCE, concatBytes(...chunks));
}

/**
 * T.2c: outputs_digest
 */
export function computeOutputsDigest(tx: UnsignedV5Transaction): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const out of tx.outputs) {
    const scriptBytes = hexToBytes(out.scriptPubKeyHex);
    chunks.push(
      writeInt64LE(out.satoshis),
      encodeCompactSize(scriptBytes.length),
      scriptBytes
    );
  }
  return blake2b256(ZIP244_PERSONALIZATION.OUTPUTS, concatBytes(...chunks));
}

/**
 * T.2: transparent_digest (for TxId calculation)
 */
export function computeTransparentTxIdDigest(tx: UnsignedV5Transaction): Uint8Array {
  if (tx.inputs.length === 0 && tx.outputs.length === 0) {
    return blake2b256(ZIP244_PERSONALIZATION.TRANSPARENT, new Uint8Array(0));
  }
  const prevouts = computePrevoutsDigest(tx);
  const sequences = computeSequenceDigest(tx);
  const outputs = computeOutputsDigest(tx);
  return blake2b256(ZIP244_PERSONALIZATION.TRANSPARENT, concatBytes(prevouts, sequences, outputs));
}

/**
 * T.3 / S.3: sapling_digest (empty when no Sapling spends/outputs)
 */
export function computeEmptySaplingDigest(): Uint8Array {
  return blake2b256(ZIP244_PERSONALIZATION.SAPLING, new Uint8Array(0));
}

/**
 * T.4 / S.4: orchard_digest (empty when no Orchard actions)
 */
export function computeEmptyOrchardDigest(): Uint8Array {
  return blake2b256(ZIP244_PERSONALIZATION.ORCHARD, new Uint8Array(0));
}

/**
 * S.2c: amounts_sig_digest
 */
export function computeAmountsSigDigest(tx: UnsignedV5Transaction, anyoneCanPay: boolean): Uint8Array {
  if (anyoneCanPay) {
    return blake2b256(ZIP244_PERSONALIZATION.AMOUNTS, new Uint8Array(0));
  }
  const chunks = tx.inputs.map((inp) => writeInt64LE(inp.utxo.satoshis));
  return blake2b256(ZIP244_PERSONALIZATION.AMOUNTS, concatBytes(...chunks));
}

/**
 * S.2d: scriptpubkeys_sig_digest
 */
export function computeScriptPubKeysSigDigest(tx: UnsignedV5Transaction, anyoneCanPay: boolean): Uint8Array {
  if (anyoneCanPay) {
    return blake2b256(ZIP244_PERSONALIZATION.SCRIPTPUBKEYS, new Uint8Array(0));
  }
  const chunks: Uint8Array[] = [];
  for (const inp of tx.inputs) {
    const scriptBytes = hexToBytes(inp.utxo.scriptPubKeyHex);
    chunks.push(encodeCompactSize(scriptBytes.length), scriptBytes);
  }
  return blake2b256(ZIP244_PERSONALIZATION.SCRIPTPUBKEYS, concatBytes(...chunks));
}

/**
 * S.2g: txin_sig_digest for the specific transparent input at `inputIndex`
 */
export function computeTxInSigDigest(tx: UnsignedV5Transaction, inputIndex: number): Uint8Array {
  const inp = tx.inputs[inputIndex];
  if (!inp) {
    throw new Error(`Input index ${inputIndex} out of bounds`);
  }
  const txidWire = reverseBytes(hexToBytes(inp.utxo.txid));
  const scriptBytes = hexToBytes(inp.utxo.scriptPubKeyHex);
  const data = concatBytes(
    txidWire,
    writeUint32LE(inp.utxo.vout),
    writeInt64LE(inp.utxo.satoshis),
    encodeCompactSize(scriptBytes.length),
    scriptBytes,
    writeUint32LE(inp.sequence)
  );
  return blake2b256(ZIP244_PERSONALIZATION.TXIN, data);
}

/**
 * S.2: transparent_sig_digest for signing transparent input `inputIndex`
 */
export function computeTransparentSigDigest(
  tx: UnsignedV5Transaction,
  inputIndex: number,
  hashType: number = SIGHASH_ALL
): Uint8Array {
  const anyoneCanPay = (hashType & SIGHASH_ANYONECANPAY) !== 0;
  const baseType = hashType & 0x1f;

  const prevoutsDigest = anyoneCanPay
    ? blake2b256(ZIP244_PERSONALIZATION.PREVOUTS, new Uint8Array(0))
    : computePrevoutsDigest(tx);

  const amountsDigest = computeAmountsSigDigest(tx, anyoneCanPay);
  const scriptsDigest = computeScriptPubKeysSigDigest(tx, anyoneCanPay);

  const sequenceDigest =
    anyoneCanPay || baseType === SIGHASH_SINGLE || baseType === SIGHASH_NONE
      ? blake2b256(ZIP244_PERSONALIZATION.SEQUENCE, new Uint8Array(0))
      : computeSequenceDigest(tx);

  let outputsDigest: Uint8Array;
  if (baseType !== SIGHASH_SINGLE && baseType !== SIGHASH_NONE) {
    outputsDigest = computeOutputsDigest(tx);
  } else if (baseType === SIGHASH_SINGLE && inputIndex < tx.outputs.length) {
    const out = tx.outputs[inputIndex];
    const scriptBytes = hexToBytes(out.scriptPubKeyHex);
    outputsDigest = blake2b256(
      ZIP244_PERSONALIZATION.OUTPUTS,
      concatBytes(writeInt64LE(out.satoshis), encodeCompactSize(scriptBytes.length), scriptBytes)
    );
  } else {
    outputsDigest = blake2b256(ZIP244_PERSONALIZATION.OUTPUTS, new Uint8Array(0));
  }

  const txInDigest = computeTxInSigDigest(tx, inputIndex);

  const payload = concatBytes(
    new Uint8Array([hashType & 0xff]),
    prevoutsDigest,
    amountsDigest,
    scriptsDigest,
    sequenceDigest,
    outputsDigest,
    txInDigest
  );

  return blake2b256(ZIP244_PERSONALIZATION.TRANSPARENT, payload);
}

/**
 * Compute the ZIP 244 Signature Digest (`signature_digest`) for transparent input `inputIndex`.
 * Binds directly to `tx.consensusBranchId` (0x77190AD9 for NU7).
 */
export function computeZip244SignatureDigest(
  tx: UnsignedV5Transaction,
  inputIndex: number,
  hashType: number = SIGHASH_ALL
): Uint8Array {
  const headerDigest = computeHeaderDigest(tx);
  const transparentSigDigest = computeTransparentSigDigest(tx, inputIndex, hashType);
  const saplingDigest = computeEmptySaplingDigest();
  const orchardDigest = computeEmptyOrchardDigest();

  const personalization = getTxHashPersonalization(tx.consensusBranchId);
  return blake2b256(
    personalization,
    concatBytes(headerDigest, transparentSigDigest, saplingDigest, orchardDigest)
  );
}

/**
 * Compute the non-malleable ZIP 244 Transaction Identifier (`txid`) for a v5 transaction.
 * Returned in standard big-endian display hex format (reversed from internal digest bytes).
 */
export function computeZip244TxId(tx: UnsignedV5Transaction): string {
  const headerDigest = computeHeaderDigest(tx);
  const transparentDigest = computeTransparentTxIdDigest(tx);
  const saplingDigest = computeEmptySaplingDigest();
  const orchardDigest = computeEmptyOrchardDigest();

  const personalization = getTxHashPersonalization(tx.consensusBranchId);
  const rawTxIdBytes = blake2b256(
    personalization,
    concatBytes(headerDigest, transparentDigest, saplingDigest, orchardDigest)
  );
  // Display txids in Zcash/Bitcoin RPCs are byte-reversed relative to the raw hash output
  return bytesToHex(reverseBytes(rawTxIdBytes));
}
