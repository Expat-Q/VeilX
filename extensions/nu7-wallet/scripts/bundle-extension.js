const fs = require("fs");
const path = require("path");

// Resolve and bundle dependencies into a single browser-compatible script
const baseDir = path.resolve(__dirname, "..");
const outDir = path.resolve(baseDir, "chrome-extension");

console.log("Building wallet-core.bundle.js for Chrome Extension...");

// We can build a clean, self-contained bundle by creating an entry point and bundling
const entryCode = `
const { blake2b } = require("@noble/hashes/blake2b");
const { blake2s } = require("@noble/hashes/blake2s");
const { sha256 } = require("@noble/hashes/sha256");
const { sha512 } = require("@noble/hashes/sha512");
const { pbkdf2 } = require("@noble/hashes/pbkdf2");
const { hmac } = require("@noble/hashes/hmac");
const { ripemd160 } = require("@noble/hashes/ripemd160");
const { bytesToHex, hexToBytes, randomBytes } = require("@noble/hashes/utils");
const { secp256k1 } = require("@noble/curves/secp256k1");
const { jubjub } = require("@noble/curves/jubjub");
const { pallas } = require("@noble/curves/pasta");
const { generateMnemonic, mnemonicToSeedSync, validateMnemonic } = require("@scure/bip39");
const { wordlist: englishWordlist } = require("@scure/bip39/wordlists/english");
const bs58 = require("bs58");

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
const GH_FIRST_BLOCK = new TextEncoder().encode(
  "096b36a5804bfacef1691e173c366a47ff5ba84a44f26ddd7e8d9f79d5b42df0"
);

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >>> i) & 1) chk ^= GEN[i];
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >>> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || value >>> fromBits !== 0) throw new Error("Invalid value in convertBits");
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >>> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error("Invalid padding in convertBits");
  }
  return ret;
}

function bech32EncodeBytes(hrp, bytes, variant) {
  const words = convertBits(bytes, 8, 5, true);
  const specConst = variant === "bech32m" ? BECH32M_CONST : BECH32_CONST;
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ specConst;
  const checksum = [];
  for (let p = 0; p < 6; p++) checksum.push((mod >>> (5 * (5 - p))) & 31);
  let out = hrp + "1";
  for (const w of [...words, ...checksum]) out += BECH32_CHARSET[w];
  return out;
}

function f4H(i, u, lL) {
  const pers = new Uint8Array(16);
  pers.set(new TextEncoder().encode("UA_F4Jumble_H"), 0);
  pers[13] = i & 0xff;
  return blake2b(u, { dkLen: lL, personalization: pers });
}

function f4G(i, u, lR) {
  const out = new Uint8Array(lR);
  const numBlocks = Math.ceil(lR / 64);
  const prefix = new TextEncoder().encode("UA_F4Jumble_G");
  for (let j = 0; j < numBlocks; j++) {
    const pers = new Uint8Array(16);
    pers.set(prefix, 0);
    pers[13] = i & 0xff;
    pers[14] = j & 0xff;
    pers[15] = (j >>> 8) & 0xff;
    const block = blake2b(u, { dkLen: 64, personalization: pers });
    const offset = j * 64;
    out.set(block.slice(0, Math.min(64, lR - offset)), offset);
  }
  return out;
}

function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function f4Jumble(message) {
  const lM = message.length;
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

function deriveValidSaplingDiversifier(seedKey) {
  const pers = new TextEncoder().encode("Zcash_gd");
  for (let counter = 0; counter < 256; counter++) {
    const d = blake2b(new Uint8Array([...seedKey, counter]), { dkLen: 16 }).slice(0, 11);
    const input = new Uint8Array(GH_FIRST_BLOCK.length + 11);
    input.set(GH_FIRST_BLOCK, 0);
    input.set(d, GH_FIRST_BLOCK.length);
    const hash = blake2s(input, { dkLen: 32, personalization: pers });
    try {
      const pt = jubjub.Point.fromHex(hash).multiply(8n);
      if (!pt.equals(jubjub.Point.ZERO)) return { d, gd: pt };
    } catch {}
  }
  throw new Error("Failed to find valid Sapling diversifier");
}

function deriveSaplingAddress(seed, accountIndex = 0, network = "testnet") {
  const pers = new TextEncoder().encode("ZcashIP32Sapling");
  const master = blake2b(new Uint8Array([...seed, accountIndex & 0xff]), { dkLen: 64, personalization: pers });
  const { d, gd } = deriveValidSaplingDiversifier(master.slice(32, 64));
  const rOrder = jubjub.CURVE.n;
  const rawScalar = BigInt("0x" + bytesToHex(master.slice(0, 32)));
  const ivkScalar = (rawScalar % (rOrder - 1n)) + 1n;
  const pkdBytes = gd.multiply(ivkScalar).toRawBytes();
  const rawReceiver = new Uint8Array(43);
  rawReceiver.set(d, 0);
  rawReceiver.set(pkdBytes, 11);
  const hrp = network === "testnet" ? "ztestsapling" : "zs";
  const saplingAddress = bech32EncodeBytes(hrp, rawReceiver, "bech32");
  return { saplingAddress, saplingRawReceiver: rawReceiver };
}

function encodeOrchardPallasPoint(pt) {
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

function deriveOrchardRawReceiver(seed, accountIndex = 0) {
  const pers = new TextEncoder().encode("ZcashIP32Orchard");
  const master = blake2b(new Uint8Array([...seed, accountIndex & 0xff]), { dkLen: 64, personalization: pers });
  const d = master.slice(32, 43);
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

function encodeUnifiedAddress(params) {
  const network = params.network || "testnet";
  const hrp = network === "testnet" ? "utest" : "u";
  const items = [];
  if (params.p2pkhPubKeyHash) {
    const pkh = typeof params.p2pkhPubKeyHash === "string" ? hexToBytes(params.p2pkhPubKeyHash) : params.p2pkhPubKeyHash;
    const tlv = new Uint8Array(22);
    tlv[0] = 0x00; tlv[1] = 20; tlv.set(pkh, 2);
    items.push(tlv);
  }
  if (params.saplingRawReceiver) {
    const tlv = new Uint8Array(45);
    tlv[0] = 0x02; tlv[1] = 43; tlv.set(params.saplingRawReceiver, 2);
    items.push(tlv);
  }
  if (params.orchardRawReceiver) {
    const tlv = new Uint8Array(45);
    tlv[0] = 0x03; tlv[1] = 43; tlv.set(params.orchardRawReceiver, 2);
    items.push(tlv);
  }
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

function doubleSha256Checksum(payload) {
  return sha256(sha256(payload)).slice(0, 4);
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58RawEncode(source) {
  if (source.length === 0) return "";
  let digits = [0];
  for (let i = 0; i < source.length; ++i) {
    let carry = source[i];
    for (let j = 0; j < digits.length; ++j) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let string = "";
  for (let k = 0; source[k] === 0 && k < source.length - 1; ++k) string += "1";
  for (let q = digits.length - 1; q >= 0; --q) string += BASE58_ALPHABET[digits[q]];
  return string;
}

const BASE58_MAP = new Map();
for (let i = 0; i < BASE58_ALPHABET.length; i++) BASE58_MAP.set(BASE58_ALPHABET[i], i);

function base58RawDecode(string) {
  if (string.length === 0) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < string.length; ++i) {
    const c = string[i];
    if (!BASE58_MAP.has(c)) throw new Error("Non-base58 character: " + c);
    let carry = BASE58_MAP.get(c);
    for (let j = 0; j < bytes.length; ++j) {
      const x = bytes[j] * 58 + carry;
      bytes[j] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; string[k] === "1" && k < string.length - 1; ++k) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function base58CheckEncode(prefix, payload) {
  const body = new Uint8Array(prefix.length + payload.length);
  body.set(prefix, 0);
  body.set(payload, prefix.length);
  const checksum = doubleSha256Checksum(body);
  const full = new Uint8Array(body.length + 4);
  full.set(body, 0);
  full.set(checksum, body.length);
  return base58RawEncode(full);
}

function hash160(pub) {
  return ripemd160(sha256(pub));
}

function getRandomBytes(n) {
  return randomBytes(n);
}

function generateMnemonic24() {
  return generateMnemonic(englishWordlist, 256);
}

function validateMnemonicPhrase(phrase) {
  try {
    return validateMnemonic(phrase.trim().replace(/\\s+/g, " "), englishWordlist);
  } catch (e) {
    return false;
  }
}

function mnemonicToSeed(mnemonic, passphrase = "") {
  return mnemonicToSeedSync(mnemonic.trim().replace(/\\s+/g, " "), passphrase);
}

function deriveAccountFromSeed(seed, accountIndex = 0, network = "testnet") {
  const masterI = hmac(sha512, new TextEncoder().encode("Bitcoin seed"), seed);
  const masterKey = masterI.slice(0, 32);
  const masterChain = masterI.slice(32, 64);
  const privKey = sha256(new Uint8Array([...masterKey, accountIndex]));
  const pubBytes = secp256k1.getPublicKey(privKey, true);
  const pkh = hash160(pubBytes);
  const prefix = network === "testnet" ? new Uint8Array([0x1d, 0x25]) : new Uint8Array([0x1c, 0xb8]);
  const address = base58CheckEncode(prefix, pkh);
  const wifPrefix = network === "testnet" ? new Uint8Array([0xef]) : new Uint8Array([0x80]);
  const wifPayload = new Uint8Array(33);
  wifPayload.set(privKey, 0);
  wifPayload[32] = 0x01;
  const wif = base58CheckEncode(wifPrefix, wifPayload);
  const { saplingAddress, saplingRawReceiver } = deriveSaplingAddress(seed, accountIndex, network);
  const orchardRawReceiver = deriveOrchardRawReceiver(seed, accountIndex);
  const unifiedAddress = encodeUnifiedAddress({
    network,
    p2pkhPubKeyHash: pkh,
    saplingRawReceiver,
    orchardRawReceiver,
  });
  return {
    index: accountIndex,
    address,
    saplingAddress,
    unifiedAddress,
    wif,
    publicKey: bytesToHex(pubBytes),
    publicKeyHex: bytesToHex(pubBytes),
    pubKeyHash: bytesToHex(pkh),
    scriptPubKeyHex: bytesToHex(pubKeyHashToScriptPubKey(pkh)),
    privateKeyHex: bytesToHex(privKey),
  };
}

function f4JumbleInverse(jumbled) {
  const lM = jumbled.length;
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

function bech32DecodeToBytes(bech) {
  const pos = bech.lastIndexOf("1");
  if (pos < 1 || pos + 7 > bech.length) throw new Error("Invalid Bech32 length");
  const hrp = bech.slice(0, pos).toLowerCase();
  const data = [];
  for (let p = pos + 1; p < bech.length; ++p) {
    const d = BECH32_CHARSET.indexOf(bech.charAt(p).toLowerCase());
    if (d === -1) throw new Error("Invalid Bech32 character: " + bech.charAt(p));
    data.push(d);
  }
  const values = [...hrpExpand(hrp), ...data];
  const polymod = bech32Polymod(values);
  let variant = null;
  if (polymod === BECH32_CONST) variant = "bech32";
  else if (polymod === BECH32M_CONST) variant = "bech32m";
  else throw new Error("Invalid Bech32 checksum");
  const words = data.slice(0, data.length - 6);
  const bytes = convertBits(words, 5, 8, false);
  return { hrp, bytes: new Uint8Array(bytes), variant };
}

function decodeUnifiedAddress(ua) {
  const { hrp, bytes, variant } = bech32DecodeToBytes(ua);
  if (variant !== "bech32m") throw new Error("Unified Address must use Bech32m encoding");
  const unjumbled = f4JumbleInverse(bytes);
  const expectedPadding = new Uint8Array(16);
  expectedPadding.set(new TextEncoder().encode(hrp), 0);
  const actualPadding = unjumbled.slice(unjumbled.length - 16);
  for (let i = 0; i < 16; i++) {
    if (actualPadding[i] !== expectedPadding[i]) throw new Error("Invalid Unified Address HRP padding");
  }
  const body = unjumbled.slice(0, unjumbled.length - 16);
  const receivers = [];
  let offset = 0;
  let prevTypecode = -1;
  while (offset < body.length) {
    const typecode = body[offset++];
    const len = body[offset++];
    if (typecode <= prevTypecode) throw new Error("Receivers not in ascending order");
    prevTypecode = typecode;
    const data = body.slice(offset, offset + len);
    if (data.length !== len) throw new Error("Truncated receiver in Unified Address");
    receivers.push({ typecode, dataHex: bytesToHex(data) });
    offset += len;
  }
  return { hrp, receivers };
}

function base58CheckDecode(encoded) {
  const raw = base58RawDecode(encoded);
  if (raw.length < 5) throw new Error("Invalid Base58Check string");
  const body = raw.slice(0, raw.length - 4);
  const checksum = raw.slice(raw.length - 4);
  const expected = doubleSha256Checksum(body);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) throw new Error("Invalid Base58Check checksum");
  }
  if (raw.length === 26) return { prefix: body.slice(0, 2), payload: body.slice(2) };
  return { prefix: body.slice(0, 1), payload: body.slice(1) };
}

function pubKeyHashToScriptPubKey(pubKeyHash) {
  const script = new Uint8Array(25);
  script[0] = 0x76;
  script[1] = 0xa9;
  script[2] = 0x14;
  script.set(pubKeyHash, 3);
  script[23] = 0x88;
  script[24] = 0xac;
  return script;
}

function addressToScriptPubKey(address) {
  if (address.startsWith("utest1") || address.startsWith("u1")) {
    const decoded = decodeUnifiedAddress(address);
    const p2pkhRecv = decoded.receivers.find((r) => r.typecode === 0x00);
    if (!p2pkhRecv) {
      throw new Error("Recipient Unified Address has no transparent receiver (Orchard-only recipient requires shielded spend)");
    }
    return pubKeyHashToScriptPubKey(hexToBytes(p2pkhRecv.dataHex));
  }
  const { prefix, payload } = base58CheckDecode(address);
  if (prefix.length === 2 && payload.length === 20) {
    return pubKeyHashToScriptPubKey(payload);
  }
  throw new Error("Unsupported address format: " + address);
}

const IRONWOOD_BRANCH_ID = 0x37a5165b;
const NU7_BRANCH_ID = 0x77190ad9;
const ACTIVE_TESTNET_BRANCH_ID = 0x37a5165b;
const TX_V5_HEADER = 0x80000005;
const TX_V5_VERSION_GROUP_ID = 0x26a7270a;
const SIGHASH_ALL = 0x01;
const GRACE_ACTIONS = 2n;
const MARGINAL_FEE_ZATOSHIS = 5000n;
const DEFAULT_EXPIRY_DELTA_BLOCKS = 40;

function calculateZip317Fee(inputCount, outputCount) {
  const logicalActions = BigInt(Math.max(inputCount, outputCount));
  const billableActions = logicalActions > GRACE_ACTIONS ? logicalActions : GRACE_ACTIONS;
  return billableActions * MARGINAL_FEE_ZATOSHIS;
}

function writeUint32LE(val) {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val >>> 0, true);
  return buf;
}

function writeInt64LE(val) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, BigInt(val), true);
  return buf;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function reverseBytes(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[bytes.length - 1 - i];
  return out;
}

function encodeCompactSize(n) {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, n, true);
    return buf;
  }
  const buf = new Uint8Array(5);
  buf[0] = 0xfe;
  new DataView(buf.buffer).setUint32(1, n, true);
  return buf;
}

function blake2b256(personalization, data) {
  const persBytes = typeof personalization === "string" ? new TextEncoder().encode(personalization) : personalization;
  if (persBytes.length !== 16) {
    throw new Error("BLAKE2b personalization must be exactly 16 bytes (got " + persBytes.length + ")");
  }
  return blake2b(data, { dkLen: 32, personalization: persBytes });
}

function getTxHashPersonalization(consensusBranchId = NU7_BRANCH_ID) {
  const prefix = new TextEncoder().encode("ZcashTxHash_");
  const branchBytes = writeUint32LE(consensusBranchId);
  const pers = new Uint8Array(16);
  pers.set(prefix, 0);
  pers.set(branchBytes, 12);
  return pers;
}

function computeHeaderDigest(tx) {
  const data = concatBytes(
    writeUint32LE(tx.version),
    writeUint32LE(tx.versionGroupId),
    writeUint32LE(tx.consensusBranchId),
    writeUint32LE(tx.lockTime),
    writeUint32LE(tx.expiryHeight)
  );
  return blake2b256("ZTxIdHeadersHash", data);
}

function computePrevoutsDigest(tx) {
  const chunks = [];
  for (const input of tx.inputs) {
    const txidWire = reverseBytes(hexToBytes(input.utxo.txid));
    chunks.push(txidWire, writeUint32LE(input.utxo.vout));
  }
  return blake2b256("ZTxIdPrevoutHash", concatBytes(...chunks));
}

function computeSequenceDigest(tx) {
  const chunks = tx.inputs.map((inp) => writeUint32LE(inp.sequence));
  return blake2b256("ZTxIdSequencHash", concatBytes(...chunks));
}

function computeOutputsDigest(tx) {
  const chunks = [];
  for (const out of tx.outputs) {
    const scriptBytes = hexToBytes(out.scriptPubKeyHex);
    chunks.push(
      writeInt64LE(out.satoshis),
      encodeCompactSize(scriptBytes.length),
      scriptBytes
    );
  }
  return blake2b256("ZTxIdOutputsHash", concatBytes(...chunks));
}

function computeTransparentTxIdDigest(tx) {
  if (tx.inputs.length === 0 && tx.outputs.length === 0) {
    return blake2b256("ZTxIdTranspaHash", new Uint8Array(0));
  }
  const prevouts = computePrevoutsDigest(tx);
  const sequences = computeSequenceDigest(tx);
  const outputs = computeOutputsDigest(tx);
  return blake2b256("ZTxIdTranspaHash", concatBytes(prevouts, sequences, outputs));
}

function computeEmptySaplingDigest() {
  return blake2b256("ZTxIdSaplingHash", new Uint8Array(0));
}

function computeEmptyOrchardDigest() {
  return blake2b256("ZTxIdOrchardHash", new Uint8Array(0));
}

function computeAmountsSigDigest(tx, anyoneCanPay) {
  if (anyoneCanPay) {
    return blake2b256("ZTxTrAmountsHash", new Uint8Array(0));
  }
  const chunks = tx.inputs.map((inp) => writeInt64LE(inp.utxo.satoshis));
  return blake2b256("ZTxTrAmountsHash", concatBytes(...chunks));
}

function computeScriptPubKeysSigDigest(tx, anyoneCanPay) {
  if (anyoneCanPay) {
    return blake2b256("ZTxTrScriptsHash", new Uint8Array(0));
  }
  const chunks = [];
  for (const inp of tx.inputs) {
    const scriptBytes = hexToBytes(inp.utxo.scriptPubKeyHex);
    chunks.push(encodeCompactSize(scriptBytes.length), scriptBytes);
  }
  return blake2b256("ZTxTrScriptsHash", concatBytes(...chunks));
}

function computeTxInSigDigest(tx, inputIndex) {
  const inp = tx.inputs[inputIndex];
  if (!inp) throw new Error("Input index " + inputIndex + " out of bounds");
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
  return blake2b256("Zcash___TxInHash", data);
}

function computeTransparentSigDigest(tx, inputIndex, hashType = SIGHASH_ALL) {
  const anyoneCanPay = (hashType & 0x80) !== 0;
  const baseType = hashType & 0x1f;

  const prevoutsDigest = anyoneCanPay
    ? blake2b256("ZTxIdPrevoutHash", new Uint8Array(0))
    : computePrevoutsDigest(tx);

  const amountsDigest = computeAmountsSigDigest(tx, anyoneCanPay);
  const scriptsDigest = computeScriptPubKeysSigDigest(tx, anyoneCanPay);

  const sequenceDigest =
    anyoneCanPay || baseType === 2 || baseType === 3
      ? blake2b256("ZTxIdSequencHash", new Uint8Array(0))
      : computeSequenceDigest(tx);

  let outputsDigest;
  if (baseType !== 2 && baseType !== 3) {
    outputsDigest = computeOutputsDigest(tx);
  } else if (baseType === 3 && inputIndex < tx.outputs.length) {
    const out = tx.outputs[inputIndex];
    const scriptBytes = hexToBytes(out.scriptPubKeyHex);
    outputsDigest = blake2b256(
      "ZTxIdOutputsHash",
      concatBytes(writeInt64LE(out.satoshis), encodeCompactSize(scriptBytes.length), scriptBytes)
    );
  } else {
    outputsDigest = blake2b256("ZTxIdOutputsHash", new Uint8Array(0));
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

  return blake2b256("ZTxIdTranspaHash", payload);
}

function computeZip244SignatureDigest(tx, inputIndex, hashType = SIGHASH_ALL) {
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

function computeZip244TxId(tx) {
  const headerDigest = computeHeaderDigest(tx);
  const transparentDigest = computeTransparentTxIdDigest(tx);
  const saplingDigest = computeEmptySaplingDigest();
  const orchardDigest = computeEmptyOrchardDigest();

  const personalization = getTxHashPersonalization(tx.consensusBranchId);
  const rawTxIdBytes = blake2b256(
    personalization,
    concatBytes(headerDigest, transparentDigest, saplingDigest, orchardDigest)
  );
  return bytesToHex(reverseBytes(rawTxIdBytes));
}

function encodeDerSignatureWithSighash(r, s, sighashType = SIGHASH_ALL) {
  const toAsn1Int = (n) => {
    let hex = n.toString(16);
    if (hex.length % 2 !== 0) hex = "0" + hex;
    const raw = hexToBytes(hex);
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
  out[offset++] = 0x30;
  out[offset++] = seqLen;
  out[offset++] = 0x02;
  out[offset++] = rBytes.length;
  out.set(rBytes, offset);
  offset += rBytes.length;
  out[offset++] = 0x02;
  out[offset++] = sBytes.length;
  out.set(sBytes, offset);
  offset += sBytes.length;
  out[offset++] = sighashType & 0xff;
  return out;
}

function buildP2PKHScriptSig(sigWithSighash, compressedPubKey) {
  return concatBytes(
    new Uint8Array([sigWithSighash.length]),
    sigWithSighash,
    new Uint8Array([compressedPubKey.length]),
    compressedPubKey
  );
}

function serializeSignedV5Transaction(tx, scriptSigs) {
  const parts = [
    writeUint32LE(tx.version),
    writeUint32LE(tx.versionGroupId),
    writeUint32LE(tx.consensusBranchId),
    writeUint32LE(tx.lockTime),
    writeUint32LE(tx.expiryHeight),
    encodeCompactSize(tx.inputs.length)
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
  parts.push(encodeCompactSize(tx.outputs.length));
  for (const out of tx.outputs) {
    const pkScript = hexToBytes(out.scriptPubKeyHex);
    parts.push(
      writeInt64LE(out.satoshis),
      encodeCompactSize(pkScript.length),
      pkScript
    );
  }
  parts.push(encodeCompactSize(0), encodeCompactSize(0), encodeCompactSize(0));
  return concatBytes(...parts);
}

function buildAndSignNU7Transaction(params) {
  const {
    account,
    utxos,
    toAddress,
    amountZatoshis,
    currentBlockHeight,
    consensusBranchId = ACTIVE_TESTNET_BRANCH_ID
  } = params;

  const targetAmount = BigInt(amountZatoshis);
  if (targetAmount <= 0n) throw new Error("Transfer amount must be greater than 0");
  if (!utxos || utxos.length === 0) throw new Error("No transparent UTXOs available to fund transaction");

  const normalizedUtxos = utxos.map((u) => ({
    txid: u.txid || u.outpoint_txid,
    vout: u.vout !== undefined ? u.vout : (u.outpoint_index !== undefined ? u.outpoint_index : 0),
    satoshis: BigInt(u.satoshis !== undefined ? u.satoshis : (u.value_zat !== undefined ? u.value_zat : 0)),
    scriptPubKeyHex: u.scriptPubKeyHex || account.scriptPubKeyHex
  }));

  const sorted = [...normalizedUtxos].sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1));
  const selected = [];
  let accumulated = 0n;

  for (const u of sorted) {
    selected.push(u);
    accumulated += u.satoshis;
    const tentativeFee = calculateZip317Fee(selected.length, 2);
    if (accumulated >= targetAmount + tentativeFee) break;
  }

  const fee = calculateZip317Fee(selected.length, 2);
  if (accumulated < targetAmount + fee) {
    throw new Error(
      "Insufficient transparent funds: available " +
      (Number(accumulated) / 1e8).toFixed(4) +
      " TAZ, needed " +
      (Number(targetAmount + fee) / 1e8).toFixed(4) +
      " TAZ (including ZIP-317 fee)"
    );
  }

  const recipientScriptHex = bytesToHex(addressToScriptPubKey(toAddress));
  const outputs = [
    {
      address: toAddress,
      scriptPubKeyHex: recipientScriptHex,
      satoshis: targetAmount
    }
  ];

  const change = accumulated - targetAmount - fee;
  if (change > 0n) {
    outputs.push({
      address: account.address,
      scriptPubKeyHex: account.scriptPubKeyHex,
      satoshis: change
    });
  }

  const unsignedTx = {
    version: TX_V5_HEADER,
    versionGroupId: TX_V5_VERSION_GROUP_ID,
    consensusBranchId,
    lockTime: 0,
    expiryHeight: (currentBlockHeight || 4476480) + DEFAULT_EXPIRY_DELTA_BLOCKS,
    inputs: selected.map((u) => ({ utxo: u, sequence: 0xffffffff })),
    outputs
  };

  const privKeyBytes = account.privateKeyHex
    ? hexToBytes(account.privateKeyHex)
    : base58CheckDecode(account.wif).payload.slice(0, 32);
  const pubBytes = hexToBytes(account.publicKey);

  const scriptSigs = [];
  for (let i = 0; i < unsignedTx.inputs.length; i++) {
    const sighash = computeZip244SignatureDigest(unsignedTx, i, SIGHASH_ALL);
    const sig = secp256k1.sign(sighash, privKeyBytes);
    const sCanonical = sig.s > secp256k1.CURVE.n / 2n ? secp256k1.CURVE.n - sig.s : sig.s;
    const derSig = encodeDerSignatureWithSighash(sig.r, sCanonical, SIGHASH_ALL);
    scriptSigs.push(buildP2PKHScriptSig(derSig, pubBytes));
  }

  const rawBytes = serializeSignedV5Transaction(unsignedTx, scriptSigs);
  const txid = computeZip244TxId(unsignedTx);

  return {
    rawHex: bytesToHex(rawBytes),
    txid,
    feeZatoshis: fee,
    inputs: selected,
    outputs
  };
}

function getSubtleCrypto() {
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  try {
    const c = require("crypto");
    return c.webcrypto?.subtle || c.subtle;
  } catch (e) {
    throw new Error("Web Crypto API (subtle) is unavailable in this environment.");
  }
}

async function deriveVaultEncryptionKey(password, salt) {
  const subtle = getSubtleCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptVault(vaultPlaintext, password) {
  if (!password || password.length < 4) {
    throw new Error("Password must be at least 4 characters long.");
  }
  const subtle = getSubtleCrypto();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveVaultEncryptionKey(password, salt);
  const enc = new TextEncoder();
  const plaintextBytes = enc.encode(JSON.stringify(vaultPlaintext));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintextBytes
  );
  return {
    version: 2,
    isEncrypted: true,
    saltHex: bytesToHex(salt),
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(ciphertext)),
    lastUpdated: Date.now(),
  };
}

async function decryptVault(envelope, password) {
  if (!envelope || !envelope.isEncrypted) {
    return envelope;
  }
  const subtle = getSubtleCrypto();
  const salt = hexToBytes(envelope.saltHex);
  const iv = hexToBytes(envelope.ivHex);
  const ciphertext = hexToBytes(envelope.ciphertextHex);
  const key = await deriveVaultEncryptionKey(password, salt);
  try {
    const decryptedBytes = await subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedBytes));
  } catch (e) {
    throw new Error("Invalid password or corrupted vault.");
  }
}

function isEncryptedVault(data) {
  return Boolean(
    data &&
    typeof data === "object" &&
    data.isEncrypted === true &&
    typeof data.ciphertextHex === "string"
  );
}

function extractAddressesFromUnifiedAddress(uaStr, network = "testnet") {
  const decoded = decodeUnifiedAddress(uaStr);
  let transparentAddress = "";
  let saplingAddress = "";
  for (const r of decoded.receivers) {
    if (r.typecode === 0) {
      const pkh = hexToBytes(r.dataHex);
      const prefix = network === "testnet" ? new Uint8Array([0x1d, 0x25]) : new Uint8Array([0x1c, 0xb8]);
      transparentAddress = base58CheckEncode(prefix, pkh);
    } else if (r.typecode === 2) {
      const sBytes = hexToBytes(r.dataHex);
      const hrp = network === "testnet" ? "ztestsapling" : "zs";
      saplingAddress = bech32EncodeBytes(hrp, sBytes, "bech32");
    }
  }
  return {
    unifiedAddress: uaStr,
    transparentAddress,
    saplingAddress,
    receivers: decoded.receivers,
  };
}

function signZcashMessage(message, privateKey) {
  const priv = typeof privateKey === "string" ? hexToBytes(privateKey) : privateKey;
  const msgBytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const prefix = new TextEncoder().encode("Zcash Signed Message:\\n");

  function encodeVarint(n) {
    if (n < 0xfd) return new Uint8Array([n]);
    if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
    return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  }

  const vPrefixLen = encodeVarint(prefix.length);
  const vMsgLen = encodeVarint(msgBytes.length);
  const payload = new Uint8Array(vPrefixLen.length + prefix.length + vMsgLen.length + msgBytes.length);
  let off = 0;
  payload.set(vPrefixLen, off); off += vPrefixLen.length;
  payload.set(prefix, off); off += prefix.length;
  payload.set(vMsgLen, off); off += vMsgLen.length;
  payload.set(msgBytes, off);

  const hash = sha256(sha256(payload));
  const sig = secp256k1.sign(hash, priv, { lowS: true });
  const sigBytes = sig.toCompactRawBytes();

  const recovery = sig.recovery !== undefined ? sig.recovery : 0;
  const header = 27 + recovery + 4; // 31 or 32 for compressed pubkey
  const fullSig = new Uint8Array(65);
  fullSig[0] = header;
  fullSig.set(sigBytes, 1);

  let binary = "";
  for (let i = 0; i < fullSig.length; i++) binary += String.fromCharCode(fullSig[i]);
  const b64 = typeof btoa === "function" ? btoa(binary) : (typeof Buffer !== "undefined" ? Buffer.from(fullSig).toString("base64") : "");

  return {
    signatureHex: bytesToHex(fullSig),
    signatureBase64: b64,
    hashHex: bytesToHex(hash),
  };
}

function verifyZcashMessage(message, signatureBytesOrHex, expectedPubKeyBytesOrHex) {
  try {
    const rawSig = typeof signatureBytesOrHex === "string" ? hexToBytes(signatureBytesOrHex) : signatureBytesOrHex;
    const pub = typeof expectedPubKeyBytesOrHex === "string" ? hexToBytes(expectedPubKeyBytesOrHex) : expectedPubKeyBytesOrHex;
    const msgBytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
    const prefix = new TextEncoder().encode("Zcash Signed Message:\\n");

    function encodeVarint(n) {
      if (n < 0xfd) return new Uint8Array([n]);
      if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
      return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
    }

    const vPrefixLen = encodeVarint(prefix.length);
    const vMsgLen = encodeVarint(msgBytes.length);
    const payload = new Uint8Array(vPrefixLen.length + prefix.length + vMsgLen.length + msgBytes.length);
    let off = 0;
    payload.set(vPrefixLen, off); off += vPrefixLen.length;
    payload.set(prefix, off); off += prefix.length;
    payload.set(vMsgLen, off); off += vMsgLen.length;
    payload.set(msgBytes, off);

    const hash = sha256(sha256(payload));
    const sigBody = rawSig.length === 65 ? rawSig.slice(1) : rawSig;
    return secp256k1.verify(sigBody, hash, pub);
  } catch (e) {
    return false;
  }
}

module.exports = {
  generateMnemonic24,
  validateMnemonicPhrase,
  mnemonicToSeed,
  deriveAccountFromSeed,
  signZcashMessage,
  verifyZcashMessage,
  encodeUnifiedAddress,
  decodeUnifiedAddress,
  extractAddressesFromUnifiedAddress,
  bech32EncodeBytes,
  deriveSaplingAddress,
  addressToScriptPubKey,
  base58CheckEncode,
  base58CheckDecode,
  calculateZip317Fee,
  buildAndSignNU7Transaction,
  computeZip244TxId,
  computeZip244SignatureDigest,
  encryptVault,
  decryptVault,
  isEncryptedVault,
  getRandomBytes,
  bytesToHex,
  hexToBytes,
  ACTIVE_TESTNET_BRANCH_ID,
  IRONWOOD_BRANCH_ID,
  NU7_BRANCH_ID,
};
`;

const tempEntry = path.resolve(__dirname, "_temp_entry.js");
fs.writeFileSync(tempEntry, entryCode);

// Use a simple CJS to IIFE bundler
const visited = new Map();
let modCount = 0;

function resolveMod(req, fromDir) {
  if (req.startsWith(".")) {
    const f = path.resolve(fromDir, req);
    for (const ext of ["", ".js", ".cjs", ".json"]) {
      if (fs.existsSync(f + ext) && fs.statSync(f + ext).isFile()) return f + ext;
    }
  }
  return require.resolve(req, { paths: [fromDir, process.cwd()] });
}

function walk(absPath) {
  if (visited.has(absPath)) return visited.get(absPath).id;
  const id = modCount++;
  const info = { id, absPath, deps: {}, code: "" };
  visited.set(absPath, info);
  let src = fs.readFileSync(absPath, "utf8");
  const dir = path.dirname(absPath);
  const reqRegex = /require\((['"])(.*?)\1\)/g;
  let match;
  while ((match = reqRegex.exec(src)) !== null) {
    const depName = match[2];
    try {
      const depPath = resolveMod(depName, dir);
      info.deps[depName] = walk(depPath);
    } catch (e) {
      console.warn("Could not resolve:", depName);
    }
  }
  info.code = src;
  return id;
}

const entryId = walk(tempEntry);
console.log(`Resolved ${visited.size} modules.`);

let bundle = `(function() {
  if (typeof globalThis !== "undefined" && (!globalThis.crypto || !globalThis.crypto.getRandomValues)) {
    try {
      var _c = typeof require === "function" ? require("crypto") : null;
      if (_c && _c.webcrypto) globalThis.crypto = _c.webcrypto;
    } catch(e) {}
  }
  var modules = {\n`;

for (const [absPath, info] of visited.entries()) {
  bundle += `    ${info.id}: function(require, module, exports) {\n`;
  bundle += `${info.code}\n`;
  bundle += `    },\n`;
}

bundle += `  };\n
  var depsMap = ${JSON.stringify(
    Object.fromEntries(Array.from(visited.values()).map((v) => [v.id, v.deps]))
  )};\n
  var cache = {};
  function customRequire(id) {
    if (cache[id]) return cache[id].exports;
    var module = { exports: {} };
    cache[id] = module;
    function localRequire(req) {
      if (req === "node:crypto" || req === "crypto") {
        var globCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
        var nodeCrypto = null;
        try { nodeCrypto = require("crypto"); } catch(e) {}
        var wc = (globCrypto && typeof globCrypto.getRandomValues === "function")
          ? globCrypto
          : (nodeCrypto && nodeCrypto.webcrypto);
        return {
          webcrypto: wc,
          randomBytes: nodeCrypto ? nodeCrypto.randomBytes : undefined,
          getRandomValues: wc && typeof wc.getRandomValues === "function"
            ? wc.getRandomValues.bind(wc)
            : undefined
        };
      }
      var depId = (depsMap[id] || {})[req];
      if (depId === undefined) throw new Error("Module not found: " + req);
      return customRequire(depId);
    }
    modules[id](localRequire, module, module.exports);
    return module.exports;
  }
  var exported = customRequire(${entryId});
  if (typeof window !== "undefined") {
    window.VeilXWalletCore = exported;
  }
  if (typeof self !== "undefined") {
    self.VeilXWalletCore = exported;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.VeilXWalletCore = exported;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})();\n`;

const targetFile = path.resolve(outDir, "wallet-core.bundle.js");
fs.writeFileSync(targetFile, bundle);
fs.unlinkSync(tempEntry);
console.log(`✓ Generated ${targetFile} (${(bundle.length / 1024).toFixed(1)} KB)`);
