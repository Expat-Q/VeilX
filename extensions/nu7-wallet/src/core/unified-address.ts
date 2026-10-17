import { blake2b } from "@noble/hashes/blake2b";
import { blake2s } from "@noble/hashes/blake2s";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { jubjub } from "@noble/curves/jubjub";
import { pallas } from "@noble/curves/pasta";
import type { ZcashNetwork } from "../types.ts";

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

const GH_FIRST_BLOCK = new TextEncoder().encode(
  "096b36a5804bfacef1691e173c366a47ff5ba84a44f26ddd7e8d9f79d5b42df0"
);

/**
 * Bech32 / Bech32m Polymod
 */
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >>> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >>> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

/**
 * Convert between bit groups (e.g. 8-bit bytes <-> 5-bit Bech32 words)
 */
export function convertBits(
  data: Uint8Array | number[],
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || value >>> fromBits !== 0) {
      throw new Error("Invalid value for convertBits");
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >>> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error("Invalid padding in convertBits");
  }
  return ret;
}

/**
 * Encode bytes into Bech32 (Sapling) or Bech32m (ZIP-316 Unified Address)
 */
export function bech32EncodeBytes(
  hrp: string,
  bytes: Uint8Array,
  variant: "bech32" | "bech32m"
): string {
  const words = convertBits(bytes, 8, 5, true);
  const specConst = variant === "bech32m" ? BECH32M_CONST : BECH32_CONST;
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ specConst;
  const checksum: number[] = [];
  for (let p = 0; p < 6; p++) {
    checksum.push((mod >>> (5 * (5 - p))) & 31);
  }
  const combined = [...words, ...checksum];
  let out = hrp + "1";
  for (const w of combined) {
    out += BECH32_CHARSET[w];
  }
  return out;
}

/**
 * Decode Bech32 or Bech32m string back into { hrp, bytes, variant }
 */
export function bech32DecodeToBytes(str: string): {
  hrp: string;
  bytes: Uint8Array;
  variant: "bech32" | "bech32m";
} {
  const lower = str.toLowerCase();
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length) {
    throw new Error("Invalid Bech32/Bech32m string separator");
  }
  const hrp = lower.slice(0, pos);
  const dataWords: number[] = [];
  for (let i = pos + 1; i < lower.length; i++) {
    const idx = BECH32_CHARSET.indexOf(lower[i]);
    if (idx === -1) throw new Error(`Invalid Bech32 character: ${lower[i]}`);
    dataWords.push(idx);
  }
  const check = bech32Polymod([...hrpExpand(hrp), ...dataWords]);
  let variant: "bech32" | "bech32m";
  if (check === BECH32_CONST) {
    variant = "bech32";
  } else if (check === BECH32M_CONST) {
    variant = "bech32m";
  } else {
    throw new Error("Invalid Bech32/Bech32m checksum");
  }
  const payloadWords = dataWords.slice(0, dataWords.length - 6);
  const bytes = new Uint8Array(convertBits(payloadWords, 5, 8, false));
  return { hrp, bytes, variant };
}

/**
 * ZIP-316 F4Jumble H_i(u) = BLAKE2b-(8 * l_L)("UA_F4Jumble_H" || [i, 0, 0], u)
 */
function f4H(i: number, u: Uint8Array, lL: number): Uint8Array {
  const pers = new Uint8Array(16);
  pers.set(new TextEncoder().encode("UA_F4Jumble_H"), 0); // 13 bytes
  pers[13] = i & 0xff;
  pers[14] = 0;
  pers[15] = 0;
  return blake2b(u, { dkLen: lL, personalization: pers });
}

/**
 * ZIP-316 F4Jumble G_i(u) = first l_R bytes of concat(BLAKE2b-512("UA_F4Jumble_G" || [i] || I2LEOSP_16(j), u))
 */
function f4G(i: number, u: Uint8Array, lR: number): Uint8Array {
  const out = new Uint8Array(lR);
  const numBlocks = Math.ceil(lR / 64);
  const prefix = new TextEncoder().encode("UA_F4Jumble_G"); // 13 bytes
  for (let j = 0; j < numBlocks; j++) {
    const pers = new Uint8Array(16);
    pers.set(prefix, 0);
    pers[13] = i & 0xff;
    pers[14] = j & 0xff;
    pers[15] = (j >>> 8) & 0xff;
    const block = blake2b(u, { dkLen: 64, personalization: pers });
    const offset = j * 64;
    const copyLen = Math.min(64, lR - offset);
    out.set(block.slice(0, copyLen), offset);
  }
  return out;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

/**
 * ZIP-316 F4Jumble (4-round unkeyed Feistel permutation)
 */
export function f4Jumble(message: Uint8Array): Uint8Array {
  const lM = message.length;
  if (lM < 48 || lM > 4194368) {
    throw new Error(`F4Jumble invalid input length: ${lM}`);
  }
  const lL = Math.min(64, Math.floor(lM / 2));
  const lR = lM - lL;
  const a = message.slice(0, lL);
  const b = message.slice(lL);

  const x = xorBytes(b, f4G(0, a, lR));
  const y = xorBytes(a, f4H(0, x, lL));
  const d = xorBytes(x, f4G(1, y, lR));
  const c = xorBytes(y, f4H(1, d, lL));

  const out = new Uint8Array(lM);
  out.set(c, 0);
  out.set(d, lL);
  return out;
}

/**
 * ZIP-316 F4Jumble Inverse (F4Jumble^-1)
 */
export function f4JumbleInverse(jumbled: Uint8Array): Uint8Array {
  const lM = jumbled.length;
  if (lM < 48 || lM > 4194368) {
    throw new Error(`F4JumbleInverse invalid input length: ${lM}`);
  }
  const lL = Math.min(64, Math.floor(lM / 2));
  const lR = lM - lL;
  const c = jumbled.slice(0, lL);
  const d = jumbled.slice(lL);

  const y = xorBytes(c, f4H(1, d, lL));
  const x = xorBytes(d, f4G(1, y, lR));
  const a = xorBytes(y, f4H(0, x, lL));
  const b = xorBytes(x, f4G(0, a, lR));

  const out = new Uint8Array(lM);
  out.set(a, 0);
  out.set(b, lL);
  return out;
}

/**
 * Sapling DiversifyHash^J(d): Finds a valid 11-byte diversifier `d` and its Jubjub point `g_d`
 */
export function deriveValidSaplingDiversifier(seedKey: Uint8Array): {
  d: Uint8Array;
  gd: InstanceType<typeof jubjub.Point>;
} {
  const pers = new TextEncoder().encode("Zcash_gd");
  for (let counter = 0; counter < 256; counter++) {
    const d = blake2b(new Uint8Array([...seedKey, counter]), { dkLen: 16 }).slice(0, 11);
    const input = new Uint8Array(GH_FIRST_BLOCK.length + 11);
    input.set(GH_FIRST_BLOCK, 0);
    input.set(d, GH_FIRST_BLOCK.length);
    const hash = blake2s(input, { dkLen: 32, personalization: pers });
    try {
      const pt = jubjub.Point.fromHex(hash).multiply(8n);
      if (!pt.equals(jubjub.Point.ZERO)) {
        return { d, gd: pt };
      }
    } catch {
      // Try next counter
    }
  }
  throw new Error("Failed to find valid Sapling diversifier");
}

/**
 * Derive a valid 43-byte Sapling Raw Receiver (11-byte d || 32-byte Jubjub pk_d)
 * and Bech32 Sapling Shielded Address (`ztestsapling1...` on testnet, `zs1...` on mainnet)
 */
export function deriveSaplingAddress(
  seed: Uint8Array,
  accountIndex: number = 0,
  network: ZcashNetwork = "testnet"
): { saplingAddress: string; saplingRawReceiver: Uint8Array } {
  const pers = new TextEncoder().encode("ZcashIP32Sapling");
  const master = blake2b(new Uint8Array([...seed, accountIndex & 0xff]), {
    dkLen: 64,
    personalization: pers,
  });

  const { d, gd } = deriveValidSaplingDiversifier(master.slice(32, 64));
  // Reduce 32-byte key modulo Jubjub subgroup order r
  const rOrder = jubjub.CURVE.n;
  const rawScalar = BigInt("0x" + bytesToHex(master.slice(0, 32)));
  const ivkScalar = (rawScalar % (rOrder - 1n)) + 1n;

  const pkdBytes = gd.multiply(ivkScalar).toRawBytes(); // 32 bytes
  const rawReceiver = new Uint8Array(43);
  rawReceiver.set(d, 0);
  rawReceiver.set(pkdBytes, 11);

  const hrp = network === "testnet" ? "ztestsapling" : "zs";
  const saplingAddress = bech32EncodeBytes(hrp, rawReceiver, "bech32");
  return { saplingAddress, saplingRawReceiver: rawReceiver };
}

/**
 * Encode a Pallas affine point (x, y) into canonical 32-byte Zcash Orchard representation
 * (255-bit little-endian x coordinate + top bit 255 = LSB of y)
 */
function encodeOrchardPallasPoint(pt: InstanceType<typeof pallas.Point>): Uint8Array {
  const affine = pt.toAffine();
  const xBytes = new Uint8Array(32);
  let xVal = affine.x;
  for (let i = 0; i < 32; i++) {
    xBytes[i] = Number(xVal & 0xffn);
    xVal >>= 8n;
  }
  const ySign = Number(affine.y & 1n);
  xBytes[31] = (xBytes[31] & 0x7f) | (ySign << 7);
  return xBytes;
}

/**
 * Derive a valid 43-byte Orchard Raw Receiver (11-byte d || 32-byte Pallas pk_d)
 */
export function deriveOrchardRawReceiver(seed: Uint8Array, accountIndex: number = 0): Uint8Array {
  const pers = new TextEncoder().encode("ZcashIP32Orchard");
  const master = blake2b(new Uint8Array([...seed, accountIndex & 0xff]), {
    dkLen: 64,
    personalization: pers,
  });
  const d = master.slice(32, 43); // 11-byte Orchard diversifier (all 11-byte values are valid in Orchard)
  const qOrder = pallas.CURVE.n;
  const rawScalar = BigInt("0x" + bytesToHex(master.slice(0, 32)));
  const ivkScalar = (rawScalar % (qOrder - 1n)) + 1n;

  const pkdPoint = pallas.Point.BASE.multiply(ivkScalar);
  const pkdBytes = encodeOrchardPallasPoint(pkdPoint);

  const rawReceiver = new Uint8Array(43);
  rawReceiver.set(d, 0);
  rawReceiver.set(pkdBytes, 11);
  return rawReceiver;
}

/**
 * Encode a ZIP-316 Unified Address (`utest1...` on testnet, `u1...` on mainnet)
 * Receivers are encoded in ascending order of Typecode:
 * - 0x00: P2PKH (20 bytes, optional)
 * - 0x02: Sapling (43 bytes, optional)
 * - 0x03: Orchard (43 bytes)
 */
export function encodeUnifiedAddress(params: {
  network?: ZcashNetwork;
  p2pkhPubKeyHash?: Uint8Array | string;
  saplingRawReceiver?: Uint8Array;
  orchardRawReceiver?: Uint8Array;
}): string {
  const network = params.network || "testnet";
  const hrp = network === "testnet" ? "utest" : "u";

  const items: Uint8Array[] = [];

  // Typecode 0x00: Transparent P2PKH (20 bytes)
  if (params.p2pkhPubKeyHash) {
    const pkh =
      typeof params.p2pkhPubKeyHash === "string"
        ? hexToBytes(params.p2pkhPubKeyHash)
        : params.p2pkhPubKeyHash;
    if (pkh.length !== 20) throw new Error("P2PKH receiver must be 20 bytes");
    const tlv = new Uint8Array(2 + 20);
    tlv[0] = 0x00; // typecode 0x00
    tlv[1] = 20; // length 20
    tlv.set(pkh, 2);
    items.push(tlv);
  }

  // Typecode 0x02: Sapling (43 bytes)
  if (params.saplingRawReceiver) {
    if (params.saplingRawReceiver.length !== 43) {
      throw new Error("Sapling receiver must be 43 bytes");
    }
    const tlv = new Uint8Array(2 + 43);
    tlv[0] = 0x02; // typecode 0x02
    tlv[1] = 43; // length 43
    tlv.set(params.saplingRawReceiver, 2);
    items.push(tlv);
  }

  // Typecode 0x03: Orchard (43 bytes)
  if (params.orchardRawReceiver) {
    if (params.orchardRawReceiver.length !== 43) {
      throw new Error("Orchard receiver must be 43 bytes");
    }
    const tlv = new Uint8Array(2 + 43);
    tlv[0] = 0x03; // typecode 0x03
    tlv[1] = 43; // length 43
    tlv.set(params.orchardRawReceiver, 2);
    items.push(tlv);
  }

  if (!params.saplingRawReceiver && !params.orchardRawReceiver) {
    throw new Error("Unified Address must include at least one shielded receiver (Sapling or Orchard)");
  }

  // 16-byte zero-padded HRP
  const padding = new Uint8Array(16);
  padding.set(new TextEncoder().encode(hrp), 0);

  const totalLen = items.reduce((s, a) => s + a.length, 0) + 16;
  const rawBytes = new Uint8Array(totalLen);
  let offset = 0;
  for (const item of items) {
    rawBytes.set(item, offset);
    offset += item.length;
  }
  rawBytes.set(padding, offset);

  const jumbled = f4Jumble(rawBytes);
  return bech32EncodeBytes(hrp, jumbled, "bech32m");
}

/**
 * Decode and verify a ZIP-316 Unified Address (`utest1...` or `u1...`)
 */
export function decodeUnifiedAddress(ua: string): {
  hrp: string;
  receivers: Array<{ typecode: number; dataHex: string }>;
} {
  const { hrp, bytes, variant } = bech32DecodeToBytes(ua);
  if (variant !== "bech32m") {
    throw new Error("Unified Address must use Bech32m encoding");
  }
  const unjumbled = f4JumbleInverse(bytes);
  const expectedPadding = new Uint8Array(16);
  expectedPadding.set(new TextEncoder().encode(hrp), 0);

  const actualPadding = unjumbled.slice(unjumbled.length - 16);
  for (let i = 0; i < 16; i++) {
    if (actualPadding[i] !== expectedPadding[i]) {
      throw new Error("Invalid Unified Address HRP padding after F4Jumble^-1");
    }
  }

  const body = unjumbled.slice(0, unjumbled.length - 16);
  const receivers: Array<{ typecode: number; dataHex: string }> = [];
  let offset = 0;
  let prevTypecode = -1;

  while (offset < body.length) {
    const typecode = body[offset++];
    const len = body[offset++];
    if (typecode <= prevTypecode) {
      throw new Error("Unified Address receivers are not in strictly ascending order of typecode");
    }
    prevTypecode = typecode;
    const data = body.slice(offset, offset + len);
    if (data.length !== len) {
      throw new Error("Truncated receiver in Unified Address");
    }
    receivers.push({ typecode, dataHex: bytesToHex(data) });
    offset += len;
  }

  return { hrp, receivers };
}
