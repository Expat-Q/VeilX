(function() {
  if (typeof globalThis !== "undefined" && (!globalThis.crypto || !globalThis.crypto.getRandomValues)) {
    try {
      var _c = typeof require === "function" ? require("crypto") : null;
      if (_c && _c.webcrypto) globalThis.crypto = _c.webcrypto;
    } catch(e) {}
  }
  var modules = {
    0: function(require, module, exports) {

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
    return validateMnemonic(phrase.trim().replace(/\s+/g, " "), englishWordlist);
  } catch (e) {
    return false;
  }
}

function mnemonicToSeed(mnemonic, passphrase = "") {
  return mnemonicToSeedSync(mnemonic.trim().replace(/\s+/g, " "), passphrase);
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
  const prefix = new TextEncoder().encode("Zcash Signed Message:\n");

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
    const prefix = new TextEncoder().encode("Zcash Signed Message:\n");

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

    },
    1: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blake2b = exports.BLAKE2b = void 0;
/**
 * Blake2b hash function. Focuses on 64-bit platforms, but in JS speed different from Blake2s is negligible.
 * @module
 * @deprecated
 */
const blake2_ts_1 = require("./blake2.js");
/** @deprecated Use import from `noble/hashes/blake2` module */
exports.BLAKE2b = blake2_ts_1.BLAKE2b;
/** @deprecated Use import from `noble/hashes/blake2` module */
exports.blake2b = blake2_ts_1.blake2b;
//# sourceMappingURL=blake2b.js.map
    },
    2: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blake2s = exports.BLAKE2s = exports.blake2b = exports.BLAKE2b = exports.BLAKE2 = void 0;
exports.compress = compress;
/**
 * blake2b (64-bit) & blake2s (8 to 32-bit) hash functions.
 * b could have been faster, but there is no fast u64 in js, so s is 1.5x faster.
 * @module
 */
const _blake_ts_1 = require("./_blake.js");
const _md_ts_1 = require("./_md.js");
const u64 = require("./_u64.js");
// prettier-ignore
const utils_ts_1 = require("./utils.js");
// Same as SHA512_IV, but swapped endianness: LE instead of BE. iv[1] is iv[0], etc.
const B2B_IV = /* @__PURE__ */ Uint32Array.from([
    0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
    0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);
// Temporary buffer
const BBUF = /* @__PURE__ */ new Uint32Array(32);
// Mixing function G splitted in two halfs
function G1b(a, b, c, d, msg, x) {
    // NOTE: V is LE here
    const Xl = msg[x], Xh = msg[x + 1]; // prettier-ignore
    let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1]; // prettier-ignore
    let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1]; // prettier-ignore
    let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1]; // prettier-ignore
    let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1]; // prettier-ignore
    // v[a] = (v[a] + v[b] + x) | 0;
    let ll = u64.add3L(Al, Bl, Xl);
    Ah = u64.add3H(ll, Ah, Bh, Xh);
    Al = ll | 0;
    // v[d] = rotr(v[d] ^ v[a], 32)
    ({ Dh, Dl } = { Dh: Dh ^ Ah, Dl: Dl ^ Al });
    ({ Dh, Dl } = { Dh: u64.rotr32H(Dh, Dl), Dl: u64.rotr32L(Dh, Dl) });
    // v[c] = (v[c] + v[d]) | 0;
    ({ h: Ch, l: Cl } = u64.add(Ch, Cl, Dh, Dl));
    // v[b] = rotr(v[b] ^ v[c], 24)
    ({ Bh, Bl } = { Bh: Bh ^ Ch, Bl: Bl ^ Cl });
    ({ Bh, Bl } = { Bh: u64.rotrSH(Bh, Bl, 24), Bl: u64.rotrSL(Bh, Bl, 24) });
    (BBUF[2 * a] = Al), (BBUF[2 * a + 1] = Ah);
    (BBUF[2 * b] = Bl), (BBUF[2 * b + 1] = Bh);
    (BBUF[2 * c] = Cl), (BBUF[2 * c + 1] = Ch);
    (BBUF[2 * d] = Dl), (BBUF[2 * d + 1] = Dh);
}
function G2b(a, b, c, d, msg, x) {
    // NOTE: V is LE here
    const Xl = msg[x], Xh = msg[x + 1]; // prettier-ignore
    let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1]; // prettier-ignore
    let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1]; // prettier-ignore
    let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1]; // prettier-ignore
    let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1]; // prettier-ignore
    // v[a] = (v[a] + v[b] + x) | 0;
    let ll = u64.add3L(Al, Bl, Xl);
    Ah = u64.add3H(ll, Ah, Bh, Xh);
    Al = ll | 0;
    // v[d] = rotr(v[d] ^ v[a], 16)
    ({ Dh, Dl } = { Dh: Dh ^ Ah, Dl: Dl ^ Al });
    ({ Dh, Dl } = { Dh: u64.rotrSH(Dh, Dl, 16), Dl: u64.rotrSL(Dh, Dl, 16) });
    // v[c] = (v[c] + v[d]) | 0;
    ({ h: Ch, l: Cl } = u64.add(Ch, Cl, Dh, Dl));
    // v[b] = rotr(v[b] ^ v[c], 63)
    ({ Bh, Bl } = { Bh: Bh ^ Ch, Bl: Bl ^ Cl });
    ({ Bh, Bl } = { Bh: u64.rotrBH(Bh, Bl, 63), Bl: u64.rotrBL(Bh, Bl, 63) });
    (BBUF[2 * a] = Al), (BBUF[2 * a + 1] = Ah);
    (BBUF[2 * b] = Bl), (BBUF[2 * b + 1] = Bh);
    (BBUF[2 * c] = Cl), (BBUF[2 * c + 1] = Ch);
    (BBUF[2 * d] = Dl), (BBUF[2 * d + 1] = Dh);
}
function checkBlake2Opts(outputLen, opts = {}, keyLen, saltLen, persLen) {
    (0, utils_ts_1.anumber)(keyLen);
    if (outputLen < 0 || outputLen > keyLen)
        throw new Error('outputLen bigger than keyLen');
    const { key, salt, personalization } = opts;
    if (key !== undefined && (key.length < 1 || key.length > keyLen))
        throw new Error('key length must be undefined or 1..' + keyLen);
    if (salt !== undefined && salt.length !== saltLen)
        throw new Error('salt must be undefined or ' + saltLen);
    if (personalization !== undefined && personalization.length !== persLen)
        throw new Error('personalization must be undefined or ' + persLen);
}
/** Class, from which others are subclassed. */
class BLAKE2 extends utils_ts_1.Hash {
    constructor(blockLen, outputLen) {
        super();
        this.finished = false;
        this.destroyed = false;
        this.length = 0;
        this.pos = 0;
        (0, utils_ts_1.anumber)(blockLen);
        (0, utils_ts_1.anumber)(outputLen);
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.buffer = new Uint8Array(blockLen);
        this.buffer32 = (0, utils_ts_1.u32)(this.buffer);
    }
    update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        // Main difference with other hashes: there is flag for last block,
        // so we cannot process current block before we know that there
        // is the next one. This significantly complicates logic and reduces ability
        // to do zero-copy processing
        const { blockLen, buffer, buffer32 } = this;
        const len = data.length;
        const offset = data.byteOffset;
        const buf = data.buffer;
        for (let pos = 0; pos < len;) {
            // If buffer is full and we still have input (don't process last block, same as blake2s)
            if (this.pos === blockLen) {
                (0, utils_ts_1.swap32IfBE)(buffer32);
                this.compress(buffer32, 0, false);
                (0, utils_ts_1.swap32IfBE)(buffer32);
                this.pos = 0;
            }
            const take = Math.min(blockLen - this.pos, len - pos);
            const dataOffset = offset + pos;
            // full block && aligned to 4 bytes && not last in input
            if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
                const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
                (0, utils_ts_1.swap32IfBE)(data32);
                for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
                    this.length += blockLen;
                    this.compress(data32, pos32, false);
                }
                (0, utils_ts_1.swap32IfBE)(data32);
                continue;
            }
            buffer.set(data.subarray(pos, pos + take), this.pos);
            this.pos += take;
            this.length += take;
            pos += take;
        }
        return this;
    }
    digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.aoutput)(out, this);
        const { pos, buffer32 } = this;
        this.finished = true;
        // Padding
        (0, utils_ts_1.clean)(this.buffer.subarray(pos));
        (0, utils_ts_1.swap32IfBE)(buffer32);
        this.compress(buffer32, 0, true);
        (0, utils_ts_1.swap32IfBE)(buffer32);
        const out32 = (0, utils_ts_1.u32)(out);
        this.get().forEach((v, i) => (out32[i] = (0, utils_ts_1.swap8IfBE)(v)));
    }
    digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
    }
    _cloneInto(to) {
        const { buffer, length, finished, destroyed, outputLen, pos } = this;
        to || (to = new this.constructor({ dkLen: outputLen }));
        to.set(...this.get());
        to.buffer.set(buffer);
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        // @ts-ignore
        to.outputLen = outputLen;
        return to;
    }
    clone() {
        return this._cloneInto();
    }
}
exports.BLAKE2 = BLAKE2;
class BLAKE2b extends BLAKE2 {
    constructor(opts = {}) {
        const olen = opts.dkLen === undefined ? 64 : opts.dkLen;
        super(128, olen);
        // Same as SHA-512, but LE
        this.v0l = B2B_IV[0] | 0;
        this.v0h = B2B_IV[1] | 0;
        this.v1l = B2B_IV[2] | 0;
        this.v1h = B2B_IV[3] | 0;
        this.v2l = B2B_IV[4] | 0;
        this.v2h = B2B_IV[5] | 0;
        this.v3l = B2B_IV[6] | 0;
        this.v3h = B2B_IV[7] | 0;
        this.v4l = B2B_IV[8] | 0;
        this.v4h = B2B_IV[9] | 0;
        this.v5l = B2B_IV[10] | 0;
        this.v5h = B2B_IV[11] | 0;
        this.v6l = B2B_IV[12] | 0;
        this.v6h = B2B_IV[13] | 0;
        this.v7l = B2B_IV[14] | 0;
        this.v7h = B2B_IV[15] | 0;
        checkBlake2Opts(olen, opts, 64, 16, 16);
        let { key, personalization, salt } = opts;
        let keyLength = 0;
        if (key !== undefined) {
            key = (0, utils_ts_1.toBytes)(key);
            keyLength = key.length;
        }
        this.v0l ^= this.outputLen | (keyLength << 8) | (0x01 << 16) | (0x01 << 24);
        if (salt !== undefined) {
            salt = (0, utils_ts_1.toBytes)(salt);
            const slt = (0, utils_ts_1.u32)(salt);
            this.v4l ^= (0, utils_ts_1.swap8IfBE)(slt[0]);
            this.v4h ^= (0, utils_ts_1.swap8IfBE)(slt[1]);
            this.v5l ^= (0, utils_ts_1.swap8IfBE)(slt[2]);
            this.v5h ^= (0, utils_ts_1.swap8IfBE)(slt[3]);
        }
        if (personalization !== undefined) {
            personalization = (0, utils_ts_1.toBytes)(personalization);
            const pers = (0, utils_ts_1.u32)(personalization);
            this.v6l ^= (0, utils_ts_1.swap8IfBE)(pers[0]);
            this.v6h ^= (0, utils_ts_1.swap8IfBE)(pers[1]);
            this.v7l ^= (0, utils_ts_1.swap8IfBE)(pers[2]);
            this.v7h ^= (0, utils_ts_1.swap8IfBE)(pers[3]);
        }
        if (key !== undefined) {
            // Pad to blockLen and update
            const tmp = new Uint8Array(this.blockLen);
            tmp.set(key);
            this.update(tmp);
        }
    }
    // prettier-ignore
    get() {
        let { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
        return [v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h];
    }
    // prettier-ignore
    set(v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h) {
        this.v0l = v0l | 0;
        this.v0h = v0h | 0;
        this.v1l = v1l | 0;
        this.v1h = v1h | 0;
        this.v2l = v2l | 0;
        this.v2h = v2h | 0;
        this.v3l = v3l | 0;
        this.v3h = v3h | 0;
        this.v4l = v4l | 0;
        this.v4h = v4h | 0;
        this.v5l = v5l | 0;
        this.v5h = v5h | 0;
        this.v6l = v6l | 0;
        this.v6h = v6h | 0;
        this.v7l = v7l | 0;
        this.v7h = v7h | 0;
    }
    compress(msg, offset, isLast) {
        this.get().forEach((v, i) => (BBUF[i] = v)); // First half from state.
        BBUF.set(B2B_IV, 16); // Second half from IV.
        let { h, l } = u64.fromBig(BigInt(this.length));
        BBUF[24] = B2B_IV[8] ^ l; // Low word of the offset.
        BBUF[25] = B2B_IV[9] ^ h; // High word.
        // Invert all bits for last block
        if (isLast) {
            BBUF[28] = ~BBUF[28];
            BBUF[29] = ~BBUF[29];
        }
        let j = 0;
        const s = _blake_ts_1.BSIGMA;
        for (let i = 0; i < 12; i++) {
            G1b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
            G2b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
            G1b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
            G2b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
            G1b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
            G2b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
            G1b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
            G2b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
            G1b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
            G2b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
            G1b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
            G2b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
            G1b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
            G2b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
            G1b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
            G2b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
        }
        this.v0l ^= BBUF[0] ^ BBUF[16];
        this.v0h ^= BBUF[1] ^ BBUF[17];
        this.v1l ^= BBUF[2] ^ BBUF[18];
        this.v1h ^= BBUF[3] ^ BBUF[19];
        this.v2l ^= BBUF[4] ^ BBUF[20];
        this.v2h ^= BBUF[5] ^ BBUF[21];
        this.v3l ^= BBUF[6] ^ BBUF[22];
        this.v3h ^= BBUF[7] ^ BBUF[23];
        this.v4l ^= BBUF[8] ^ BBUF[24];
        this.v4h ^= BBUF[9] ^ BBUF[25];
        this.v5l ^= BBUF[10] ^ BBUF[26];
        this.v5h ^= BBUF[11] ^ BBUF[27];
        this.v6l ^= BBUF[12] ^ BBUF[28];
        this.v6h ^= BBUF[13] ^ BBUF[29];
        this.v7l ^= BBUF[14] ^ BBUF[30];
        this.v7h ^= BBUF[15] ^ BBUF[31];
        (0, utils_ts_1.clean)(BBUF);
    }
    destroy() {
        this.destroyed = true;
        (0, utils_ts_1.clean)(this.buffer32);
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
}
exports.BLAKE2b = BLAKE2b;
/**
 * Blake2b hash function. 64-bit. 1.5x slower than blake2s in JS.
 * @param msg - message that would be hashed
 * @param opts - dkLen output length, key for MAC mode, salt, personalization
 */
exports.blake2b = (0, utils_ts_1.createOptHasher)((opts) => new BLAKE2b(opts));
// prettier-ignore
function compress(s, offset, msg, rounds, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15) {
    let j = 0;
    for (let i = 0; i < rounds; i++) {
        ({ a: v0, b: v4, c: v8, d: v12 } = (0, _blake_ts_1.G1s)(v0, v4, v8, v12, msg[offset + s[j++]]));
        ({ a: v0, b: v4, c: v8, d: v12 } = (0, _blake_ts_1.G2s)(v0, v4, v8, v12, msg[offset + s[j++]]));
        ({ a: v1, b: v5, c: v9, d: v13 } = (0, _blake_ts_1.G1s)(v1, v5, v9, v13, msg[offset + s[j++]]));
        ({ a: v1, b: v5, c: v9, d: v13 } = (0, _blake_ts_1.G2s)(v1, v5, v9, v13, msg[offset + s[j++]]));
        ({ a: v2, b: v6, c: v10, d: v14 } = (0, _blake_ts_1.G1s)(v2, v6, v10, v14, msg[offset + s[j++]]));
        ({ a: v2, b: v6, c: v10, d: v14 } = (0, _blake_ts_1.G2s)(v2, v6, v10, v14, msg[offset + s[j++]]));
        ({ a: v3, b: v7, c: v11, d: v15 } = (0, _blake_ts_1.G1s)(v3, v7, v11, v15, msg[offset + s[j++]]));
        ({ a: v3, b: v7, c: v11, d: v15 } = (0, _blake_ts_1.G2s)(v3, v7, v11, v15, msg[offset + s[j++]]));
        ({ a: v0, b: v5, c: v10, d: v15 } = (0, _blake_ts_1.G1s)(v0, v5, v10, v15, msg[offset + s[j++]]));
        ({ a: v0, b: v5, c: v10, d: v15 } = (0, _blake_ts_1.G2s)(v0, v5, v10, v15, msg[offset + s[j++]]));
        ({ a: v1, b: v6, c: v11, d: v12 } = (0, _blake_ts_1.G1s)(v1, v6, v11, v12, msg[offset + s[j++]]));
        ({ a: v1, b: v6, c: v11, d: v12 } = (0, _blake_ts_1.G2s)(v1, v6, v11, v12, msg[offset + s[j++]]));
        ({ a: v2, b: v7, c: v8, d: v13 } = (0, _blake_ts_1.G1s)(v2, v7, v8, v13, msg[offset + s[j++]]));
        ({ a: v2, b: v7, c: v8, d: v13 } = (0, _blake_ts_1.G2s)(v2, v7, v8, v13, msg[offset + s[j++]]));
        ({ a: v3, b: v4, c: v9, d: v14 } = (0, _blake_ts_1.G1s)(v3, v4, v9, v14, msg[offset + s[j++]]));
        ({ a: v3, b: v4, c: v9, d: v14 } = (0, _blake_ts_1.G2s)(v3, v4, v9, v14, msg[offset + s[j++]]));
    }
    return { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 };
}
const B2S_IV = _md_ts_1.SHA256_IV;
class BLAKE2s extends BLAKE2 {
    constructor(opts = {}) {
        const olen = opts.dkLen === undefined ? 32 : opts.dkLen;
        super(64, olen);
        // Internal state, same as SHA-256
        this.v0 = B2S_IV[0] | 0;
        this.v1 = B2S_IV[1] | 0;
        this.v2 = B2S_IV[2] | 0;
        this.v3 = B2S_IV[3] | 0;
        this.v4 = B2S_IV[4] | 0;
        this.v5 = B2S_IV[5] | 0;
        this.v6 = B2S_IV[6] | 0;
        this.v7 = B2S_IV[7] | 0;
        checkBlake2Opts(olen, opts, 32, 8, 8);
        let { key, personalization, salt } = opts;
        let keyLength = 0;
        if (key !== undefined) {
            key = (0, utils_ts_1.toBytes)(key);
            keyLength = key.length;
        }
        this.v0 ^= this.outputLen | (keyLength << 8) | (0x01 << 16) | (0x01 << 24);
        if (salt !== undefined) {
            salt = (0, utils_ts_1.toBytes)(salt);
            const slt = (0, utils_ts_1.u32)(salt);
            this.v4 ^= (0, utils_ts_1.swap8IfBE)(slt[0]);
            this.v5 ^= (0, utils_ts_1.swap8IfBE)(slt[1]);
        }
        if (personalization !== undefined) {
            personalization = (0, utils_ts_1.toBytes)(personalization);
            const pers = (0, utils_ts_1.u32)(personalization);
            this.v6 ^= (0, utils_ts_1.swap8IfBE)(pers[0]);
            this.v7 ^= (0, utils_ts_1.swap8IfBE)(pers[1]);
        }
        if (key !== undefined) {
            // Pad to blockLen and update
            (0, utils_ts_1.abytes)(key);
            const tmp = new Uint8Array(this.blockLen);
            tmp.set(key);
            this.update(tmp);
        }
    }
    get() {
        const { v0, v1, v2, v3, v4, v5, v6, v7 } = this;
        return [v0, v1, v2, v3, v4, v5, v6, v7];
    }
    // prettier-ignore
    set(v0, v1, v2, v3, v4, v5, v6, v7) {
        this.v0 = v0 | 0;
        this.v1 = v1 | 0;
        this.v2 = v2 | 0;
        this.v3 = v3 | 0;
        this.v4 = v4 | 0;
        this.v5 = v5 | 0;
        this.v6 = v6 | 0;
        this.v7 = v7 | 0;
    }
    compress(msg, offset, isLast) {
        const { h, l } = u64.fromBig(BigInt(this.length));
        // prettier-ignore
        const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = compress(_blake_ts_1.BSIGMA, offset, msg, 10, this.v0, this.v1, this.v2, this.v3, this.v4, this.v5, this.v6, this.v7, B2S_IV[0], B2S_IV[1], B2S_IV[2], B2S_IV[3], l ^ B2S_IV[4], h ^ B2S_IV[5], isLast ? ~B2S_IV[6] : B2S_IV[6], B2S_IV[7]);
        this.v0 ^= v0 ^ v8;
        this.v1 ^= v1 ^ v9;
        this.v2 ^= v2 ^ v10;
        this.v3 ^= v3 ^ v11;
        this.v4 ^= v4 ^ v12;
        this.v5 ^= v5 ^ v13;
        this.v6 ^= v6 ^ v14;
        this.v7 ^= v7 ^ v15;
    }
    destroy() {
        this.destroyed = true;
        (0, utils_ts_1.clean)(this.buffer32);
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
    }
}
exports.BLAKE2s = BLAKE2s;
/**
 * Blake2s hash function. Focuses on 8-bit to 32-bit platforms. 1.5x faster than blake2b in JS.
 * @param msg - message that would be hashed
 * @param opts - dkLen output length, key for MAC mode, salt, personalization
 */
exports.blake2s = (0, utils_ts_1.createOptHasher)((opts) => new BLAKE2s(opts));
//# sourceMappingURL=blake2.js.map
    },
    3: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BSIGMA = void 0;
exports.G1s = G1s;
exports.G2s = G2s;
/**
 * Internal helpers for blake hash.
 * @module
 */
const utils_ts_1 = require("./utils.js");
/**
 * Internal blake variable.
 * For BLAKE2b, the two extra permutations for rounds 10 and 11 are SIGMA[10..11] = SIGMA[0..1].
 */
// prettier-ignore
exports.BSIGMA = Uint8Array.from([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
    11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
    7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
    9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
    2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
    12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
    13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
    6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
    10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
    // Blake1, unused in others
    11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
    7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
    9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
    2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
]);
// Mixing function G splitted in two halfs
function G1s(a, b, c, d, x) {
    a = (a + b + x) | 0;
    d = (0, utils_ts_1.rotr)(d ^ a, 16);
    c = (c + d) | 0;
    b = (0, utils_ts_1.rotr)(b ^ c, 12);
    return { a, b, c, d };
}
function G2s(a, b, c, d, x) {
    a = (a + b + x) | 0;
    d = (0, utils_ts_1.rotr)(d ^ a, 8);
    c = (c + d) | 0;
    b = (0, utils_ts_1.rotr)(b ^ c, 7);
    return { a, b, c, d };
}
//# sourceMappingURL=_blake.js.map
    },
    4: function(require, module, exports) {
"use strict";
/**
 * Utilities for hex, bytes, CSPRNG.
 * @module
 */
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapXOFConstructorWithOpts = exports.wrapConstructorWithOpts = exports.wrapConstructor = exports.Hash = exports.nextTick = exports.swap32IfBE = exports.byteSwapIfBE = exports.swap8IfBE = exports.isLE = void 0;
exports.isBytes = isBytes;
exports.anumber = anumber;
exports.abytes = abytes;
exports.ahash = ahash;
exports.aexists = aexists;
exports.aoutput = aoutput;
exports.u8 = u8;
exports.u32 = u32;
exports.clean = clean;
exports.createView = createView;
exports.rotr = rotr;
exports.rotl = rotl;
exports.byteSwap = byteSwap;
exports.byteSwap32 = byteSwap32;
exports.bytesToHex = bytesToHex;
exports.hexToBytes = hexToBytes;
exports.asyncLoop = asyncLoop;
exports.utf8ToBytes = utf8ToBytes;
exports.bytesToUtf8 = bytesToUtf8;
exports.toBytes = toBytes;
exports.kdfInputToBytes = kdfInputToBytes;
exports.concatBytes = concatBytes;
exports.checkOpts = checkOpts;
exports.createHasher = createHasher;
exports.createOptHasher = createOptHasher;
exports.createXOFer = createXOFer;
exports.randomBytes = randomBytes;
// We use WebCrypto aka globalThis.crypto, which exists in browsers and node.js 16+.
// node.js versions earlier than v19 don't declare it in global scope.
// For node.js, package.json#exports field mapping rewrites import
// from `crypto` to `cryptoNode`, which imports native module.
// Makes the utils un-importable in browsers without a bundler.
// Once node.js 18 is deprecated (2025-04-30), we can just drop the import.
const crypto_1 = require("@noble/hashes/crypto");
/** Checks if something is Uint8Array. Be careful: nodejs Buffer will return true. */
function isBytes(a) {
    return a instanceof Uint8Array || (ArrayBuffer.isView(a) && a.constructor.name === 'Uint8Array');
}
/** Asserts something is positive integer. */
function anumber(n) {
    if (!Number.isSafeInteger(n) || n < 0)
        throw new Error('positive integer expected, got ' + n);
}
/** Asserts something is Uint8Array. */
function abytes(b, ...lengths) {
    if (!isBytes(b))
        throw new Error('Uint8Array expected');
    if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error('Uint8Array expected of length ' + lengths + ', got length=' + b.length);
}
/** Asserts something is hash */
function ahash(h) {
    if (typeof h !== 'function' || typeof h.create !== 'function')
        throw new Error('Hash should be wrapped by utils.createHasher');
    anumber(h.outputLen);
    anumber(h.blockLen);
}
/** Asserts a hash instance has not been destroyed / finished */
function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
        throw new Error('Hash instance has been destroyed');
    if (checkFinished && instance.finished)
        throw new Error('Hash#digest() has already been called');
}
/** Asserts output is properly-sized byte array */
function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
        throw new Error('digestInto() expects output buffer of length at least ' + min);
    }
}
/** Cast u8 / u16 / u32 to u8. */
function u8(arr) {
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
/** Cast u8 / u16 / u32 to u32. */
function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
/** Zeroize a byte array. Warning: JS provides no guarantees. */
function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
        arrays[i].fill(0);
    }
}
/** Create DataView of an array for easy byte-level manipulation. */
function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
/** The rotate right (circular right shift) operation for uint32 */
function rotr(word, shift) {
    return (word << (32 - shift)) | (word >>> shift);
}
/** The rotate left (circular left shift) operation for uint32 */
function rotl(word, shift) {
    return (word << shift) | ((word >>> (32 - shift)) >>> 0);
}
/** Is current platform little-endian? Most are. Big-Endian platform: IBM */
exports.isLE = (() => new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44)();
/** The byte swap operation for uint32 */
function byteSwap(word) {
    return (((word << 24) & 0xff000000) |
        ((word << 8) & 0xff0000) |
        ((word >>> 8) & 0xff00) |
        ((word >>> 24) & 0xff));
}
/** Conditionally byte swap if on a big-endian platform */
exports.swap8IfBE = exports.isLE
    ? (n) => n
    : (n) => byteSwap(n);
/** @deprecated */
exports.byteSwapIfBE = exports.swap8IfBE;
/** In place byte swap for Uint32Array */
function byteSwap32(arr) {
    for (let i = 0; i < arr.length; i++) {
        arr[i] = byteSwap(arr[i]);
    }
    return arr;
}
exports.swap32IfBE = exports.isLE
    ? (u) => u
    : byteSwap32;
// Built-in hex conversion https://caniuse.com/mdn-javascript_builtins_uint8array_fromhex
const hasHexBuiltin = /* @__PURE__ */ (() => 
// @ts-ignore
typeof Uint8Array.from([]).toHex === 'function' && typeof Uint8Array.fromHex === 'function')();
// Array where index 0xf0 (240) is mapped to string 'f0'
const hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
/**
 * Convert byte array to hex string. Uses built-in function, when available.
 * @example bytesToHex(Uint8Array.from([0xca, 0xfe, 0x01, 0x23])) // 'cafe0123'
 */
function bytesToHex(bytes) {
    abytes(bytes);
    // @ts-ignore
    if (hasHexBuiltin)
        return bytes.toHex();
    // pre-caching improves the speed 6x
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += hexes[bytes[i]];
    }
    return hex;
}
// We use optimized technique to convert hex string to byte array
const asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
        return ch - asciis._0; // '2' => 50-48
    if (ch >= asciis.A && ch <= asciis.F)
        return ch - (asciis.A - 10); // 'B' => 66-(65-10)
    if (ch >= asciis.a && ch <= asciis.f)
        return ch - (asciis.a - 10); // 'b' => 98-(97-10)
    return;
}
/**
 * Convert hex string to byte array. Uses built-in function, when available.
 * @example hexToBytes('cafe0123') // Uint8Array.from([0xca, 0xfe, 0x01, 0x23])
 */
function hexToBytes(hex) {
    if (typeof hex !== 'string')
        throw new Error('hex string expected, got ' + typeof hex);
    // @ts-ignore
    if (hasHexBuiltin)
        return Uint8Array.fromHex(hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
        throw new Error('hex string expected, got unpadded hex of length ' + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
        const n1 = asciiToBase16(hex.charCodeAt(hi));
        const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
        if (n1 === undefined || n2 === undefined) {
            const char = hex[hi] + hex[hi + 1];
            throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
        }
        array[ai] = n1 * 16 + n2; // multiply first octet, e.g. 'a3' => 10*16+3 => 160 + 3 => 163
    }
    return array;
}
/**
 * There is no setImmediate in browser and setTimeout is slow.
 * Call of async fn will return Promise, which will be fullfiled only on
 * next scheduler queue processing step and this is exactly what we need.
 */
const nextTick = async () => { };
exports.nextTick = nextTick;
/** Returns control to thread each 'tick' ms to avoid blocking. */
async function asyncLoop(iters, tick, cb) {
    let ts = Date.now();
    for (let i = 0; i < iters; i++) {
        cb(i);
        // Date.now() is not monotonic, so in case if clock goes backwards we return return control too
        const diff = Date.now() - ts;
        if (diff >= 0 && diff < tick)
            continue;
        await (0, exports.nextTick)();
        ts += diff;
    }
}
/**
 * Converts string to bytes using UTF8 encoding.
 * @example utf8ToBytes('abc') // Uint8Array.from([97, 98, 99])
 */
function utf8ToBytes(str) {
    if (typeof str !== 'string')
        throw new Error('string expected');
    return new Uint8Array(new TextEncoder().encode(str)); // https://bugzil.la/1681809
}
/**
 * Converts bytes to string using UTF8 encoding.
 * @example bytesToUtf8(Uint8Array.from([97, 98, 99])) // 'abc'
 */
function bytesToUtf8(bytes) {
    return new TextDecoder().decode(bytes);
}
/**
 * Normalizes (non-hex) string or Uint8Array to Uint8Array.
 * Warning: when Uint8Array is passed, it would NOT get copied.
 * Keep in mind for future mutable operations.
 */
function toBytes(data) {
    if (typeof data === 'string')
        data = utf8ToBytes(data);
    abytes(data);
    return data;
}
/**
 * Helper for KDFs: consumes uint8array or string.
 * When string is passed, does utf8 decoding, using TextDecoder.
 */
function kdfInputToBytes(data) {
    if (typeof data === 'string')
        data = utf8ToBytes(data);
    abytes(data);
    return data;
}
/** Copies several Uint8Arrays into one. */
function concatBytes(...arrays) {
    let sum = 0;
    for (let i = 0; i < arrays.length; i++) {
        const a = arrays[i];
        abytes(a);
        sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i = 0, pad = 0; i < arrays.length; i++) {
        const a = arrays[i];
        res.set(a, pad);
        pad += a.length;
    }
    return res;
}
function checkOpts(defaults, opts) {
    if (opts !== undefined && {}.toString.call(opts) !== '[object Object]')
        throw new Error('options should be object or undefined');
    const merged = Object.assign(defaults, opts);
    return merged;
}
/** For runtime check if class implements interface */
class Hash {
}
exports.Hash = Hash;
/** Wraps hash function, creating an interface on top of it */
function createHasher(hashCons) {
    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
}
function createOptHasher(hashCons) {
    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
    const tmp = hashCons({});
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    return hashC;
}
function createXOFer(hashCons) {
    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
    const tmp = hashCons({});
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    return hashC;
}
exports.wrapConstructor = createHasher;
exports.wrapConstructorWithOpts = createOptHasher;
exports.wrapXOFConstructorWithOpts = createXOFer;
/** Cryptographically secure PRNG. Uses internal OS-level `crypto.getRandomValues`. */
function randomBytes(bytesLength = 32) {
    if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === 'function') {
        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
    }
    // Legacy Node.js compatibility
    if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === 'function') {
        return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
    }
    throw new Error('crypto.getRandomValues must be defined');
}
//# sourceMappingURL=utils.js.map
    },
    5: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crypto = void 0;
/**
 * Internal webcrypto alias.
 * We prefer WebCrypto aka globalThis.crypto, which exists in node.js 16+.
 * Falls back to Node.js built-in crypto for Node.js <=v14.
 * See utils.ts for details.
 * @module
 */
// @ts-ignore
const nc = require("node:crypto");
exports.crypto = nc && typeof nc === 'object' && 'webcrypto' in nc
    ? nc.webcrypto
    : nc && typeof nc === 'object' && 'randomBytes' in nc
        ? nc
        : undefined;
//# sourceMappingURL=cryptoNode.js.map
    },
    6: function(require, module, exports) {

    },
    7: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHA512_IV = exports.SHA384_IV = exports.SHA224_IV = exports.SHA256_IV = exports.HashMD = void 0;
exports.setBigUint64 = setBigUint64;
exports.Chi = Chi;
exports.Maj = Maj;
/**
 * Internal Merkle-Damgard hash utils.
 * @module
 */
const utils_ts_1 = require("./utils.js");
/** Polyfill for Safari 14. https://caniuse.com/mdn-javascript_builtins_dataview_setbiguint64 */
function setBigUint64(view, byteOffset, value, isLE) {
    if (typeof view.setBigUint64 === 'function')
        return view.setBigUint64(byteOffset, value, isLE);
    const _32n = BigInt(32);
    const _u32_max = BigInt(0xffffffff);
    const wh = Number((value >> _32n) & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
}
/** Choice: a ? b : c */
function Chi(a, b, c) {
    return (a & b) ^ (~a & c);
}
/** Majority function, true if any two inputs is true. */
function Maj(a, b, c) {
    return (a & b) ^ (a & c) ^ (b & c);
}
/**
 * Merkle-Damgard hash construction base class.
 * Could be used to create MD5, RIPEMD, SHA1, SHA2.
 */
class HashMD extends utils_ts_1.Hash {
    constructor(blockLen, outputLen, padOffset, isLE) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.padOffset = padOffset;
        this.isLE = isLE;
        this.buffer = new Uint8Array(blockLen);
        this.view = (0, utils_ts_1.createView)(this.buffer);
    }
    update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        const { view, buffer, blockLen } = this;
        const len = data.length;
        for (let pos = 0; pos < len;) {
            const take = Math.min(blockLen - this.pos, len - pos);
            // Fast path: we have at least one block in input, cast it to view and process
            if (take === blockLen) {
                const dataView = (0, utils_ts_1.createView)(data);
                for (; blockLen <= len - pos; pos += blockLen)
                    this.process(dataView, pos);
                continue;
            }
            buffer.set(data.subarray(pos, pos + take), this.pos);
            this.pos += take;
            pos += take;
            if (this.pos === blockLen) {
                this.process(view, 0);
                this.pos = 0;
            }
        }
        this.length += data.length;
        this.roundClean();
        return this;
    }
    digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.aoutput)(out, this);
        this.finished = true;
        // Padding
        // We can avoid allocation of buffer for padding completely if it
        // was previously not allocated here. But it won't change performance.
        const { buffer, view, blockLen, isLE } = this;
        let { pos } = this;
        // append the bit '1' to the message
        buffer[pos++] = 0b10000000;
        (0, utils_ts_1.clean)(this.buffer.subarray(pos));
        // we have less than padOffset left in buffer, so we cannot put length in
        // current block, need process it and pad again
        if (this.padOffset > blockLen - pos) {
            this.process(view, 0);
            pos = 0;
        }
        // Pad until full block byte with zeros
        for (let i = pos; i < blockLen; i++)
            buffer[i] = 0;
        // Note: sha512 requires length to be 128bit integer, but length in JS will overflow before that
        // You need to write around 2 exabytes (u64_max / 8 / (1024**6)) for this to happen.
        // So we just write lowest 64 bits of that value.
        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
        this.process(view, 0);
        const oview = (0, utils_ts_1.createView)(out);
        const len = this.outputLen;
        // NOTE: we do division by 4 later, which should be fused in single op with modulo by JIT
        if (len % 4)
            throw new Error('_sha2: outputLen should be aligned to 32bit');
        const outLen = len / 4;
        const state = this.get();
        if (outLen > state.length)
            throw new Error('_sha2: outputLen bigger than state');
        for (let i = 0; i < outLen; i++)
            oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
    }
    _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { blockLen, buffer, length, finished, destroyed, pos } = this;
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        if (length % blockLen)
            to.buffer.set(buffer);
        return to;
    }
    clone() {
        return this._cloneInto();
    }
}
exports.HashMD = HashMD;
/**
 * Initial SHA-2 state: fractional parts of square roots of first 16 primes 2..53.
 * Check out `test/misc/sha2-gen-iv.js` for recomputation guide.
 */
/** Initial SHA256 state. Bits 0..32 of frac part of sqrt of primes 2..19 */
exports.SHA256_IV = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
/** Initial SHA224 state. Bits 32..64 of frac part of sqrt of primes 23..53 */
exports.SHA224_IV = Uint32Array.from([
    0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
]);
/** Initial SHA384 state. Bits 0..64 of frac part of sqrt of primes 23..53 */
exports.SHA384_IV = Uint32Array.from([
    0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
    0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
]);
/** Initial SHA512 state. Bits 0..64 of frac part of sqrt of primes 2..19 */
exports.SHA512_IV = Uint32Array.from([
    0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
]);
//# sourceMappingURL=_md.js.map
    },
    8: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBig = exports.shrSL = exports.shrSH = exports.rotrSL = exports.rotrSH = exports.rotrBL = exports.rotrBH = exports.rotr32L = exports.rotr32H = exports.rotlSL = exports.rotlSH = exports.rotlBL = exports.rotlBH = exports.add5L = exports.add5H = exports.add4L = exports.add4H = exports.add3L = exports.add3H = void 0;
exports.add = add;
exports.fromBig = fromBig;
exports.split = split;
/**
 * Internal helpers for u64. BigUint64Array is too slow as per 2025, so we implement it using Uint32Array.
 * @todo re-check https://issues.chromium.org/issues/42212588
 * @module
 */
const U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
const _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
    if (le)
        return { h: Number(n & U32_MASK64), l: Number((n >> _32n) & U32_MASK64) };
    return { h: Number((n >> _32n) & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
        const { h, l } = fromBig(lst[i], le);
        [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
}
const toBig = (h, l) => (BigInt(h >>> 0) << _32n) | BigInt(l >>> 0);
exports.toBig = toBig;
// for Shift in [0, 32)
const shrSH = (h, _l, s) => h >>> s;
exports.shrSH = shrSH;
const shrSL = (h, l, s) => (h << (32 - s)) | (l >>> s);
exports.shrSL = shrSL;
// Right rotate for Shift in [1, 32)
const rotrSH = (h, l, s) => (h >>> s) | (l << (32 - s));
exports.rotrSH = rotrSH;
const rotrSL = (h, l, s) => (h << (32 - s)) | (l >>> s);
exports.rotrSL = rotrSL;
// Right rotate for Shift in (32, 64), NOTE: 32 is special case.
const rotrBH = (h, l, s) => (h << (64 - s)) | (l >>> (s - 32));
exports.rotrBH = rotrBH;
const rotrBL = (h, l, s) => (h >>> (s - 32)) | (l << (64 - s));
exports.rotrBL = rotrBL;
// Right rotate for shift===32 (just swaps l&h)
const rotr32H = (_h, l) => l;
exports.rotr32H = rotr32H;
const rotr32L = (h, _l) => h;
exports.rotr32L = rotr32L;
// Left rotate for Shift in [1, 32)
const rotlSH = (h, l, s) => (h << s) | (l >>> (32 - s));
exports.rotlSH = rotlSH;
const rotlSL = (h, l, s) => (l << s) | (h >>> (32 - s));
exports.rotlSL = rotlSL;
// Left rotate for Shift in (32, 64), NOTE: 32 is special case.
const rotlBH = (h, l, s) => (l << (s - 32)) | (h >>> (64 - s));
exports.rotlBH = rotlBH;
const rotlBL = (h, l, s) => (h << (s - 32)) | (l >>> (64 - s));
exports.rotlBL = rotlBL;
// JS uses 32-bit signed integers for bitwise operations which means we cannot
// simple take carry out of low bit sum by shift, we need to use division.
function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: (Ah + Bh + ((l / 2 ** 32) | 0)) | 0, l: l | 0 };
}
// Addition with more than 2 elements
const add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
exports.add3L = add3L;
const add3H = (low, Ah, Bh, Ch) => (Ah + Bh + Ch + ((low / 2 ** 32) | 0)) | 0;
exports.add3H = add3H;
const add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
exports.add4L = add4L;
const add4H = (low, Ah, Bh, Ch, Dh) => (Ah + Bh + Ch + Dh + ((low / 2 ** 32) | 0)) | 0;
exports.add4H = add4H;
const add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
exports.add5L = add5L;
const add5H = (low, Ah, Bh, Ch, Dh, Eh) => (Ah + Bh + Ch + Dh + Eh + ((low / 2 ** 32) | 0)) | 0;
exports.add5H = add5H;
// prettier-ignore
const u64 = {
    fromBig, split, toBig,
    shrSH, shrSL,
    rotrSH, rotrSL, rotrBH, rotrBL,
    rotr32H, rotr32L,
    rotlSH, rotlSL, rotlBH, rotlBL,
    add, add3L, add3H, add4L, add4H, add5H, add5L,
};
exports.default = u64;
//# sourceMappingURL=_u64.js.map
    },
    9: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blake2s = exports.BLAKE2s = exports.compress = exports.G2s = exports.G1s = exports.B2S_IV = void 0;
/**
 * Blake2s hash function. Focuses on 8-bit to 32-bit platforms. blake2b for 64-bit, but in JS it is slower.
 * @module
 * @deprecated
 */
const _blake_ts_1 = require("./_blake.js");
const _md_ts_1 = require("./_md.js");
const blake2_ts_1 = require("./blake2.js");
/** @deprecated Use import from `noble/hashes/blake2` module */
exports.B2S_IV = _md_ts_1.SHA256_IV;
/** @deprecated Use import from `noble/hashes/blake2` module */
exports.G1s = _blake_ts_1.G1s;
/** @deprecated Use import from `noble/hashes/blake2` module */
exports.G2s = _blake_ts_1.G2s;
/** @deprecated Use import from `noble/hashes/blake2` module */
exports.compress = blake2_ts_1.compress;
/** @deprecated Use import from `noble/hashes/blake2` module */
exports.BLAKE2s = blake2_ts_1.BLAKE2s;
/** @deprecated Use import from `noble/hashes/blake2` module */
exports.blake2s = blake2_ts_1.blake2s;
//# sourceMappingURL=blake2s.js.map
    },
    10: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha224 = exports.SHA224 = exports.sha256 = exports.SHA256 = void 0;
/**
 * SHA2-256 a.k.a. sha256. In JS, it is the fastest hash, even faster than Blake3.
 *
 * To break sha256 using birthday attack, attackers need to try 2^128 hashes.
 * BTC network is doing 2^70 hashes/sec (2^95 hashes/year) as per 2025.
 *
 * Check out [FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf).
 * @module
 * @deprecated
 */
const sha2_ts_1 = require("./sha2.js");
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.SHA256 = sha2_ts_1.SHA256;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.sha256 = sha2_ts_1.sha256;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.SHA224 = sha2_ts_1.SHA224;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.sha224 = sha2_ts_1.sha224;
//# sourceMappingURL=sha256.js.map
    },
    11: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha512_224 = exports.sha512_256 = exports.sha384 = exports.sha512 = exports.sha224 = exports.sha256 = exports.SHA512_256 = exports.SHA512_224 = exports.SHA384 = exports.SHA512 = exports.SHA224 = exports.SHA256 = void 0;
/**
 * SHA2 hash function. A.k.a. sha256, sha384, sha512, sha512_224, sha512_256.
 * SHA256 is the fastest hash implementable in JS, even faster than Blake3.
 * Check out [RFC 4634](https://datatracker.ietf.org/doc/html/rfc4634) and
 * [FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf).
 * @module
 */
const _md_ts_1 = require("./_md.js");
const u64 = require("./_u64.js");
const utils_ts_1 = require("./utils.js");
/**
 * Round constants:
 * First 32 bits of fractional parts of the cube roots of the first 64 primes 2..311)
 */
// prettier-ignore
const SHA256_K = /* @__PURE__ */ Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
/** Reusable temporary buffer. "W" comes straight from spec. */
const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
class SHA256 extends _md_ts_1.HashMD {
    constructor(outputLen = 32) {
        super(64, outputLen, 8, false);
        // We cannot use array here since array allows indexing by variable
        // which means optimizer/compiler cannot use registers.
        this.A = _md_ts_1.SHA256_IV[0] | 0;
        this.B = _md_ts_1.SHA256_IV[1] | 0;
        this.C = _md_ts_1.SHA256_IV[2] | 0;
        this.D = _md_ts_1.SHA256_IV[3] | 0;
        this.E = _md_ts_1.SHA256_IV[4] | 0;
        this.F = _md_ts_1.SHA256_IV[5] | 0;
        this.G = _md_ts_1.SHA256_IV[6] | 0;
        this.H = _md_ts_1.SHA256_IV[7] | 0;
    }
    get() {
        const { A, B, C, D, E, F, G, H } = this;
        return [A, B, C, D, E, F, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F, G, H) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
        this.E = E | 0;
        this.F = F | 0;
        this.G = G | 0;
        this.H = H | 0;
    }
    process(view, offset) {
        // Extend the first 16 words into the remaining 48 words w[16..63] of the message schedule array
        for (let i = 0; i < 16; i++, offset += 4)
            SHA256_W[i] = view.getUint32(offset, false);
        for (let i = 16; i < 64; i++) {
            const W15 = SHA256_W[i - 15];
            const W2 = SHA256_W[i - 2];
            const s0 = (0, utils_ts_1.rotr)(W15, 7) ^ (0, utils_ts_1.rotr)(W15, 18) ^ (W15 >>> 3);
            const s1 = (0, utils_ts_1.rotr)(W2, 17) ^ (0, utils_ts_1.rotr)(W2, 19) ^ (W2 >>> 10);
            SHA256_W[i] = (s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16]) | 0;
        }
        // Compression function main loop, 64 rounds
        let { A, B, C, D, E, F, G, H } = this;
        for (let i = 0; i < 64; i++) {
            const sigma1 = (0, utils_ts_1.rotr)(E, 6) ^ (0, utils_ts_1.rotr)(E, 11) ^ (0, utils_ts_1.rotr)(E, 25);
            const T1 = (H + sigma1 + (0, _md_ts_1.Chi)(E, F, G) + SHA256_K[i] + SHA256_W[i]) | 0;
            const sigma0 = (0, utils_ts_1.rotr)(A, 2) ^ (0, utils_ts_1.rotr)(A, 13) ^ (0, utils_ts_1.rotr)(A, 22);
            const T2 = (sigma0 + (0, _md_ts_1.Maj)(A, B, C)) | 0;
            H = G;
            G = F;
            F = E;
            E = (D + T1) | 0;
            D = C;
            C = B;
            B = A;
            A = (T1 + T2) | 0;
        }
        // Add the compressed chunk to the current hash value
        A = (A + this.A) | 0;
        B = (B + this.B) | 0;
        C = (C + this.C) | 0;
        D = (D + this.D) | 0;
        E = (E + this.E) | 0;
        F = (F + this.F) | 0;
        G = (G + this.G) | 0;
        H = (H + this.H) | 0;
        this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
        (0, utils_ts_1.clean)(SHA256_W);
    }
    destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
        (0, utils_ts_1.clean)(this.buffer);
    }
}
exports.SHA256 = SHA256;
class SHA224 extends SHA256 {
    constructor() {
        super(28);
        this.A = _md_ts_1.SHA224_IV[0] | 0;
        this.B = _md_ts_1.SHA224_IV[1] | 0;
        this.C = _md_ts_1.SHA224_IV[2] | 0;
        this.D = _md_ts_1.SHA224_IV[3] | 0;
        this.E = _md_ts_1.SHA224_IV[4] | 0;
        this.F = _md_ts_1.SHA224_IV[5] | 0;
        this.G = _md_ts_1.SHA224_IV[6] | 0;
        this.H = _md_ts_1.SHA224_IV[7] | 0;
    }
}
exports.SHA224 = SHA224;
// SHA2-512 is slower than sha256 in js because u64 operations are slow.
// Round contants
// First 32 bits of the fractional parts of the cube roots of the first 80 primes 2..409
// prettier-ignore
const K512 = /* @__PURE__ */ (() => u64.split([
    '0x428a2f98d728ae22', '0x7137449123ef65cd', '0xb5c0fbcfec4d3b2f', '0xe9b5dba58189dbbc',
    '0x3956c25bf348b538', '0x59f111f1b605d019', '0x923f82a4af194f9b', '0xab1c5ed5da6d8118',
    '0xd807aa98a3030242', '0x12835b0145706fbe', '0x243185be4ee4b28c', '0x550c7dc3d5ffb4e2',
    '0x72be5d74f27b896f', '0x80deb1fe3b1696b1', '0x9bdc06a725c71235', '0xc19bf174cf692694',
    '0xe49b69c19ef14ad2', '0xefbe4786384f25e3', '0x0fc19dc68b8cd5b5', '0x240ca1cc77ac9c65',
    '0x2de92c6f592b0275', '0x4a7484aa6ea6e483', '0x5cb0a9dcbd41fbd4', '0x76f988da831153b5',
    '0x983e5152ee66dfab', '0xa831c66d2db43210', '0xb00327c898fb213f', '0xbf597fc7beef0ee4',
    '0xc6e00bf33da88fc2', '0xd5a79147930aa725', '0x06ca6351e003826f', '0x142929670a0e6e70',
    '0x27b70a8546d22ffc', '0x2e1b21385c26c926', '0x4d2c6dfc5ac42aed', '0x53380d139d95b3df',
    '0x650a73548baf63de', '0x766a0abb3c77b2a8', '0x81c2c92e47edaee6', '0x92722c851482353b',
    '0xa2bfe8a14cf10364', '0xa81a664bbc423001', '0xc24b8b70d0f89791', '0xc76c51a30654be30',
    '0xd192e819d6ef5218', '0xd69906245565a910', '0xf40e35855771202a', '0x106aa07032bbd1b8',
    '0x19a4c116b8d2d0c8', '0x1e376c085141ab53', '0x2748774cdf8eeb99', '0x34b0bcb5e19b48a8',
    '0x391c0cb3c5c95a63', '0x4ed8aa4ae3418acb', '0x5b9cca4f7763e373', '0x682e6ff3d6b2b8a3',
    '0x748f82ee5defb2fc', '0x78a5636f43172f60', '0x84c87814a1f0ab72', '0x8cc702081a6439ec',
    '0x90befffa23631e28', '0xa4506cebde82bde9', '0xbef9a3f7b2c67915', '0xc67178f2e372532b',
    '0xca273eceea26619c', '0xd186b8c721c0c207', '0xeada7dd6cde0eb1e', '0xf57d4f7fee6ed178',
    '0x06f067aa72176fba', '0x0a637dc5a2c898a6', '0x113f9804bef90dae', '0x1b710b35131c471b',
    '0x28db77f523047d84', '0x32caab7b40c72493', '0x3c9ebe0a15c9bebc', '0x431d67c49c100d4c',
    '0x4cc5d4becb3e42b6', '0x597f299cfc657e2a', '0x5fcb6fab3ad6faec', '0x6c44198c4a475817'
].map(n => BigInt(n))))();
const SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
const SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
// Reusable temporary buffers
const SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
const SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
class SHA512 extends _md_ts_1.HashMD {
    constructor(outputLen = 64) {
        super(128, outputLen, 16, false);
        // We cannot use array here since array allows indexing by variable
        // which means optimizer/compiler cannot use registers.
        // h -- high 32 bits, l -- low 32 bits
        this.Ah = _md_ts_1.SHA512_IV[0] | 0;
        this.Al = _md_ts_1.SHA512_IV[1] | 0;
        this.Bh = _md_ts_1.SHA512_IV[2] | 0;
        this.Bl = _md_ts_1.SHA512_IV[3] | 0;
        this.Ch = _md_ts_1.SHA512_IV[4] | 0;
        this.Cl = _md_ts_1.SHA512_IV[5] | 0;
        this.Dh = _md_ts_1.SHA512_IV[6] | 0;
        this.Dl = _md_ts_1.SHA512_IV[7] | 0;
        this.Eh = _md_ts_1.SHA512_IV[8] | 0;
        this.El = _md_ts_1.SHA512_IV[9] | 0;
        this.Fh = _md_ts_1.SHA512_IV[10] | 0;
        this.Fl = _md_ts_1.SHA512_IV[11] | 0;
        this.Gh = _md_ts_1.SHA512_IV[12] | 0;
        this.Gl = _md_ts_1.SHA512_IV[13] | 0;
        this.Hh = _md_ts_1.SHA512_IV[14] | 0;
        this.Hl = _md_ts_1.SHA512_IV[15] | 0;
    }
    // prettier-ignore
    get() {
        const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    // prettier-ignore
    set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
        this.Ah = Ah | 0;
        this.Al = Al | 0;
        this.Bh = Bh | 0;
        this.Bl = Bl | 0;
        this.Ch = Ch | 0;
        this.Cl = Cl | 0;
        this.Dh = Dh | 0;
        this.Dl = Dl | 0;
        this.Eh = Eh | 0;
        this.El = El | 0;
        this.Fh = Fh | 0;
        this.Fl = Fl | 0;
        this.Gh = Gh | 0;
        this.Gl = Gl | 0;
        this.Hh = Hh | 0;
        this.Hl = Hl | 0;
    }
    process(view, offset) {
        // Extend the first 16 words into the remaining 64 words w[16..79] of the message schedule array
        for (let i = 0; i < 16; i++, offset += 4) {
            SHA512_W_H[i] = view.getUint32(offset);
            SHA512_W_L[i] = view.getUint32((offset += 4));
        }
        for (let i = 16; i < 80; i++) {
            // s0 := (w[i-15] rightrotate 1) xor (w[i-15] rightrotate 8) xor (w[i-15] rightshift 7)
            const W15h = SHA512_W_H[i - 15] | 0;
            const W15l = SHA512_W_L[i - 15] | 0;
            const s0h = u64.rotrSH(W15h, W15l, 1) ^ u64.rotrSH(W15h, W15l, 8) ^ u64.shrSH(W15h, W15l, 7);
            const s0l = u64.rotrSL(W15h, W15l, 1) ^ u64.rotrSL(W15h, W15l, 8) ^ u64.shrSL(W15h, W15l, 7);
            // s1 := (w[i-2] rightrotate 19) xor (w[i-2] rightrotate 61) xor (w[i-2] rightshift 6)
            const W2h = SHA512_W_H[i - 2] | 0;
            const W2l = SHA512_W_L[i - 2] | 0;
            const s1h = u64.rotrSH(W2h, W2l, 19) ^ u64.rotrBH(W2h, W2l, 61) ^ u64.shrSH(W2h, W2l, 6);
            const s1l = u64.rotrSL(W2h, W2l, 19) ^ u64.rotrBL(W2h, W2l, 61) ^ u64.shrSL(W2h, W2l, 6);
            // SHA256_W[i] = s0 + s1 + SHA256_W[i - 7] + SHA256_W[i - 16];
            const SUMl = u64.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
            const SUMh = u64.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
            SHA512_W_H[i] = SUMh | 0;
            SHA512_W_L[i] = SUMl | 0;
        }
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        // Compression function main loop, 80 rounds
        for (let i = 0; i < 80; i++) {
            // S1 := (e rightrotate 14) xor (e rightrotate 18) xor (e rightrotate 41)
            const sigma1h = u64.rotrSH(Eh, El, 14) ^ u64.rotrSH(Eh, El, 18) ^ u64.rotrBH(Eh, El, 41);
            const sigma1l = u64.rotrSL(Eh, El, 14) ^ u64.rotrSL(Eh, El, 18) ^ u64.rotrBL(Eh, El, 41);
            //const T1 = (H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i]) | 0;
            const CHIh = (Eh & Fh) ^ (~Eh & Gh);
            const CHIl = (El & Fl) ^ (~El & Gl);
            // T1 = H + sigma1 + Chi(E, F, G) + SHA512_K[i] + SHA512_W[i]
            // prettier-ignore
            const T1ll = u64.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
            const T1h = u64.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
            const T1l = T1ll | 0;
            // S0 := (a rightrotate 28) xor (a rightrotate 34) xor (a rightrotate 39)
            const sigma0h = u64.rotrSH(Ah, Al, 28) ^ u64.rotrBH(Ah, Al, 34) ^ u64.rotrBH(Ah, Al, 39);
            const sigma0l = u64.rotrSL(Ah, Al, 28) ^ u64.rotrBL(Ah, Al, 34) ^ u64.rotrBL(Ah, Al, 39);
            const MAJh = (Ah & Bh) ^ (Ah & Ch) ^ (Bh & Ch);
            const MAJl = (Al & Bl) ^ (Al & Cl) ^ (Bl & Cl);
            Hh = Gh | 0;
            Hl = Gl | 0;
            Gh = Fh | 0;
            Gl = Fl | 0;
            Fh = Eh | 0;
            Fl = El | 0;
            ({ h: Eh, l: El } = u64.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
            Dh = Ch | 0;
            Dl = Cl | 0;
            Ch = Bh | 0;
            Cl = Bl | 0;
            Bh = Ah | 0;
            Bl = Al | 0;
            const All = u64.add3L(T1l, sigma0l, MAJl);
            Ah = u64.add3H(All, T1h, sigma0h, MAJh);
            Al = All | 0;
        }
        // Add the compressed chunk to the current hash value
        ({ h: Ah, l: Al } = u64.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
        ({ h: Bh, l: Bl } = u64.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
        ({ h: Ch, l: Cl } = u64.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
        ({ h: Dh, l: Dl } = u64.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
        ({ h: Eh, l: El } = u64.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
        ({ h: Fh, l: Fl } = u64.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
        ({ h: Gh, l: Gl } = u64.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
        ({ h: Hh, l: Hl } = u64.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
        this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
        (0, utils_ts_1.clean)(SHA512_W_H, SHA512_W_L);
    }
    destroy() {
        (0, utils_ts_1.clean)(this.buffer);
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
}
exports.SHA512 = SHA512;
class SHA384 extends SHA512 {
    constructor() {
        super(48);
        this.Ah = _md_ts_1.SHA384_IV[0] | 0;
        this.Al = _md_ts_1.SHA384_IV[1] | 0;
        this.Bh = _md_ts_1.SHA384_IV[2] | 0;
        this.Bl = _md_ts_1.SHA384_IV[3] | 0;
        this.Ch = _md_ts_1.SHA384_IV[4] | 0;
        this.Cl = _md_ts_1.SHA384_IV[5] | 0;
        this.Dh = _md_ts_1.SHA384_IV[6] | 0;
        this.Dl = _md_ts_1.SHA384_IV[7] | 0;
        this.Eh = _md_ts_1.SHA384_IV[8] | 0;
        this.El = _md_ts_1.SHA384_IV[9] | 0;
        this.Fh = _md_ts_1.SHA384_IV[10] | 0;
        this.Fl = _md_ts_1.SHA384_IV[11] | 0;
        this.Gh = _md_ts_1.SHA384_IV[12] | 0;
        this.Gl = _md_ts_1.SHA384_IV[13] | 0;
        this.Hh = _md_ts_1.SHA384_IV[14] | 0;
        this.Hl = _md_ts_1.SHA384_IV[15] | 0;
    }
}
exports.SHA384 = SHA384;
/**
 * Truncated SHA512/256 and SHA512/224.
 * SHA512_IV is XORed with 0xa5a5a5a5a5a5a5a5, then used as "intermediary" IV of SHA512/t.
 * Then t hashes string to produce result IV.
 * See `test/misc/sha2-gen-iv.js`.
 */
/** SHA512/224 IV */
const T224_IV = /* @__PURE__ */ Uint32Array.from([
    0x8c3d37c8, 0x19544da2, 0x73e19966, 0x89dcd4d6, 0x1dfab7ae, 0x32ff9c82, 0x679dd514, 0x582f9fcf,
    0x0f6d2b69, 0x7bd44da8, 0x77e36f73, 0x04c48942, 0x3f9d85a8, 0x6a1d36c8, 0x1112e6ad, 0x91d692a1,
]);
/** SHA512/256 IV */
const T256_IV = /* @__PURE__ */ Uint32Array.from([
    0x22312194, 0xfc2bf72c, 0x9f555fa3, 0xc84c64c2, 0x2393b86b, 0x6f53b151, 0x96387719, 0x5940eabd,
    0x96283ee2, 0xa88effe3, 0xbe5e1e25, 0x53863992, 0x2b0199fc, 0x2c85b8aa, 0x0eb72ddc, 0x81c52ca2,
]);
class SHA512_224 extends SHA512 {
    constructor() {
        super(28);
        this.Ah = T224_IV[0] | 0;
        this.Al = T224_IV[1] | 0;
        this.Bh = T224_IV[2] | 0;
        this.Bl = T224_IV[3] | 0;
        this.Ch = T224_IV[4] | 0;
        this.Cl = T224_IV[5] | 0;
        this.Dh = T224_IV[6] | 0;
        this.Dl = T224_IV[7] | 0;
        this.Eh = T224_IV[8] | 0;
        this.El = T224_IV[9] | 0;
        this.Fh = T224_IV[10] | 0;
        this.Fl = T224_IV[11] | 0;
        this.Gh = T224_IV[12] | 0;
        this.Gl = T224_IV[13] | 0;
        this.Hh = T224_IV[14] | 0;
        this.Hl = T224_IV[15] | 0;
    }
}
exports.SHA512_224 = SHA512_224;
class SHA512_256 extends SHA512 {
    constructor() {
        super(32);
        this.Ah = T256_IV[0] | 0;
        this.Al = T256_IV[1] | 0;
        this.Bh = T256_IV[2] | 0;
        this.Bl = T256_IV[3] | 0;
        this.Ch = T256_IV[4] | 0;
        this.Cl = T256_IV[5] | 0;
        this.Dh = T256_IV[6] | 0;
        this.Dl = T256_IV[7] | 0;
        this.Eh = T256_IV[8] | 0;
        this.El = T256_IV[9] | 0;
        this.Fh = T256_IV[10] | 0;
        this.Fl = T256_IV[11] | 0;
        this.Gh = T256_IV[12] | 0;
        this.Gl = T256_IV[13] | 0;
        this.Hh = T256_IV[14] | 0;
        this.Hl = T256_IV[15] | 0;
    }
}
exports.SHA512_256 = SHA512_256;
/**
 * SHA2-256 hash function from RFC 4634.
 *
 * It is the fastest JS hash, even faster than Blake3.
 * To break sha256 using birthday attack, attackers need to try 2^128 hashes.
 * BTC network is doing 2^70 hashes/sec (2^95 hashes/year) as per 2025.
 */
exports.sha256 = (0, utils_ts_1.createHasher)(() => new SHA256());
/** SHA2-224 hash function from RFC 4634 */
exports.sha224 = (0, utils_ts_1.createHasher)(() => new SHA224());
/** SHA2-512 hash function from RFC 4634. */
exports.sha512 = (0, utils_ts_1.createHasher)(() => new SHA512());
/** SHA2-384 hash function from RFC 4634. */
exports.sha384 = (0, utils_ts_1.createHasher)(() => new SHA384());
/**
 * SHA2-512/256 "truncated" hash function, with improved resistance to length extension attacks.
 * See the paper on [truncated SHA512](https://eprint.iacr.org/2010/548.pdf).
 */
exports.sha512_256 = (0, utils_ts_1.createHasher)(() => new SHA512_256());
/**
 * SHA2-512/224 "truncated" hash function, with improved resistance to length extension attacks.
 * See the paper on [truncated SHA512](https://eprint.iacr.org/2010/548.pdf).
 */
exports.sha512_224 = (0, utils_ts_1.createHasher)(() => new SHA512_224());
//# sourceMappingURL=sha2.js.map
    },
    12: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha512_256 = exports.SHA512_256 = exports.sha512_224 = exports.SHA512_224 = exports.sha384 = exports.SHA384 = exports.sha512 = exports.SHA512 = void 0;
/**
 * SHA2-512 a.k.a. sha512 and sha384. It is slower than sha256 in js because u64 operations are slow.
 *
 * Check out [RFC 4634](https://datatracker.ietf.org/doc/html/rfc4634) and
 * [the paper on truncated SHA512/256](https://eprint.iacr.org/2010/548.pdf).
 * @module
 * @deprecated
 */
const sha2_ts_1 = require("./sha2.js");
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.SHA512 = sha2_ts_1.SHA512;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.sha512 = sha2_ts_1.sha512;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.SHA384 = sha2_ts_1.SHA384;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.sha384 = sha2_ts_1.sha384;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.SHA512_224 = sha2_ts_1.SHA512_224;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.sha512_224 = sha2_ts_1.sha512_224;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.SHA512_256 = sha2_ts_1.SHA512_256;
/** @deprecated Use import from `noble/hashes/sha2` module */
exports.sha512_256 = sha2_ts_1.sha512_256;
//# sourceMappingURL=sha512.js.map
    },
    13: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pbkdf2 = pbkdf2;
exports.pbkdf2Async = pbkdf2Async;
/**
 * PBKDF (RFC 2898). Can be used to create a key from password and salt.
 * @module
 */
const hmac_ts_1 = require("./hmac.js");
// prettier-ignore
const utils_ts_1 = require("./utils.js");
// Common prologue and epilogue for sync/async functions
function pbkdf2Init(hash, _password, _salt, _opts) {
    (0, utils_ts_1.ahash)(hash);
    const opts = (0, utils_ts_1.checkOpts)({ dkLen: 32, asyncTick: 10 }, _opts);
    const { c, dkLen, asyncTick } = opts;
    (0, utils_ts_1.anumber)(c);
    (0, utils_ts_1.anumber)(dkLen);
    (0, utils_ts_1.anumber)(asyncTick);
    if (c < 1)
        throw new Error('iterations (c) should be >= 1');
    const password = (0, utils_ts_1.kdfInputToBytes)(_password);
    const salt = (0, utils_ts_1.kdfInputToBytes)(_salt);
    // DK = PBKDF2(PRF, Password, Salt, c, dkLen);
    const DK = new Uint8Array(dkLen);
    // U1 = PRF(Password, Salt + INT_32_BE(i))
    const PRF = hmac_ts_1.hmac.create(hash, password);
    const PRFSalt = PRF._cloneInto().update(salt);
    return { c, dkLen, asyncTick, DK, PRF, PRFSalt };
}
function pbkdf2Output(PRF, PRFSalt, DK, prfW, u) {
    PRF.destroy();
    PRFSalt.destroy();
    if (prfW)
        prfW.destroy();
    (0, utils_ts_1.clean)(u);
    return DK;
}
/**
 * PBKDF2-HMAC: RFC 2898 key derivation function
 * @param hash - hash function that would be used e.g. sha256
 * @param password - password from which a derived key is generated
 * @param salt - cryptographic salt
 * @param opts - {c, dkLen} where c is work factor and dkLen is output message size
 * @example
 * const key = pbkdf2(sha256, 'password', 'salt', { dkLen: 32, c: Math.pow(2, 18) });
 */
function pbkdf2(hash, password, salt, opts) {
    const { c, dkLen, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
    let prfW; // Working copy
    const arr = new Uint8Array(4);
    const view = (0, utils_ts_1.createView)(arr);
    const u = new Uint8Array(PRF.outputLen);
    // DK = T1 + T2 + ⋯ + Tdklen/hlen
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
        // Ti = F(Password, Salt, c, i)
        const Ti = DK.subarray(pos, pos + PRF.outputLen);
        view.setInt32(0, ti, false);
        // F(Password, Salt, c, i) = U1 ^ U2 ^ ⋯ ^ Uc
        // U1 = PRF(Password, Salt + INT_32_BE(i))
        (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
        Ti.set(u.subarray(0, Ti.length));
        for (let ui = 1; ui < c; ui++) {
            // Uc = PRF(Password, Uc−1)
            PRF._cloneInto(prfW).update(u).digestInto(u);
            for (let i = 0; i < Ti.length; i++)
                Ti[i] ^= u[i];
        }
    }
    return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}
/**
 * PBKDF2-HMAC: RFC 2898 key derivation function. Async version.
 * @example
 * await pbkdf2Async(sha256, 'password', 'salt', { dkLen: 32, c: 500_000 });
 */
async function pbkdf2Async(hash, password, salt, opts) {
    const { c, dkLen, asyncTick, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
    let prfW; // Working copy
    const arr = new Uint8Array(4);
    const view = (0, utils_ts_1.createView)(arr);
    const u = new Uint8Array(PRF.outputLen);
    // DK = T1 + T2 + ⋯ + Tdklen/hlen
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
        // Ti = F(Password, Salt, c, i)
        const Ti = DK.subarray(pos, pos + PRF.outputLen);
        view.setInt32(0, ti, false);
        // F(Password, Salt, c, i) = U1 ^ U2 ^ ⋯ ^ Uc
        // U1 = PRF(Password, Salt + INT_32_BE(i))
        (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
        Ti.set(u.subarray(0, Ti.length));
        await (0, utils_ts_1.asyncLoop)(c - 1, asyncTick, () => {
            // Uc = PRF(Password, Uc−1)
            PRF._cloneInto(prfW).update(u).digestInto(u);
            for (let i = 0; i < Ti.length; i++)
                Ti[i] ^= u[i];
        });
    }
    return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}
//# sourceMappingURL=pbkdf2.js.map
    },
    14: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hmac = exports.HMAC = void 0;
/**
 * HMAC: RFC2104 message authentication code.
 * @module
 */
const utils_ts_1 = require("./utils.js");
class HMAC extends utils_ts_1.Hash {
    constructor(hash, _key) {
        super();
        this.finished = false;
        this.destroyed = false;
        (0, utils_ts_1.ahash)(hash);
        const key = (0, utils_ts_1.toBytes)(_key);
        this.iHash = hash.create();
        if (typeof this.iHash.update !== 'function')
            throw new Error('Expected instance of class which extends utils.Hash');
        this.blockLen = this.iHash.blockLen;
        this.outputLen = this.iHash.outputLen;
        const blockLen = this.blockLen;
        const pad = new Uint8Array(blockLen);
        // blockLen can be bigger than outputLen
        pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
        for (let i = 0; i < pad.length; i++)
            pad[i] ^= 0x36;
        this.iHash.update(pad);
        // By doing update (processing of first block) of outer hash here we can re-use it between multiple calls via clone
        this.oHash = hash.create();
        // Undo internal XOR && apply outer XOR
        for (let i = 0; i < pad.length; i++)
            pad[i] ^= 0x36 ^ 0x5c;
        this.oHash.update(pad);
        (0, utils_ts_1.clean)(pad);
    }
    update(buf) {
        (0, utils_ts_1.aexists)(this);
        this.iHash.update(buf);
        return this;
    }
    digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.abytes)(out, this.outputLen);
        this.finished = true;
        this.iHash.digestInto(out);
        this.oHash.update(out);
        this.oHash.digestInto(out);
        this.destroy();
    }
    digest() {
        const out = new Uint8Array(this.oHash.outputLen);
        this.digestInto(out);
        return out;
    }
    _cloneInto(to) {
        // Create new instance without calling constructor since key already in state and we don't know it.
        to || (to = Object.create(Object.getPrototypeOf(this), {}));
        const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
        to = to;
        to.finished = finished;
        to.destroyed = destroyed;
        to.blockLen = blockLen;
        to.outputLen = outputLen;
        to.oHash = oHash._cloneInto(to.oHash);
        to.iHash = iHash._cloneInto(to.iHash);
        return to;
    }
    clone() {
        return this._cloneInto();
    }
    destroy() {
        this.destroyed = true;
        this.oHash.destroy();
        this.iHash.destroy();
    }
}
exports.HMAC = HMAC;
/**
 * HMAC: RFC2104 message authentication code.
 * @param hash - function that would be used e.g. sha256
 * @param key - message key
 * @param message - message data
 * @example
 * import { hmac } from '@noble/hashes/hmac';
 * import { sha256 } from '@noble/hashes/sha2';
 * const mac1 = hmac(sha256, 'key', 'message');
 */
const hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
exports.hmac = hmac;
exports.hmac.create = (hash, key) => new HMAC(hash, key);
//# sourceMappingURL=hmac.js.map
    },
    15: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ripemd160 = exports.RIPEMD160 = void 0;
/**
 * RIPEMD-160 legacy hash function.
 * https://homes.esat.kuleuven.be/~bosselae/ripemd160.html
 * https://homes.esat.kuleuven.be/~bosselae/ripemd160/pdf/AB-9601/AB-9601.pdf
 * @module
 * @deprecated
 */
const legacy_ts_1 = require("./legacy.js");
/** @deprecated Use import from `noble/hashes/legacy` module */
exports.RIPEMD160 = legacy_ts_1.RIPEMD160;
/** @deprecated Use import from `noble/hashes/legacy` module */
exports.ripemd160 = legacy_ts_1.ripemd160;
//# sourceMappingURL=ripemd160.js.map
    },
    16: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ripemd160 = exports.RIPEMD160 = exports.md5 = exports.MD5 = exports.sha1 = exports.SHA1 = void 0;
/**

SHA1 (RFC 3174), MD5 (RFC 1321) and RIPEMD160 (RFC 2286) legacy, weak hash functions.
Don't use them in a new protocol. What "weak" means:

- Collisions can be made with 2^18 effort in MD5, 2^60 in SHA1, 2^80 in RIPEMD160.
- No practical pre-image attacks (only theoretical, 2^123.4)
- HMAC seems kinda ok: https://datatracker.ietf.org/doc/html/rfc6151
 * @module
 */
const _md_ts_1 = require("./_md.js");
const utils_ts_1 = require("./utils.js");
/** Initial SHA1 state */
const SHA1_IV = /* @__PURE__ */ Uint32Array.from([
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0,
]);
// Reusable temporary buffer
const SHA1_W = /* @__PURE__ */ new Uint32Array(80);
/** SHA1 legacy hash class. */
class SHA1 extends _md_ts_1.HashMD {
    constructor() {
        super(64, 20, 8, false);
        this.A = SHA1_IV[0] | 0;
        this.B = SHA1_IV[1] | 0;
        this.C = SHA1_IV[2] | 0;
        this.D = SHA1_IV[3] | 0;
        this.E = SHA1_IV[4] | 0;
    }
    get() {
        const { A, B, C, D, E } = this;
        return [A, B, C, D, E];
    }
    set(A, B, C, D, E) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
        this.E = E | 0;
    }
    process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
            SHA1_W[i] = view.getUint32(offset, false);
        for (let i = 16; i < 80; i++)
            SHA1_W[i] = (0, utils_ts_1.rotl)(SHA1_W[i - 3] ^ SHA1_W[i - 8] ^ SHA1_W[i - 14] ^ SHA1_W[i - 16], 1);
        // Compression function main loop, 80 rounds
        let { A, B, C, D, E } = this;
        for (let i = 0; i < 80; i++) {
            let F, K;
            if (i < 20) {
                F = (0, _md_ts_1.Chi)(B, C, D);
                K = 0x5a827999;
            }
            else if (i < 40) {
                F = B ^ C ^ D;
                K = 0x6ed9eba1;
            }
            else if (i < 60) {
                F = (0, _md_ts_1.Maj)(B, C, D);
                K = 0x8f1bbcdc;
            }
            else {
                F = B ^ C ^ D;
                K = 0xca62c1d6;
            }
            const T = ((0, utils_ts_1.rotl)(A, 5) + F + E + K + SHA1_W[i]) | 0;
            E = D;
            D = C;
            C = (0, utils_ts_1.rotl)(B, 30);
            B = A;
            A = T;
        }
        // Add the compressed chunk to the current hash value
        A = (A + this.A) | 0;
        B = (B + this.B) | 0;
        C = (C + this.C) | 0;
        D = (D + this.D) | 0;
        E = (E + this.E) | 0;
        this.set(A, B, C, D, E);
    }
    roundClean() {
        (0, utils_ts_1.clean)(SHA1_W);
    }
    destroy() {
        this.set(0, 0, 0, 0, 0);
        (0, utils_ts_1.clean)(this.buffer);
    }
}
exports.SHA1 = SHA1;
/** SHA1 (RFC 3174) legacy hash function. It was cryptographically broken. */
exports.sha1 = (0, utils_ts_1.createHasher)(() => new SHA1());
/** Per-round constants */
const p32 = /* @__PURE__ */ Math.pow(2, 32);
const K = /* @__PURE__ */ Array.from({ length: 64 }, (_, i) => Math.floor(p32 * Math.abs(Math.sin(i + 1))));
/** md5 initial state: same as sha1, but 4 u32 instead of 5. */
const MD5_IV = /* @__PURE__ */ SHA1_IV.slice(0, 4);
// Reusable temporary buffer
const MD5_W = /* @__PURE__ */ new Uint32Array(16);
/** MD5 legacy hash class. */
class MD5 extends _md_ts_1.HashMD {
    constructor() {
        super(64, 16, 8, true);
        this.A = MD5_IV[0] | 0;
        this.B = MD5_IV[1] | 0;
        this.C = MD5_IV[2] | 0;
        this.D = MD5_IV[3] | 0;
    }
    get() {
        const { A, B, C, D } = this;
        return [A, B, C, D];
    }
    set(A, B, C, D) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
    }
    process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
            MD5_W[i] = view.getUint32(offset, true);
        // Compression function main loop, 64 rounds
        let { A, B, C, D } = this;
        for (let i = 0; i < 64; i++) {
            let F, g, s;
            if (i < 16) {
                F = (0, _md_ts_1.Chi)(B, C, D);
                g = i;
                s = [7, 12, 17, 22];
            }
            else if (i < 32) {
                F = (0, _md_ts_1.Chi)(D, B, C);
                g = (5 * i + 1) % 16;
                s = [5, 9, 14, 20];
            }
            else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
                s = [4, 11, 16, 23];
            }
            else {
                F = C ^ (B | ~D);
                g = (7 * i) % 16;
                s = [6, 10, 15, 21];
            }
            F = F + A + K[i] + MD5_W[g];
            A = D;
            D = C;
            C = B;
            B = B + (0, utils_ts_1.rotl)(F, s[i % 4]);
        }
        // Add the compressed chunk to the current hash value
        A = (A + this.A) | 0;
        B = (B + this.B) | 0;
        C = (C + this.C) | 0;
        D = (D + this.D) | 0;
        this.set(A, B, C, D);
    }
    roundClean() {
        (0, utils_ts_1.clean)(MD5_W);
    }
    destroy() {
        this.set(0, 0, 0, 0);
        (0, utils_ts_1.clean)(this.buffer);
    }
}
exports.MD5 = MD5;
/**
 * MD5 (RFC 1321) legacy hash function. It was cryptographically broken.
 * MD5 architecture is similar to SHA1, with some differences:
 * - Reduced output length: 16 bytes (128 bit) instead of 20
 * - 64 rounds, instead of 80
 * - Little-endian: could be faster, but will require more code
 * - Non-linear index selection: huge speed-up for unroll
 * - Per round constants: more memory accesses, additional speed-up for unroll
 */
exports.md5 = (0, utils_ts_1.createHasher)(() => new MD5());
// RIPEMD-160
const Rho160 = /* @__PURE__ */ Uint8Array.from([
    7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
]);
const Id160 = /* @__PURE__ */ (() => Uint8Array.from(new Array(16).fill(0).map((_, i) => i)))();
const Pi160 = /* @__PURE__ */ (() => Id160.map((i) => (9 * i + 5) % 16))();
const idxLR = /* @__PURE__ */ (() => {
    const L = [Id160];
    const R = [Pi160];
    const res = [L, R];
    for (let i = 0; i < 4; i++)
        for (let j of res)
            j.push(j[i].map((k) => Rho160[k]));
    return res;
})();
const idxL = /* @__PURE__ */ (() => idxLR[0])();
const idxR = /* @__PURE__ */ (() => idxLR[1])();
// const [idxL, idxR] = idxLR;
const shifts160 = /* @__PURE__ */ [
    [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8],
    [12, 13, 11, 15, 6, 9, 9, 7, 12, 15, 11, 13, 7, 8, 7, 7],
    [13, 15, 14, 11, 7, 7, 6, 8, 13, 14, 13, 12, 5, 5, 6, 9],
    [14, 11, 12, 14, 8, 6, 5, 5, 15, 12, 15, 14, 9, 9, 8, 6],
    [15, 12, 13, 13, 9, 5, 8, 6, 14, 11, 12, 11, 8, 6, 5, 5],
].map((i) => Uint8Array.from(i));
const shiftsL160 = /* @__PURE__ */ idxL.map((idx, i) => idx.map((j) => shifts160[i][j]));
const shiftsR160 = /* @__PURE__ */ idxR.map((idx, i) => idx.map((j) => shifts160[i][j]));
const Kl160 = /* @__PURE__ */ Uint32Array.from([
    0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e,
]);
const Kr160 = /* @__PURE__ */ Uint32Array.from([
    0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000,
]);
// It's called f() in spec.
function ripemd_f(group, x, y, z) {
    if (group === 0)
        return x ^ y ^ z;
    if (group === 1)
        return (x & y) | (~x & z);
    if (group === 2)
        return (x | ~y) ^ z;
    if (group === 3)
        return (x & z) | (y & ~z);
    return x ^ (y | ~z);
}
// Reusable temporary buffer
const BUF_160 = /* @__PURE__ */ new Uint32Array(16);
class RIPEMD160 extends _md_ts_1.HashMD {
    constructor() {
        super(64, 20, 8, true);
        this.h0 = 0x67452301 | 0;
        this.h1 = 0xefcdab89 | 0;
        this.h2 = 0x98badcfe | 0;
        this.h3 = 0x10325476 | 0;
        this.h4 = 0xc3d2e1f0 | 0;
    }
    get() {
        const { h0, h1, h2, h3, h4 } = this;
        return [h0, h1, h2, h3, h4];
    }
    set(h0, h1, h2, h3, h4) {
        this.h0 = h0 | 0;
        this.h1 = h1 | 0;
        this.h2 = h2 | 0;
        this.h3 = h3 | 0;
        this.h4 = h4 | 0;
    }
    process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
            BUF_160[i] = view.getUint32(offset, true);
        // prettier-ignore
        let al = this.h0 | 0, ar = al, bl = this.h1 | 0, br = bl, cl = this.h2 | 0, cr = cl, dl = this.h3 | 0, dr = dl, el = this.h4 | 0, er = el;
        // Instead of iterating 0 to 80, we split it into 5 groups
        // And use the groups in constants, functions, etc. Much simpler
        for (let group = 0; group < 5; group++) {
            const rGroup = 4 - group;
            const hbl = Kl160[group], hbr = Kr160[group]; // prettier-ignore
            const rl = idxL[group], rr = idxR[group]; // prettier-ignore
            const sl = shiftsL160[group], sr = shiftsR160[group]; // prettier-ignore
            for (let i = 0; i < 16; i++) {
                const tl = ((0, utils_ts_1.rotl)(al + ripemd_f(group, bl, cl, dl) + BUF_160[rl[i]] + hbl, sl[i]) + el) | 0;
                al = el, el = dl, dl = (0, utils_ts_1.rotl)(cl, 10) | 0, cl = bl, bl = tl; // prettier-ignore
            }
            // 2 loops are 10% faster
            for (let i = 0; i < 16; i++) {
                const tr = ((0, utils_ts_1.rotl)(ar + ripemd_f(rGroup, br, cr, dr) + BUF_160[rr[i]] + hbr, sr[i]) + er) | 0;
                ar = er, er = dr, dr = (0, utils_ts_1.rotl)(cr, 10) | 0, cr = br, br = tr; // prettier-ignore
            }
        }
        // Add the compressed chunk to the current hash value
        this.set((this.h1 + cl + dr) | 0, (this.h2 + dl + er) | 0, (this.h3 + el + ar) | 0, (this.h4 + al + br) | 0, (this.h0 + bl + cr) | 0);
    }
    roundClean() {
        (0, utils_ts_1.clean)(BUF_160);
    }
    destroy() {
        this.destroyed = true;
        (0, utils_ts_1.clean)(this.buffer);
        this.set(0, 0, 0, 0, 0);
    }
}
exports.RIPEMD160 = RIPEMD160;
/**
 * RIPEMD-160 - a legacy hash function from 1990s.
 * * https://homes.esat.kuleuven.be/~bosselae/ripemd160.html
 * * https://homes.esat.kuleuven.be/~bosselae/ripemd160/pdf/AB-9601/AB-9601.pdf
 */
exports.ripemd160 = (0, utils_ts_1.createHasher)(() => new RIPEMD160());
//# sourceMappingURL=legacy.js.map
    },
    17: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeToCurve = exports.hashToCurve = exports.secp256k1_hasher = exports.schnorr = exports.secp256k1 = void 0;
/**
 * SECG secp256k1. See [pdf](https://www.secg.org/sec2-v2.pdf).
 *
 * Belongs to Koblitz curves: it has efficiently-computable GLV endomorphism ψ,
 * check out {@link EndomorphismOpts}. Seems to be rigid (not backdoored).
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const sha2_js_1 = require("@noble/hashes/sha2.js");
const utils_js_1 = require("@noble/hashes/utils.js");
const _shortw_utils_ts_1 = require("./_shortw_utils.js");
const hash_to_curve_ts_1 = require("./abstract/hash-to-curve.js");
const modular_ts_1 = require("./abstract/modular.js");
const weierstrass_ts_1 = require("./abstract/weierstrass.js");
const utils_ts_1 = require("./utils.js");
// Seems like generator was produced from some seed:
// `Point.BASE.multiply(Point.Fn.inv(2n, N)).toAffine().x`
// // gives short x 0x3b78ce563f89a0ed9414f5aa28ad0d96d6795f9c63n
const secp256k1_CURVE = {
    p: BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f'),
    n: BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'),
    h: BigInt(1),
    a: BigInt(0),
    b: BigInt(7),
    Gx: BigInt('0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
    Gy: BigInt('0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'),
};
const secp256k1_ENDO = {
    beta: BigInt('0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee'),
    basises: [
        [BigInt('0x3086d221a7d46bcde86c90e49284eb15'), -BigInt('0xe4437ed6010e88286f547fa90abfe4c3')],
        [BigInt('0x114ca50f7a8e2f3f657c1108d9d44cfd8'), BigInt('0x3086d221a7d46bcde86c90e49284eb15')],
    ],
};
const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
const _2n = /* @__PURE__ */ BigInt(2);
/**
 * √n = n^((p+1)/4) for fields p = 3 mod 4. We unwrap the loop and multiply bit-by-bit.
 * (P+1n/4n).toString(2) would produce bits [223x 1, 0, 22x 1, 4x 0, 11, 00]
 */
function sqrtMod(y) {
    const P = secp256k1_CURVE.p;
    // prettier-ignore
    const _3n = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
    // prettier-ignore
    const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
    const b2 = (y * y * y) % P; // x^3, 11
    const b3 = (b2 * b2 * y) % P; // x^7
    const b6 = ((0, modular_ts_1.pow2)(b3, _3n, P) * b3) % P;
    const b9 = ((0, modular_ts_1.pow2)(b6, _3n, P) * b3) % P;
    const b11 = ((0, modular_ts_1.pow2)(b9, _2n, P) * b2) % P;
    const b22 = ((0, modular_ts_1.pow2)(b11, _11n, P) * b11) % P;
    const b44 = ((0, modular_ts_1.pow2)(b22, _22n, P) * b22) % P;
    const b88 = ((0, modular_ts_1.pow2)(b44, _44n, P) * b44) % P;
    const b176 = ((0, modular_ts_1.pow2)(b88, _88n, P) * b88) % P;
    const b220 = ((0, modular_ts_1.pow2)(b176, _44n, P) * b44) % P;
    const b223 = ((0, modular_ts_1.pow2)(b220, _3n, P) * b3) % P;
    const t1 = ((0, modular_ts_1.pow2)(b223, _23n, P) * b22) % P;
    const t2 = ((0, modular_ts_1.pow2)(t1, _6n, P) * b2) % P;
    const root = (0, modular_ts_1.pow2)(t2, _2n, P);
    if (!Fpk1.eql(Fpk1.sqr(root), y))
        throw new Error('Cannot find square root');
    return root;
}
const Fpk1 = (0, modular_ts_1.Field)(secp256k1_CURVE.p, { sqrt: sqrtMod });
/**
 * secp256k1 curve, ECDSA and ECDH methods.
 *
 * Field: `2n**256n - 2n**32n - 2n**9n - 2n**8n - 2n**7n - 2n**6n - 2n**4n - 1n`
 *
 * @example
 * ```js
 * import { secp256k1 } from '@noble/curves/secp256k1';
 * const { secretKey, publicKey } = secp256k1.keygen();
 * const msg = new TextEncoder().encode('hello');
 * const sig = secp256k1.sign(msg, secretKey);
 * const isValid = secp256k1.verify(sig, msg, publicKey) === true;
 * ```
 */
exports.secp256k1 = (0, _shortw_utils_ts_1.createCurve)({ ...secp256k1_CURVE, Fp: Fpk1, lowS: true, endo: secp256k1_ENDO }, sha2_js_1.sha256);
// Schnorr signatures are superior to ECDSA from above. Below is Schnorr-specific BIP0340 code.
// https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki
/** An object mapping tags to their tagged hash prefix of [SHA256(tag) | SHA256(tag)] */
const TAGGED_HASH_PREFIXES = {};
function taggedHash(tag, ...messages) {
    let tagP = TAGGED_HASH_PREFIXES[tag];
    if (tagP === undefined) {
        const tagH = (0, sha2_js_1.sha256)((0, utils_ts_1.utf8ToBytes)(tag));
        tagP = (0, utils_ts_1.concatBytes)(tagH, tagH);
        TAGGED_HASH_PREFIXES[tag] = tagP;
    }
    return (0, sha2_js_1.sha256)((0, utils_ts_1.concatBytes)(tagP, ...messages));
}
// ECDSA compact points are 33-byte. Schnorr is 32: we strip first byte 0x02 or 0x03
const pointToBytes = (point) => point.toBytes(true).slice(1);
const Pointk1 = /* @__PURE__ */ (() => exports.secp256k1.Point)();
const hasEven = (y) => y % _2n === _0n;
// Calculate point, scalar and bytes
function schnorrGetExtPubKey(priv) {
    const { Fn, BASE } = Pointk1;
    const d_ = (0, weierstrass_ts_1._normFnElement)(Fn, priv);
    const p = BASE.multiply(d_); // P = d'⋅G; 0 < d' < n check is done inside
    const scalar = hasEven(p.y) ? d_ : Fn.neg(d_);
    return { scalar, bytes: pointToBytes(p) };
}
/**
 * lift_x from BIP340. Convert 32-byte x coordinate to elliptic curve point.
 * @returns valid point checked for being on-curve
 */
function lift_x(x) {
    const Fp = Fpk1;
    if (!Fp.isValidNot0(x))
        throw new Error('invalid x: Fail if x ≥ p');
    const xx = Fp.create(x * x);
    const c = Fp.create(xx * x + BigInt(7)); // Let c = x³ + 7 mod p.
    let y = Fp.sqrt(c); // Let y = c^(p+1)/4 mod p. Same as sqrt().
    // Return the unique point P such that x(P) = x and
    // y(P) = y if y mod 2 = 0 or y(P) = p-y otherwise.
    if (!hasEven(y))
        y = Fp.neg(y);
    const p = Pointk1.fromAffine({ x, y });
    p.assertValidity();
    return p;
}
const num = utils_ts_1.bytesToNumberBE;
/**
 * Create tagged hash, convert it to bigint, reduce modulo-n.
 */
function challenge(...args) {
    return Pointk1.Fn.create(num(taggedHash('BIP0340/challenge', ...args)));
}
/**
 * Schnorr public key is just `x` coordinate of Point as per BIP340.
 */
function schnorrGetPublicKey(secretKey) {
    return schnorrGetExtPubKey(secretKey).bytes; // d'=int(sk). Fail if d'=0 or d'≥n. Ret bytes(d'⋅G)
}
/**
 * Creates Schnorr signature as per BIP340. Verifies itself before returning anything.
 * auxRand is optional and is not the sole source of k generation: bad CSPRNG won't be dangerous.
 */
function schnorrSign(message, secretKey, auxRand = (0, utils_js_1.randomBytes)(32)) {
    const { Fn } = Pointk1;
    const m = (0, utils_ts_1.ensureBytes)('message', message);
    const { bytes: px, scalar: d } = schnorrGetExtPubKey(secretKey); // checks for isWithinCurveOrder
    const a = (0, utils_ts_1.ensureBytes)('auxRand', auxRand, 32); // Auxiliary random data a: a 32-byte array
    const t = Fn.toBytes(d ^ num(taggedHash('BIP0340/aux', a))); // Let t be the byte-wise xor of bytes(d) and hash/aux(a)
    const rand = taggedHash('BIP0340/nonce', t, px, m); // Let rand = hash/nonce(t || bytes(P) || m)
    // Let k' = int(rand) mod n. Fail if k' = 0. Let R = k'⋅G
    const { bytes: rx, scalar: k } = schnorrGetExtPubKey(rand);
    const e = challenge(rx, px, m); // Let e = int(hash/challenge(bytes(R) || bytes(P) || m)) mod n.
    const sig = new Uint8Array(64); // Let sig = bytes(R) || bytes((k + ed) mod n).
    sig.set(rx, 0);
    sig.set(Fn.toBytes(Fn.create(k + e * d)), 32);
    // If Verify(bytes(P), m, sig) (see below) returns failure, abort
    if (!schnorrVerify(sig, m, px))
        throw new Error('sign: Invalid signature produced');
    return sig;
}
/**
 * Verifies Schnorr signature.
 * Will swallow errors & return false except for initial type validation of arguments.
 */
function schnorrVerify(signature, message, publicKey) {
    const { Fn, BASE } = Pointk1;
    const sig = (0, utils_ts_1.ensureBytes)('signature', signature, 64);
    const m = (0, utils_ts_1.ensureBytes)('message', message);
    const pub = (0, utils_ts_1.ensureBytes)('publicKey', publicKey, 32);
    try {
        const P = lift_x(num(pub)); // P = lift_x(int(pk)); fail if that fails
        const r = num(sig.subarray(0, 32)); // Let r = int(sig[0:32]); fail if r ≥ p.
        if (!(0, utils_ts_1.inRange)(r, _1n, secp256k1_CURVE.p))
            return false;
        const s = num(sig.subarray(32, 64)); // Let s = int(sig[32:64]); fail if s ≥ n.
        if (!(0, utils_ts_1.inRange)(s, _1n, secp256k1_CURVE.n))
            return false;
        // int(challenge(bytes(r)||bytes(P)||m))%n
        const e = challenge(Fn.toBytes(r), pointToBytes(P), m);
        // R = s⋅G - e⋅P, where -eP == (n-e)P
        const R = BASE.multiplyUnsafe(s).add(P.multiplyUnsafe(Fn.neg(e)));
        const { x, y } = R.toAffine();
        // Fail if is_infinite(R) / not has_even_y(R) / x(R) ≠ r.
        if (R.is0() || !hasEven(y) || x !== r)
            return false;
        return true;
    }
    catch (error) {
        return false;
    }
}
/**
 * Schnorr signatures over secp256k1.
 * https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki
 * @example
 * ```js
 * import { schnorr } from '@noble/curves/secp256k1';
 * const { secretKey, publicKey } = schnorr.keygen();
 * // const publicKey = schnorr.getPublicKey(secretKey);
 * const msg = new TextEncoder().encode('hello');
 * const sig = schnorr.sign(msg, secretKey);
 * const isValid = schnorr.verify(sig, msg, publicKey);
 * ```
 */
exports.schnorr = (() => {
    const size = 32;
    const seedLength = 48;
    const randomSecretKey = (seed = (0, utils_js_1.randomBytes)(seedLength)) => {
        return (0, modular_ts_1.mapHashToField)(seed, secp256k1_CURVE.n);
    };
    // TODO: remove
    exports.secp256k1.utils.randomSecretKey;
    function keygen(seed) {
        const secretKey = randomSecretKey(seed);
        return { secretKey, publicKey: schnorrGetPublicKey(secretKey) };
    }
    return {
        keygen,
        getPublicKey: schnorrGetPublicKey,
        sign: schnorrSign,
        verify: schnorrVerify,
        Point: Pointk1,
        utils: {
            randomSecretKey: randomSecretKey,
            randomPrivateKey: randomSecretKey,
            taggedHash,
            // TODO: remove
            lift_x,
            pointToBytes,
            numberToBytesBE: utils_ts_1.numberToBytesBE,
            bytesToNumberBE: utils_ts_1.bytesToNumberBE,
            mod: modular_ts_1.mod,
        },
        lengths: {
            secretKey: size,
            publicKey: size,
            publicKeyHasPrefix: false,
            signature: size * 2,
            seed: seedLength,
        },
    };
})();
const isoMap = /* @__PURE__ */ (() => (0, hash_to_curve_ts_1.isogenyMap)(Fpk1, [
    // xNum
    [
        '0x8e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38daaaaa8c7',
        '0x7d3d4c80bc321d5b9f315cea7fd44c5d595d2fc0bf63b92dfff1044f17c6581',
        '0x534c328d23f234e6e2a413deca25caece4506144037c40314ecbd0b53d9dd262',
        '0x8e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38daaaaa88c',
    ],
    // xDen
    [
        '0xd35771193d94918a9ca34ccbb7b640dd86cd409542f8487d9fe6b745781eb49b',
        '0xedadc6f64383dc1df7c4b2d51b54225406d36b641f5e41bbc52a56612a8c6d14',
        '0x0000000000000000000000000000000000000000000000000000000000000001', // LAST 1
    ],
    // yNum
    [
        '0x4bda12f684bda12f684bda12f684bda12f684bda12f684bda12f684b8e38e23c',
        '0xc75e0c32d5cb7c0fa9d0a54b12a0a6d5647ab046d686da6fdffc90fc201d71a3',
        '0x29a6194691f91a73715209ef6512e576722830a201be2018a765e85a9ecee931',
        '0x2f684bda12f684bda12f684bda12f684bda12f684bda12f684bda12f38e38d84',
    ],
    // yDen
    [
        '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffff93b',
        '0x7a06534bb8bdb49fd5e9e6632722c2989467c1bfc8e8d978dfb425d2685c2573',
        '0x6484aa716545ca2cf3a70c3fa8fe337e0a3d21162f0d6299a7bf8192bfd2a76f',
        '0x0000000000000000000000000000000000000000000000000000000000000001', // LAST 1
    ],
].map((i) => i.map((j) => BigInt(j)))))();
const mapSWU = /* @__PURE__ */ (() => (0, weierstrass_ts_1.mapToCurveSimpleSWU)(Fpk1, {
    A: BigInt('0x3f8731abdd661adca08a5558f0f5d272e953d363cb6f0e5d405447c01a444533'),
    B: BigInt('1771'),
    Z: Fpk1.create(BigInt('-11')),
}))();
/** Hashing / encoding to secp256k1 points / field. RFC 9380 methods. */
exports.secp256k1_hasher = (() => (0, hash_to_curve_ts_1.createHasher)(exports.secp256k1.Point, (scalars) => {
    const { x, y } = mapSWU(Fpk1.create(scalars[0]));
    return isoMap(x, y);
}, {
    DST: 'secp256k1_XMD:SHA-256_SSWU_RO_',
    encodeDST: 'secp256k1_XMD:SHA-256_SSWU_NU_',
    p: Fpk1.ORDER,
    m: 1,
    k: 128,
    expand: 'xmd',
    hash: sha2_js_1.sha256,
}))();
/** @deprecated use `import { secp256k1_hasher } from '@noble/curves/secp256k1.js';` */
exports.hashToCurve = (() => exports.secp256k1_hasher.hashToCurve)();
/** @deprecated use `import { secp256k1_hasher } from '@noble/curves/secp256k1.js';` */
exports.encodeToCurve = (() => exports.secp256k1_hasher.encodeToCurve)();
//# sourceMappingURL=secp256k1.js.map
    },
    18: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHash = getHash;
exports.createCurve = createCurve;
/**
 * Utilities for short weierstrass curves, combined with noble-hashes.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const weierstrass_ts_1 = require("./abstract/weierstrass.js");
/** connects noble-curves to noble-hashes */
function getHash(hash) {
    return { hash };
}
/** @deprecated use new `weierstrass()` and `ecdsa()` methods */
function createCurve(curveDef, defHash) {
    const create = (hash) => (0, weierstrass_ts_1.weierstrass)({ ...curveDef, hash: hash });
    return { ...create(defHash), create };
}
//# sourceMappingURL=_shortw_utils.js.map
    },
    19: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DER = exports.DERErr = void 0;
exports._splitEndoScalar = _splitEndoScalar;
exports._normFnElement = _normFnElement;
exports.weierstrassN = weierstrassN;
exports.SWUFpSqrtRatio = SWUFpSqrtRatio;
exports.mapToCurveSimpleSWU = mapToCurveSimpleSWU;
exports.ecdh = ecdh;
exports.ecdsa = ecdsa;
exports.weierstrassPoints = weierstrassPoints;
exports._legacyHelperEquat = _legacyHelperEquat;
exports.weierstrass = weierstrass;
/**
 * Short Weierstrass curve methods. The formula is: y² = x³ + ax + b.
 *
 * ### Design rationale for types
 *
 * * Interaction between classes from different curves should fail:
 *   `k256.Point.BASE.add(p256.Point.BASE)`
 * * For this purpose we want to use `instanceof` operator, which is fast and works during runtime
 * * Different calls of `curve()` would return different classes -
 *   `curve(params) !== curve(params)`: if somebody decided to monkey-patch their curve,
 *   it won't affect others
 *
 * TypeScript can't infer types for classes created inside a function. Classes is one instance
 * of nominative types in TypeScript and interfaces only check for shape, so it's hard to create
 * unique type for every function call.
 *
 * We can use generic types via some param, like curve opts, but that would:
 *     1. Enable interaction between `curve(params)` and `curve(params)` (curves of same params)
 *     which is hard to debug.
 *     2. Params can be generic and we can't enforce them to be constant value:
 *     if somebody creates curve from non-constant params,
 *     it would be allowed to interact with other curves with non-constant params
 *
 * @todo https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-7.html#unique-symbol
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const hmac_js_1 = require("@noble/hashes/hmac.js");
const utils_1 = require("@noble/hashes/utils");
const utils_ts_1 = require("../utils.js");
const curve_ts_1 = require("./curve.js");
const modular_ts_1 = require("./modular.js");
// We construct basis in such way that den is always positive and equals n, but num sign depends on basis (not on secret value)
const divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n) / den;
/**
 * Splits scalar for GLV endomorphism.
 */
function _splitEndoScalar(k, basis, n) {
    // Split scalar into two such that part is ~half bits: `abs(part) < sqrt(N)`
    // Since part can be negative, we need to do this on point.
    // TODO: verifyScalar function which consumes lambda
    const [[a1, b1], [a2, b2]] = basis;
    const c1 = divNearest(b2 * k, n);
    const c2 = divNearest(-b1 * k, n);
    // |k1|/|k2| is < sqrt(N), but can be negative.
    // If we do `k1 mod N`, we'll get big scalar (`> sqrt(N)`): so, we do cheaper negation instead.
    let k1 = k - c1 * a1 - c2 * a2;
    let k2 = -c1 * b1 - c2 * b2;
    const k1neg = k1 < _0n;
    const k2neg = k2 < _0n;
    if (k1neg)
        k1 = -k1;
    if (k2neg)
        k2 = -k2;
    // Double check that resulting scalar less than half bits of N: otherwise wNAF will fail.
    // This should only happen on wrong basises. Also, math inside is too complex and I don't trust it.
    const MAX_NUM = (0, utils_ts_1.bitMask)(Math.ceil((0, utils_ts_1.bitLen)(n) / 2)) + _1n; // Half bits of N
    if (k1 < _0n || k1 >= MAX_NUM || k2 < _0n || k2 >= MAX_NUM) {
        throw new Error('splitScalar (endomorphism): failed, k=' + k);
    }
    return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
    if (!['compact', 'recovered', 'der'].includes(format))
        throw new Error('Signature format must be "compact", "recovered", or "der"');
    return format;
}
function validateSigOpts(opts, def) {
    const optsn = {};
    for (let optName of Object.keys(def)) {
        // @ts-ignore
        optsn[optName] = opts[optName] === undefined ? def[optName] : opts[optName];
    }
    (0, utils_ts_1._abool2)(optsn.lowS, 'lowS');
    (0, utils_ts_1._abool2)(optsn.prehash, 'prehash');
    if (optsn.format !== undefined)
        validateSigFormat(optsn.format);
    return optsn;
}
class DERErr extends Error {
    constructor(m = '') {
        super(m);
    }
}
exports.DERErr = DERErr;
/**
 * ASN.1 DER encoding utilities. ASN is very complex & fragile. Format:
 *
 *     [0x30 (SEQUENCE), bytelength, 0x02 (INTEGER), intLength, R, 0x02 (INTEGER), intLength, S]
 *
 * Docs: https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/, https://luca.ntop.org/Teaching/Appunti/asn1.html
 */
exports.DER = {
    // asn.1 DER encoding utils
    Err: DERErr,
    // Basic building block is TLV (Tag-Length-Value)
    _tlv: {
        encode: (tag, data) => {
            const { Err: E } = exports.DER;
            if (tag < 0 || tag > 256)
                throw new E('tlv.encode: wrong tag');
            if (data.length & 1)
                throw new E('tlv.encode: unpadded data');
            const dataLen = data.length / 2;
            const len = (0, utils_ts_1.numberToHexUnpadded)(dataLen);
            if ((len.length / 2) & 128)
                throw new E('tlv.encode: long form length too big');
            // length of length with long form flag
            const lenLen = dataLen > 127 ? (0, utils_ts_1.numberToHexUnpadded)((len.length / 2) | 128) : '';
            const t = (0, utils_ts_1.numberToHexUnpadded)(tag);
            return t + lenLen + len + data;
        },
        // v - value, l - left bytes (unparsed)
        decode(tag, data) {
            const { Err: E } = exports.DER;
            let pos = 0;
            if (tag < 0 || tag > 256)
                throw new E('tlv.encode: wrong tag');
            if (data.length < 2 || data[pos++] !== tag)
                throw new E('tlv.decode: wrong tlv');
            const first = data[pos++];
            const isLong = !!(first & 128); // First bit of first length byte is flag for short/long form
            let length = 0;
            if (!isLong)
                length = first;
            else {
                // Long form: [longFlag(1bit), lengthLength(7bit), length (BE)]
                const lenLen = first & 127;
                if (!lenLen)
                    throw new E('tlv.decode(long): indefinite length not supported');
                if (lenLen > 4)
                    throw new E('tlv.decode(long): byte length is too big'); // this will overflow u32 in js
                const lengthBytes = data.subarray(pos, pos + lenLen);
                if (lengthBytes.length !== lenLen)
                    throw new E('tlv.decode: length bytes not complete');
                if (lengthBytes[0] === 0)
                    throw new E('tlv.decode(long): zero leftmost byte');
                for (const b of lengthBytes)
                    length = (length << 8) | b;
                pos += lenLen;
                if (length < 128)
                    throw new E('tlv.decode(long): not minimal encoding');
            }
            const v = data.subarray(pos, pos + length);
            if (v.length !== length)
                throw new E('tlv.decode: wrong value length');
            return { v, l: data.subarray(pos + length) };
        },
    },
    // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
    // since we always use positive integers here. It must always be empty:
    // - add zero byte if exists
    // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
    _int: {
        encode(num) {
            const { Err: E } = exports.DER;
            if (num < _0n)
                throw new E('integer: negative integers are not allowed');
            let hex = (0, utils_ts_1.numberToHexUnpadded)(num);
            // Pad with zero byte if negative flag is present
            if (Number.parseInt(hex[0], 16) & 0b1000)
                hex = '00' + hex;
            if (hex.length & 1)
                throw new E('unexpected DER parsing assertion: unpadded hex');
            return hex;
        },
        decode(data) {
            const { Err: E } = exports.DER;
            if (data[0] & 128)
                throw new E('invalid signature integer: negative');
            if (data[0] === 0x00 && !(data[1] & 128))
                throw new E('invalid signature integer: unnecessary leading zero');
            return (0, utils_ts_1.bytesToNumberBE)(data);
        },
    },
    toSig(hex) {
        // parse DER signature
        const { Err: E, _int: int, _tlv: tlv } = exports.DER;
        const data = (0, utils_ts_1.ensureBytes)('signature', hex);
        const { v: seqBytes, l: seqLeftBytes } = tlv.decode(0x30, data);
        if (seqLeftBytes.length)
            throw new E('invalid signature: left bytes after parsing');
        const { v: rBytes, l: rLeftBytes } = tlv.decode(0x02, seqBytes);
        const { v: sBytes, l: sLeftBytes } = tlv.decode(0x02, rLeftBytes);
        if (sLeftBytes.length)
            throw new E('invalid signature: left bytes after parsing');
        return { r: int.decode(rBytes), s: int.decode(sBytes) };
    },
    hexFromSig(sig) {
        const { _tlv: tlv, _int: int } = exports.DER;
        const rs = tlv.encode(0x02, int.encode(sig.r));
        const ss = tlv.encode(0x02, int.encode(sig.s));
        const seq = rs + ss;
        return tlv.encode(0x30, seq);
    },
};
// Be friendly to bad ECMAScript parsers by not using bigint literals
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3), _4n = BigInt(4);
function _normFnElement(Fn, key) {
    const { BYTES: expected } = Fn;
    let num;
    if (typeof key === 'bigint') {
        num = key;
    }
    else {
        let bytes = (0, utils_ts_1.ensureBytes)('private key', key);
        try {
            num = Fn.fromBytes(bytes);
        }
        catch (error) {
            throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
        }
    }
    if (!Fn.isValidNot0(num))
        throw new Error('invalid private key: out of range [1..N-1]');
    return num;
}
/**
 * Creates weierstrass Point constructor, based on specified curve options.
 *
 * @example
```js
const opts = {
  p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
  n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
  h: BigInt(1),
  a: BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc'),
  b: BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
  Gx: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
  Gy: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
};
const p256_Point = weierstrass(opts);
```
 */
function weierstrassN(params, extraOpts = {}) {
    const validated = (0, curve_ts_1._createCurveFields)('weierstrass', params, extraOpts);
    const { Fp, Fn } = validated;
    let CURVE = validated.CURVE;
    const { h: cofactor, n: CURVE_ORDER } = CURVE;
    (0, utils_ts_1._validateObject)(extraOpts, {}, {
        allowInfinityPoint: 'boolean',
        clearCofactor: 'function',
        isTorsionFree: 'function',
        fromBytes: 'function',
        toBytes: 'function',
        endo: 'object',
        wrapPrivateKey: 'boolean',
    });
    const { endo } = extraOpts;
    if (endo) {
        // validateObject(endo, { beta: 'bigint', splitScalar: 'function' });
        if (!Fp.is0(CURVE.a) || typeof endo.beta !== 'bigint' || !Array.isArray(endo.basises)) {
            throw new Error('invalid endo: expected "beta": bigint and "basises": array');
        }
    }
    const lengths = getWLengths(Fp, Fn);
    function assertCompressionIsSupported() {
        if (!Fp.isOdd)
            throw new Error('compression is not supported: Field does not have .isOdd()');
    }
    // Implements IEEE P1363 point encoding
    function pointToBytes(_c, point, isCompressed) {
        const { x, y } = point.toAffine();
        const bx = Fp.toBytes(x);
        (0, utils_ts_1._abool2)(isCompressed, 'isCompressed');
        if (isCompressed) {
            assertCompressionIsSupported();
            const hasEvenY = !Fp.isOdd(y);
            return (0, utils_ts_1.concatBytes)(pprefix(hasEvenY), bx);
        }
        else {
            return (0, utils_ts_1.concatBytes)(Uint8Array.of(0x04), bx, Fp.toBytes(y));
        }
    }
    function pointFromBytes(bytes) {
        (0, utils_ts_1._abytes2)(bytes, undefined, 'Point');
        const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths; // e.g. for 32-byte: 33, 65
        const length = bytes.length;
        const head = bytes[0];
        const tail = bytes.subarray(1);
        // No actual validation is done here: use .assertValidity()
        if (length === comp && (head === 0x02 || head === 0x03)) {
            const x = Fp.fromBytes(tail);
            if (!Fp.isValid(x))
                throw new Error('bad point: is not on curve, wrong x');
            const y2 = weierstrassEquation(x); // y² = x³ + ax + b
            let y;
            try {
                y = Fp.sqrt(y2); // y = y² ^ (p+1)/4
            }
            catch (sqrtError) {
                const err = sqrtError instanceof Error ? ': ' + sqrtError.message : '';
                throw new Error('bad point: is not on curve, sqrt error' + err);
            }
            assertCompressionIsSupported();
            const isYOdd = Fp.isOdd(y); // (y & _1n) === _1n;
            const isHeadOdd = (head & 1) === 1; // ECDSA-specific
            if (isHeadOdd !== isYOdd)
                y = Fp.neg(y);
            return { x, y };
        }
        else if (length === uncomp && head === 0x04) {
            // TODO: more checks
            const L = Fp.BYTES;
            const x = Fp.fromBytes(tail.subarray(0, L));
            const y = Fp.fromBytes(tail.subarray(L, L * 2));
            if (!isValidXY(x, y))
                throw new Error('bad point: is not on curve');
            return { x, y };
        }
        else {
            throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
        }
    }
    const encodePoint = extraOpts.toBytes || pointToBytes;
    const decodePoint = extraOpts.fromBytes || pointFromBytes;
    function weierstrassEquation(x) {
        const x2 = Fp.sqr(x); // x * x
        const x3 = Fp.mul(x2, x); // x² * x
        return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b); // x³ + a * x + b
    }
    // TODO: move top-level
    /** Checks whether equation holds for given x, y: y² == x³ + ax + b */
    function isValidXY(x, y) {
        const left = Fp.sqr(y); // y²
        const right = weierstrassEquation(x); // x³ + ax + b
        return Fp.eql(left, right);
    }
    // Validate whether the passed curve params are valid.
    // Test 1: equation y² = x³ + ax + b should work for generator point.
    if (!isValidXY(CURVE.Gx, CURVE.Gy))
        throw new Error('bad curve params: generator point');
    // Test 2: discriminant Δ part should be non-zero: 4a³ + 27b² != 0.
    // Guarantees curve is genus-1, smooth (non-singular).
    const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n), _4n);
    const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
    if (Fp.is0(Fp.add(_4a3, _27b2)))
        throw new Error('bad curve params: a or b');
    /** Asserts coordinate is valid: 0 <= n < Fp.ORDER. */
    function acoord(title, n, banZero = false) {
        if (!Fp.isValid(n) || (banZero && Fp.is0(n)))
            throw new Error(`bad point coordinate ${title}`);
        return n;
    }
    function aprjpoint(other) {
        if (!(other instanceof Point))
            throw new Error('ProjectivePoint expected');
    }
    function splitEndoScalarN(k) {
        if (!endo || !endo.basises)
            throw new Error('no endo');
        return _splitEndoScalar(k, endo.basises, Fn.ORDER);
    }
    // Memoized toAffine / validity check. They are heavy. Points are immutable.
    // Converts Projective point to affine (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    // (X, Y, Z) ∋ (x=X/Z, y=Y/Z)
    const toAffineMemo = (0, utils_ts_1.memoized)((p, iz) => {
        const { X, Y, Z } = p;
        // Fast-path for normalized points
        if (Fp.eql(Z, Fp.ONE))
            return { x: X, y: Y };
        const is0 = p.is0();
        // If invZ was 0, we return zero point. However we still want to execute
        // all operations, so we replace invZ with a random number, 1.
        if (iz == null)
            iz = is0 ? Fp.ONE : Fp.inv(Z);
        const x = Fp.mul(X, iz);
        const y = Fp.mul(Y, iz);
        const zz = Fp.mul(Z, iz);
        if (is0)
            return { x: Fp.ZERO, y: Fp.ZERO };
        if (!Fp.eql(zz, Fp.ONE))
            throw new Error('invZ was invalid');
        return { x, y };
    });
    // NOTE: on exception this will crash 'cached' and no value will be set.
    // Otherwise true will be return
    const assertValidMemo = (0, utils_ts_1.memoized)((p) => {
        if (p.is0()) {
            // (0, 1, 0) aka ZERO is invalid in most contexts.
            // In BLS, ZERO can be serialized, so we allow it.
            // (0, 0, 0) is invalid representation of ZERO.
            if (extraOpts.allowInfinityPoint && !Fp.is0(p.Y))
                return;
            throw new Error('bad point: ZERO');
        }
        // Some 3rd-party test vectors require different wording between here & `fromCompressedHex`
        const { x, y } = p.toAffine();
        if (!Fp.isValid(x) || !Fp.isValid(y))
            throw new Error('bad point: x or y not field elements');
        if (!isValidXY(x, y))
            throw new Error('bad point: equation left != right');
        if (!p.isTorsionFree())
            throw new Error('bad point: not in prime-order subgroup');
        return true;
    });
    function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
        k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
        k1p = (0, curve_ts_1.negateCt)(k1neg, k1p);
        k2p = (0, curve_ts_1.negateCt)(k2neg, k2p);
        return k1p.add(k2p);
    }
    /**
     * Projective Point works in 3d / projective (homogeneous) coordinates:(X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * Default Point works in 2d / affine coordinates: (x, y).
     * We're doing calculations in projective, because its operations don't require costly inversion.
     */
    class Point {
        /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
        constructor(X, Y, Z) {
            this.X = acoord('x', X);
            this.Y = acoord('y', Y, true);
            this.Z = acoord('z', Z);
            Object.freeze(this);
        }
        static CURVE() {
            return CURVE;
        }
        /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
        static fromAffine(p) {
            const { x, y } = p || {};
            if (!p || !Fp.isValid(x) || !Fp.isValid(y))
                throw new Error('invalid affine point');
            if (p instanceof Point)
                throw new Error('projective point not allowed');
            // (0, 0) would've produced (0, 0, 1) - instead, we need (0, 1, 0)
            if (Fp.is0(x) && Fp.is0(y))
                return Point.ZERO;
            return new Point(x, y, Fp.ONE);
        }
        static fromBytes(bytes) {
            const P = Point.fromAffine(decodePoint((0, utils_ts_1._abytes2)(bytes, undefined, 'point')));
            P.assertValidity();
            return P;
        }
        static fromHex(hex) {
            return Point.fromBytes((0, utils_ts_1.ensureBytes)('pointHex', hex));
        }
        get x() {
            return this.toAffine().x;
        }
        get y() {
            return this.toAffine().y;
        }
        /**
         *
         * @param windowSize
         * @param isLazy true will defer table computation until the first multiplication
         * @returns
         */
        precompute(windowSize = 8, isLazy = true) {
            wnaf.createCache(this, windowSize);
            if (!isLazy)
                this.multiply(_3n); // random number
            return this;
        }
        // TODO: return `this`
        /** A point on curve is valid if it conforms to equation. */
        assertValidity() {
            assertValidMemo(this);
        }
        hasEvenY() {
            const { y } = this.toAffine();
            if (!Fp.isOdd)
                throw new Error("Field doesn't support isOdd");
            return !Fp.isOdd(y);
        }
        /** Compare one point to another. */
        equals(other) {
            aprjpoint(other);
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const { X: X2, Y: Y2, Z: Z2 } = other;
            const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
            const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
            return U1 && U2;
        }
        /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
        negate() {
            return new Point(this.X, Fp.neg(this.Y), this.Z);
        }
        // Renes-Costello-Batina exception-free doubling formula.
        // There is 30% faster Jacobian formula, but it is not complete.
        // https://eprint.iacr.org/2015/1060, algorithm 3
        // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
        double() {
            const { a, b } = CURVE;
            const b3 = Fp.mul(b, _3n);
            const { X: X1, Y: Y1, Z: Z1 } = this;
            let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO; // prettier-ignore
            let t0 = Fp.mul(X1, X1); // step 1
            let t1 = Fp.mul(Y1, Y1);
            let t2 = Fp.mul(Z1, Z1);
            let t3 = Fp.mul(X1, Y1);
            t3 = Fp.add(t3, t3); // step 5
            Z3 = Fp.mul(X1, Z1);
            Z3 = Fp.add(Z3, Z3);
            X3 = Fp.mul(a, Z3);
            Y3 = Fp.mul(b3, t2);
            Y3 = Fp.add(X3, Y3); // step 10
            X3 = Fp.sub(t1, Y3);
            Y3 = Fp.add(t1, Y3);
            Y3 = Fp.mul(X3, Y3);
            X3 = Fp.mul(t3, X3);
            Z3 = Fp.mul(b3, Z3); // step 15
            t2 = Fp.mul(a, t2);
            t3 = Fp.sub(t0, t2);
            t3 = Fp.mul(a, t3);
            t3 = Fp.add(t3, Z3);
            Z3 = Fp.add(t0, t0); // step 20
            t0 = Fp.add(Z3, t0);
            t0 = Fp.add(t0, t2);
            t0 = Fp.mul(t0, t3);
            Y3 = Fp.add(Y3, t0);
            t2 = Fp.mul(Y1, Z1); // step 25
            t2 = Fp.add(t2, t2);
            t0 = Fp.mul(t2, t3);
            X3 = Fp.sub(X3, t0);
            Z3 = Fp.mul(t2, t1);
            Z3 = Fp.add(Z3, Z3); // step 30
            Z3 = Fp.add(Z3, Z3);
            return new Point(X3, Y3, Z3);
        }
        // Renes-Costello-Batina exception-free addition formula.
        // There is 30% faster Jacobian formula, but it is not complete.
        // https://eprint.iacr.org/2015/1060, algorithm 1
        // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
        add(other) {
            aprjpoint(other);
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const { X: X2, Y: Y2, Z: Z2 } = other;
            let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO; // prettier-ignore
            const a = CURVE.a;
            const b3 = Fp.mul(CURVE.b, _3n);
            let t0 = Fp.mul(X1, X2); // step 1
            let t1 = Fp.mul(Y1, Y2);
            let t2 = Fp.mul(Z1, Z2);
            let t3 = Fp.add(X1, Y1);
            let t4 = Fp.add(X2, Y2); // step 5
            t3 = Fp.mul(t3, t4);
            t4 = Fp.add(t0, t1);
            t3 = Fp.sub(t3, t4);
            t4 = Fp.add(X1, Z1);
            let t5 = Fp.add(X2, Z2); // step 10
            t4 = Fp.mul(t4, t5);
            t5 = Fp.add(t0, t2);
            t4 = Fp.sub(t4, t5);
            t5 = Fp.add(Y1, Z1);
            X3 = Fp.add(Y2, Z2); // step 15
            t5 = Fp.mul(t5, X3);
            X3 = Fp.add(t1, t2);
            t5 = Fp.sub(t5, X3);
            Z3 = Fp.mul(a, t4);
            X3 = Fp.mul(b3, t2); // step 20
            Z3 = Fp.add(X3, Z3);
            X3 = Fp.sub(t1, Z3);
            Z3 = Fp.add(t1, Z3);
            Y3 = Fp.mul(X3, Z3);
            t1 = Fp.add(t0, t0); // step 25
            t1 = Fp.add(t1, t0);
            t2 = Fp.mul(a, t2);
            t4 = Fp.mul(b3, t4);
            t1 = Fp.add(t1, t2);
            t2 = Fp.sub(t0, t2); // step 30
            t2 = Fp.mul(a, t2);
            t4 = Fp.add(t4, t2);
            t0 = Fp.mul(t1, t4);
            Y3 = Fp.add(Y3, t0);
            t0 = Fp.mul(t5, t4); // step 35
            X3 = Fp.mul(t3, X3);
            X3 = Fp.sub(X3, t0);
            t0 = Fp.mul(t3, t1);
            Z3 = Fp.mul(t5, Z3);
            Z3 = Fp.add(Z3, t0); // step 40
            return new Point(X3, Y3, Z3);
        }
        subtract(other) {
            return this.add(other.negate());
        }
        is0() {
            return this.equals(Point.ZERO);
        }
        /**
         * Constant time multiplication.
         * Uses wNAF method. Windowed method may be 10% faster,
         * but takes 2x longer to generate and consumes 2x memory.
         * Uses precomputes when available.
         * Uses endomorphism for Koblitz curves.
         * @param scalar by which the point would be multiplied
         * @returns New point
         */
        multiply(scalar) {
            const { endo } = extraOpts;
            if (!Fn.isValidNot0(scalar))
                throw new Error('invalid scalar: out of range'); // 0 is invalid
            let point, fake; // Fake point is used to const-time mult
            const mul = (n) => wnaf.cached(this, n, (p) => (0, curve_ts_1.normalizeZ)(Point, p));
            /** See docs for {@link EndomorphismOpts} */
            if (endo) {
                const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
                const { p: k1p, f: k1f } = mul(k1);
                const { p: k2p, f: k2f } = mul(k2);
                fake = k1f.add(k2f);
                point = finishEndo(endo.beta, k1p, k2p, k1neg, k2neg);
            }
            else {
                const { p, f } = mul(scalar);
                point = p;
                fake = f;
            }
            // Normalize `z` for both points, but return only real one
            return (0, curve_ts_1.normalizeZ)(Point, [point, fake])[0];
        }
        /**
         * Non-constant-time multiplication. Uses double-and-add algorithm.
         * It's faster, but should only be used when you don't care about
         * an exposed secret key e.g. sig verification, which works over *public* keys.
         */
        multiplyUnsafe(sc) {
            const { endo } = extraOpts;
            const p = this;
            if (!Fn.isValid(sc))
                throw new Error('invalid scalar: out of range'); // 0 is valid
            if (sc === _0n || p.is0())
                return Point.ZERO;
            if (sc === _1n)
                return p; // fast-path
            if (wnaf.hasCache(this))
                return this.multiply(sc);
            if (endo) {
                const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
                const { p1, p2 } = (0, curve_ts_1.mulEndoUnsafe)(Point, p, k1, k2); // 30% faster vs wnaf.unsafe
                return finishEndo(endo.beta, p1, p2, k1neg, k2neg);
            }
            else {
                return wnaf.unsafe(p, sc);
            }
        }
        multiplyAndAddUnsafe(Q, a, b) {
            const sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
            return sum.is0() ? undefined : sum;
        }
        /**
         * Converts Projective point to affine (x, y) coordinates.
         * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
         */
        toAffine(invertedZ) {
            return toAffineMemo(this, invertedZ);
        }
        /**
         * Checks whether Point is free of torsion elements (is in prime subgroup).
         * Always torsion-free for cofactor=1 curves.
         */
        isTorsionFree() {
            const { isTorsionFree } = extraOpts;
            if (cofactor === _1n)
                return true;
            if (isTorsionFree)
                return isTorsionFree(Point, this);
            return wnaf.unsafe(this, CURVE_ORDER).is0();
        }
        clearCofactor() {
            const { clearCofactor } = extraOpts;
            if (cofactor === _1n)
                return this; // Fast-path
            if (clearCofactor)
                return clearCofactor(Point, this);
            return this.multiplyUnsafe(cofactor);
        }
        isSmallOrder() {
            // can we use this.clearCofactor()?
            return this.multiplyUnsafe(cofactor).is0();
        }
        toBytes(isCompressed = true) {
            (0, utils_ts_1._abool2)(isCompressed, 'isCompressed');
            this.assertValidity();
            return encodePoint(Point, this, isCompressed);
        }
        toHex(isCompressed = true) {
            return (0, utils_ts_1.bytesToHex)(this.toBytes(isCompressed));
        }
        toString() {
            return `<Point ${this.is0() ? 'ZERO' : this.toHex()}>`;
        }
        // TODO: remove
        get px() {
            return this.X;
        }
        get py() {
            return this.X;
        }
        get pz() {
            return this.Z;
        }
        toRawBytes(isCompressed = true) {
            return this.toBytes(isCompressed);
        }
        _setWindowSize(windowSize) {
            this.precompute(windowSize);
        }
        static normalizeZ(points) {
            return (0, curve_ts_1.normalizeZ)(Point, points);
        }
        static msm(points, scalars) {
            return (0, curve_ts_1.pippenger)(Point, Fn, points, scalars);
        }
        static fromPrivateKey(privateKey) {
            return Point.BASE.multiply(_normFnElement(Fn, privateKey));
        }
    }
    // base / generator point
    Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    // zero / infinity / identity point
    Point.ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO); // 0, 1, 0
    // math field
    Point.Fp = Fp;
    // scalar field
    Point.Fn = Fn;
    const bits = Fn.BITS;
    const wnaf = new curve_ts_1.wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
    Point.BASE.precompute(8); // Enable precomputes. Slows down first publicKey computation by 20ms.
    return Point;
}
// Points start with byte 0x02 when y is even; otherwise 0x03
function pprefix(hasEvenY) {
    return Uint8Array.of(hasEvenY ? 0x02 : 0x03);
}
/**
 * Implementation of the Shallue and van de Woestijne method for any weierstrass curve.
 * TODO: check if there is a way to merge this with uvRatio in Edwards; move to modular.
 * b = True and y = sqrt(u / v) if (u / v) is square in F, and
 * b = False and y = sqrt(Z * (u / v)) otherwise.
 * @param Fp
 * @param Z
 * @returns
 */
function SWUFpSqrtRatio(Fp, Z) {
    // Generic implementation
    const q = Fp.ORDER;
    let l = _0n;
    for (let o = q - _1n; o % _2n === _0n; o /= _2n)
        l += _1n;
    const c1 = l; // 1. c1, the largest integer such that 2^c1 divides q - 1.
    // We need 2n ** c1 and 2n ** (c1-1). We can't use **; but we can use <<.
    // 2n ** c1 == 2n << (c1-1)
    const _2n_pow_c1_1 = _2n << (c1 - _1n - _1n);
    const _2n_pow_c1 = _2n_pow_c1_1 * _2n;
    const c2 = (q - _1n) / _2n_pow_c1; // 2. c2 = (q - 1) / (2^c1)  # Integer arithmetic
    const c3 = (c2 - _1n) / _2n; // 3. c3 = (c2 - 1) / 2            # Integer arithmetic
    const c4 = _2n_pow_c1 - _1n; // 4. c4 = 2^c1 - 1                # Integer arithmetic
    const c5 = _2n_pow_c1_1; // 5. c5 = 2^(c1 - 1)                  # Integer arithmetic
    const c6 = Fp.pow(Z, c2); // 6. c6 = Z^c2
    const c7 = Fp.pow(Z, (c2 + _1n) / _2n); // 7. c7 = Z^((c2 + 1) / 2)
    let sqrtRatio = (u, v) => {
        let tv1 = c6; // 1. tv1 = c6
        let tv2 = Fp.pow(v, c4); // 2. tv2 = v^c4
        let tv3 = Fp.sqr(tv2); // 3. tv3 = tv2^2
        tv3 = Fp.mul(tv3, v); // 4. tv3 = tv3 * v
        let tv5 = Fp.mul(u, tv3); // 5. tv5 = u * tv3
        tv5 = Fp.pow(tv5, c3); // 6. tv5 = tv5^c3
        tv5 = Fp.mul(tv5, tv2); // 7. tv5 = tv5 * tv2
        tv2 = Fp.mul(tv5, v); // 8. tv2 = tv5 * v
        tv3 = Fp.mul(tv5, u); // 9. tv3 = tv5 * u
        let tv4 = Fp.mul(tv3, tv2); // 10. tv4 = tv3 * tv2
        tv5 = Fp.pow(tv4, c5); // 11. tv5 = tv4^c5
        let isQR = Fp.eql(tv5, Fp.ONE); // 12. isQR = tv5 == 1
        tv2 = Fp.mul(tv3, c7); // 13. tv2 = tv3 * c7
        tv5 = Fp.mul(tv4, tv1); // 14. tv5 = tv4 * tv1
        tv3 = Fp.cmov(tv2, tv3, isQR); // 15. tv3 = CMOV(tv2, tv3, isQR)
        tv4 = Fp.cmov(tv5, tv4, isQR); // 16. tv4 = CMOV(tv5, tv4, isQR)
        // 17. for i in (c1, c1 - 1, ..., 2):
        for (let i = c1; i > _1n; i--) {
            let tv5 = i - _2n; // 18.    tv5 = i - 2
            tv5 = _2n << (tv5 - _1n); // 19.    tv5 = 2^tv5
            let tvv5 = Fp.pow(tv4, tv5); // 20.    tv5 = tv4^tv5
            const e1 = Fp.eql(tvv5, Fp.ONE); // 21.    e1 = tv5 == 1
            tv2 = Fp.mul(tv3, tv1); // 22.    tv2 = tv3 * tv1
            tv1 = Fp.mul(tv1, tv1); // 23.    tv1 = tv1 * tv1
            tvv5 = Fp.mul(tv4, tv1); // 24.    tv5 = tv4 * tv1
            tv3 = Fp.cmov(tv2, tv3, e1); // 25.    tv3 = CMOV(tv2, tv3, e1)
            tv4 = Fp.cmov(tvv5, tv4, e1); // 26.    tv4 = CMOV(tv5, tv4, e1)
        }
        return { isValid: isQR, value: tv3 };
    };
    if (Fp.ORDER % _4n === _3n) {
        // sqrt_ratio_3mod4(u, v)
        const c1 = (Fp.ORDER - _3n) / _4n; // 1. c1 = (q - 3) / 4     # Integer arithmetic
        const c2 = Fp.sqrt(Fp.neg(Z)); // 2. c2 = sqrt(-Z)
        sqrtRatio = (u, v) => {
            let tv1 = Fp.sqr(v); // 1. tv1 = v^2
            const tv2 = Fp.mul(u, v); // 2. tv2 = u * v
            tv1 = Fp.mul(tv1, tv2); // 3. tv1 = tv1 * tv2
            let y1 = Fp.pow(tv1, c1); // 4. y1 = tv1^c1
            y1 = Fp.mul(y1, tv2); // 5. y1 = y1 * tv2
            const y2 = Fp.mul(y1, c2); // 6. y2 = y1 * c2
            const tv3 = Fp.mul(Fp.sqr(y1), v); // 7. tv3 = y1^2; 8. tv3 = tv3 * v
            const isQR = Fp.eql(tv3, u); // 9. isQR = tv3 == u
            let y = Fp.cmov(y2, y1, isQR); // 10. y = CMOV(y2, y1, isQR)
            return { isValid: isQR, value: y }; // 11. return (isQR, y) isQR ? y : y*c2
        };
    }
    // No curves uses that
    // if (Fp.ORDER % _8n === _5n) // sqrt_ratio_5mod8
    return sqrtRatio;
}
/**
 * Simplified Shallue-van de Woestijne-Ulas Method
 * https://www.rfc-editor.org/rfc/rfc9380#section-6.6.2
 */
function mapToCurveSimpleSWU(Fp, opts) {
    (0, modular_ts_1.validateField)(Fp);
    const { A, B, Z } = opts;
    if (!Fp.isValid(A) || !Fp.isValid(B) || !Fp.isValid(Z))
        throw new Error('mapToCurveSimpleSWU: invalid opts');
    const sqrtRatio = SWUFpSqrtRatio(Fp, Z);
    if (!Fp.isOdd)
        throw new Error('Field does not have .isOdd()');
    // Input: u, an element of F.
    // Output: (x, y), a point on E.
    return (u) => {
        // prettier-ignore
        let tv1, tv2, tv3, tv4, tv5, tv6, x, y;
        tv1 = Fp.sqr(u); // 1.  tv1 = u^2
        tv1 = Fp.mul(tv1, Z); // 2.  tv1 = Z * tv1
        tv2 = Fp.sqr(tv1); // 3.  tv2 = tv1^2
        tv2 = Fp.add(tv2, tv1); // 4.  tv2 = tv2 + tv1
        tv3 = Fp.add(tv2, Fp.ONE); // 5.  tv3 = tv2 + 1
        tv3 = Fp.mul(tv3, B); // 6.  tv3 = B * tv3
        tv4 = Fp.cmov(Z, Fp.neg(tv2), !Fp.eql(tv2, Fp.ZERO)); // 7.  tv4 = CMOV(Z, -tv2, tv2 != 0)
        tv4 = Fp.mul(tv4, A); // 8.  tv4 = A * tv4
        tv2 = Fp.sqr(tv3); // 9.  tv2 = tv3^2
        tv6 = Fp.sqr(tv4); // 10. tv6 = tv4^2
        tv5 = Fp.mul(tv6, A); // 11. tv5 = A * tv6
        tv2 = Fp.add(tv2, tv5); // 12. tv2 = tv2 + tv5
        tv2 = Fp.mul(tv2, tv3); // 13. tv2 = tv2 * tv3
        tv6 = Fp.mul(tv6, tv4); // 14. tv6 = tv6 * tv4
        tv5 = Fp.mul(tv6, B); // 15. tv5 = B * tv6
        tv2 = Fp.add(tv2, tv5); // 16. tv2 = tv2 + tv5
        x = Fp.mul(tv1, tv3); // 17.   x = tv1 * tv3
        const { isValid, value } = sqrtRatio(tv2, tv6); // 18. (is_gx1_square, y1) = sqrt_ratio(tv2, tv6)
        y = Fp.mul(tv1, u); // 19.   y = tv1 * u  -> Z * u^3 * y1
        y = Fp.mul(y, value); // 20.   y = y * y1
        x = Fp.cmov(x, tv3, isValid); // 21.   x = CMOV(x, tv3, is_gx1_square)
        y = Fp.cmov(y, value, isValid); // 22.   y = CMOV(y, y1, is_gx1_square)
        const e1 = Fp.isOdd(u) === Fp.isOdd(y); // 23.  e1 = sgn0(u) == sgn0(y)
        y = Fp.cmov(Fp.neg(y), y, e1); // 24.   y = CMOV(-y, y, e1)
        const tv4_inv = (0, modular_ts_1.FpInvertBatch)(Fp, [tv4], true)[0];
        x = Fp.mul(x, tv4_inv); // 25.   x = x / tv4
        return { x, y };
    };
}
function getWLengths(Fp, Fn) {
    return {
        secretKey: Fn.BYTES,
        publicKey: 1 + Fp.BYTES,
        publicKeyUncompressed: 1 + 2 * Fp.BYTES,
        publicKeyHasPrefix: true,
        signature: 2 * Fn.BYTES,
    };
}
/**
 * Sometimes users only need getPublicKey, getSharedSecret, and secret key handling.
 * This helper ensures no signature functionality is present. Less code, smaller bundle size.
 */
function ecdh(Point, ecdhOpts = {}) {
    const { Fn } = Point;
    const randomBytes_ = ecdhOpts.randomBytes || utils_ts_1.randomBytes;
    const lengths = Object.assign(getWLengths(Point.Fp, Fn), { seed: (0, modular_ts_1.getMinHashLength)(Fn.ORDER) });
    function isValidSecretKey(secretKey) {
        try {
            return !!_normFnElement(Fn, secretKey);
        }
        catch (error) {
            return false;
        }
    }
    function isValidPublicKey(publicKey, isCompressed) {
        const { publicKey: comp, publicKeyUncompressed } = lengths;
        try {
            const l = publicKey.length;
            if (isCompressed === true && l !== comp)
                return false;
            if (isCompressed === false && l !== publicKeyUncompressed)
                return false;
            return !!Point.fromBytes(publicKey);
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Produces cryptographically secure secret key from random of size
     * (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
     */
    function randomSecretKey(seed = randomBytes_(lengths.seed)) {
        return (0, modular_ts_1.mapHashToField)((0, utils_ts_1._abytes2)(seed, lengths.seed, 'seed'), Fn.ORDER);
    }
    /**
     * Computes public key for a secret key. Checks for validity of the secret key.
     * @param isCompressed whether to return compact (default), or full key
     * @returns Public key, full when isCompressed=false; short when isCompressed=true
     */
    function getPublicKey(secretKey, isCompressed = true) {
        return Point.BASE.multiply(_normFnElement(Fn, secretKey)).toBytes(isCompressed);
    }
    function keygen(seed) {
        const secretKey = randomSecretKey(seed);
        return { secretKey, publicKey: getPublicKey(secretKey) };
    }
    /**
     * Quick and dirty check for item being public key. Does not validate hex, or being on-curve.
     */
    function isProbPub(item) {
        if (typeof item === 'bigint')
            return false;
        if (item instanceof Point)
            return true;
        const { secretKey, publicKey, publicKeyUncompressed } = lengths;
        if (Fn.allowedLengths || secretKey === publicKey)
            return undefined;
        const l = (0, utils_ts_1.ensureBytes)('key', item).length;
        return l === publicKey || l === publicKeyUncompressed;
    }
    /**
     * ECDH (Elliptic Curve Diffie Hellman).
     * Computes shared public key from secret key A and public key B.
     * Checks: 1) secret key validity 2) shared key is on-curve.
     * Does NOT hash the result.
     * @param isCompressed whether to return compact (default), or full key
     * @returns shared public key
     */
    function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
        if (isProbPub(secretKeyA) === true)
            throw new Error('first arg must be private key');
        if (isProbPub(publicKeyB) === false)
            throw new Error('second arg must be public key');
        const s = _normFnElement(Fn, secretKeyA);
        const b = Point.fromHex(publicKeyB); // checks for being on-curve
        return b.multiply(s).toBytes(isCompressed);
    }
    const utils = {
        isValidSecretKey,
        isValidPublicKey,
        randomSecretKey,
        // TODO: remove
        isValidPrivateKey: isValidSecretKey,
        randomPrivateKey: randomSecretKey,
        normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
        precompute(windowSize = 8, point = Point.BASE) {
            return point.precompute(windowSize, false);
        },
    };
    return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
/**
 * Creates ECDSA signing interface for given elliptic curve `Point` and `hash` function.
 * We need `hash` for 2 features:
 * 1. Message prehash-ing. NOT used if `sign` / `verify` are called with `prehash: false`
 * 2. k generation in `sign`, using HMAC-drbg(hash)
 *
 * ECDSAOpts are only rarely needed.
 *
 * @example
 * ```js
 * const p256_Point = weierstrass(...);
 * const p256_sha256 = ecdsa(p256_Point, sha256);
 * const p256_sha224 = ecdsa(p256_Point, sha224);
 * const p256_sha224_r = ecdsa(p256_Point, sha224, { randomBytes: (length) => { ... } });
 * ```
 */
function ecdsa(Point, hash, ecdsaOpts = {}) {
    (0, utils_1.ahash)(hash);
    (0, utils_ts_1._validateObject)(ecdsaOpts, {}, {
        hmac: 'function',
        lowS: 'boolean',
        randomBytes: 'function',
        bits2int: 'function',
        bits2int_modN: 'function',
    });
    const randomBytes = ecdsaOpts.randomBytes || utils_ts_1.randomBytes;
    const hmac = ecdsaOpts.hmac ||
        ((key, ...msgs) => (0, hmac_js_1.hmac)(hash, key, (0, utils_ts_1.concatBytes)(...msgs)));
    const { Fp, Fn } = Point;
    const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
    const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts);
    const defaultSigOpts = {
        prehash: false,
        lowS: typeof ecdsaOpts.lowS === 'boolean' ? ecdsaOpts.lowS : false,
        format: undefined, //'compact' as ECDSASigFormat,
        extraEntropy: false,
    };
    const defaultSigOpts_format = 'compact';
    function isBiggerThanHalfOrder(number) {
        const HALF = CURVE_ORDER >> _1n;
        return number > HALF;
    }
    function validateRS(title, num) {
        if (!Fn.isValidNot0(num))
            throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
        return num;
    }
    function validateSigLength(bytes, format) {
        validateSigFormat(format);
        const size = lengths.signature;
        const sizer = format === 'compact' ? size : format === 'recovered' ? size + 1 : undefined;
        return (0, utils_ts_1._abytes2)(bytes, sizer, `${format} signature`);
    }
    /**
     * ECDSA signature with its (r, s) properties. Supports compact, recovered & DER representations.
     */
    class Signature {
        constructor(r, s, recovery) {
            this.r = validateRS('r', r); // r in [1..N-1];
            this.s = validateRS('s', s); // s in [1..N-1];
            if (recovery != null)
                this.recovery = recovery;
            Object.freeze(this);
        }
        static fromBytes(bytes, format = defaultSigOpts_format) {
            validateSigLength(bytes, format);
            let recid;
            if (format === 'der') {
                const { r, s } = exports.DER.toSig((0, utils_ts_1._abytes2)(bytes));
                return new Signature(r, s);
            }
            if (format === 'recovered') {
                recid = bytes[0];
                format = 'compact';
                bytes = bytes.subarray(1);
            }
            const L = Fn.BYTES;
            const r = bytes.subarray(0, L);
            const s = bytes.subarray(L, L * 2);
            return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
        }
        static fromHex(hex, format) {
            return this.fromBytes((0, utils_ts_1.hexToBytes)(hex), format);
        }
        addRecoveryBit(recovery) {
            return new Signature(this.r, this.s, recovery);
        }
        recoverPublicKey(messageHash) {
            const FIELD_ORDER = Fp.ORDER;
            const { r, s, recovery: rec } = this;
            if (rec == null || ![0, 1, 2, 3].includes(rec))
                throw new Error('recovery id invalid');
            // ECDSA recovery is hard for cofactor > 1 curves.
            // In sign, `r = q.x mod n`, and here we recover q.x from r.
            // While recovering q.x >= n, we need to add r+n for cofactor=1 curves.
            // However, for cofactor>1, r+n may not get q.x:
            // r+n*i would need to be done instead where i is unknown.
            // To easily get i, we either need to:
            // a. increase amount of valid recid values (4, 5...); OR
            // b. prohibit non-prime-order signatures (recid > 1).
            const hasCofactor = CURVE_ORDER * _2n < FIELD_ORDER;
            if (hasCofactor && rec > 1)
                throw new Error('recovery id is ambiguous for h>1 curve');
            const radj = rec === 2 || rec === 3 ? r + CURVE_ORDER : r;
            if (!Fp.isValid(radj))
                throw new Error('recovery id 2 or 3 invalid');
            const x = Fp.toBytes(radj);
            const R = Point.fromBytes((0, utils_ts_1.concatBytes)(pprefix((rec & 1) === 0), x));
            const ir = Fn.inv(radj); // r^-1
            const h = bits2int_modN((0, utils_ts_1.ensureBytes)('msgHash', messageHash)); // Truncate hash
            const u1 = Fn.create(-h * ir); // -hr^-1
            const u2 = Fn.create(s * ir); // sr^-1
            // (sr^-1)R-(hr^-1)G = -(hr^-1)G + (sr^-1). unsafe is fine: there is no private data.
            const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
            if (Q.is0())
                throw new Error('point at infinify');
            Q.assertValidity();
            return Q;
        }
        // Signatures should be low-s, to prevent malleability.
        hasHighS() {
            return isBiggerThanHalfOrder(this.s);
        }
        toBytes(format = defaultSigOpts_format) {
            validateSigFormat(format);
            if (format === 'der')
                return (0, utils_ts_1.hexToBytes)(exports.DER.hexFromSig(this));
            const r = Fn.toBytes(this.r);
            const s = Fn.toBytes(this.s);
            if (format === 'recovered') {
                if (this.recovery == null)
                    throw new Error('recovery bit must be present');
                return (0, utils_ts_1.concatBytes)(Uint8Array.of(this.recovery), r, s);
            }
            return (0, utils_ts_1.concatBytes)(r, s);
        }
        toHex(format) {
            return (0, utils_ts_1.bytesToHex)(this.toBytes(format));
        }
        // TODO: remove
        assertValidity() { }
        static fromCompact(hex) {
            return Signature.fromBytes((0, utils_ts_1.ensureBytes)('sig', hex), 'compact');
        }
        static fromDER(hex) {
            return Signature.fromBytes((0, utils_ts_1.ensureBytes)('sig', hex), 'der');
        }
        normalizeS() {
            return this.hasHighS() ? new Signature(this.r, Fn.neg(this.s), this.recovery) : this;
        }
        toDERRawBytes() {
            return this.toBytes('der');
        }
        toDERHex() {
            return (0, utils_ts_1.bytesToHex)(this.toBytes('der'));
        }
        toCompactRawBytes() {
            return this.toBytes('compact');
        }
        toCompactHex() {
            return (0, utils_ts_1.bytesToHex)(this.toBytes('compact'));
        }
    }
    // RFC6979: ensure ECDSA msg is X bytes and < N. RFC suggests optional truncating via bits2octets.
    // FIPS 186-4 4.6 suggests the leftmost min(nBitLen, outLen) bits, which matches bits2int.
    // bits2int can produce res>N, we can do mod(res, N) since the bitLen is the same.
    // int2octets can't be used; pads small msgs with 0: unacceptatble for trunc as per RFC vectors
    const bits2int = ecdsaOpts.bits2int ||
        function bits2int_def(bytes) {
            // Our custom check "just in case", for protection against DoS
            if (bytes.length > 8192)
                throw new Error('input is too large');
            // For curves with nBitLength % 8 !== 0: bits2octets(bits2octets(m)) !== bits2octets(m)
            // for some cases, since bytes.length * 8 is not actual bitLength.
            const num = (0, utils_ts_1.bytesToNumberBE)(bytes); // check for == u8 done here
            const delta = bytes.length * 8 - fnBits; // truncate to nBitLength leftmost bits
            return delta > 0 ? num >> BigInt(delta) : num;
        };
    const bits2int_modN = ecdsaOpts.bits2int_modN ||
        function bits2int_modN_def(bytes) {
            return Fn.create(bits2int(bytes)); // can't use bytesToNumberBE here
        };
    // Pads output with zero as per spec
    const ORDER_MASK = (0, utils_ts_1.bitMask)(fnBits);
    /** Converts to bytes. Checks if num in `[0..ORDER_MASK-1]` e.g.: `[0..2^256-1]`. */
    function int2octets(num) {
        // IMPORTANT: the check ensures working for case `Fn.BYTES != Fn.BITS * 8`
        (0, utils_ts_1.aInRange)('num < 2^' + fnBits, num, _0n, ORDER_MASK);
        return Fn.toBytes(num);
    }
    function validateMsgAndHash(message, prehash) {
        (0, utils_ts_1._abytes2)(message, undefined, 'message');
        return prehash ? (0, utils_ts_1._abytes2)(hash(message), undefined, 'prehashed message') : message;
    }
    /**
     * Steps A, D of RFC6979 3.2.
     * Creates RFC6979 seed; converts msg/privKey to numbers.
     * Used only in sign, not in verify.
     *
     * Warning: we cannot assume here that message has same amount of bytes as curve order,
     * this will be invalid at least for P521. Also it can be bigger for P224 + SHA256.
     */
    function prepSig(message, privateKey, opts) {
        if (['recovered', 'canonical'].some((k) => k in opts))
            throw new Error('sign() legacy options not supported');
        const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
        message = validateMsgAndHash(message, prehash); // RFC6979 3.2 A: h1 = H(m)
        // We can't later call bits2octets, since nested bits2int is broken for curves
        // with fnBits % 8 !== 0. Because of that, we unwrap it here as int2octets call.
        // const bits2octets = (bits) => int2octets(bits2int_modN(bits))
        const h1int = bits2int_modN(message);
        const d = _normFnElement(Fn, privateKey); // validate secret key, convert to bigint
        const seedArgs = [int2octets(d), int2octets(h1int)];
        // extraEntropy. RFC6979 3.6: additional k' (optional).
        if (extraEntropy != null && extraEntropy !== false) {
            // K = HMAC_K(V || 0x00 || int2octets(x) || bits2octets(h1) || k')
            // gen random bytes OR pass as-is
            const e = extraEntropy === true ? randomBytes(lengths.secretKey) : extraEntropy;
            seedArgs.push((0, utils_ts_1.ensureBytes)('extraEntropy', e)); // check for being bytes
        }
        const seed = (0, utils_ts_1.concatBytes)(...seedArgs); // Step D of RFC6979 3.2
        const m = h1int; // NOTE: no need to call bits2int second time here, it is inside truncateHash!
        // Converts signature params into point w r/s, checks result for validity.
        // To transform k => Signature:
        // q = k⋅G
        // r = q.x mod n
        // s = k^-1(m + rd) mod n
        // Can use scalar blinding b^-1(bm + bdr) where b ∈ [1,q−1] according to
        // https://tches.iacr.org/index.php/TCHES/article/view/7337/6509. We've decided against it:
        // a) dependency on CSPRNG b) 15% slowdown c) doesn't really help since bigints are not CT
        function k2sig(kBytes) {
            // RFC 6979 Section 3.2, step 3: k = bits2int(T)
            // Important: all mod() calls here must be done over N
            const k = bits2int(kBytes); // mod n, not mod p
            if (!Fn.isValidNot0(k))
                return; // Valid scalars (including k) must be in 1..N-1
            const ik = Fn.inv(k); // k^-1 mod n
            const q = Point.BASE.multiply(k).toAffine(); // q = k⋅G
            const r = Fn.create(q.x); // r = q.x mod n
            if (r === _0n)
                return;
            const s = Fn.create(ik * Fn.create(m + r * d)); // Not using blinding here, see comment above
            if (s === _0n)
                return;
            let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n); // recovery bit (2 or 3, when q.x > n)
            let normS = s;
            if (lowS && isBiggerThanHalfOrder(s)) {
                normS = Fn.neg(s); // if lowS was passed, ensure s is always
                recovery ^= 1; // // in the bottom half of N
            }
            return new Signature(r, normS, recovery); // use normS, not s
        }
        return { seed, k2sig };
    }
    /**
     * Signs message hash with a secret key.
     *
     * ```
     * sign(m, d) where
     *   k = rfc6979_hmac_drbg(m, d)
     *   (x, y) = G × k
     *   r = x mod n
     *   s = (m + dr) / k mod n
     * ```
     */
    function sign(message, secretKey, opts = {}) {
        message = (0, utils_ts_1.ensureBytes)('message', message);
        const { seed, k2sig } = prepSig(message, secretKey, opts); // Steps A, D of RFC6979 3.2.
        const drbg = (0, utils_ts_1.createHmacDrbg)(hash.outputLen, Fn.BYTES, hmac);
        const sig = drbg(seed, k2sig); // Steps B, C, D, E, F, G
        return sig;
    }
    function tryParsingSig(sg) {
        // Try to deduce format
        let sig = undefined;
        const isHex = typeof sg === 'string' || (0, utils_ts_1.isBytes)(sg);
        const isObj = !isHex &&
            sg !== null &&
            typeof sg === 'object' &&
            typeof sg.r === 'bigint' &&
            typeof sg.s === 'bigint';
        if (!isHex && !isObj)
            throw new Error('invalid signature, expected Uint8Array, hex string or Signature instance');
        if (isObj) {
            sig = new Signature(sg.r, sg.s);
        }
        else if (isHex) {
            try {
                sig = Signature.fromBytes((0, utils_ts_1.ensureBytes)('sig', sg), 'der');
            }
            catch (derError) {
                if (!(derError instanceof exports.DER.Err))
                    throw derError;
            }
            if (!sig) {
                try {
                    sig = Signature.fromBytes((0, utils_ts_1.ensureBytes)('sig', sg), 'compact');
                }
                catch (error) {
                    return false;
                }
            }
        }
        if (!sig)
            return false;
        return sig;
    }
    /**
     * Verifies a signature against message and public key.
     * Rejects lowS signatures by default: see {@link ECDSAVerifyOpts}.
     * Implements section 4.1.4 from https://www.secg.org/sec1-v2.pdf:
     *
     * ```
     * verify(r, s, h, P) where
     *   u1 = hs^-1 mod n
     *   u2 = rs^-1 mod n
     *   R = u1⋅G + u2⋅P
     *   mod(R.x, n) == r
     * ```
     */
    function verify(signature, message, publicKey, opts = {}) {
        const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
        publicKey = (0, utils_ts_1.ensureBytes)('publicKey', publicKey);
        message = validateMsgAndHash((0, utils_ts_1.ensureBytes)('message', message), prehash);
        if ('strict' in opts)
            throw new Error('options.strict was renamed to lowS');
        const sig = format === undefined
            ? tryParsingSig(signature)
            : Signature.fromBytes((0, utils_ts_1.ensureBytes)('sig', signature), format);
        if (sig === false)
            return false;
        try {
            const P = Point.fromBytes(publicKey);
            if (lowS && sig.hasHighS())
                return false;
            const { r, s } = sig;
            const h = bits2int_modN(message); // mod n, not mod p
            const is = Fn.inv(s); // s^-1 mod n
            const u1 = Fn.create(h * is); // u1 = hs^-1 mod n
            const u2 = Fn.create(r * is); // u2 = rs^-1 mod n
            const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2)); // u1⋅G + u2⋅P
            if (R.is0())
                return false;
            const v = Fn.create(R.x); // v = r.x mod n
            return v === r;
        }
        catch (e) {
            return false;
        }
    }
    function recoverPublicKey(signature, message, opts = {}) {
        const { prehash } = validateSigOpts(opts, defaultSigOpts);
        message = validateMsgAndHash(message, prehash);
        return Signature.fromBytes(signature, 'recovered').recoverPublicKey(message).toBytes();
    }
    return Object.freeze({
        keygen,
        getPublicKey,
        getSharedSecret,
        utils,
        lengths,
        Point,
        sign,
        verify,
        recoverPublicKey,
        Signature,
        hash,
    });
}
/** @deprecated use `weierstrass` in newer releases */
function weierstrassPoints(c) {
    const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c);
    const Point = weierstrassN(CURVE, curveOpts);
    return _weierstrass_new_output_to_legacy(c, Point);
}
function _weierstrass_legacy_opts_to_new(c) {
    const CURVE = {
        a: c.a,
        b: c.b,
        p: c.Fp.ORDER,
        n: c.n,
        h: c.h,
        Gx: c.Gx,
        Gy: c.Gy,
    };
    const Fp = c.Fp;
    let allowedLengths = c.allowedPrivateKeyLengths
        ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2))))
        : undefined;
    const Fn = (0, modular_ts_1.Field)(CURVE.n, {
        BITS: c.nBitLength,
        allowedLengths: allowedLengths,
        modFromBytes: c.wrapPrivateKey,
    });
    const curveOpts = {
        Fp,
        Fn,
        allowInfinityPoint: c.allowInfinityPoint,
        endo: c.endo,
        isTorsionFree: c.isTorsionFree,
        clearCofactor: c.clearCofactor,
        fromBytes: c.fromBytes,
        toBytes: c.toBytes,
    };
    return { CURVE, curveOpts };
}
function _ecdsa_legacy_opts_to_new(c) {
    const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c);
    const ecdsaOpts = {
        hmac: c.hmac,
        randomBytes: c.randomBytes,
        lowS: c.lowS,
        bits2int: c.bits2int,
        bits2int_modN: c.bits2int_modN,
    };
    return { CURVE, curveOpts, hash: c.hash, ecdsaOpts };
}
function _legacyHelperEquat(Fp, a, b) {
    /**
     * y² = x³ + ax + b: Short weierstrass curve formula. Takes x, returns y².
     * @returns y²
     */
    function weierstrassEquation(x) {
        const x2 = Fp.sqr(x); // x * x
        const x3 = Fp.mul(x2, x); // x² * x
        return Fp.add(Fp.add(x3, Fp.mul(x, a)), b); // x³ + a * x + b
    }
    return weierstrassEquation;
}
function _weierstrass_new_output_to_legacy(c, Point) {
    const { Fp, Fn } = Point;
    function isWithinCurveOrder(num) {
        return (0, utils_ts_1.inRange)(num, _1n, Fn.ORDER);
    }
    const weierstrassEquation = _legacyHelperEquat(Fp, c.a, c.b);
    return Object.assign({}, {
        CURVE: c,
        Point: Point,
        ProjectivePoint: Point,
        normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
        weierstrassEquation,
        isWithinCurveOrder,
    });
}
function _ecdsa_new_output_to_legacy(c, _ecdsa) {
    const Point = _ecdsa.Point;
    return Object.assign({}, _ecdsa, {
        ProjectivePoint: Point,
        CURVE: Object.assign({}, c, (0, modular_ts_1.nLength)(Point.Fn.ORDER, Point.Fn.BITS)),
    });
}
// _ecdsa_legacy
function weierstrass(c) {
    const { CURVE, curveOpts, hash, ecdsaOpts } = _ecdsa_legacy_opts_to_new(c);
    const Point = weierstrassN(CURVE, curveOpts);
    const signs = ecdsa(Point, hash, ecdsaOpts);
    return _ecdsa_new_output_to_legacy(c, signs);
}
//# sourceMappingURL=weierstrass.js.map
    },
    20: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notImplemented = exports.bitMask = exports.utf8ToBytes = exports.randomBytes = exports.isBytes = exports.hexToBytes = exports.concatBytes = exports.bytesToUtf8 = exports.bytesToHex = exports.anumber = exports.abytes = void 0;
exports.abool = abool;
exports._abool2 = _abool2;
exports._abytes2 = _abytes2;
exports.numberToHexUnpadded = numberToHexUnpadded;
exports.hexToNumber = hexToNumber;
exports.bytesToNumberBE = bytesToNumberBE;
exports.bytesToNumberLE = bytesToNumberLE;
exports.numberToBytesBE = numberToBytesBE;
exports.numberToBytesLE = numberToBytesLE;
exports.numberToVarBytesBE = numberToVarBytesBE;
exports.ensureBytes = ensureBytes;
exports.equalBytes = equalBytes;
exports.copyBytes = copyBytes;
exports.asciiToBytes = asciiToBytes;
exports.inRange = inRange;
exports.aInRange = aInRange;
exports.bitLen = bitLen;
exports.bitGet = bitGet;
exports.bitSet = bitSet;
exports.createHmacDrbg = createHmacDrbg;
exports.validateObject = validateObject;
exports.isHash = isHash;
exports._validateObject = _validateObject;
exports.memoized = memoized;
/**
 * Hex, bytes and number utilities.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_js_1 = require("@noble/hashes/utils.js");
var utils_js_2 = require("@noble/hashes/utils.js");
Object.defineProperty(exports, "abytes", { enumerable: true, get: function () { return utils_js_2.abytes; } });
Object.defineProperty(exports, "anumber", { enumerable: true, get: function () { return utils_js_2.anumber; } });
Object.defineProperty(exports, "bytesToHex", { enumerable: true, get: function () { return utils_js_2.bytesToHex; } });
Object.defineProperty(exports, "bytesToUtf8", { enumerable: true, get: function () { return utils_js_2.bytesToUtf8; } });
Object.defineProperty(exports, "concatBytes", { enumerable: true, get: function () { return utils_js_2.concatBytes; } });
Object.defineProperty(exports, "hexToBytes", { enumerable: true, get: function () { return utils_js_2.hexToBytes; } });
Object.defineProperty(exports, "isBytes", { enumerable: true, get: function () { return utils_js_2.isBytes; } });
Object.defineProperty(exports, "randomBytes", { enumerable: true, get: function () { return utils_js_2.randomBytes; } });
Object.defineProperty(exports, "utf8ToBytes", { enumerable: true, get: function () { return utils_js_2.utf8ToBytes; } });
const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
function abool(title, value) {
    if (typeof value !== 'boolean')
        throw new Error(title + ' boolean expected, got ' + value);
}
// tmp name until v2
function _abool2(value, title = '') {
    if (typeof value !== 'boolean') {
        const prefix = title && `"${title}"`;
        throw new Error(prefix + 'expected boolean, got type=' + typeof value);
    }
    return value;
}
// tmp name until v2
/** Asserts something is Uint8Array. */
function _abytes2(value, length, title = '') {
    const bytes = (0, utils_js_1.isBytes)(value);
    const len = value?.length;
    const needsLen = length !== undefined;
    if (!bytes || (needsLen && len !== length)) {
        const prefix = title && `"${title}" `;
        const ofLen = needsLen ? ` of length ${length}` : '';
        const got = bytes ? `length=${len}` : `type=${typeof value}`;
        throw new Error(prefix + 'expected Uint8Array' + ofLen + ', got ' + got);
    }
    return value;
}
// Used in weierstrass, der
function numberToHexUnpadded(num) {
    const hex = num.toString(16);
    return hex.length & 1 ? '0' + hex : hex;
}
function hexToNumber(hex) {
    if (typeof hex !== 'string')
        throw new Error('hex string expected, got ' + typeof hex);
    return hex === '' ? _0n : BigInt('0x' + hex); // Big Endian
}
// BE: Big Endian, LE: Little Endian
function bytesToNumberBE(bytes) {
    return hexToNumber((0, utils_js_1.bytesToHex)(bytes));
}
function bytesToNumberLE(bytes) {
    (0, utils_js_1.abytes)(bytes);
    return hexToNumber((0, utils_js_1.bytesToHex)(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
    return (0, utils_js_1.hexToBytes)(n.toString(16).padStart(len * 2, '0'));
}
function numberToBytesLE(n, len) {
    return numberToBytesBE(n, len).reverse();
}
// Unpadded, rarely used
function numberToVarBytesBE(n) {
    return (0, utils_js_1.hexToBytes)(numberToHexUnpadded(n));
}
/**
 * Takes hex string or Uint8Array, converts to Uint8Array.
 * Validates output length.
 * Will throw error for other types.
 * @param title descriptive title for an error e.g. 'secret key'
 * @param hex hex string or Uint8Array
 * @param expectedLength optional, will compare to result array's length
 * @returns
 */
function ensureBytes(title, hex, expectedLength) {
    let res;
    if (typeof hex === 'string') {
        try {
            res = (0, utils_js_1.hexToBytes)(hex);
        }
        catch (e) {
            throw new Error(title + ' must be hex string or Uint8Array, cause: ' + e);
        }
    }
    else if ((0, utils_js_1.isBytes)(hex)) {
        // Uint8Array.from() instead of hash.slice() because node.js Buffer
        // is instance of Uint8Array, and its slice() creates **mutable** copy
        res = Uint8Array.from(hex);
    }
    else {
        throw new Error(title + ' must be hex string or Uint8Array');
    }
    const len = res.length;
    if (typeof expectedLength === 'number' && len !== expectedLength)
        throw new Error(title + ' of length ' + expectedLength + ' expected, got ' + len);
    return res;
}
// Compares 2 u8a-s in kinda constant time
function equalBytes(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
    return diff === 0;
}
/**
 * Copies Uint8Array. We can't use u8a.slice(), because u8a can be Buffer,
 * and Buffer#slice creates mutable copy. Never use Buffers!
 */
function copyBytes(bytes) {
    return Uint8Array.from(bytes);
}
/**
 * Decodes 7-bit ASCII string to Uint8Array, throws on non-ascii symbols
 * Should be safe to use for things expected to be ASCII.
 * Returns exact same result as utf8ToBytes for ASCII or throws.
 */
function asciiToBytes(ascii) {
    return Uint8Array.from(ascii, (c, i) => {
        const charCode = c.charCodeAt(0);
        if (c.length !== 1 || charCode > 127) {
            throw new Error(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
        }
        return charCode;
    });
}
/**
 * @example utf8ToBytes('abc') // new Uint8Array([97, 98, 99])
 */
// export const utf8ToBytes: typeof utf8ToBytes_ = utf8ToBytes_;
/**
 * Converts bytes to string using UTF8 encoding.
 * @example bytesToUtf8(Uint8Array.from([97, 98, 99])) // 'abc'
 */
// export const bytesToUtf8: typeof bytesToUtf8_ = bytesToUtf8_;
// Is positive bigint
const isPosBig = (n) => typeof n === 'bigint' && _0n <= n;
function inRange(n, min, max) {
    return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
/**
 * Asserts min <= n < max. NOTE: It's < max and not <= max.
 * @example
 * aInRange('x', x, 1n, 256n); // would assume x is in (1n..255n)
 */
function aInRange(title, n, min, max) {
    // Why min <= n < max and not a (min < n < max) OR b (min <= n <= max)?
    // consider P=256n, min=0n, max=P
    // - a for min=0 would require -1:          `inRange('x', x, -1n, P)`
    // - b would commonly require subtraction:  `inRange('x', x, 0n, P - 1n)`
    // - our way is the cleanest:               `inRange('x', x, 0n, P)
    if (!inRange(n, min, max))
        throw new Error('expected valid ' + title + ': ' + min + ' <= n < ' + max + ', got ' + n);
}
// Bit operations
/**
 * Calculates amount of bits in a bigint.
 * Same as `n.toString(2).length`
 * TODO: merge with nLength in modular
 */
function bitLen(n) {
    let len;
    for (len = 0; n > _0n; n >>= _1n, len += 1)
        ;
    return len;
}
/**
 * Gets single bit at position.
 * NOTE: first bit position is 0 (same as arrays)
 * Same as `!!+Array.from(n.toString(2)).reverse()[pos]`
 */
function bitGet(n, pos) {
    return (n >> BigInt(pos)) & _1n;
}
/**
 * Sets single bit at position.
 */
function bitSet(n, pos, value) {
    return n | ((value ? _1n : _0n) << BigInt(pos));
}
/**
 * Calculate mask for N bits. Not using ** operator with bigints because of old engines.
 * Same as BigInt(`0b${Array(i).fill('1').join('')}`)
 */
const bitMask = (n) => (_1n << BigInt(n)) - _1n;
exports.bitMask = bitMask;
/**
 * Minimal HMAC-DRBG from NIST 800-90 for RFC6979 sigs.
 * @returns function that will call DRBG until 2nd arg returns something meaningful
 * @example
 *   const drbg = createHmacDRBG<Key>(32, 32, hmac);
 *   drbg(seed, bytesToKey); // bytesToKey must return Key or undefined
 */
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
    if (typeof hashLen !== 'number' || hashLen < 2)
        throw new Error('hashLen must be a number');
    if (typeof qByteLen !== 'number' || qByteLen < 2)
        throw new Error('qByteLen must be a number');
    if (typeof hmacFn !== 'function')
        throw new Error('hmacFn must be a function');
    // Step B, Step C: set hashLen to 8*ceil(hlen/8)
    const u8n = (len) => new Uint8Array(len); // creates Uint8Array
    const u8of = (byte) => Uint8Array.of(byte); // another shortcut
    let v = u8n(hashLen); // Minimal non-full-spec HMAC-DRBG from NIST 800-90 for RFC6979 sigs.
    let k = u8n(hashLen); // Steps B and C of RFC6979 3.2: set hashLen, in our case always same
    let i = 0; // Iterations counter, will throw when over 1000
    const reset = () => {
        v.fill(1);
        k.fill(0);
        i = 0;
    };
    const h = (...b) => hmacFn(k, v, ...b); // hmac(k)(v, ...values)
    const reseed = (seed = u8n(0)) => {
        // HMAC-DRBG reseed() function. Steps D-G
        k = h(u8of(0x00), seed); // k = hmac(k || v || 0x00 || seed)
        v = h(); // v = hmac(k || v)
        if (seed.length === 0)
            return;
        k = h(u8of(0x01), seed); // k = hmac(k || v || 0x01 || seed)
        v = h(); // v = hmac(k || v)
    };
    const gen = () => {
        // HMAC-DRBG generate() function
        if (i++ >= 1000)
            throw new Error('drbg: tried 1000 values');
        let len = 0;
        const out = [];
        while (len < qByteLen) {
            v = h();
            const sl = v.slice();
            out.push(sl);
            len += v.length;
        }
        return (0, utils_js_1.concatBytes)(...out);
    };
    const genUntil = (seed, pred) => {
        reset();
        reseed(seed); // Steps D-G
        let res = undefined; // Step H: grind until k is in [1..n-1]
        while (!(res = pred(gen())))
            reseed();
        reset();
        return res;
    };
    return genUntil;
}
// Validating curves and fields
const validatorFns = {
    bigint: (val) => typeof val === 'bigint',
    function: (val) => typeof val === 'function',
    boolean: (val) => typeof val === 'boolean',
    string: (val) => typeof val === 'string',
    stringOrUint8Array: (val) => typeof val === 'string' || (0, utils_js_1.isBytes)(val),
    isSafeInteger: (val) => Number.isSafeInteger(val),
    array: (val) => Array.isArray(val),
    field: (val, object) => object.Fp.isValid(val),
    hash: (val) => typeof val === 'function' && Number.isSafeInteger(val.outputLen),
};
// type Record<K extends string | number | symbol, T> = { [P in K]: T; }
function validateObject(object, validators, optValidators = {}) {
    const checkField = (fieldName, type, isOptional) => {
        const checkVal = validatorFns[type];
        if (typeof checkVal !== 'function')
            throw new Error('invalid validator function');
        const val = object[fieldName];
        if (isOptional && val === undefined)
            return;
        if (!checkVal(val, object)) {
            throw new Error('param ' + String(fieldName) + ' is invalid. Expected ' + type + ', got ' + val);
        }
    };
    for (const [fieldName, type] of Object.entries(validators))
        checkField(fieldName, type, false);
    for (const [fieldName, type] of Object.entries(optValidators))
        checkField(fieldName, type, true);
    return object;
}
// validate type tests
// const o: { a: number; b: number; c: number } = { a: 1, b: 5, c: 6 };
// const z0 = validateObject(o, { a: 'isSafeInteger' }, { c: 'bigint' }); // Ok!
// // Should fail type-check
// const z1 = validateObject(o, { a: 'tmp' }, { c: 'zz' });
// const z2 = validateObject(o, { a: 'isSafeInteger' }, { c: 'zz' });
// const z3 = validateObject(o, { test: 'boolean', z: 'bug' });
// const z4 = validateObject(o, { a: 'boolean', z: 'bug' });
function isHash(val) {
    return typeof val === 'function' && Number.isSafeInteger(val.outputLen);
}
function _validateObject(object, fields, optFields = {}) {
    if (!object || typeof object !== 'object')
        throw new Error('expected valid options object');
    function checkField(fieldName, expectedType, isOpt) {
        const val = object[fieldName];
        if (isOpt && val === undefined)
            return;
        const current = typeof val;
        if (current !== expectedType || val === null)
            throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
    }
    Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
    Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
/**
 * throws not implemented error
 */
const notImplemented = () => {
    throw new Error('not implemented');
};
exports.notImplemented = notImplemented;
/**
 * Memoizes (caches) computation result.
 * Uses WeakMap: the value is going auto-cleaned by GC after last reference is removed.
 */
function memoized(fn) {
    const map = new WeakMap();
    return (arg, ...args) => {
        const val = map.get(arg);
        if (val !== undefined)
            return val;
        const computed = fn(arg, ...args);
        map.set(arg, computed);
        return computed;
    };
}
//# sourceMappingURL=utils.js.map
    },
    21: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wNAF = void 0;
exports.negateCt = negateCt;
exports.normalizeZ = normalizeZ;
exports.mulEndoUnsafe = mulEndoUnsafe;
exports.pippenger = pippenger;
exports.precomputeMSMUnsafe = precomputeMSMUnsafe;
exports.validateBasic = validateBasic;
exports._createCurveFields = _createCurveFields;
/**
 * Methods for elliptic curve multiplication by scalars.
 * Contains wNAF, pippenger.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
const modular_ts_1 = require("./modular.js");
const _0n = BigInt(0);
const _1n = BigInt(1);
function negateCt(condition, item) {
    const neg = item.negate();
    return condition ? neg : item;
}
/**
 * Takes a bunch of Projective Points but executes only one
 * inversion on all of them. Inversion is very slow operation,
 * so this improves performance massively.
 * Optimization: converts a list of projective points to a list of identical points with Z=1.
 */
function normalizeZ(c, points) {
    const invertedZs = (0, modular_ts_1.FpInvertBatch)(c.Fp, points.map((p) => p.Z));
    return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
    if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
        throw new Error('invalid window size, expected [1..' + bits + '], got W=' + W);
}
function calcWOpts(W, scalarBits) {
    validateW(W, scalarBits);
    const windows = Math.ceil(scalarBits / W) + 1; // W=8 33. Not 32, because we skip zero
    const windowSize = 2 ** (W - 1); // W=8 128. Not 256, because we skip zero
    const maxNumber = 2 ** W; // W=8 256
    const mask = (0, utils_ts_1.bitMask)(W); // W=8 255 == mask 0b11111111
    const shiftBy = BigInt(W); // W=8 8
    return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
    const { windowSize, mask, maxNumber, shiftBy } = wOpts;
    let wbits = Number(n & mask); // extract W bits.
    let nextN = n >> shiftBy; // shift number by W bits.
    // What actually happens here:
    // const highestBit = Number(mask ^ (mask >> 1n));
    // let wbits2 = wbits - 1; // skip zero
    // if (wbits2 & highestBit) { wbits2 ^= Number(mask); // (~);
    // split if bits > max: +224 => 256-32
    if (wbits > windowSize) {
        // we skip zero, which means instead of `>= size-1`, we do `> size`
        wbits -= maxNumber; // -32, can be maxNumber - wbits, but then we need to set isNeg here.
        nextN += _1n; // +256 (carry)
    }
    const offsetStart = window * windowSize;
    const offset = offsetStart + Math.abs(wbits) - 1; // -1 because we skip zero
    const isZero = wbits === 0; // is current window slice a 0?
    const isNeg = wbits < 0; // is current window slice negative?
    const isNegF = window % 2 !== 0; // fake random statement for noise
    const offsetF = offsetStart; // fake offset for noise
    return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
    if (!Array.isArray(points))
        throw new Error('array expected');
    points.forEach((p, i) => {
        if (!(p instanceof c))
            throw new Error('invalid point at index ' + i);
    });
}
function validateMSMScalars(scalars, field) {
    if (!Array.isArray(scalars))
        throw new Error('array of scalars expected');
    scalars.forEach((s, i) => {
        if (!field.isValid(s))
            throw new Error('invalid scalar at index ' + i);
    });
}
// Since points in different groups cannot be equal (different object constructor),
// we can have single place to store precomputes.
// Allows to make points frozen / immutable.
const pointPrecomputes = new WeakMap();
const pointWindowSizes = new WeakMap();
function getW(P) {
    // To disable precomputes:
    // return 1;
    return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
    if (n !== _0n)
        throw new Error('invalid wNAF');
}
/**
 * Elliptic curve multiplication of Point by scalar. Fragile.
 * Table generation takes **30MB of ram and 10ms on high-end CPU**,
 * but may take much longer on slow devices. Actual generation will happen on
 * first call of `multiply()`. By default, `BASE` point is precomputed.
 *
 * Scalars should always be less than curve order: this should be checked inside of a curve itself.
 * Creates precomputation tables for fast multiplication:
 * - private scalar is split by fixed size windows of W bits
 * - every window point is collected from window's table & added to accumulator
 * - since windows are different, same point inside tables won't be accessed more than once per calc
 * - each multiplication is 'Math.ceil(CURVE_ORDER / 𝑊) + 1' point additions (fixed for any scalar)
 * - +1 window is neccessary for wNAF
 * - wNAF reduces table size: 2x less memory + 2x faster generation, but 10% slower multiplication
 *
 * @todo Research returning 2d JS array of windows, instead of a single window.
 * This would allow windows to be in different memory locations
 */
class wNAF {
    // Parametrized with a given Point class (not individual point)
    constructor(Point, bits) {
        this.BASE = Point.BASE;
        this.ZERO = Point.ZERO;
        this.Fn = Point.Fn;
        this.bits = bits;
    }
    // non-const time multiplication ladder
    _unsafeLadder(elm, n, p = this.ZERO) {
        let d = elm;
        while (n > _0n) {
            if (n & _1n)
                p = p.add(d);
            d = d.double();
            n >>= _1n;
        }
        return p;
    }
    /**
     * Creates a wNAF precomputation window. Used for caching.
     * Default window size is set by `utils.precompute()` and is equal to 8.
     * Number of precomputed points depends on the curve size:
     * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
     * - 𝑊 is the window size
     * - 𝑛 is the bitlength of the curve order.
     * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
     * @param point Point instance
     * @param W window size
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(point, W) {
        const { windows, windowSize } = calcWOpts(W, this.bits);
        const points = [];
        let p = point;
        let base = p;
        for (let window = 0; window < windows; window++) {
            base = p;
            points.push(base);
            // i=1, bc we skip 0
            for (let i = 1; i < windowSize; i++) {
                base = base.add(p);
                points.push(base);
            }
            p = base.double();
        }
        return points;
    }
    /**
     * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
     * More compact implementation:
     * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
     * @returns real and fake (for const-time) points
     */
    wNAF(W, precomputes, n) {
        // Scalar should be smaller than field order
        if (!this.Fn.isValid(n))
            throw new Error('invalid scalar');
        // Accumulators
        let p = this.ZERO;
        let f = this.BASE;
        // This code was first written with assumption that 'f' and 'p' will never be infinity point:
        // since each addition is multiplied by 2 ** W, it cannot cancel each other. However,
        // there is negate now: it is possible that negated element from low value
        // would be the same as high element, which will create carry into next window.
        // It's not obvious how this can fail, but still worth investigating later.
        const wo = calcWOpts(W, this.bits);
        for (let window = 0; window < wo.windows; window++) {
            // (n === _0n) is handled and not early-exited. isEven and offsetF are used for noise
            const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
            n = nextN;
            if (isZero) {
                // bits are 0: add garbage to fake point
                // Important part for const-time getPublicKey: add random "noise" point to f.
                f = f.add(negateCt(isNegF, precomputes[offsetF]));
            }
            else {
                // bits are 1: add to result point
                p = p.add(negateCt(isNeg, precomputes[offset]));
            }
        }
        assert0(n);
        // Return both real and fake points: JIT won't eliminate f.
        // At this point there is a way to F be infinity-point even if p is not,
        // which makes it less const-time: around 1 bigint multiply.
        return { p, f };
    }
    /**
     * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
     * @param acc accumulator point to add result of multiplication
     * @returns point
     */
    wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
        const wo = calcWOpts(W, this.bits);
        for (let window = 0; window < wo.windows; window++) {
            if (n === _0n)
                break; // Early-exit, skip 0 value
            const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
            n = nextN;
            if (isZero) {
                // Window bits are 0: skip processing.
                // Move to next window.
                continue;
            }
            else {
                const item = precomputes[offset];
                acc = acc.add(isNeg ? item.negate() : item); // Re-using acc allows to save adds in MSM
            }
        }
        assert0(n);
        return acc;
    }
    getPrecomputes(W, point, transform) {
        // Calculate precomputes on a first run, reuse them after
        let comp = pointPrecomputes.get(point);
        if (!comp) {
            comp = this.precomputeWindow(point, W);
            if (W !== 1) {
                // Doing transform outside of if brings 15% perf hit
                if (typeof transform === 'function')
                    comp = transform(comp);
                pointPrecomputes.set(point, comp);
            }
        }
        return comp;
    }
    cached(point, scalar, transform) {
        const W = getW(point);
        return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
    }
    unsafe(point, scalar, transform, prev) {
        const W = getW(point);
        if (W === 1)
            return this._unsafeLadder(point, scalar, prev); // For W=1 ladder is ~x2 faster
        return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
    }
    // We calculate precomputes for elliptic curve point multiplication
    // using windowed method. This specifies window size and
    // stores precomputed values. Usually only base point would be precomputed.
    createCache(P, W) {
        validateW(W, this.bits);
        pointWindowSizes.set(P, W);
        pointPrecomputes.delete(P);
    }
    hasCache(elm) {
        return getW(elm) !== 1;
    }
}
exports.wNAF = wNAF;
/**
 * Endomorphism-specific multiplication for Koblitz curves.
 * Cost: 128 dbl, 0-256 adds.
 */
function mulEndoUnsafe(Point, point, k1, k2) {
    let acc = point;
    let p1 = Point.ZERO;
    let p2 = Point.ZERO;
    while (k1 > _0n || k2 > _0n) {
        if (k1 & _1n)
            p1 = p1.add(acc);
        if (k2 & _1n)
            p2 = p2.add(acc);
        acc = acc.double();
        k1 >>= _1n;
        k2 >>= _1n;
    }
    return { p1, p2 };
}
/**
 * Pippenger algorithm for multi-scalar multiplication (MSM, Pa + Qb + Rc + ...).
 * 30x faster vs naive addition on L=4096, 10x faster than precomputes.
 * For N=254bit, L=1, it does: 1024 ADD + 254 DBL. For L=5: 1536 ADD + 254 DBL.
 * Algorithmically constant-time (for same L), even when 1 point + scalar, or when scalar = 0.
 * @param c Curve Point constructor
 * @param fieldN field over CURVE.N - important that it's not over CURVE.P
 * @param points array of L curve points
 * @param scalars array of L scalars (aka secret keys / bigints)
 */
function pippenger(c, fieldN, points, scalars) {
    // If we split scalars by some window (let's say 8 bits), every chunk will only
    // take 256 buckets even if there are 4096 scalars, also re-uses double.
    // TODO:
    // - https://eprint.iacr.org/2024/750.pdf
    // - https://tches.iacr.org/index.php/TCHES/article/view/10287
    // 0 is accepted in scalars
    validateMSMPoints(points, c);
    validateMSMScalars(scalars, fieldN);
    const plength = points.length;
    const slength = scalars.length;
    if (plength !== slength)
        throw new Error('arrays of points and scalars must have equal length');
    // if (plength === 0) throw new Error('array must be of length >= 2');
    const zero = c.ZERO;
    const wbits = (0, utils_ts_1.bitLen)(BigInt(plength));
    let windowSize = 1; // bits
    if (wbits > 12)
        windowSize = wbits - 3;
    else if (wbits > 4)
        windowSize = wbits - 2;
    else if (wbits > 0)
        windowSize = 2;
    const MASK = (0, utils_ts_1.bitMask)(windowSize);
    const buckets = new Array(Number(MASK) + 1).fill(zero); // +1 for zero array
    const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
    let sum = zero;
    for (let i = lastBits; i >= 0; i -= windowSize) {
        buckets.fill(zero);
        for (let j = 0; j < slength; j++) {
            const scalar = scalars[j];
            const wbits = Number((scalar >> BigInt(i)) & MASK);
            buckets[wbits] = buckets[wbits].add(points[j]);
        }
        let resI = zero; // not using this will do small speed-up, but will lose ct
        // Skip first bucket, because it is zero
        for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
            sumI = sumI.add(buckets[j]);
            resI = resI.add(sumI);
        }
        sum = sum.add(resI);
        if (i !== 0)
            for (let j = 0; j < windowSize; j++)
                sum = sum.double();
    }
    return sum;
}
/**
 * Precomputed multi-scalar multiplication (MSM, Pa + Qb + Rc + ...).
 * @param c Curve Point constructor
 * @param fieldN field over CURVE.N - important that it's not over CURVE.P
 * @param points array of L curve points
 * @returns function which multiplies points with scaars
 */
function precomputeMSMUnsafe(c, fieldN, points, windowSize) {
    /**
     * Performance Analysis of Window-based Precomputation
     *
     * Base Case (256-bit scalar, 8-bit window):
     * - Standard precomputation requires:
     *   - 31 additions per scalar × 256 scalars = 7,936 ops
     *   - Plus 255 summary additions = 8,191 total ops
     *   Note: Summary additions can be optimized via accumulator
     *
     * Chunked Precomputation Analysis:
     * - Using 32 chunks requires:
     *   - 255 additions per chunk
     *   - 256 doublings
     *   - Total: (255 × 32) + 256 = 8,416 ops
     *
     * Memory Usage Comparison:
     * Window Size | Standard Points | Chunked Points
     * ------------|-----------------|---------------
     *     4-bit   |     520         |      15
     *     8-bit   |    4,224        |     255
     *    10-bit   |   13,824        |   1,023
     *    16-bit   |  557,056        |  65,535
     *
     * Key Advantages:
     * 1. Enables larger window sizes due to reduced memory overhead
     * 2. More efficient for smaller scalar counts:
     *    - 16 chunks: (16 × 255) + 256 = 4,336 ops
     *    - ~2x faster than standard 8,191 ops
     *
     * Limitations:
     * - Not suitable for plain precomputes (requires 256 constant doublings)
     * - Performance degrades with larger scalar counts:
     *   - Optimal for ~256 scalars
     *   - Less efficient for 4096+ scalars (Pippenger preferred)
     */
    validateW(windowSize, fieldN.BITS);
    validateMSMPoints(points, c);
    const zero = c.ZERO;
    const tableSize = 2 ** windowSize - 1; // table size (without zero)
    const chunks = Math.ceil(fieldN.BITS / windowSize); // chunks of item
    const MASK = (0, utils_ts_1.bitMask)(windowSize);
    const tables = points.map((p) => {
        const res = [];
        for (let i = 0, acc = p; i < tableSize; i++) {
            res.push(acc);
            acc = acc.add(p);
        }
        return res;
    });
    return (scalars) => {
        validateMSMScalars(scalars, fieldN);
        if (scalars.length > points.length)
            throw new Error('array of scalars must be smaller than array of points');
        let res = zero;
        for (let i = 0; i < chunks; i++) {
            // No need to double if accumulator is still zero.
            if (res !== zero)
                for (let j = 0; j < windowSize; j++)
                    res = res.double();
            const shiftBy = BigInt(chunks * windowSize - (i + 1) * windowSize);
            for (let j = 0; j < scalars.length; j++) {
                const n = scalars[j];
                const curr = Number((n >> shiftBy) & MASK);
                if (!curr)
                    continue; // skip zero scalars chunks
                res = res.add(tables[j][curr - 1]);
            }
        }
        return res;
    };
}
// TODO: remove
/** @deprecated */
function validateBasic(curve) {
    (0, modular_ts_1.validateField)(curve.Fp);
    (0, utils_ts_1.validateObject)(curve, {
        n: 'bigint',
        h: 'bigint',
        Gx: 'field',
        Gy: 'field',
    }, {
        nBitLength: 'isSafeInteger',
        nByteLength: 'isSafeInteger',
    });
    // Set defaults
    return Object.freeze({
        ...(0, modular_ts_1.nLength)(curve.n, curve.nBitLength),
        ...curve,
        ...{ p: curve.Fp.ORDER },
    });
}
function createField(order, field, isLE) {
    if (field) {
        if (field.ORDER !== order)
            throw new Error('Field.ORDER must match order: Fp == p, Fn == n');
        (0, modular_ts_1.validateField)(field);
        return field;
    }
    else {
        return (0, modular_ts_1.Field)(order, { isLE });
    }
}
/** Validates CURVE opts and creates fields */
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
    if (FpFnLE === undefined)
        FpFnLE = type === 'edwards';
    if (!CURVE || typeof CURVE !== 'object')
        throw new Error(`expected valid ${type} CURVE object`);
    for (const p of ['p', 'n', 'h']) {
        const val = CURVE[p];
        if (!(typeof val === 'bigint' && val > _0n))
            throw new Error(`CURVE.${p} must be positive bigint`);
    }
    const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
    const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
    const _b = type === 'weierstrass' ? 'b' : 'd';
    const params = ['Gx', 'Gy', 'a', _b];
    for (const p of params) {
        // @ts-ignore
        if (!Fp.isValid(CURVE[p]))
            throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
    }
    CURVE = Object.freeze(Object.assign({}, CURVE));
    return { CURVE, Fp, Fn };
}
//# sourceMappingURL=curve.js.map
    },
    22: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNegativeLE = void 0;
exports.mod = mod;
exports.pow = pow;
exports.pow2 = pow2;
exports.invert = invert;
exports.tonelliShanks = tonelliShanks;
exports.FpSqrt = FpSqrt;
exports.validateField = validateField;
exports.FpPow = FpPow;
exports.FpInvertBatch = FpInvertBatch;
exports.FpDiv = FpDiv;
exports.FpLegendre = FpLegendre;
exports.FpIsSquare = FpIsSquare;
exports.nLength = nLength;
exports.Field = Field;
exports.FpSqrtOdd = FpSqrtOdd;
exports.FpSqrtEven = FpSqrtEven;
exports.hashToPrivateScalar = hashToPrivateScalar;
exports.getFieldBytesLength = getFieldBytesLength;
exports.getMinHashLength = getMinHashLength;
exports.mapHashToField = mapHashToField;
/**
 * Utils for modular division and fields.
 * Field over 11 is a finite (Galois) field is integer number operations `mod 11`.
 * There is no division: it is replaced by modular multiplicative inverse.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = /* @__PURE__ */ BigInt(2), _3n = /* @__PURE__ */ BigInt(3);
// prettier-ignore
const _4n = /* @__PURE__ */ BigInt(4), _5n = /* @__PURE__ */ BigInt(5), _7n = /* @__PURE__ */ BigInt(7);
// prettier-ignore
const _8n = /* @__PURE__ */ BigInt(8), _9n = /* @__PURE__ */ BigInt(9), _16n = /* @__PURE__ */ BigInt(16);
// Calculates a modulo b
function mod(a, b) {
    const result = a % b;
    return result >= _0n ? result : b + result;
}
/**
 * Efficiently raise num to power and do modular division.
 * Unsafe in some contexts: uses ladder, so can expose bigint bits.
 * @example
 * pow(2n, 6n, 11n) // 64n % 11n == 9n
 */
function pow(num, power, modulo) {
    return FpPow(Field(modulo), num, power);
}
/** Does `x^(2^power)` mod p. `pow2(30, 4)` == `30^(2^4)` */
function pow2(x, power, modulo) {
    let res = x;
    while (power-- > _0n) {
        res *= res;
        res %= modulo;
    }
    return res;
}
/**
 * Inverses number over modulo.
 * Implemented using [Euclidean GCD](https://brilliant.org/wiki/extended-euclidean-algorithm/).
 */
function invert(number, modulo) {
    if (number === _0n)
        throw new Error('invert: expected non-zero number');
    if (modulo <= _0n)
        throw new Error('invert: expected positive modulus, got ' + modulo);
    // Fermat's little theorem "CT-like" version inv(n) = n^(m-2) mod m is 30x slower.
    let a = mod(number, modulo);
    let b = modulo;
    // prettier-ignore
    let x = _0n, y = _1n, u = _1n, v = _0n;
    while (a !== _0n) {
        // JIT applies optimization if those two lines follow each other
        const q = b / a;
        const r = b % a;
        const m = x - u * q;
        const n = y - v * q;
        // prettier-ignore
        b = a, a = r, x = u, y = v, u = m, v = n;
    }
    const gcd = b;
    if (gcd !== _1n)
        throw new Error('invert: does not exist');
    return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
    if (!Fp.eql(Fp.sqr(root), n))
        throw new Error('Cannot find square root');
}
// Not all roots are possible! Example which will throw:
// const NUM =
// n = 72057594037927816n;
// Fp = Field(BigInt('0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab'));
function sqrt3mod4(Fp, n) {
    const p1div4 = (Fp.ORDER + _1n) / _4n;
    const root = Fp.pow(n, p1div4);
    assertIsSquare(Fp, root, n);
    return root;
}
function sqrt5mod8(Fp, n) {
    const p5div8 = (Fp.ORDER - _5n) / _8n;
    const n2 = Fp.mul(n, _2n);
    const v = Fp.pow(n2, p5div8);
    const nv = Fp.mul(n, v);
    const i = Fp.mul(Fp.mul(nv, _2n), v);
    const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
    assertIsSquare(Fp, root, n);
    return root;
}
// Based on RFC9380, Kong algorithm
// prettier-ignore
function sqrt9mod16(P) {
    const Fp_ = Field(P);
    const tn = tonelliShanks(P);
    const c1 = tn(Fp_, Fp_.neg(Fp_.ONE)); //  1. c1 = sqrt(-1) in F, i.e., (c1^2) == -1 in F
    const c2 = tn(Fp_, c1); //  2. c2 = sqrt(c1) in F, i.e., (c2^2) == c1 in F
    const c3 = tn(Fp_, Fp_.neg(c1)); //  3. c3 = sqrt(-c1) in F, i.e., (c3^2) == -c1 in F
    const c4 = (P + _7n) / _16n; //  4. c4 = (q + 7) / 16        # Integer arithmetic
    return (Fp, n) => {
        let tv1 = Fp.pow(n, c4); //  1. tv1 = x^c4
        let tv2 = Fp.mul(tv1, c1); //  2. tv2 = c1 * tv1
        const tv3 = Fp.mul(tv1, c2); //  3. tv3 = c2 * tv1
        const tv4 = Fp.mul(tv1, c3); //  4. tv4 = c3 * tv1
        const e1 = Fp.eql(Fp.sqr(tv2), n); //  5.  e1 = (tv2^2) == x
        const e2 = Fp.eql(Fp.sqr(tv3), n); //  6.  e2 = (tv3^2) == x
        tv1 = Fp.cmov(tv1, tv2, e1); //  7. tv1 = CMOV(tv1, tv2, e1)  # Select tv2 if (tv2^2) == x
        tv2 = Fp.cmov(tv4, tv3, e2); //  8. tv2 = CMOV(tv4, tv3, e2)  # Select tv3 if (tv3^2) == x
        const e3 = Fp.eql(Fp.sqr(tv2), n); //  9.  e3 = (tv2^2) == x
        const root = Fp.cmov(tv1, tv2, e3); // 10.  z = CMOV(tv1, tv2, e3)   # Select sqrt from tv1 & tv2
        assertIsSquare(Fp, root, n);
        return root;
    };
}
/**
 * Tonelli-Shanks square root search algorithm.
 * 1. https://eprint.iacr.org/2012/685.pdf (page 12)
 * 2. Square Roots from 1; 24, 51, 10 to Dan Shanks
 * @param P field order
 * @returns function that takes field Fp (created from P) and number n
 */
function tonelliShanks(P) {
    // Initialization (precomputation).
    // Caching initialization could boost perf by 7%.
    if (P < _3n)
        throw new Error('sqrt is not defined for small field');
    // Factor P - 1 = Q * 2^S, where Q is odd
    let Q = P - _1n;
    let S = 0;
    while (Q % _2n === _0n) {
        Q /= _2n;
        S++;
    }
    // Find the first quadratic non-residue Z >= 2
    let Z = _2n;
    const _Fp = Field(P);
    while (FpLegendre(_Fp, Z) === 1) {
        // Basic primality test for P. After x iterations, chance of
        // not finding quadratic non-residue is 2^x, so 2^1000.
        if (Z++ > 1000)
            throw new Error('Cannot find square root: probably non-prime P');
    }
    // Fast-path; usually done before Z, but we do "primality test".
    if (S === 1)
        return sqrt3mod4;
    // Slow-path
    // TODO: test on Fp2 and others
    let cc = _Fp.pow(Z, Q); // c = z^Q
    const Q1div2 = (Q + _1n) / _2n;
    return function tonelliSlow(Fp, n) {
        if (Fp.is0(n))
            return n;
        // Check if n is a quadratic residue using Legendre symbol
        if (FpLegendre(Fp, n) !== 1)
            throw new Error('Cannot find square root');
        // Initialize variables for the main loop
        let M = S;
        let c = Fp.mul(Fp.ONE, cc); // c = z^Q, move cc from field _Fp into field Fp
        let t = Fp.pow(n, Q); // t = n^Q, first guess at the fudge factor
        let R = Fp.pow(n, Q1div2); // R = n^((Q+1)/2), first guess at the square root
        // Main loop
        // while t != 1
        while (!Fp.eql(t, Fp.ONE)) {
            if (Fp.is0(t))
                return Fp.ZERO; // if t=0 return R=0
            let i = 1;
            // Find the smallest i >= 1 such that t^(2^i) ≡ 1 (mod P)
            let t_tmp = Fp.sqr(t); // t^(2^1)
            while (!Fp.eql(t_tmp, Fp.ONE)) {
                i++;
                t_tmp = Fp.sqr(t_tmp); // t^(2^2)...
                if (i === M)
                    throw new Error('Cannot find square root');
            }
            // Calculate the exponent for b: 2^(M - i - 1)
            const exponent = _1n << BigInt(M - i - 1); // bigint is important
            const b = Fp.pow(c, exponent); // b = 2^(M - i - 1)
            // Update variables
            M = i;
            c = Fp.sqr(b); // c = b^2
            t = Fp.mul(t, c); // t = (t * b^2)
            R = Fp.mul(R, b); // R = R*b
        }
        return R;
    };
}
/**
 * Square root for a finite field. Will try optimized versions first:
 *
 * 1. P ≡ 3 (mod 4)
 * 2. P ≡ 5 (mod 8)
 * 3. P ≡ 9 (mod 16)
 * 4. Tonelli-Shanks algorithm
 *
 * Different algorithms can give different roots, it is up to user to decide which one they want.
 * For example there is FpSqrtOdd/FpSqrtEven to choice root based on oddness (used for hash-to-curve).
 */
function FpSqrt(P) {
    // P ≡ 3 (mod 4) => √n = n^((P+1)/4)
    if (P % _4n === _3n)
        return sqrt3mod4;
    // P ≡ 5 (mod 8) => Atkin algorithm, page 10 of https://eprint.iacr.org/2012/685.pdf
    if (P % _8n === _5n)
        return sqrt5mod8;
    // P ≡ 9 (mod 16) => Kong algorithm, page 11 of https://eprint.iacr.org/2012/685.pdf (algorithm 4)
    if (P % _16n === _9n)
        return sqrt9mod16(P);
    // Tonelli-Shanks algorithm
    return tonelliShanks(P);
}
// Little-endian check for first LE bit (last BE bit);
const isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n) === _1n;
exports.isNegativeLE = isNegativeLE;
// prettier-ignore
const FIELD_FIELDS = [
    'create', 'isValid', 'is0', 'neg', 'inv', 'sqrt', 'sqr',
    'eql', 'add', 'sub', 'mul', 'pow', 'div',
    'addN', 'subN', 'mulN', 'sqrN'
];
function validateField(field) {
    const initial = {
        ORDER: 'bigint',
        MASK: 'bigint',
        BYTES: 'number',
        BITS: 'number',
    };
    const opts = FIELD_FIELDS.reduce((map, val) => {
        map[val] = 'function';
        return map;
    }, initial);
    (0, utils_ts_1._validateObject)(field, opts);
    // const max = 16384;
    // if (field.BYTES < 1 || field.BYTES > max) throw new Error('invalid field');
    // if (field.BITS < 1 || field.BITS > 8 * max) throw new Error('invalid field');
    return field;
}
// Generic field functions
/**
 * Same as `pow` but for Fp: non-constant-time.
 * Unsafe in some contexts: uses ladder, so can expose bigint bits.
 */
function FpPow(Fp, num, power) {
    if (power < _0n)
        throw new Error('invalid exponent, negatives unsupported');
    if (power === _0n)
        return Fp.ONE;
    if (power === _1n)
        return num;
    let p = Fp.ONE;
    let d = num;
    while (power > _0n) {
        if (power & _1n)
            p = Fp.mul(p, d);
        d = Fp.sqr(d);
        power >>= _1n;
    }
    return p;
}
/**
 * Efficiently invert an array of Field elements.
 * Exception-free. Will return `undefined` for 0 elements.
 * @param passZero map 0 to 0 (instead of undefined)
 */
function FpInvertBatch(Fp, nums, passZero = false) {
    const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : undefined);
    // Walk from first to last, multiply them by each other MOD p
    const multipliedAcc = nums.reduce((acc, num, i) => {
        if (Fp.is0(num))
            return acc;
        inverted[i] = acc;
        return Fp.mul(acc, num);
    }, Fp.ONE);
    // Invert last element
    const invertedAcc = Fp.inv(multipliedAcc);
    // Walk from last to first, multiply them by inverted each other MOD p
    nums.reduceRight((acc, num, i) => {
        if (Fp.is0(num))
            return acc;
        inverted[i] = Fp.mul(acc, inverted[i]);
        return Fp.mul(acc, num);
    }, invertedAcc);
    return inverted;
}
// TODO: remove
function FpDiv(Fp, lhs, rhs) {
    return Fp.mul(lhs, typeof rhs === 'bigint' ? invert(rhs, Fp.ORDER) : Fp.inv(rhs));
}
/**
 * Legendre symbol.
 * Legendre constant is used to calculate Legendre symbol (a | p)
 * which denotes the value of a^((p-1)/2) (mod p).
 *
 * * (a | p) ≡ 1    if a is a square (mod p), quadratic residue
 * * (a | p) ≡ -1   if a is not a square (mod p), quadratic non residue
 * * (a | p) ≡ 0    if a ≡ 0 (mod p)
 */
function FpLegendre(Fp, n) {
    // We can use 3rd argument as optional cache of this value
    // but seems unneeded for now. The operation is very fast.
    const p1mod2 = (Fp.ORDER - _1n) / _2n;
    const powered = Fp.pow(n, p1mod2);
    const yes = Fp.eql(powered, Fp.ONE);
    const zero = Fp.eql(powered, Fp.ZERO);
    const no = Fp.eql(powered, Fp.neg(Fp.ONE));
    if (!yes && !zero && !no)
        throw new Error('invalid Legendre symbol result');
    return yes ? 1 : zero ? 0 : -1;
}
// This function returns True whenever the value x is a square in the field F.
function FpIsSquare(Fp, n) {
    const l = FpLegendre(Fp, n);
    return l === 1;
}
// CURVE.n lengths
function nLength(n, nBitLength) {
    // Bit size, byte size of CURVE.n
    if (nBitLength !== undefined)
        (0, utils_ts_1.anumber)(nBitLength);
    const _nBitLength = nBitLength !== undefined ? nBitLength : n.toString(2).length;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
}
/**
 * Creates a finite field. Major performance optimizations:
 * * 1. Denormalized operations like mulN instead of mul.
 * * 2. Identical object shape: never add or remove keys.
 * * 3. `Object.freeze`.
 * Fragile: always run a benchmark on a change.
 * Security note: operations don't check 'isValid' for all elements for performance reasons,
 * it is caller responsibility to check this.
 * This is low-level code, please make sure you know what you're doing.
 *
 * Note about field properties:
 * * CHARACTERISTIC p = prime number, number of elements in main subgroup.
 * * ORDER q = similar to cofactor in curves, may be composite `q = p^m`.
 *
 * @param ORDER field order, probably prime, or could be composite
 * @param bitLen how many bits the field consumes
 * @param isLE (default: false) if encoding / decoding should be in little-endian
 * @param redef optional faster redefinitions of sqrt and other methods
 */
function Field(ORDER, bitLenOrOpts, // TODO: use opts only in v2?
isLE = false, opts = {}) {
    if (ORDER <= _0n)
        throw new Error('invalid field: expected ORDER > 0, got ' + ORDER);
    let _nbitLength = undefined;
    let _sqrt = undefined;
    let modFromBytes = false;
    let allowedLengths = undefined;
    if (typeof bitLenOrOpts === 'object' && bitLenOrOpts != null) {
        if (opts.sqrt || isLE)
            throw new Error('cannot specify opts in two arguments');
        const _opts = bitLenOrOpts;
        if (_opts.BITS)
            _nbitLength = _opts.BITS;
        if (_opts.sqrt)
            _sqrt = _opts.sqrt;
        if (typeof _opts.isLE === 'boolean')
            isLE = _opts.isLE;
        if (typeof _opts.modFromBytes === 'boolean')
            modFromBytes = _opts.modFromBytes;
        allowedLengths = _opts.allowedLengths;
    }
    else {
        if (typeof bitLenOrOpts === 'number')
            _nbitLength = bitLenOrOpts;
        if (opts.sqrt)
            _sqrt = opts.sqrt;
    }
    const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
    if (BYTES > 2048)
        throw new Error('invalid field: expected ORDER of <= 2048 bytes');
    let sqrtP; // cached sqrtP
    const f = Object.freeze({
        ORDER,
        isLE,
        BITS,
        BYTES,
        MASK: (0, utils_ts_1.bitMask)(BITS),
        ZERO: _0n,
        ONE: _1n,
        allowedLengths: allowedLengths,
        create: (num) => mod(num, ORDER),
        isValid: (num) => {
            if (typeof num !== 'bigint')
                throw new Error('invalid field element: expected bigint, got ' + typeof num);
            return _0n <= num && num < ORDER; // 0 is valid element, but it's not invertible
        },
        is0: (num) => num === _0n,
        // is valid and invertible
        isValidNot0: (num) => !f.is0(num) && f.isValid(num),
        isOdd: (num) => (num & _1n) === _1n,
        neg: (num) => mod(-num, ORDER),
        eql: (lhs, rhs) => lhs === rhs,
        sqr: (num) => mod(num * num, ORDER),
        add: (lhs, rhs) => mod(lhs + rhs, ORDER),
        sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
        mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
        pow: (num, power) => FpPow(f, num, power),
        div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
        // Same as above, but doesn't normalize
        sqrN: (num) => num * num,
        addN: (lhs, rhs) => lhs + rhs,
        subN: (lhs, rhs) => lhs - rhs,
        mulN: (lhs, rhs) => lhs * rhs,
        inv: (num) => invert(num, ORDER),
        sqrt: _sqrt ||
            ((n) => {
                if (!sqrtP)
                    sqrtP = FpSqrt(ORDER);
                return sqrtP(f, n);
            }),
        toBytes: (num) => (isLE ? (0, utils_ts_1.numberToBytesLE)(num, BYTES) : (0, utils_ts_1.numberToBytesBE)(num, BYTES)),
        fromBytes: (bytes, skipValidation = true) => {
            if (allowedLengths) {
                if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
                    throw new Error('Field.fromBytes: expected ' + allowedLengths + ' bytes, got ' + bytes.length);
                }
                const padded = new Uint8Array(BYTES);
                // isLE add 0 to right, !isLE to the left.
                padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
                bytes = padded;
            }
            if (bytes.length !== BYTES)
                throw new Error('Field.fromBytes: expected ' + BYTES + ' bytes, got ' + bytes.length);
            let scalar = isLE ? (0, utils_ts_1.bytesToNumberLE)(bytes) : (0, utils_ts_1.bytesToNumberBE)(bytes);
            if (modFromBytes)
                scalar = mod(scalar, ORDER);
            if (!skipValidation)
                if (!f.isValid(scalar))
                    throw new Error('invalid field element: outside of range 0..ORDER');
            // NOTE: we don't validate scalar here, please use isValid. This done such way because some
            // protocol may allow non-reduced scalar that reduced later or changed some other way.
            return scalar;
        },
        // TODO: we don't need it here, move out to separate fn
        invertBatch: (lst) => FpInvertBatch(f, lst),
        // We can't move this out because Fp6, Fp12 implement it
        // and it's unclear what to return in there.
        cmov: (a, b, c) => (c ? b : a),
    });
    return Object.freeze(f);
}
// Generic random scalar, we can do same for other fields if via Fp2.mul(Fp2.ONE, Fp2.random)?
// This allows unsafe methods like ignore bias or zero. These unsafe, but often used in different protocols (if deterministic RNG).
// which mean we cannot force this via opts.
// Not sure what to do with randomBytes, we can accept it inside opts if wanted.
// Probably need to export getMinHashLength somewhere?
// random(bytes?: Uint8Array, unsafeAllowZero = false, unsafeAllowBias = false) {
//   const LEN = !unsafeAllowBias ? getMinHashLength(ORDER) : BYTES;
//   if (bytes === undefined) bytes = randomBytes(LEN); // _opts.randomBytes?
//   const num = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
//   // `mod(x, 11)` can sometimes produce 0. `mod(x, 10) + 1` is the same, but no 0
//   const reduced = unsafeAllowZero ? mod(num, ORDER) : mod(num, ORDER - _1n) + _1n;
//   return reduced;
// },
function FpSqrtOdd(Fp, elm) {
    if (!Fp.isOdd)
        throw new Error("Field doesn't have isOdd");
    const root = Fp.sqrt(elm);
    return Fp.isOdd(root) ? root : Fp.neg(root);
}
function FpSqrtEven(Fp, elm) {
    if (!Fp.isOdd)
        throw new Error("Field doesn't have isOdd");
    const root = Fp.sqrt(elm);
    return Fp.isOdd(root) ? Fp.neg(root) : root;
}
/**
 * "Constant-time" private key generation utility.
 * Same as mapKeyToField, but accepts less bytes (40 instead of 48 for 32-byte field).
 * Which makes it slightly more biased, less secure.
 * @deprecated use `mapKeyToField` instead
 */
function hashToPrivateScalar(hash, groupOrder, isLE = false) {
    hash = (0, utils_ts_1.ensureBytes)('privateHash', hash);
    const hashLen = hash.length;
    const minLen = nLength(groupOrder).nByteLength + 8;
    if (minLen < 24 || hashLen < minLen || hashLen > 1024)
        throw new Error('hashToPrivateScalar: expected ' + minLen + '-1024 bytes of input, got ' + hashLen);
    const num = isLE ? (0, utils_ts_1.bytesToNumberLE)(hash) : (0, utils_ts_1.bytesToNumberBE)(hash);
    return mod(num, groupOrder - _1n) + _1n;
}
/**
 * Returns total number of bytes consumed by the field element.
 * For example, 32 bytes for usual 256-bit weierstrass curve.
 * @param fieldOrder number of field elements, usually CURVE.n
 * @returns byte length of field
 */
function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== 'bigint')
        throw new Error('field order must be bigint');
    const bitLength = fieldOrder.toString(2).length;
    return Math.ceil(bitLength / 8);
}
/**
 * Returns minimal amount of bytes that can be safely reduced
 * by field order.
 * Should be 2^-128 for 128-bit curve such as P256.
 * @param fieldOrder number of field elements, usually CURVE.n
 * @returns byte length of target hash
 */
function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
}
/**
 * "Constant-time" private key generation utility.
 * Can take (n + n/2) or more bytes of uniform input e.g. from CSPRNG or KDF
 * and convert them into private scalar, with the modulo bias being negligible.
 * Needs at least 48 bytes of input for 32-byte private key.
 * https://research.kudelskisecurity.com/2020/07/28/the-definitive-guide-to-modulo-bias-and-how-to-avoid-it/
 * FIPS 186-5, A.2 https://csrc.nist.gov/publications/detail/fips/186/5/final
 * RFC 9380, https://www.rfc-editor.org/rfc/rfc9380#section-5
 * @param hash hash output from SHA3 or a similar function
 * @param groupOrder size of subgroup - (e.g. secp256k1.CURVE.n)
 * @param isLE interpret hash bytes as LE num
 * @returns valid private scalar
 */
function mapHashToField(key, fieldOrder, isLE = false) {
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = getMinHashLength(fieldOrder);
    // No small numbers: need to understand bias story. No huge numbers: easier to detect JS timings.
    if (len < 16 || len < minLen || len > 1024)
        throw new Error('expected ' + minLen + '-1024 bytes of input, got ' + len);
    const num = isLE ? (0, utils_ts_1.bytesToNumberLE)(key) : (0, utils_ts_1.bytesToNumberBE)(key);
    // `mod(x, 11)` can sometimes produce 0. `mod(x, 10) + 1` is the same, but no 0
    const reduced = mod(num, fieldOrder - _1n) + _1n;
    return isLE ? (0, utils_ts_1.numberToBytesLE)(reduced, fieldLen) : (0, utils_ts_1.numberToBytesBE)(reduced, fieldLen);
}
//# sourceMappingURL=modular.js.map
    },
    23: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._DST_scalar = void 0;
exports.expand_message_xmd = expand_message_xmd;
exports.expand_message_xof = expand_message_xof;
exports.hash_to_field = hash_to_field;
exports.isogenyMap = isogenyMap;
exports.createHasher = createHasher;
const utils_ts_1 = require("../utils.js");
const modular_ts_1 = require("./modular.js");
// Octet Stream to Integer. "spec" implementation of os2ip is 2.5x slower vs bytesToNumberBE.
const os2ip = utils_ts_1.bytesToNumberBE;
// Integer to Octet Stream (numberToBytesBE)
function i2osp(value, length) {
    anum(value);
    anum(length);
    if (value < 0 || value >= 1 << (8 * length))
        throw new Error('invalid I2OSP input: ' + value);
    const res = Array.from({ length }).fill(0);
    for (let i = length - 1; i >= 0; i--) {
        res[i] = value & 0xff;
        value >>>= 8;
    }
    return new Uint8Array(res);
}
function strxor(a, b) {
    const arr = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
        arr[i] = a[i] ^ b[i];
    }
    return arr;
}
function anum(item) {
    if (!Number.isSafeInteger(item))
        throw new Error('number expected');
}
function normDST(DST) {
    if (!(0, utils_ts_1.isBytes)(DST) && typeof DST !== 'string')
        throw new Error('DST must be Uint8Array or string');
    return typeof DST === 'string' ? (0, utils_ts_1.utf8ToBytes)(DST) : DST;
}
/**
 * Produces a uniformly random byte string using a cryptographic hash function H that outputs b bits.
 * [RFC 9380 5.3.1](https://www.rfc-editor.org/rfc/rfc9380#section-5.3.1).
 */
function expand_message_xmd(msg, DST, lenInBytes, H) {
    (0, utils_ts_1.abytes)(msg);
    anum(lenInBytes);
    DST = normDST(DST);
    // https://www.rfc-editor.org/rfc/rfc9380#section-5.3.3
    if (DST.length > 255)
        DST = H((0, utils_ts_1.concatBytes)((0, utils_ts_1.utf8ToBytes)('H2C-OVERSIZE-DST-'), DST));
    const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
    const ell = Math.ceil(lenInBytes / b_in_bytes);
    if (lenInBytes > 65535 || ell > 255)
        throw new Error('expand_message_xmd: invalid lenInBytes');
    const DST_prime = (0, utils_ts_1.concatBytes)(DST, i2osp(DST.length, 1));
    const Z_pad = i2osp(0, r_in_bytes);
    const l_i_b_str = i2osp(lenInBytes, 2); // len_in_bytes_str
    const b = new Array(ell);
    const b_0 = H((0, utils_ts_1.concatBytes)(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
    b[0] = H((0, utils_ts_1.concatBytes)(b_0, i2osp(1, 1), DST_prime));
    for (let i = 1; i <= ell; i++) {
        const args = [strxor(b_0, b[i - 1]), i2osp(i + 1, 1), DST_prime];
        b[i] = H((0, utils_ts_1.concatBytes)(...args));
    }
    const pseudo_random_bytes = (0, utils_ts_1.concatBytes)(...b);
    return pseudo_random_bytes.slice(0, lenInBytes);
}
/**
 * Produces a uniformly random byte string using an extendable-output function (XOF) H.
 * 1. The collision resistance of H MUST be at least k bits.
 * 2. H MUST be an XOF that has been proved indifferentiable from
 *    a random oracle under a reasonable cryptographic assumption.
 * [RFC 9380 5.3.2](https://www.rfc-editor.org/rfc/rfc9380#section-5.3.2).
 */
function expand_message_xof(msg, DST, lenInBytes, k, H) {
    (0, utils_ts_1.abytes)(msg);
    anum(lenInBytes);
    DST = normDST(DST);
    // https://www.rfc-editor.org/rfc/rfc9380#section-5.3.3
    // DST = H('H2C-OVERSIZE-DST-' || a_very_long_DST, Math.ceil((lenInBytes * k) / 8));
    if (DST.length > 255) {
        const dkLen = Math.ceil((2 * k) / 8);
        DST = H.create({ dkLen }).update((0, utils_ts_1.utf8ToBytes)('H2C-OVERSIZE-DST-')).update(DST).digest();
    }
    if (lenInBytes > 65535 || DST.length > 255)
        throw new Error('expand_message_xof: invalid lenInBytes');
    return (H.create({ dkLen: lenInBytes })
        .update(msg)
        .update(i2osp(lenInBytes, 2))
        // 2. DST_prime = DST || I2OSP(len(DST), 1)
        .update(DST)
        .update(i2osp(DST.length, 1))
        .digest());
}
/**
 * Hashes arbitrary-length byte strings to a list of one or more elements of a finite field F.
 * [RFC 9380 5.2](https://www.rfc-editor.org/rfc/rfc9380#section-5.2).
 * @param msg a byte string containing the message to hash
 * @param count the number of elements of F to output
 * @param options `{DST: string, p: bigint, m: number, k: number, expand: 'xmd' | 'xof', hash: H}`, see above
 * @returns [u_0, ..., u_(count - 1)], a list of field elements.
 */
function hash_to_field(msg, count, options) {
    (0, utils_ts_1._validateObject)(options, {
        p: 'bigint',
        m: 'number',
        k: 'number',
        hash: 'function',
    });
    const { p, k, m, hash, expand, DST } = options;
    if (!(0, utils_ts_1.isHash)(options.hash))
        throw new Error('expected valid hash');
    (0, utils_ts_1.abytes)(msg);
    anum(count);
    const log2p = p.toString(2).length;
    const L = Math.ceil((log2p + k) / 8); // section 5.1 of ietf draft link above
    const len_in_bytes = count * m * L;
    let prb; // pseudo_random_bytes
    if (expand === 'xmd') {
        prb = expand_message_xmd(msg, DST, len_in_bytes, hash);
    }
    else if (expand === 'xof') {
        prb = expand_message_xof(msg, DST, len_in_bytes, k, hash);
    }
    else if (expand === '_internal_pass') {
        // for internal tests only
        prb = msg;
    }
    else {
        throw new Error('expand must be "xmd" or "xof"');
    }
    const u = new Array(count);
    for (let i = 0; i < count; i++) {
        const e = new Array(m);
        for (let j = 0; j < m; j++) {
            const elm_offset = L * (j + i * m);
            const tv = prb.subarray(elm_offset, elm_offset + L);
            e[j] = (0, modular_ts_1.mod)(os2ip(tv), p);
        }
        u[i] = e;
    }
    return u;
}
function isogenyMap(field, map) {
    // Make same order as in spec
    const coeff = map.map((i) => Array.from(i).reverse());
    return (x, y) => {
        const [xn, xd, yn, yd] = coeff.map((val) => val.reduce((acc, i) => field.add(field.mul(acc, x), i)));
        // 6.6.3
        // Exceptional cases of iso_map are inputs that cause the denominator of
        // either rational function to evaluate to zero; such cases MUST return
        // the identity point on E.
        const [xd_inv, yd_inv] = (0, modular_ts_1.FpInvertBatch)(field, [xd, yd], true);
        x = field.mul(xn, xd_inv); // xNum / xDen
        y = field.mul(y, field.mul(yn, yd_inv)); // y * (yNum / yDev)
        return { x, y };
    };
}
exports._DST_scalar = (0, utils_ts_1.utf8ToBytes)('HashToScalar-');
/** Creates hash-to-curve methods from EC Point and mapToCurve function. See {@link H2CHasher}. */
function createHasher(Point, mapToCurve, defaults) {
    if (typeof mapToCurve !== 'function')
        throw new Error('mapToCurve() must be defined');
    function map(num) {
        return Point.fromAffine(mapToCurve(num));
    }
    function clear(initial) {
        const P = initial.clearCofactor();
        if (P.equals(Point.ZERO))
            return Point.ZERO; // zero will throw in assert
        P.assertValidity();
        return P;
    }
    return {
        defaults,
        hashToCurve(msg, options) {
            const opts = Object.assign({}, defaults, options);
            const u = hash_to_field(msg, 2, opts);
            const u0 = map(u[0]);
            const u1 = map(u[1]);
            return clear(u0.add(u1));
        },
        encodeToCurve(msg, options) {
            const optsDst = defaults.encodeDST ? { DST: defaults.encodeDST } : {};
            const opts = Object.assign({}, defaults, optsDst, options);
            const u = hash_to_field(msg, 1, opts);
            const u0 = map(u[0]);
            return clear(u0);
        },
        /** See {@link H2CHasher} */
        mapToCurve(scalars) {
            if (!Array.isArray(scalars))
                throw new Error('expected array of bigints');
            for (const i of scalars)
                if (typeof i !== 'bigint')
                    throw new Error('expected array of bigints');
            return clear(map(scalars));
        },
        // hash_to_scalar can produce 0: https://www.rfc-editor.org/errata/eid8393
        // RFC 9380, draft-irtf-cfrg-bbs-signatures-08
        hashToScalar(msg, options) {
            // @ts-ignore
            const N = Point.Fn.ORDER;
            const opts = Object.assign({}, defaults, { p: N, m: 1, DST: exports._DST_scalar }, options);
            return hash_to_field(msg, 1, opts)[0][0];
        },
    };
}
//# sourceMappingURL=hash-to-curve.js.map
    },
    24: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupHash = exports.findGroupHash = exports.jubjub = void 0;
/**
 * @deprecated
 * @module
 */
const misc_ts_1 = require("./misc.js");
/** @deprecated use `import { jubjub } from '@noble/curves/misc.js';` */
exports.jubjub = misc_ts_1.jubjub;
/** @deprecated use `import { jubjub_findGroupHash } from '@noble/curves/misc.js';` */
exports.findGroupHash = misc_ts_1.jubjub_findGroupHash;
/** @deprecated use `import { jubjub_groupHash } from '@noble/curves/misc.js';` */
exports.groupHash = misc_ts_1.jubjub_groupHash;
//# sourceMappingURL=jubjub.js.map
    },
    25: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vesta = exports.pallas = exports.pasta_q = exports.pasta_p = exports.babyjubjub = exports.jubjub = void 0;
exports.jubjub_groupHash = jubjub_groupHash;
exports.jubjub_findGroupHash = jubjub_findGroupHash;
/**
 * Miscellaneous, rarely used curves.
 * jubjub, babyjubjub, pallas, vesta.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const blake1_js_1 = require("@noble/hashes/blake1.js");
const blake2_js_1 = require("@noble/hashes/blake2.js");
const sha2_js_1 = require("@noble/hashes/sha2.js");
const utils_js_1 = require("@noble/hashes/utils.js");
const edwards_ts_1 = require("./abstract/edwards.js");
const modular_ts_1 = require("./abstract/modular.js");
const weierstrass_ts_1 = require("./abstract/weierstrass.js");
const bls12_381_ts_1 = require("./bls12-381.js");
const bn254_ts_1 = require("./bn254.js");
// Jubjub curves have 𝔽p over scalar fields of other curves. They are friendly to ZK proofs.
// jubjub Fp = bls n. babyjubjub Fp = bn254 n.
// verify manually, check bls12-381.ts and bn254.ts.
const jubjub_CURVE = {
    p: bls12_381_ts_1.bls12_381_Fr.ORDER,
    n: BigInt('0xe7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7'),
    h: BigInt(8),
    a: BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000000'),
    d: BigInt('0x2a9318e74bfa2b48f5fd9207e6bd7fd4292d7f6d37579d2601065fd6d6343eb1'),
    Gx: BigInt('0x11dafe5d23e1218086a365b99fbf3d3be72f6afd7d1f72623e6b071492d1122b'),
    Gy: BigInt('0x1d523cf1ddab1a1793132e78c866c0c33e26ba5cc220fed7cc3f870e59d292aa'),
};
/** Curve over scalar field of bls12-381. jubjub Fp = bls n */
exports.jubjub = (0, edwards_ts_1.twistedEdwards)({
    ...jubjub_CURVE,
    Fp: bls12_381_ts_1.bls12_381_Fr,
    hash: sha2_js_1.sha512,
});
const babyjubjub_CURVE = {
    p: bn254_ts_1.bn254_Fr.ORDER,
    n: BigInt('0x30644e72e131a029b85045b68181585d59f76dc1c90770533b94bee1c9093788'),
    h: BigInt(8),
    a: BigInt('168700'),
    d: BigInt('168696'),
    Gx: BigInt('0x23343e3445b673d38bcba38f25645adb494b1255b1162bb40f41a59f4d4b45e'),
    Gy: BigInt('0xc19139cb84c680a6e14116da06056174a0cfa121e6e5c2450f87d64fc000001'),
};
/** Curve over scalar field of bn254. babyjubjub Fp = bn254 n */
exports.babyjubjub = (0, edwards_ts_1.twistedEdwards)({
    ...babyjubjub_CURVE,
    Fp: bn254_ts_1.bn254_Fr,
    hash: blake1_js_1.blake256,
});
const jubjub_gh_first_block = (0, utils_js_1.utf8ToBytes)('096b36a5804bfacef1691e173c366a47ff5ba84a44f26ddd7e8d9f79d5b42df0');
// Returns point at JubJub curve which is prime order and not zero
function jubjub_groupHash(tag, personalization) {
    const h = blake2_js_1.blake2s.create({ personalization, dkLen: 32 });
    h.update(jubjub_gh_first_block);
    h.update(tag);
    // NOTE: returns ExtendedPoint, in case it will be multiplied later
    let p = exports.jubjub.Point.fromBytes(h.digest());
    // NOTE: cannot replace with isSmallOrder, returns Point*8
    p = p.multiply(jubjub_CURVE.h);
    if (p.equals(exports.jubjub.Point.ZERO))
        throw new Error('Point has small order');
    return p;
}
// No secret data is leaked here at all.
// It operates over public data:
// const G_SPEND = jubjub.findGroupHash(Uint8Array.of(), utf8ToBytes('Item_G_'));
function jubjub_findGroupHash(m, personalization) {
    const tag = (0, utils_js_1.concatBytes)(m, Uint8Array.of(0));
    const hashes = [];
    for (let i = 0; i < 256; i++) {
        tag[tag.length - 1] = i;
        try {
            hashes.push(jubjub_groupHash(tag, personalization));
        }
        catch (e) { }
    }
    if (!hashes.length)
        throw new Error('findGroupHash tag overflow');
    return hashes[0];
}
// Pasta curves. See [Spec](https://o1-labs.github.io/proof-systems/specs/pasta.html).
exports.pasta_p = BigInt('0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001');
exports.pasta_q = BigInt('0x40000000000000000000000000000000224698fc0994a8dd8c46eb2100000001');
/**
 * @deprecated
 */
exports.pallas = (0, weierstrass_ts_1.weierstrass)({
    a: BigInt(0),
    b: BigInt(5),
    Fp: (0, modular_ts_1.Field)(exports.pasta_p),
    n: exports.pasta_q,
    Gx: (0, modular_ts_1.mod)(BigInt(-1), exports.pasta_p),
    Gy: BigInt(2),
    h: BigInt(1),
    hash: sha2_js_1.sha256,
});
/**
 * @deprecated
 */
exports.vesta = (0, weierstrass_ts_1.weierstrass)({
    a: BigInt(0),
    b: BigInt(5),
    Fp: (0, modular_ts_1.Field)(exports.pasta_q),
    n: exports.pasta_p,
    Gx: (0, modular_ts_1.mod)(BigInt(-1), exports.pasta_q),
    Gy: BigInt(2),
    h: BigInt(1),
    hash: sha2_js_1.sha256,
});
//# sourceMappingURL=misc.js.map
    },
    26: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blake512 = exports.blake384 = exports.blake256 = exports.blake224 = exports.BLAKE512 = exports.BLAKE384 = exports.BLAKE256 = exports.BLAKE224 = void 0;
/**
 * Blake1 legacy hash function, one of SHA3 proposals.
 * Rarely used. Check out blake2 or blake3 instead.
 * https://www.aumasson.jp/blake/blake.pdf
 *
 * In the best case, there are 0 allocations.
 *
 * Differences from blake2:
 *
 * - BE instead of LE
 * - Paddings, similar to MD5, RIPEMD, SHA1, SHA2, but:
 *     - length flag is located before actual length
 *     - padding block is compressed differently (no lengths)
 * Instead of msg[sigma[k]], we have `msg[sigma[k]] ^ constants[sigma[k-1]]`
 * (-1 for g1, g2 without -1)
 * - Salt is XOR-ed into constants instead of state
 * - Salt is XOR-ed with output in `compress`
 * - Additional rows (+64 bytes) in SIGMA for new rounds
 * - Different round count:
 *     - 14 / 10 rounds in blake256 / blake2s
 *     - 16 / 12 rounds in blake512 / blake2b
 * - blake512: G1b: rotr 24 -> 25, G2b: rotr 63 -> 11
 * @module
 */
const _blake_ts_1 = require("./_blake.js");
const _md_ts_1 = require("./_md.js");
const u64 = require("./_u64.js");
// prettier-ignore
const utils_ts_1 = require("./utils.js");
// Empty zero-filled salt
const EMPTY_SALT = /* @__PURE__ */ new Uint32Array(8);
class BLAKE1 extends utils_ts_1.Hash {
    constructor(blockLen, outputLen, lengthFlag, counterLen, saltLen, constants, opts = {}) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        const { salt } = opts;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.lengthFlag = lengthFlag;
        this.counterLen = counterLen;
        this.buffer = new Uint8Array(blockLen);
        this.view = (0, utils_ts_1.createView)(this.buffer);
        if (salt) {
            let slt = salt;
            slt = (0, utils_ts_1.toBytes)(slt);
            (0, utils_ts_1.abytes)(slt);
            if (slt.length !== 4 * saltLen)
                throw new Error('wrong salt length');
            const salt32 = (this.salt = new Uint32Array(saltLen));
            const sv = (0, utils_ts_1.createView)(slt);
            this.constants = constants.slice();
            for (let i = 0, offset = 0; i < salt32.length; i++, offset += 4) {
                salt32[i] = sv.getUint32(offset, false);
                this.constants[i] ^= salt32[i];
            }
        }
        else {
            this.salt = EMPTY_SALT;
            this.constants = constants;
        }
    }
    update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        // From _md, but update length before each compress
        const { view, buffer, blockLen } = this;
        const len = data.length;
        let dataView;
        for (let pos = 0; pos < len;) {
            const take = Math.min(blockLen - this.pos, len - pos);
            // Fast path: we have at least one block in input, cast it to view and process
            if (take === blockLen) {
                if (!dataView)
                    dataView = (0, utils_ts_1.createView)(data);
                for (; blockLen <= len - pos; pos += blockLen) {
                    this.length += blockLen;
                    this.compress(dataView, pos);
                }
                continue;
            }
            buffer.set(data.subarray(pos, pos + take), this.pos);
            this.pos += take;
            pos += take;
            if (this.pos === blockLen) {
                this.length += blockLen;
                this.compress(view, 0, true);
                this.pos = 0;
            }
        }
        return this;
    }
    destroy() {
        this.destroyed = true;
        if (this.salt !== EMPTY_SALT) {
            (0, utils_ts_1.clean)(this.salt, this.constants);
        }
    }
    _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { buffer, length, finished, destroyed, constants, salt, pos } = this;
        to.buffer.set(buffer);
        to.constants = constants.slice();
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        to.salt = salt.slice();
        return to;
    }
    clone() {
        return this._cloneInto();
    }
    digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.aoutput)(out, this);
        this.finished = true;
        // Padding
        const { buffer, blockLen, counterLen, lengthFlag, view } = this;
        (0, utils_ts_1.clean)(buffer.subarray(this.pos)); // clean buf
        const counter = BigInt((this.length + this.pos) * 8);
        const counterPos = blockLen - counterLen - 1;
        buffer[this.pos] |= 128; // End block flag
        this.length += this.pos; // add unwritten length
        // Not enough in buffer for length: write what we have.
        if (this.pos > counterPos) {
            this.compress(view, 0);
            (0, utils_ts_1.clean)(buffer);
            this.pos = 0;
        }
        // Difference with md: here we have lengthFlag!
        buffer[counterPos] |= lengthFlag; // Length flag
        // We always set 8 byte length flag. Because length will overflow significantly sooner.
        (0, _md_ts_1.setBigUint64)(view, blockLen - 8, counter, false);
        this.compress(view, 0, this.pos !== 0); // don't add length if length is not empty block?
        // Write output
        (0, utils_ts_1.clean)(buffer);
        const v = (0, utils_ts_1.createView)(out);
        const state = this.get();
        for (let i = 0; i < this.outputLen / 4; ++i)
            v.setUint32(i * 4, state[i]);
    }
    digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
    }
}
// Constants
const B64C = /* @__PURE__ */ Uint32Array.from([
    0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344, 0xa4093822, 0x299f31d0, 0x082efa98, 0xec4e6c89,
    0x452821e6, 0x38d01377, 0xbe5466cf, 0x34e90c6c, 0xc0ac29b7, 0xc97c50dd, 0x3f84d5b5, 0xb5470917,
    0x9216d5d9, 0x8979fb1b, 0xd1310ba6, 0x98dfb5ac, 0x2ffd72db, 0xd01adfb7, 0xb8e1afed, 0x6a267e96,
    0xba7c9045, 0xf12c7f99, 0x24a19947, 0xb3916cf7, 0x0801f2e2, 0x858efc16, 0x636920d8, 0x71574e69,
]);
// first half of C512
const B32C = B64C.slice(0, 16);
const B256_IV = _md_ts_1.SHA256_IV.slice();
const B224_IV = _md_ts_1.SHA224_IV.slice();
const B384_IV = _md_ts_1.SHA384_IV.slice();
const B512_IV = _md_ts_1.SHA512_IV.slice();
function generateTBL256() {
    const TBL = [];
    for (let i = 0, j = 0; i < 14; i++, j += 16) {
        for (let offset = 1; offset < 16; offset += 2) {
            TBL.push(B32C[_blake_ts_1.BSIGMA[j + offset]]);
            TBL.push(B32C[_blake_ts_1.BSIGMA[j + offset - 1]]);
        }
    }
    return new Uint32Array(TBL);
}
const TBL256 = /* @__PURE__ */ generateTBL256(); // C256[SIGMA[X]] precompute
// Reusable temporary buffer
const BLAKE256_W = /* @__PURE__ */ new Uint32Array(16);
class Blake1_32 extends BLAKE1 {
    constructor(outputLen, IV, lengthFlag, opts = {}) {
        super(64, outputLen, lengthFlag, 8, 4, B32C, opts);
        this.v0 = IV[0] | 0;
        this.v1 = IV[1] | 0;
        this.v2 = IV[2] | 0;
        this.v3 = IV[3] | 0;
        this.v4 = IV[4] | 0;
        this.v5 = IV[5] | 0;
        this.v6 = IV[6] | 0;
        this.v7 = IV[7] | 0;
    }
    get() {
        const { v0, v1, v2, v3, v4, v5, v6, v7 } = this;
        return [v0, v1, v2, v3, v4, v5, v6, v7];
    }
    // prettier-ignore
    set(v0, v1, v2, v3, v4, v5, v6, v7) {
        this.v0 = v0 | 0;
        this.v1 = v1 | 0;
        this.v2 = v2 | 0;
        this.v3 = v3 | 0;
        this.v4 = v4 | 0;
        this.v5 = v5 | 0;
        this.v6 = v6 | 0;
        this.v7 = v7 | 0;
    }
    destroy() {
        super.destroy();
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
    }
    compress(view, offset, withLength = true) {
        for (let i = 0; i < 16; i++, offset += 4)
            BLAKE256_W[i] = view.getUint32(offset, false);
        // NOTE: we cannot re-use compress from blake2s, since there is additional xor over u256[SIGMA[e]]
        let v00 = this.v0 | 0;
        let v01 = this.v1 | 0;
        let v02 = this.v2 | 0;
        let v03 = this.v3 | 0;
        let v04 = this.v4 | 0;
        let v05 = this.v5 | 0;
        let v06 = this.v6 | 0;
        let v07 = this.v7 | 0;
        let v08 = this.constants[0] | 0;
        let v09 = this.constants[1] | 0;
        let v10 = this.constants[2] | 0;
        let v11 = this.constants[3] | 0;
        const { h, l } = u64.fromBig(BigInt(withLength ? this.length * 8 : 0));
        let v12 = (this.constants[4] ^ l) >>> 0;
        let v13 = (this.constants[5] ^ l) >>> 0;
        let v14 = (this.constants[6] ^ h) >>> 0;
        let v15 = (this.constants[7] ^ h) >>> 0;
        // prettier-ignore
        for (let i = 0, k = 0, j = 0; i < 14; i++) {
            ({ a: v00, b: v04, c: v08, d: v12 } = (0, _blake_ts_1.G1s)(v00, v04, v08, v12, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v00, b: v04, c: v08, d: v12 } = (0, _blake_ts_1.G2s)(v00, v04, v08, v12, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v01, b: v05, c: v09, d: v13 } = (0, _blake_ts_1.G1s)(v01, v05, v09, v13, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v01, b: v05, c: v09, d: v13 } = (0, _blake_ts_1.G2s)(v01, v05, v09, v13, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v02, b: v06, c: v10, d: v14 } = (0, _blake_ts_1.G1s)(v02, v06, v10, v14, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v02, b: v06, c: v10, d: v14 } = (0, _blake_ts_1.G2s)(v02, v06, v10, v14, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v03, b: v07, c: v11, d: v15 } = (0, _blake_ts_1.G1s)(v03, v07, v11, v15, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v03, b: v07, c: v11, d: v15 } = (0, _blake_ts_1.G2s)(v03, v07, v11, v15, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v00, b: v05, c: v10, d: v15 } = (0, _blake_ts_1.G1s)(v00, v05, v10, v15, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v00, b: v05, c: v10, d: v15 } = (0, _blake_ts_1.G2s)(v00, v05, v10, v15, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v01, b: v06, c: v11, d: v12 } = (0, _blake_ts_1.G1s)(v01, v06, v11, v12, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v01, b: v06, c: v11, d: v12 } = (0, _blake_ts_1.G2s)(v01, v06, v11, v12, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v02, b: v07, c: v08, d: v13 } = (0, _blake_ts_1.G1s)(v02, v07, v08, v13, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v02, b: v07, c: v08, d: v13 } = (0, _blake_ts_1.G2s)(v02, v07, v08, v13, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v03, b: v04, c: v09, d: v14 } = (0, _blake_ts_1.G1s)(v03, v04, v09, v14, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
            ({ a: v03, b: v04, c: v09, d: v14 } = (0, _blake_ts_1.G2s)(v03, v04, v09, v14, BLAKE256_W[_blake_ts_1.BSIGMA[k++]] ^ TBL256[j++]));
        }
        this.v0 = (this.v0 ^ v00 ^ v08 ^ this.salt[0]) >>> 0;
        this.v1 = (this.v1 ^ v01 ^ v09 ^ this.salt[1]) >>> 0;
        this.v2 = (this.v2 ^ v02 ^ v10 ^ this.salt[2]) >>> 0;
        this.v3 = (this.v3 ^ v03 ^ v11 ^ this.salt[3]) >>> 0;
        this.v4 = (this.v4 ^ v04 ^ v12 ^ this.salt[0]) >>> 0;
        this.v5 = (this.v5 ^ v05 ^ v13 ^ this.salt[1]) >>> 0;
        this.v6 = (this.v6 ^ v06 ^ v14 ^ this.salt[2]) >>> 0;
        this.v7 = (this.v7 ^ v07 ^ v15 ^ this.salt[3]) >>> 0;
        (0, utils_ts_1.clean)(BLAKE256_W);
    }
}
const BBUF = /* @__PURE__ */ new Uint32Array(32);
const BLAKE512_W = /* @__PURE__ */ new Uint32Array(32);
function generateTBL512() {
    const TBL = [];
    for (let r = 0, k = 0; r < 16; r++, k += 16) {
        for (let offset = 1; offset < 16; offset += 2) {
            TBL.push(B64C[_blake_ts_1.BSIGMA[k + offset] * 2 + 0]);
            TBL.push(B64C[_blake_ts_1.BSIGMA[k + offset] * 2 + 1]);
            TBL.push(B64C[_blake_ts_1.BSIGMA[k + offset - 1] * 2 + 0]);
            TBL.push(B64C[_blake_ts_1.BSIGMA[k + offset - 1] * 2 + 1]);
        }
    }
    return new Uint32Array(TBL);
}
const TBL512 = /* @__PURE__ */ generateTBL512(); // C512[SIGMA[X]] precompute
// Mixing function G splitted in two halfs
function G1b(a, b, c, d, msg, k) {
    const Xpos = 2 * _blake_ts_1.BSIGMA[k];
    const Xl = msg[Xpos + 1] ^ TBL512[k * 2 + 1], Xh = msg[Xpos] ^ TBL512[k * 2]; // prettier-ignore
    let Al = BBUF[2 * a + 1], Ah = BBUF[2 * a]; // prettier-ignore
    let Bl = BBUF[2 * b + 1], Bh = BBUF[2 * b]; // prettier-ignore
    let Cl = BBUF[2 * c + 1], Ch = BBUF[2 * c]; // prettier-ignore
    let Dl = BBUF[2 * d + 1], Dh = BBUF[2 * d]; // prettier-ignore
    // v[a] = (v[a] + v[b] + x) | 0;
    let ll = u64.add3L(Al, Bl, Xl);
    Ah = u64.add3H(ll, Ah, Bh, Xh) >>> 0;
    Al = (ll | 0) >>> 0;
    // v[d] = rotr(v[d] ^ v[a], 32)
    ({ Dh, Dl } = { Dh: Dh ^ Ah, Dl: Dl ^ Al });
    ({ Dh, Dl } = { Dh: u64.rotr32H(Dh, Dl), Dl: u64.rotr32L(Dh, Dl) });
    // v[c] = (v[c] + v[d]) | 0;
    ({ h: Ch, l: Cl } = u64.add(Ch, Cl, Dh, Dl));
    // v[b] = rotr(v[b] ^ v[c], 25)
    ({ Bh, Bl } = { Bh: Bh ^ Ch, Bl: Bl ^ Cl });
    ({ Bh, Bl } = { Bh: u64.rotrSH(Bh, Bl, 25), Bl: u64.rotrSL(Bh, Bl, 25) });
    (BBUF[2 * a + 1] = Al), (BBUF[2 * a] = Ah);
    (BBUF[2 * b + 1] = Bl), (BBUF[2 * b] = Bh);
    (BBUF[2 * c + 1] = Cl), (BBUF[2 * c] = Ch);
    (BBUF[2 * d + 1] = Dl), (BBUF[2 * d] = Dh);
}
function G2b(a, b, c, d, msg, k) {
    const Xpos = 2 * _blake_ts_1.BSIGMA[k];
    const Xl = msg[Xpos + 1] ^ TBL512[k * 2 + 1], Xh = msg[Xpos] ^ TBL512[k * 2]; // prettier-ignore
    let Al = BBUF[2 * a + 1], Ah = BBUF[2 * a]; // prettier-ignore
    let Bl = BBUF[2 * b + 1], Bh = BBUF[2 * b]; // prettier-ignore
    let Cl = BBUF[2 * c + 1], Ch = BBUF[2 * c]; // prettier-ignore
    let Dl = BBUF[2 * d + 1], Dh = BBUF[2 * d]; // prettier-ignore
    // v[a] = (v[a] + v[b] + x) | 0;
    let ll = u64.add3L(Al, Bl, Xl);
    Ah = u64.add3H(ll, Ah, Bh, Xh);
    Al = ll | 0;
    // v[d] = rotr(v[d] ^ v[a], 16)
    ({ Dh, Dl } = { Dh: Dh ^ Ah, Dl: Dl ^ Al });
    ({ Dh, Dl } = { Dh: u64.rotrSH(Dh, Dl, 16), Dl: u64.rotrSL(Dh, Dl, 16) });
    // v[c] = (v[c] + v[d]) | 0;
    ({ h: Ch, l: Cl } = u64.add(Ch, Cl, Dh, Dl));
    // v[b] = rotr(v[b] ^ v[c], 11)
    ({ Bh, Bl } = { Bh: Bh ^ Ch, Bl: Bl ^ Cl });
    ({ Bh, Bl } = { Bh: u64.rotrSH(Bh, Bl, 11), Bl: u64.rotrSL(Bh, Bl, 11) });
    (BBUF[2 * a + 1] = Al), (BBUF[2 * a] = Ah);
    (BBUF[2 * b + 1] = Bl), (BBUF[2 * b] = Bh);
    (BBUF[2 * c + 1] = Cl), (BBUF[2 * c] = Ch);
    (BBUF[2 * d + 1] = Dl), (BBUF[2 * d] = Dh);
}
class Blake1_64 extends BLAKE1 {
    constructor(outputLen, IV, lengthFlag, opts = {}) {
        super(128, outputLen, lengthFlag, 16, 8, B64C, opts);
        this.v0l = IV[0] | 0;
        this.v0h = IV[1] | 0;
        this.v1l = IV[2] | 0;
        this.v1h = IV[3] | 0;
        this.v2l = IV[4] | 0;
        this.v2h = IV[5] | 0;
        this.v3l = IV[6] | 0;
        this.v3h = IV[7] | 0;
        this.v4l = IV[8] | 0;
        this.v4h = IV[9] | 0;
        this.v5l = IV[10] | 0;
        this.v5h = IV[11] | 0;
        this.v6l = IV[12] | 0;
        this.v6h = IV[13] | 0;
        this.v7l = IV[14] | 0;
        this.v7h = IV[15] | 0;
    }
    // prettier-ignore
    get() {
        let { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
        return [v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h];
    }
    // prettier-ignore
    set(v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h) {
        this.v0l = v0l | 0;
        this.v0h = v0h | 0;
        this.v1l = v1l | 0;
        this.v1h = v1h | 0;
        this.v2l = v2l | 0;
        this.v2h = v2h | 0;
        this.v3l = v3l | 0;
        this.v3h = v3h | 0;
        this.v4l = v4l | 0;
        this.v4h = v4h | 0;
        this.v5l = v5l | 0;
        this.v5h = v5h | 0;
        this.v6l = v6l | 0;
        this.v6h = v6h | 0;
        this.v7l = v7l | 0;
        this.v7h = v7h | 0;
    }
    destroy() {
        super.destroy();
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
    compress(view, offset, withLength = true) {
        for (let i = 0; i < 32; i++, offset += 4)
            BLAKE512_W[i] = view.getUint32(offset, false);
        this.get().forEach((v, i) => (BBUF[i] = v)); // First half from state.
        BBUF.set(this.constants.subarray(0, 16), 16);
        if (withLength) {
            const { h, l } = u64.fromBig(BigInt(this.length * 8));
            BBUF[24] = (BBUF[24] ^ h) >>> 0;
            BBUF[25] = (BBUF[25] ^ l) >>> 0;
            BBUF[26] = (BBUF[26] ^ h) >>> 0;
            BBUF[27] = (BBUF[27] ^ l) >>> 0;
        }
        for (let i = 0, k = 0; i < 16; i++) {
            G1b(0, 4, 8, 12, BLAKE512_W, k++);
            G2b(0, 4, 8, 12, BLAKE512_W, k++);
            G1b(1, 5, 9, 13, BLAKE512_W, k++);
            G2b(1, 5, 9, 13, BLAKE512_W, k++);
            G1b(2, 6, 10, 14, BLAKE512_W, k++);
            G2b(2, 6, 10, 14, BLAKE512_W, k++);
            G1b(3, 7, 11, 15, BLAKE512_W, k++);
            G2b(3, 7, 11, 15, BLAKE512_W, k++);
            G1b(0, 5, 10, 15, BLAKE512_W, k++);
            G2b(0, 5, 10, 15, BLAKE512_W, k++);
            G1b(1, 6, 11, 12, BLAKE512_W, k++);
            G2b(1, 6, 11, 12, BLAKE512_W, k++);
            G1b(2, 7, 8, 13, BLAKE512_W, k++);
            G2b(2, 7, 8, 13, BLAKE512_W, k++);
            G1b(3, 4, 9, 14, BLAKE512_W, k++);
            G2b(3, 4, 9, 14, BLAKE512_W, k++);
        }
        this.v0l ^= BBUF[0] ^ BBUF[16] ^ this.salt[0];
        this.v0h ^= BBUF[1] ^ BBUF[17] ^ this.salt[1];
        this.v1l ^= BBUF[2] ^ BBUF[18] ^ this.salt[2];
        this.v1h ^= BBUF[3] ^ BBUF[19] ^ this.salt[3];
        this.v2l ^= BBUF[4] ^ BBUF[20] ^ this.salt[4];
        this.v2h ^= BBUF[5] ^ BBUF[21] ^ this.salt[5];
        this.v3l ^= BBUF[6] ^ BBUF[22] ^ this.salt[6];
        this.v3h ^= BBUF[7] ^ BBUF[23] ^ this.salt[7];
        this.v4l ^= BBUF[8] ^ BBUF[24] ^ this.salt[0];
        this.v4h ^= BBUF[9] ^ BBUF[25] ^ this.salt[1];
        this.v5l ^= BBUF[10] ^ BBUF[26] ^ this.salt[2];
        this.v5h ^= BBUF[11] ^ BBUF[27] ^ this.salt[3];
        this.v6l ^= BBUF[12] ^ BBUF[28] ^ this.salt[4];
        this.v6h ^= BBUF[13] ^ BBUF[29] ^ this.salt[5];
        this.v7l ^= BBUF[14] ^ BBUF[30] ^ this.salt[6];
        this.v7h ^= BBUF[15] ^ BBUF[31] ^ this.salt[7];
        (0, utils_ts_1.clean)(BBUF, BLAKE512_W);
    }
}
class BLAKE224 extends Blake1_32 {
    constructor(opts = {}) {
        super(28, B224_IV, 0, opts);
    }
}
exports.BLAKE224 = BLAKE224;
class BLAKE256 extends Blake1_32 {
    constructor(opts = {}) {
        super(32, B256_IV, 1, opts);
    }
}
exports.BLAKE256 = BLAKE256;
class BLAKE384 extends Blake1_64 {
    constructor(opts = {}) {
        super(48, B384_IV, 0, opts);
    }
}
exports.BLAKE384 = BLAKE384;
class BLAKE512 extends Blake1_64 {
    constructor(opts = {}) {
        super(64, B512_IV, 1, opts);
    }
}
exports.BLAKE512 = BLAKE512;
/** blake1-224 hash function */
exports.blake224 = (0, utils_ts_1.createOptHasher)((opts) => new BLAKE224(opts));
/** blake1-256 hash function */
exports.blake256 = (0, utils_ts_1.createOptHasher)((opts) => new BLAKE256(opts));
/** blake1-384 hash function */
exports.blake384 = (0, utils_ts_1.createOptHasher)((opts) => new BLAKE384(opts));
/** blake1-512 hash function */
exports.blake512 = (0, utils_ts_1.createOptHasher)((opts) => new BLAKE512(opts));
//# sourceMappingURL=blake1.js.map
    },
    27: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrimeEdwardsPoint = void 0;
exports.edwards = edwards;
exports.eddsa = eddsa;
exports.twistedEdwards = twistedEdwards;
/**
 * Twisted Edwards curve. The formula is: ax² + y² = 1 + dx²y².
 * For design rationale of types / exports, see weierstrass module documentation.
 * Untwisted Edwards curves exist, but they aren't used in real-world protocols.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
const curve_ts_1 = require("./curve.js");
const modular_ts_1 = require("./modular.js");
// Be friendly to bad ECMAScript parsers by not using bigint literals
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _8n = BigInt(8);
function isEdValidXY(Fp, CURVE, x, y) {
    const x2 = Fp.sqr(x);
    const y2 = Fp.sqr(y);
    const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
    const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
    return Fp.eql(left, right);
}
function edwards(params, extraOpts = {}) {
    const validated = (0, curve_ts_1._createCurveFields)('edwards', params, extraOpts, extraOpts.FpFnLE);
    const { Fp, Fn } = validated;
    let CURVE = validated.CURVE;
    const { h: cofactor } = CURVE;
    (0, utils_ts_1._validateObject)(extraOpts, {}, { uvRatio: 'function' });
    // Important:
    // There are some places where Fp.BYTES is used instead of nByteLength.
    // So far, everything has been tested with curves of Fp.BYTES == nByteLength.
    // TODO: test and find curves which behave otherwise.
    const MASK = _2n << (BigInt(Fn.BYTES * 8) - _1n);
    const modP = (n) => Fp.create(n); // Function overrides
    // sqrt(u/v)
    const uvRatio = extraOpts.uvRatio ||
        ((u, v) => {
            try {
                return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
            }
            catch (e) {
                return { isValid: false, value: _0n };
            }
        });
    // Validate whether the passed curve params are valid.
    // equation ax² + y² = 1 + dx²y² should work for generator point.
    if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy))
        throw new Error('bad curve params: generator point');
    /**
     * Asserts coordinate is valid: 0 <= n < MASK.
     * Coordinates >= Fp.ORDER are allowed for zip215.
     */
    function acoord(title, n, banZero = false) {
        const min = banZero ? _1n : _0n;
        (0, utils_ts_1.aInRange)('coordinate ' + title, n, min, MASK);
        return n;
    }
    function aextpoint(other) {
        if (!(other instanceof Point))
            throw new Error('ExtendedPoint expected');
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    const toAffineMemo = (0, utils_ts_1.memoized)((p, iz) => {
        const { X, Y, Z } = p;
        const is0 = p.is0();
        if (iz == null)
            iz = is0 ? _8n : Fp.inv(Z); // 8 was chosen arbitrarily
        const x = modP(X * iz);
        const y = modP(Y * iz);
        const zz = Fp.mul(Z, iz);
        if (is0)
            return { x: _0n, y: _1n };
        if (zz !== _1n)
            throw new Error('invZ was invalid');
        return { x, y };
    });
    const assertValidMemo = (0, utils_ts_1.memoized)((p) => {
        const { a, d } = CURVE;
        if (p.is0())
            throw new Error('bad point: ZERO'); // TODO: optimize, with vars below?
        // Equation in affine coordinates: ax² + y² = 1 + dx²y²
        // Equation in projective coordinates (X/Z, Y/Z, Z):  (aX² + Y²)Z² = Z⁴ + dX²Y²
        const { X, Y, Z, T } = p;
        const X2 = modP(X * X); // X²
        const Y2 = modP(Y * Y); // Y²
        const Z2 = modP(Z * Z); // Z²
        const Z4 = modP(Z2 * Z2); // Z⁴
        const aX2 = modP(X2 * a); // aX²
        const left = modP(Z2 * modP(aX2 + Y2)); // (aX² + Y²)Z²
        const right = modP(Z4 + modP(d * modP(X2 * Y2))); // Z⁴ + dX²Y²
        if (left !== right)
            throw new Error('bad point: equation left != right (1)');
        // In Extended coordinates we also have T, which is x*y=T/Z: check X*Y == Z*T
        const XY = modP(X * Y);
        const ZT = modP(Z * T);
        if (XY !== ZT)
            throw new Error('bad point: equation left != right (2)');
        return true;
    });
    // Extended Point works in extended coordinates: (X, Y, Z, T) ∋ (x=X/Z, y=Y/Z, T=xy).
    // https://en.wikipedia.org/wiki/Twisted_Edwards_curve#Extended_coordinates
    class Point {
        constructor(X, Y, Z, T) {
            this.X = acoord('x', X);
            this.Y = acoord('y', Y);
            this.Z = acoord('z', Z, true);
            this.T = acoord('t', T);
            Object.freeze(this);
        }
        static CURVE() {
            return CURVE;
        }
        static fromAffine(p) {
            if (p instanceof Point)
                throw new Error('extended point not allowed');
            const { x, y } = p || {};
            acoord('x', x);
            acoord('y', y);
            return new Point(x, y, _1n, modP(x * y));
        }
        // Uses algo from RFC8032 5.1.3.
        static fromBytes(bytes, zip215 = false) {
            const len = Fp.BYTES;
            const { a, d } = CURVE;
            bytes = (0, utils_ts_1.copyBytes)((0, utils_ts_1._abytes2)(bytes, len, 'point'));
            (0, utils_ts_1._abool2)(zip215, 'zip215');
            const normed = (0, utils_ts_1.copyBytes)(bytes); // copy again, we'll manipulate it
            const lastByte = bytes[len - 1]; // select last byte
            normed[len - 1] = lastByte & ~0x80; // clear last bit
            const y = (0, utils_ts_1.bytesToNumberLE)(normed);
            // zip215=true is good for consensus-critical apps. =false follows RFC8032 / NIST186-5.
            // RFC8032 prohibits >= p, but ZIP215 doesn't
            // zip215=true:  0 <= y < MASK (2^256 for ed25519)
            // zip215=false: 0 <= y < P (2^255-19 for ed25519)
            const max = zip215 ? MASK : Fp.ORDER;
            (0, utils_ts_1.aInRange)('point.y', y, _0n, max);
            // Ed25519: x² = (y²-1)/(dy²+1) mod p. Ed448: x² = (y²-1)/(dy²-1) mod p. Generic case:
            // ax²+y²=1+dx²y² => y²-1=dx²y²-ax² => y²-1=x²(dy²-a) => x²=(y²-1)/(dy²-a)
            const y2 = modP(y * y); // denominator is always non-0 mod p.
            const u = modP(y2 - _1n); // u = y² - 1
            const v = modP(d * y2 - a); // v = d y² + 1.
            let { isValid, value: x } = uvRatio(u, v); // √(u/v)
            if (!isValid)
                throw new Error('bad point: invalid y coordinate');
            const isXOdd = (x & _1n) === _1n; // There are 2 square roots. Use x_0 bit to select proper
            const isLastByteOdd = (lastByte & 0x80) !== 0; // x_0, last bit
            if (!zip215 && x === _0n && isLastByteOdd)
                // if x=0 and x_0 = 1, fail
                throw new Error('bad point: x=0 and x_0=1');
            if (isLastByteOdd !== isXOdd)
                x = modP(-x); // if x_0 != x mod 2, set x = p-x
            return Point.fromAffine({ x, y });
        }
        static fromHex(bytes, zip215 = false) {
            return Point.fromBytes((0, utils_ts_1.ensureBytes)('point', bytes), zip215);
        }
        get x() {
            return this.toAffine().x;
        }
        get y() {
            return this.toAffine().y;
        }
        precompute(windowSize = 8, isLazy = true) {
            wnaf.createCache(this, windowSize);
            if (!isLazy)
                this.multiply(_2n); // random number
            return this;
        }
        // Useful in fromAffine() - not for fromBytes(), which always created valid points.
        assertValidity() {
            assertValidMemo(this);
        }
        // Compare one point to another.
        equals(other) {
            aextpoint(other);
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const { X: X2, Y: Y2, Z: Z2 } = other;
            const X1Z2 = modP(X1 * Z2);
            const X2Z1 = modP(X2 * Z1);
            const Y1Z2 = modP(Y1 * Z2);
            const Y2Z1 = modP(Y2 * Z1);
            return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
        }
        is0() {
            return this.equals(Point.ZERO);
        }
        negate() {
            // Flips point sign to a negative one (-x, y in affine coords)
            return new Point(modP(-this.X), this.Y, this.Z, modP(-this.T));
        }
        // Fast algo for doubling Extended Point.
        // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
        // Cost: 4M + 4S + 1*a + 6add + 1*2.
        double() {
            const { a } = CURVE;
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const A = modP(X1 * X1); // A = X12
            const B = modP(Y1 * Y1); // B = Y12
            const C = modP(_2n * modP(Z1 * Z1)); // C = 2*Z12
            const D = modP(a * A); // D = a*A
            const x1y1 = X1 + Y1;
            const E = modP(modP(x1y1 * x1y1) - A - B); // E = (X1+Y1)2-A-B
            const G = D + B; // G = D+B
            const F = G - C; // F = G-C
            const H = D - B; // H = D-B
            const X3 = modP(E * F); // X3 = E*F
            const Y3 = modP(G * H); // Y3 = G*H
            const T3 = modP(E * H); // T3 = E*H
            const Z3 = modP(F * G); // Z3 = F*G
            return new Point(X3, Y3, Z3, T3);
        }
        // Fast algo for adding 2 Extended Points.
        // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
        // Cost: 9M + 1*a + 1*d + 7add.
        add(other) {
            aextpoint(other);
            const { a, d } = CURVE;
            const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
            const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
            const A = modP(X1 * X2); // A = X1*X2
            const B = modP(Y1 * Y2); // B = Y1*Y2
            const C = modP(T1 * d * T2); // C = T1*d*T2
            const D = modP(Z1 * Z2); // D = Z1*Z2
            const E = modP((X1 + Y1) * (X2 + Y2) - A - B); // E = (X1+Y1)*(X2+Y2)-A-B
            const F = D - C; // F = D-C
            const G = D + C; // G = D+C
            const H = modP(B - a * A); // H = B-a*A
            const X3 = modP(E * F); // X3 = E*F
            const Y3 = modP(G * H); // Y3 = G*H
            const T3 = modP(E * H); // T3 = E*H
            const Z3 = modP(F * G); // Z3 = F*G
            return new Point(X3, Y3, Z3, T3);
        }
        subtract(other) {
            return this.add(other.negate());
        }
        // Constant-time multiplication.
        multiply(scalar) {
            // 1 <= scalar < L
            if (!Fn.isValidNot0(scalar))
                throw new Error('invalid scalar: expected 1 <= sc < curve.n');
            const { p, f } = wnaf.cached(this, scalar, (p) => (0, curve_ts_1.normalizeZ)(Point, p));
            return (0, curve_ts_1.normalizeZ)(Point, [p, f])[0];
        }
        // Non-constant-time multiplication. Uses double-and-add algorithm.
        // It's faster, but should only be used when you don't care about
        // an exposed private key e.g. sig verification.
        // Does NOT allow scalars higher than CURVE.n.
        // Accepts optional accumulator to merge with multiply (important for sparse scalars)
        multiplyUnsafe(scalar, acc = Point.ZERO) {
            // 0 <= scalar < L
            if (!Fn.isValid(scalar))
                throw new Error('invalid scalar: expected 0 <= sc < curve.n');
            if (scalar === _0n)
                return Point.ZERO;
            if (this.is0() || scalar === _1n)
                return this;
            return wnaf.unsafe(this, scalar, (p) => (0, curve_ts_1.normalizeZ)(Point, p), acc);
        }
        // Checks if point is of small order.
        // If you add something to small order point, you will have "dirty"
        // point with torsion component.
        // Multiplies point by cofactor and checks if the result is 0.
        isSmallOrder() {
            return this.multiplyUnsafe(cofactor).is0();
        }
        // Multiplies point by curve order and checks if the result is 0.
        // Returns `false` is the point is dirty.
        isTorsionFree() {
            return wnaf.unsafe(this, CURVE.n).is0();
        }
        // Converts Extended point to default (x, y) coordinates.
        // Can accept precomputed Z^-1 - for example, from invertBatch.
        toAffine(invertedZ) {
            return toAffineMemo(this, invertedZ);
        }
        clearCofactor() {
            if (cofactor === _1n)
                return this;
            return this.multiplyUnsafe(cofactor);
        }
        toBytes() {
            const { x, y } = this.toAffine();
            // Fp.toBytes() allows non-canonical encoding of y (>= p).
            const bytes = Fp.toBytes(y);
            // Each y has 2 valid points: (x, y), (x,-y).
            // When compressing, it's enough to store y and use the last byte to encode sign of x
            bytes[bytes.length - 1] |= x & _1n ? 0x80 : 0;
            return bytes;
        }
        toHex() {
            return (0, utils_ts_1.bytesToHex)(this.toBytes());
        }
        toString() {
            return `<Point ${this.is0() ? 'ZERO' : this.toHex()}>`;
        }
        // TODO: remove
        get ex() {
            return this.X;
        }
        get ey() {
            return this.Y;
        }
        get ez() {
            return this.Z;
        }
        get et() {
            return this.T;
        }
        static normalizeZ(points) {
            return (0, curve_ts_1.normalizeZ)(Point, points);
        }
        static msm(points, scalars) {
            return (0, curve_ts_1.pippenger)(Point, Fn, points, scalars);
        }
        _setWindowSize(windowSize) {
            this.precompute(windowSize);
        }
        toRawBytes() {
            return this.toBytes();
        }
    }
    // base / generator point
    Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n, modP(CURVE.Gx * CURVE.Gy));
    // zero / infinity / identity point
    Point.ZERO = new Point(_0n, _1n, _1n, _0n); // 0, 1, 1, 0
    // math field
    Point.Fp = Fp;
    // scalar field
    Point.Fn = Fn;
    const wnaf = new curve_ts_1.wNAF(Point, Fn.BITS);
    Point.BASE.precompute(8); // Enable precomputes. Slows down first publicKey computation by 20ms.
    return Point;
}
/**
 * Base class for prime-order points like Ristretto255 and Decaf448.
 * These points eliminate cofactor issues by representing equivalence classes
 * of Edwards curve points.
 */
class PrimeEdwardsPoint {
    constructor(ep) {
        this.ep = ep;
    }
    // Static methods that must be implemented by subclasses
    static fromBytes(_bytes) {
        (0, utils_ts_1.notImplemented)();
    }
    static fromHex(_hex) {
        (0, utils_ts_1.notImplemented)();
    }
    get x() {
        return this.toAffine().x;
    }
    get y() {
        return this.toAffine().y;
    }
    // Common implementations
    clearCofactor() {
        // no-op for prime-order groups
        return this;
    }
    assertValidity() {
        this.ep.assertValidity();
    }
    toAffine(invertedZ) {
        return this.ep.toAffine(invertedZ);
    }
    toHex() {
        return (0, utils_ts_1.bytesToHex)(this.toBytes());
    }
    toString() {
        return this.toHex();
    }
    isTorsionFree() {
        return true;
    }
    isSmallOrder() {
        return false;
    }
    add(other) {
        this.assertSame(other);
        return this.init(this.ep.add(other.ep));
    }
    subtract(other) {
        this.assertSame(other);
        return this.init(this.ep.subtract(other.ep));
    }
    multiply(scalar) {
        return this.init(this.ep.multiply(scalar));
    }
    multiplyUnsafe(scalar) {
        return this.init(this.ep.multiplyUnsafe(scalar));
    }
    double() {
        return this.init(this.ep.double());
    }
    negate() {
        return this.init(this.ep.negate());
    }
    precompute(windowSize, isLazy) {
        return this.init(this.ep.precompute(windowSize, isLazy));
    }
    /** @deprecated use `toBytes` */
    toRawBytes() {
        return this.toBytes();
    }
}
exports.PrimeEdwardsPoint = PrimeEdwardsPoint;
/**
 * Initializes EdDSA signatures over given Edwards curve.
 */
function eddsa(Point, cHash, eddsaOpts = {}) {
    if (typeof cHash !== 'function')
        throw new Error('"hash" function param is required');
    (0, utils_ts_1._validateObject)(eddsaOpts, {}, {
        adjustScalarBytes: 'function',
        randomBytes: 'function',
        domain: 'function',
        prehash: 'function',
        mapToCurve: 'function',
    });
    const { prehash } = eddsaOpts;
    const { BASE, Fp, Fn } = Point;
    const randomBytes = eddsaOpts.randomBytes || utils_ts_1.randomBytes;
    const adjustScalarBytes = eddsaOpts.adjustScalarBytes || ((bytes) => bytes);
    const domain = eddsaOpts.domain ||
        ((data, ctx, phflag) => {
            (0, utils_ts_1._abool2)(phflag, 'phflag');
            if (ctx.length || phflag)
                throw new Error('Contexts/pre-hash are not supported');
            return data;
        }); // NOOP
    // Little-endian SHA512 with modulo n
    function modN_LE(hash) {
        return Fn.create((0, utils_ts_1.bytesToNumberLE)(hash)); // Not Fn.fromBytes: it has length limit
    }
    // Get the hashed private scalar per RFC8032 5.1.5
    function getPrivateScalar(key) {
        const len = lengths.secretKey;
        key = (0, utils_ts_1.ensureBytes)('private key', key, len);
        // Hash private key with curve's hash function to produce uniformingly random input
        // Check byte lengths: ensure(64, h(ensure(32, key)))
        const hashed = (0, utils_ts_1.ensureBytes)('hashed private key', cHash(key), 2 * len);
        const head = adjustScalarBytes(hashed.slice(0, len)); // clear first half bits, produce FE
        const prefix = hashed.slice(len, 2 * len); // second half is called key prefix (5.1.6)
        const scalar = modN_LE(head); // The actual private scalar
        return { head, prefix, scalar };
    }
    /** Convenience method that creates public key from scalar. RFC8032 5.1.5 */
    function getExtendedPublicKey(secretKey) {
        const { head, prefix, scalar } = getPrivateScalar(secretKey);
        const point = BASE.multiply(scalar); // Point on Edwards curve aka public key
        const pointBytes = point.toBytes();
        return { head, prefix, scalar, point, pointBytes };
    }
    /** Calculates EdDSA pub key. RFC8032 5.1.5. */
    function getPublicKey(secretKey) {
        return getExtendedPublicKey(secretKey).pointBytes;
    }
    // int('LE', SHA512(dom2(F, C) || msgs)) mod N
    function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
        const msg = (0, utils_ts_1.concatBytes)(...msgs);
        return modN_LE(cHash(domain(msg, (0, utils_ts_1.ensureBytes)('context', context), !!prehash)));
    }
    /** Signs message with privateKey. RFC8032 5.1.6 */
    function sign(msg, secretKey, options = {}) {
        msg = (0, utils_ts_1.ensureBytes)('message', msg);
        if (prehash)
            msg = prehash(msg); // for ed25519ph etc.
        const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
        const r = hashDomainToScalar(options.context, prefix, msg); // r = dom2(F, C) || prefix || PH(M)
        const R = BASE.multiply(r).toBytes(); // R = rG
        const k = hashDomainToScalar(options.context, R, pointBytes, msg); // R || A || PH(M)
        const s = Fn.create(r + k * scalar); // S = (r + k * s) mod L
        if (!Fn.isValid(s))
            throw new Error('sign failed: invalid s'); // 0 <= s < L
        const rs = (0, utils_ts_1.concatBytes)(R, Fn.toBytes(s));
        return (0, utils_ts_1._abytes2)(rs, lengths.signature, 'result');
    }
    // verification rule is either zip215 or rfc8032 / nist186-5. Consult fromHex:
    const verifyOpts = { zip215: true };
    /**
     * Verifies EdDSA signature against message and public key. RFC8032 5.1.7.
     * An extended group equation is checked.
     */
    function verify(sig, msg, publicKey, options = verifyOpts) {
        const { context, zip215 } = options;
        const len = lengths.signature;
        sig = (0, utils_ts_1.ensureBytes)('signature', sig, len);
        msg = (0, utils_ts_1.ensureBytes)('message', msg);
        publicKey = (0, utils_ts_1.ensureBytes)('publicKey', publicKey, lengths.publicKey);
        if (zip215 !== undefined)
            (0, utils_ts_1._abool2)(zip215, 'zip215');
        if (prehash)
            msg = prehash(msg); // for ed25519ph, etc
        const mid = len / 2;
        const r = sig.subarray(0, mid);
        const s = (0, utils_ts_1.bytesToNumberLE)(sig.subarray(mid, len));
        let A, R, SB;
        try {
            // zip215=true is good for consensus-critical apps. =false follows RFC8032 / NIST186-5.
            // zip215=true:  0 <= y < MASK (2^256 for ed25519)
            // zip215=false: 0 <= y < P (2^255-19 for ed25519)
            A = Point.fromBytes(publicKey, zip215);
            R = Point.fromBytes(r, zip215);
            SB = BASE.multiplyUnsafe(s); // 0 <= s < l is done inside
        }
        catch (error) {
            return false;
        }
        if (!zip215 && A.isSmallOrder())
            return false; // zip215 allows public keys of small order
        const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
        const RkA = R.add(A.multiplyUnsafe(k));
        // Extended group equation
        // [8][S]B = [8]R + [8][k]A'
        return RkA.subtract(SB).clearCofactor().is0();
    }
    const _size = Fp.BYTES; // 32 for ed25519, 57 for ed448
    const lengths = {
        secretKey: _size,
        publicKey: _size,
        signature: 2 * _size,
        seed: _size,
    };
    function randomSecretKey(seed = randomBytes(lengths.seed)) {
        return (0, utils_ts_1._abytes2)(seed, lengths.seed, 'seed');
    }
    function keygen(seed) {
        const secretKey = utils.randomSecretKey(seed);
        return { secretKey, publicKey: getPublicKey(secretKey) };
    }
    function isValidSecretKey(key) {
        return (0, utils_ts_1.isBytes)(key) && key.length === Fn.BYTES;
    }
    function isValidPublicKey(key, zip215) {
        try {
            return !!Point.fromBytes(key, zip215);
        }
        catch (error) {
            return false;
        }
    }
    const utils = {
        getExtendedPublicKey,
        randomSecretKey,
        isValidSecretKey,
        isValidPublicKey,
        /**
         * Converts ed public key to x public key. Uses formula:
         * - ed25519:
         *   - `(u, v) = ((1+y)/(1-y), sqrt(-486664)*u/x)`
         *   - `(x, y) = (sqrt(-486664)*u/v, (u-1)/(u+1))`
         * - ed448:
         *   - `(u, v) = ((y-1)/(y+1), sqrt(156324)*u/x)`
         *   - `(x, y) = (sqrt(156324)*u/v, (1+u)/(1-u))`
         */
        toMontgomery(publicKey) {
            const { y } = Point.fromBytes(publicKey);
            const size = lengths.publicKey;
            const is25519 = size === 32;
            if (!is25519 && size !== 57)
                throw new Error('only defined for 25519 and 448');
            const u = is25519 ? Fp.div(_1n + y, _1n - y) : Fp.div(y - _1n, y + _1n);
            return Fp.toBytes(u);
        },
        toMontgomerySecret(secretKey) {
            const size = lengths.secretKey;
            (0, utils_ts_1._abytes2)(secretKey, size);
            const hashed = cHash(secretKey.subarray(0, size));
            return adjustScalarBytes(hashed).subarray(0, size);
        },
        /** @deprecated */
        randomPrivateKey: randomSecretKey,
        /** @deprecated */
        precompute(windowSize = 8, point = Point.BASE) {
            return point.precompute(windowSize, false);
        },
    };
    return Object.freeze({
        keygen,
        getPublicKey,
        sign,
        verify,
        utils,
        Point,
        lengths,
    });
}
function _eddsa_legacy_opts_to_new(c) {
    const CURVE = {
        a: c.a,
        d: c.d,
        p: c.Fp.ORDER,
        n: c.n,
        h: c.h,
        Gx: c.Gx,
        Gy: c.Gy,
    };
    const Fp = c.Fp;
    const Fn = (0, modular_ts_1.Field)(CURVE.n, c.nBitLength, true);
    const curveOpts = { Fp, Fn, uvRatio: c.uvRatio };
    const eddsaOpts = {
        randomBytes: c.randomBytes,
        adjustScalarBytes: c.adjustScalarBytes,
        domain: c.domain,
        prehash: c.prehash,
        mapToCurve: c.mapToCurve,
    };
    return { CURVE, curveOpts, hash: c.hash, eddsaOpts };
}
function _eddsa_new_output_to_legacy(c, eddsa) {
    const Point = eddsa.Point;
    const legacy = Object.assign({}, eddsa, {
        ExtendedPoint: Point,
        CURVE: c,
        nBitLength: Point.Fn.BITS,
        nByteLength: Point.Fn.BYTES,
    });
    return legacy;
}
// TODO: remove. Use eddsa
function twistedEdwards(c) {
    const { CURVE, curveOpts, hash, eddsaOpts } = _eddsa_legacy_opts_to_new(c);
    const Point = edwards(CURVE, curveOpts);
    const EDDSA = eddsa(Point, hash, eddsaOpts);
    return _eddsa_new_output_to_legacy(c, EDDSA);
}
//# sourceMappingURL=edwards.js.map
    },
    28: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bls12_381 = exports.bls12_381_Fr = void 0;
/**
 * bls12-381 is pairing-friendly Barreto-Lynn-Scott elliptic curve construction allowing to:

* Construct zk-SNARKs at the ~120-bit security, as per [Barbulescu-Duquesne 2017](https://hal.science/hal-01534101/file/main.pdf)
* Efficiently verify N aggregate signatures with 1 pairing and N ec additions:
the Boneh-Lynn-Shacham signature scheme is orders of magnitude more efficient than Schnorr

BLS can mean 2 different things:

* Barreto-Lynn-Scott: BLS12, a Pairing Friendly Elliptic Curve
* Boneh-Lynn-Shacham: A Signature Scheme.

### Summary

1. BLS Relies on expensive bilinear pairing
2. Secret Keys: 32 bytes
3. Public Keys: 48 OR 96 bytes - big-endian x coordinate of point on G1 OR G2 curve
4. Signatures: 96 OR 48 bytes - big-endian x coordinate of point on G2 OR G1 curve
5. The 12 stands for the Embedding degree.

Modes of operation:

* Long signatures:  48-byte keys + 96-byte sigs (G1 keys + G2 sigs).
* Short signatures: 96-byte keys + 48-byte sigs (G2 keys + G1 sigs).

### Formulas

- `P = pk x G` - public keys
- `S = pk x H(m)` - signing, uses hash-to-curve on m
- `e(P, H(m)) == e(G, S)` - verification using pairings
- `e(G, S) = e(G, SUM(n)(Si)) = MUL(n)(e(G, Si))` - signature aggregation

### Curves

G1 is ordinary elliptic curve. G2 is extension field curve, think "over complex numbers".

- G1: y² = x³ + 4
- G2: y² = x³ + 4(u + 1) where u = √−1; r-order subgroup of E'(Fp²), M-type twist

### Towers

Pairing G1 + G2 produces element in Fp₁₂, 12-degree polynomial.
Fp₁₂ is usually implemented using tower of lower-degree polynomials for speed.

- Fp₁₂ = Fp₆² => Fp₂³
- Fp(u) / (u² - β) where β = -1
- Fp₂(v) / (v³ - ξ) where ξ = u + 1
- Fp₆(w) / (w² - γ) where γ = v
- Fp²[u] = Fp/u²+1
- Fp⁶[v] = Fp²/v³-1-u
- Fp¹²[w] = Fp⁶/w²-v

### Params

* Embedding degree (k): 12
* Seed is sometimes named x or t
* t = -15132376222941642752
* p = (t-1)² * (t⁴-t²+1)/3 + t
* r = t⁴-t²+1
* Ate loop size: X

To verify curve parameters, see
[pairing-friendly-curves spec](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-pairing-friendly-curves-11).
Basic math is done over finite fields over p.
More complicated math is done over polynominal extension fields.

### Compatibility and notes
1. It is compatible with Algorand, Chia, Dfinity, Ethereum, Filecoin, ZEC.
Filecoin uses little endian byte arrays for secret keys - make sure to reverse byte order.
2. Make sure to correctly select mode: "long signature" or "short signature".
3. Compatible with specs:
   RFC 9380,
   [cfrg-pairing-friendly-curves-11](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-pairing-friendly-curves-11),
   [cfrg-bls-signature-05](https://datatracker.ietf.org/doc/draft-irtf-cfrg-bls-signature/).

 *
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const sha2_js_1 = require("@noble/hashes/sha2.js");
const bls_ts_1 = require("./abstract/bls.js");
const modular_ts_1 = require("./abstract/modular.js");
const utils_ts_1 = require("./utils.js");
// Types
const hash_to_curve_ts_1 = require("./abstract/hash-to-curve.js");
const tower_ts_1 = require("./abstract/tower.js");
const weierstrass_ts_1 = require("./abstract/weierstrass.js");
// Be friendly to bad ECMAScript parsers by not using bigint literals
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3), _4n = BigInt(4);
// To verify math:
// https://tools.ietf.org/html/draft-irtf-cfrg-pairing-friendly-curves-11
// The BLS parameter x (seed) for BLS12-381. NOTE: it is negative!
// x = -2^63 - 2^62 - 2^60 - 2^57 - 2^48 - 2^16
const BLS_X = BigInt('0xd201000000010000');
// t = x (called differently in different places)
// const t = -BLS_X;
const BLS_X_LEN = (0, utils_ts_1.bitLen)(BLS_X);
// a=0, b=4
// P is characteristic of field Fp, in which curve calculations are done.
// p = (t-1)² * (t⁴-t²+1)/3 + t
// bls12_381_Fp = (t-1n)**2n * (t**4n - t**2n + 1n) / 3n + t
// r*h is curve order, amount of points on curve,
// where r is order of prime subgroup and h is cofactor.
// r = t⁴-t²+1
// r = (t**4n - t**2n + 1n)
// cofactor h of G1: (t - 1)²/3
// cofactorG1 = (t-1n)**2n/3n
// x = 3685416753713387016781088315183077757961620795782546409894578378688607592378376318836054947676345821548104185464507
// y = 1339506544944476473020471379941921221584933875938349620426543736416511423956333506472724655353366534992391756441569
const bls12_381_CURVE_G1 = {
    p: BigInt('0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab'),
    n: BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001'),
    h: BigInt('0x396c8c005555e1568c00aaab0000aaab'),
    a: _0n,
    b: _4n,
    Gx: BigInt('0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb'),
    Gy: BigInt('0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1'),
};
// CURVE FIELDS
exports.bls12_381_Fr = (0, modular_ts_1.Field)(bls12_381_CURVE_G1.n, {
    modFromBytes: true,
    isLE: true,
});
const { Fp, Fp2, Fp6, Fp12 } = (0, tower_ts_1.tower12)({
    ORDER: bls12_381_CURVE_G1.p,
    X_LEN: BLS_X_LEN,
    // Finite extension field over irreducible polynominal.
    // Fp(u) / (u² - β) where β = -1
    FP2_NONRESIDUE: [_1n, _1n],
    Fp2mulByB: ({ c0, c1 }) => {
        const t0 = Fp.mul(c0, _4n); // 4 * c0
        const t1 = Fp.mul(c1, _4n); // 4 * c1
        // (T0-T1) + (T0+T1)*i
        return { c0: Fp.sub(t0, t1), c1: Fp.add(t0, t1) };
    },
    Fp12finalExponentiate: (num) => {
        const x = BLS_X;
        // this^(q⁶) / this
        const t0 = Fp12.div(Fp12.frobeniusMap(num, 6), num);
        // t0^(q²) * t0
        const t1 = Fp12.mul(Fp12.frobeniusMap(t0, 2), t0);
        const t2 = Fp12.conjugate(Fp12._cyclotomicExp(t1, x));
        const t3 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicSquare(t1)), t2);
        const t4 = Fp12.conjugate(Fp12._cyclotomicExp(t3, x));
        const t5 = Fp12.conjugate(Fp12._cyclotomicExp(t4, x));
        const t6 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicExp(t5, x)), Fp12._cyclotomicSquare(t2));
        const t7 = Fp12.conjugate(Fp12._cyclotomicExp(t6, x));
        const t2_t5_pow_q2 = Fp12.frobeniusMap(Fp12.mul(t2, t5), 2);
        const t4_t1_pow_q3 = Fp12.frobeniusMap(Fp12.mul(t4, t1), 3);
        const t6_t1c_pow_q1 = Fp12.frobeniusMap(Fp12.mul(t6, Fp12.conjugate(t1)), 1);
        const t7_t3c_t1 = Fp12.mul(Fp12.mul(t7, Fp12.conjugate(t3)), t1);
        // (t2 * t5)^(q²) * (t4 * t1)^(q³) * (t6 * t1.conj)^(q^1) * t7 * t3.conj * t1
        return Fp12.mul(Fp12.mul(Fp12.mul(t2_t5_pow_q2, t4_t1_pow_q3), t6_t1c_pow_q1), t7_t3c_t1);
    },
});
// GLV endomorphism Ψ(P), for fast cofactor clearing
const { G2psi, G2psi2 } = (0, tower_ts_1.psiFrobenius)(Fp, Fp2, Fp2.div(Fp2.ONE, Fp2.NONRESIDUE)); // 1/(u+1)
/**
 * Default hash_to_field / hash-to-curve for BLS.
 * m: 1 for G1, 2 for G2
 * k: target security level in bits
 * hash: any function, e.g. BBS+ uses BLAKE2: see [github](https://github.com/hyperledger/aries-framework-go/issues/2247).
 * Parameter values come from [section 8.8.2 of RFC 9380](https://www.rfc-editor.org/rfc/rfc9380#section-8.8.2).
 */
const htfDefaults = Object.freeze({
    DST: 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_',
    encodeDST: 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_',
    p: Fp.ORDER,
    m: 2,
    k: 128,
    expand: 'xmd',
    hash: sha2_js_1.sha256,
});
// a=0, b=4
// cofactor h of G2
// (t^8 - 4t^7 + 5t^6 - 4t^4 + 6t^3 - 4t^2 - 4t + 13)/9
// cofactorG2 = (t**8n - 4n*t**7n + 5n*t**6n - 4n*t**4n + 6n*t**3n - 4n*t**2n - 4n*t+13n)/9n
// x = 3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758*u + 352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160
// y = 927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582*u + 1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905
const bls12_381_CURVE_G2 = {
    p: Fp2.ORDER,
    n: bls12_381_CURVE_G1.n,
    h: BigInt('0x5d543a95414e7f1091d50792876a202cd91de4547085abaa68a205b2e5a7ddfa628f1cb4d9e82ef21537e293a6691ae1616ec6e786f0c70cf1c38e31c7238e5'),
    a: Fp2.ZERO,
    b: Fp2.fromBigTuple([_4n, _4n]),
    Gx: Fp2.fromBigTuple([
        BigInt('0x024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8'),
        BigInt('0x13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e'),
    ]),
    Gy: Fp2.fromBigTuple([
        BigInt('0x0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801'),
        BigInt('0x0606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be'),
    ]),
};
// Encoding utils
// Compressed point of infinity
// Set compressed & point-at-infinity bits
const COMPZERO = setMask(Fp.toBytes(_0n), { infinity: true, compressed: true });
function parseMask(bytes) {
    // Copy, so we can remove mask data. It will be removed also later, when Fp.create will call modulo.
    bytes = bytes.slice();
    const mask = bytes[0] & 224;
    const compressed = !!((mask >> 7) & 1); // compression bit (0b1000_0000)
    const infinity = !!((mask >> 6) & 1); // point at infinity bit (0b0100_0000)
    const sort = !!((mask >> 5) & 1); // sort bit (0b0010_0000)
    bytes[0] &= 31; // clear mask (zero first 3 bits)
    return { compressed, infinity, sort, value: bytes };
}
function setMask(bytes, mask) {
    if (bytes[0] & 224)
        throw new Error('setMask: non-empty mask');
    if (mask.compressed)
        bytes[0] |= 128;
    if (mask.infinity)
        bytes[0] |= 64;
    if (mask.sort)
        bytes[0] |= 32;
    return bytes;
}
function pointG1ToBytes(_c, point, isComp) {
    const { BYTES: L, ORDER: P } = Fp;
    const is0 = point.is0();
    const { x, y } = point.toAffine();
    if (isComp) {
        if (is0)
            return COMPZERO.slice();
        const sort = Boolean((y * _2n) / P);
        return setMask((0, utils_ts_1.numberToBytesBE)(x, L), { compressed: true, sort });
    }
    else {
        if (is0) {
            return (0, utils_ts_1.concatBytes)(Uint8Array.of(0x40), new Uint8Array(2 * L - 1));
        }
        else {
            return (0, utils_ts_1.concatBytes)((0, utils_ts_1.numberToBytesBE)(x, L), (0, utils_ts_1.numberToBytesBE)(y, L));
        }
    }
}
function signatureG1ToBytes(point) {
    point.assertValidity();
    const { BYTES: L, ORDER: P } = Fp;
    const { x, y } = point.toAffine();
    if (point.is0())
        return COMPZERO.slice();
    const sort = Boolean((y * _2n) / P);
    return setMask((0, utils_ts_1.numberToBytesBE)(x, L), { compressed: true, sort });
}
function pointG1FromBytes(bytes) {
    const { compressed, infinity, sort, value } = parseMask(bytes);
    const { BYTES: L, ORDER: P } = Fp;
    if (value.length === 48 && compressed) {
        const compressedValue = (0, utils_ts_1.bytesToNumberBE)(value);
        // Zero
        const x = Fp.create(compressedValue & (0, utils_ts_1.bitMask)(Fp.BITS));
        if (infinity) {
            if (x !== _0n)
                throw new Error('invalid G1 point: non-empty, at infinity, with compression');
            return { x: _0n, y: _0n };
        }
        const right = Fp.add(Fp.pow(x, _3n), Fp.create(bls12_381_CURVE_G1.b)); // y² = x³ + b
        let y = Fp.sqrt(right);
        if (!y)
            throw new Error('invalid G1 point: compressed point');
        if ((y * _2n) / P !== BigInt(sort))
            y = Fp.neg(y);
        return { x: Fp.create(x), y: Fp.create(y) };
    }
    else if (value.length === 96 && !compressed) {
        // Check if the infinity flag is set
        const x = (0, utils_ts_1.bytesToNumberBE)(value.subarray(0, L));
        const y = (0, utils_ts_1.bytesToNumberBE)(value.subarray(L));
        if (infinity) {
            if (x !== _0n || y !== _0n)
                throw new Error('G1: non-empty point at infinity');
            return exports.bls12_381.G1.Point.ZERO.toAffine();
        }
        return { x: Fp.create(x), y: Fp.create(y) };
    }
    else {
        throw new Error('invalid G1 point: expected 48/96 bytes');
    }
}
function signatureG1FromBytes(hex) {
    const { infinity, sort, value } = parseMask((0, utils_ts_1.ensureBytes)('signatureHex', hex, 48));
    const P = Fp.ORDER;
    const Point = exports.bls12_381.G1.Point;
    const compressedValue = (0, utils_ts_1.bytesToNumberBE)(value);
    // Zero
    if (infinity)
        return Point.ZERO;
    const x = Fp.create(compressedValue & (0, utils_ts_1.bitMask)(Fp.BITS));
    const right = Fp.add(Fp.pow(x, _3n), Fp.create(bls12_381_CURVE_G1.b)); // y² = x³ + b
    let y = Fp.sqrt(right);
    if (!y)
        throw new Error('invalid G1 point: compressed');
    const aflag = BigInt(sort);
    if ((y * _2n) / P !== aflag)
        y = Fp.neg(y);
    const point = Point.fromAffine({ x, y });
    point.assertValidity();
    return point;
}
function pointG2ToBytes(_c, point, isComp) {
    const { BYTES: L, ORDER: P } = Fp;
    const is0 = point.is0();
    const { x, y } = point.toAffine();
    if (isComp) {
        if (is0)
            return (0, utils_ts_1.concatBytes)(COMPZERO, (0, utils_ts_1.numberToBytesBE)(_0n, L));
        const flag = Boolean(y.c1 === _0n ? (y.c0 * _2n) / P : (y.c1 * _2n) / P);
        return (0, utils_ts_1.concatBytes)(setMask((0, utils_ts_1.numberToBytesBE)(x.c1, L), { compressed: true, sort: flag }), (0, utils_ts_1.numberToBytesBE)(x.c0, L));
    }
    else {
        if (is0)
            return (0, utils_ts_1.concatBytes)(Uint8Array.of(0x40), new Uint8Array(4 * L - 1));
        const { re: x0, im: x1 } = Fp2.reim(x);
        const { re: y0, im: y1 } = Fp2.reim(y);
        return (0, utils_ts_1.concatBytes)((0, utils_ts_1.numberToBytesBE)(x1, L), (0, utils_ts_1.numberToBytesBE)(x0, L), (0, utils_ts_1.numberToBytesBE)(y1, L), (0, utils_ts_1.numberToBytesBE)(y0, L));
    }
}
function signatureG2ToBytes(point) {
    point.assertValidity();
    const { BYTES: L } = Fp;
    if (point.is0())
        return (0, utils_ts_1.concatBytes)(COMPZERO, (0, utils_ts_1.numberToBytesBE)(_0n, L));
    const { x, y } = point.toAffine();
    const { re: x0, im: x1 } = Fp2.reim(x);
    const { re: y0, im: y1 } = Fp2.reim(y);
    const tmp = y1 > _0n ? y1 * _2n : y0 * _2n;
    const sort = Boolean((tmp / Fp.ORDER) & _1n);
    const z2 = x0;
    return (0, utils_ts_1.concatBytes)(setMask((0, utils_ts_1.numberToBytesBE)(x1, L), { sort, compressed: true }), (0, utils_ts_1.numberToBytesBE)(z2, L));
}
function pointG2FromBytes(bytes) {
    const { BYTES: L, ORDER: P } = Fp;
    const { compressed, infinity, sort, value } = parseMask(bytes);
    if ((!compressed && !infinity && sort) || // 00100000
        (!compressed && infinity && sort) || // 01100000
        (sort && infinity && compressed) // 11100000
    ) {
        throw new Error('invalid encoding flag: ' + (bytes[0] & 224));
    }
    const slc = (b, from, to) => (0, utils_ts_1.bytesToNumberBE)(b.slice(from, to));
    if (value.length === 96 && compressed) {
        if (infinity) {
            // check that all bytes are 0
            if (value.reduce((p, c) => (p !== 0 ? c + 1 : c), 0) > 0) {
                throw new Error('invalid G2 point: compressed');
            }
            return { x: Fp2.ZERO, y: Fp2.ZERO };
        }
        const x_1 = slc(value, 0, L);
        const x_0 = slc(value, L, 2 * L);
        const x = Fp2.create({ c0: Fp.create(x_0), c1: Fp.create(x_1) });
        const right = Fp2.add(Fp2.pow(x, _3n), bls12_381_CURVE_G2.b); // y² = x³ + 4 * (u+1) = x³ + b
        let y = Fp2.sqrt(right);
        const Y_bit = y.c1 === _0n ? (y.c0 * _2n) / P : (y.c1 * _2n) / P ? _1n : _0n;
        y = sort && Y_bit > 0 ? y : Fp2.neg(y);
        return { x, y };
    }
    else if (value.length === 192 && !compressed) {
        if (infinity) {
            if (value.reduce((p, c) => (p !== 0 ? c + 1 : c), 0) > 0) {
                throw new Error('invalid G2 point: uncompressed');
            }
            return { x: Fp2.ZERO, y: Fp2.ZERO };
        }
        const x1 = slc(value, 0 * L, 1 * L);
        const x0 = slc(value, 1 * L, 2 * L);
        const y1 = slc(value, 2 * L, 3 * L);
        const y0 = slc(value, 3 * L, 4 * L);
        return { x: Fp2.fromBigTuple([x0, x1]), y: Fp2.fromBigTuple([y0, y1]) };
    }
    else {
        throw new Error('invalid G2 point: expected 96/192 bytes');
    }
}
function signatureG2FromBytes(hex) {
    const { ORDER: P } = Fp;
    // TODO: Optimize, it's very slow because of sqrt.
    const { infinity, sort, value } = parseMask((0, utils_ts_1.ensureBytes)('signatureHex', hex));
    const Point = exports.bls12_381.G2.Point;
    const half = value.length / 2;
    if (half !== 48 && half !== 96)
        throw new Error('invalid compressed signature length, expected 96/192 bytes');
    const z1 = (0, utils_ts_1.bytesToNumberBE)(value.slice(0, half));
    const z2 = (0, utils_ts_1.bytesToNumberBE)(value.slice(half));
    // Indicates the infinity point
    if (infinity)
        return Point.ZERO;
    const x1 = Fp.create(z1 & (0, utils_ts_1.bitMask)(Fp.BITS));
    const x2 = Fp.create(z2);
    const x = Fp2.create({ c0: x2, c1: x1 });
    const y2 = Fp2.add(Fp2.pow(x, _3n), bls12_381_CURVE_G2.b); // y² = x³ + 4
    // The slow part
    let y = Fp2.sqrt(y2);
    if (!y)
        throw new Error('Failed to find a square root');
    // Choose the y whose leftmost bit of the imaginary part is equal to the a_flag1
    // If y1 happens to be zero, then use the bit of y0
    const { re: y0, im: y1 } = Fp2.reim(y);
    const aflag1 = BigInt(sort);
    const isGreater = y1 > _0n && (y1 * _2n) / P !== aflag1;
    const is0 = y1 === _0n && (y0 * _2n) / P !== aflag1;
    if (isGreater || is0)
        y = Fp2.neg(y);
    const point = Point.fromAffine({ x, y });
    point.assertValidity();
    return point;
}
/**
 * bls12-381 pairing-friendly curve.
 * @example
 * import { bls12_381 as bls } from '@noble/curves/bls12-381';
 * // G1 keys, G2 signatures
 * const privateKey = '67d53f170b908cabb9eb326c3c337762d59289a8fec79f7bc9254b584b73265c';
 * const message = '64726e3da8';
 * const publicKey = bls.getPublicKey(privateKey);
 * const signature = bls.sign(message, privateKey);
 * const isValid = bls.verify(signature, message, publicKey);
 */
exports.bls12_381 = (0, bls_ts_1.bls)({
    // Fields
    fields: {
        Fp,
        Fp2,
        Fp6,
        Fp12,
        Fr: exports.bls12_381_Fr,
    },
    // G1: y² = x³ + 4
    G1: {
        ...bls12_381_CURVE_G1,
        Fp,
        htfDefaults: { ...htfDefaults, m: 1, DST: 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_' },
        wrapPrivateKey: true,
        allowInfinityPoint: true,
        // Checks is the point resides in prime-order subgroup.
        // point.isTorsionFree() should return true for valid points
        // It returns false for shitty points.
        // https://eprint.iacr.org/2021/1130.pdf
        isTorsionFree: (c, point) => {
            // GLV endomorphism ψ(P)
            const beta = BigInt('0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffe');
            const phi = new c(Fp.mul(point.X, beta), point.Y, point.Z);
            // TODO: unroll
            const xP = point.multiplyUnsafe(BLS_X).negate(); // [x]P
            const u2P = xP.multiplyUnsafe(BLS_X); // [u2]P
            return u2P.equals(phi);
        },
        // Clear cofactor of G1
        // https://eprint.iacr.org/2019/403
        clearCofactor: (_c, point) => {
            // return this.multiplyUnsafe(CURVE.h);
            return point.multiplyUnsafe(BLS_X).add(point); // x*P + P
        },
        mapToCurve: mapToG1,
        fromBytes: pointG1FromBytes,
        toBytes: pointG1ToBytes,
        ShortSignature: {
            fromBytes(bytes) {
                (0, utils_ts_1.abytes)(bytes);
                return signatureG1FromBytes(bytes);
            },
            fromHex(hex) {
                return signatureG1FromBytes(hex);
            },
            toBytes(point) {
                return signatureG1ToBytes(point);
            },
            toRawBytes(point) {
                return signatureG1ToBytes(point);
            },
            toHex(point) {
                return (0, utils_ts_1.bytesToHex)(signatureG1ToBytes(point));
            },
        },
    },
    G2: {
        ...bls12_381_CURVE_G2,
        Fp: Fp2,
        // https://datatracker.ietf.org/doc/html/rfc9380#name-clearing-the-cofactor
        // https://datatracker.ietf.org/doc/html/rfc9380#name-cofactor-clearing-for-bls12
        hEff: BigInt('0xbc69f08f2ee75b3584c6a0ea91b352888e2a8e9145ad7689986ff031508ffe1329c2f178731db956d82bf015d1212b02ec0ec69d7477c1ae954cbc06689f6a359894c0adebbf6b4e8020005aaa95551'),
        htfDefaults: { ...htfDefaults },
        wrapPrivateKey: true,
        allowInfinityPoint: true,
        mapToCurve: mapToG2,
        // Checks is the point resides in prime-order subgroup.
        // point.isTorsionFree() should return true for valid points
        // It returns false for shitty points.
        // https://eprint.iacr.org/2021/1130.pdf
        // Older version: https://eprint.iacr.org/2019/814.pdf
        isTorsionFree: (c, P) => {
            return P.multiplyUnsafe(BLS_X).negate().equals(G2psi(c, P)); // ψ(P) == [u](P)
        },
        // Maps the point into the prime-order subgroup G2.
        // clear_cofactor_bls12381_g2 from RFC 9380.
        // https://eprint.iacr.org/2017/419.pdf
        // prettier-ignore
        clearCofactor: (c, P) => {
            const x = BLS_X;
            let t1 = P.multiplyUnsafe(x).negate(); // [-x]P
            let t2 = G2psi(c, P); // Ψ(P)
            let t3 = P.double(); // 2P
            t3 = G2psi2(c, t3); // Ψ²(2P)
            t3 = t3.subtract(t2); // Ψ²(2P) - Ψ(P)
            t2 = t1.add(t2); // [-x]P + Ψ(P)
            t2 = t2.multiplyUnsafe(x).negate(); // [x²]P - [x]Ψ(P)
            t3 = t3.add(t2); // Ψ²(2P) - Ψ(P) + [x²]P - [x]Ψ(P)
            t3 = t3.subtract(t1); // Ψ²(2P) - Ψ(P) + [x²]P - [x]Ψ(P) + [x]P
            const Q = t3.subtract(P); // Ψ²(2P) - Ψ(P) + [x²]P - [x]Ψ(P) + [x]P - 1P
            return Q; // [x²-x-1]P + [x-1]Ψ(P) + Ψ²(2P)
        },
        fromBytes: pointG2FromBytes,
        toBytes: pointG2ToBytes,
        Signature: {
            fromBytes(bytes) {
                (0, utils_ts_1.abytes)(bytes);
                return signatureG2FromBytes(bytes);
            },
            fromHex(hex) {
                return signatureG2FromBytes(hex);
            },
            toBytes(point) {
                return signatureG2ToBytes(point);
            },
            toRawBytes(point) {
                return signatureG2ToBytes(point);
            },
            toHex(point) {
                return (0, utils_ts_1.bytesToHex)(signatureG2ToBytes(point));
            },
        },
    },
    params: {
        ateLoopSize: BLS_X, // The BLS parameter x for BLS12-381
        r: bls12_381_CURVE_G1.n, // order; z⁴ − z² + 1; CURVE.n from other curves
        xNegative: true,
        twistType: 'multiplicative',
    },
    htfDefaults,
    hash: sha2_js_1.sha256,
});
// 3-isogeny map from E' to E https://www.rfc-editor.org/rfc/rfc9380#appendix-E.3
const isogenyMapG2 = (0, hash_to_curve_ts_1.isogenyMap)(Fp2, [
    // xNum
    [
        [
            '0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6',
            '0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6',
        ],
        [
            '0x0',
            '0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71a',
        ],
        [
            '0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71e',
            '0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38d',
        ],
        [
            '0x171d6541fa38ccfaed6dea691f5fb614cb14b4e7f4e810aa22d6108f142b85757098e38d0f671c7188e2aaaaaaaa5ed1',
            '0x0',
        ],
    ],
    // xDen
    [
        [
            '0x0',
            '0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa63',
        ],
        [
            '0xc',
            '0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa9f',
        ],
        ['0x1', '0x0'], // LAST 1
    ],
    // yNum
    [
        [
            '0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706',
            '0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706',
        ],
        [
            '0x0',
            '0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97be',
        ],
        [
            '0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71c',
            '0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38f',
        ],
        [
            '0x124c9ad43b6cf79bfbf7043de3811ad0761b0f37a1e26286b0e977c69aa274524e79097a56dc4bd9e1b371c71c718b10',
            '0x0',
        ],
    ],
    // yDen
    [
        [
            '0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb',
            '0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb',
        ],
        [
            '0x0',
            '0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa9d3',
        ],
        [
            '0x12',
            '0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa99',
        ],
        ['0x1', '0x0'], // LAST 1
    ],
].map((i) => i.map((pair) => Fp2.fromBigTuple(pair.map(BigInt)))));
// 11-isogeny map from E' to E
const isogenyMapG1 = (0, hash_to_curve_ts_1.isogenyMap)(Fp, [
    // xNum
    [
        '0x11a05f2b1e833340b809101dd99815856b303e88a2d7005ff2627b56cdb4e2c85610c2d5f2e62d6eaeac1662734649b7',
        '0x17294ed3e943ab2f0588bab22147a81c7c17e75b2f6a8417f565e33c70d1e86b4838f2a6f318c356e834eef1b3cb83bb',
        '0xd54005db97678ec1d1048c5d10a9a1bce032473295983e56878e501ec68e25c958c3e3d2a09729fe0179f9dac9edcb0',
        '0x1778e7166fcc6db74e0609d307e55412d7f5e4656a8dbf25f1b33289f1b330835336e25ce3107193c5b388641d9b6861',
        '0xe99726a3199f4436642b4b3e4118e5499db995a1257fb3f086eeb65982fac18985a286f301e77c451154ce9ac8895d9',
        '0x1630c3250d7313ff01d1201bf7a74ab5db3cb17dd952799b9ed3ab9097e68f90a0870d2dcae73d19cd13c1c66f652983',
        '0xd6ed6553fe44d296a3726c38ae652bfb11586264f0f8ce19008e218f9c86b2a8da25128c1052ecaddd7f225a139ed84',
        '0x17b81e7701abdbe2e8743884d1117e53356de5ab275b4db1a682c62ef0f2753339b7c8f8c8f475af9ccb5618e3f0c88e',
        '0x80d3cf1f9a78fc47b90b33563be990dc43b756ce79f5574a2c596c928c5d1de4fa295f296b74e956d71986a8497e317',
        '0x169b1f8e1bcfa7c42e0c37515d138f22dd2ecb803a0c5c99676314baf4bb1b7fa3190b2edc0327797f241067be390c9e',
        '0x10321da079ce07e272d8ec09d2565b0dfa7dccdde6787f96d50af36003b14866f69b771f8c285decca67df3f1605fb7b',
        '0x6e08c248e260e70bd1e962381edee3d31d79d7e22c837bc23c0bf1bc24c6b68c24b1b80b64d391fa9c8ba2e8ba2d229',
    ],
    // xDen
    [
        '0x8ca8d548cff19ae18b2e62f4bd3fa6f01d5ef4ba35b48ba9c9588617fc8ac62b558d681be343df8993cf9fa40d21b1c',
        '0x12561a5deb559c4348b4711298e536367041e8ca0cf0800c0126c2588c48bf5713daa8846cb026e9e5c8276ec82b3bff',
        '0xb2962fe57a3225e8137e629bff2991f6f89416f5a718cd1fca64e00b11aceacd6a3d0967c94fedcfcc239ba5cb83e19',
        '0x3425581a58ae2fec83aafef7c40eb545b08243f16b1655154cca8abc28d6fd04976d5243eecf5c4130de8938dc62cd8',
        '0x13a8e162022914a80a6f1d5f43e7a07dffdfc759a12062bb8d6b44e833b306da9bd29ba81f35781d539d395b3532a21e',
        '0xe7355f8e4e667b955390f7f0506c6e9395735e9ce9cad4d0a43bcef24b8982f7400d24bc4228f11c02df9a29f6304a5',
        '0x772caacf16936190f3e0c63e0596721570f5799af53a1894e2e073062aede9cea73b3538f0de06cec2574496ee84a3a',
        '0x14a7ac2a9d64a8b230b3f5b074cf01996e7f63c21bca68a81996e1cdf9822c580fa5b9489d11e2d311f7d99bbdcc5a5e',
        '0xa10ecf6ada54f825e920b3dafc7a3cce07f8d1d7161366b74100da67f39883503826692abba43704776ec3a79a1d641',
        '0x95fc13ab9e92ad4476d6e3eb3a56680f682b4ee96f7d03776df533978f31c1593174e4b4b7865002d6384d168ecdd0a',
        '0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001', // LAST 1
    ],
    // yNum
    [
        '0x90d97c81ba24ee0259d1f094980dcfa11ad138e48a869522b52af6c956543d3cd0c7aee9b3ba3c2be9845719707bb33',
        '0x134996a104ee5811d51036d776fb46831223e96c254f383d0f906343eb67ad34d6c56711962fa8bfe097e75a2e41c696',
        '0xcc786baa966e66f4a384c86a3b49942552e2d658a31ce2c344be4b91400da7d26d521628b00523b8dfe240c72de1f6',
        '0x1f86376e8981c217898751ad8746757d42aa7b90eeb791c09e4a3ec03251cf9de405aba9ec61deca6355c77b0e5f4cb',
        '0x8cc03fdefe0ff135caf4fe2a21529c4195536fbe3ce50b879833fd221351adc2ee7f8dc099040a841b6daecf2e8fedb',
        '0x16603fca40634b6a2211e11db8f0a6a074a7d0d4afadb7bd76505c3d3ad5544e203f6326c95a807299b23ab13633a5f0',
        '0x4ab0b9bcfac1bbcb2c977d027796b3ce75bb8ca2be184cb5231413c4d634f3747a87ac2460f415ec961f8855fe9d6f2',
        '0x987c8d5333ab86fde9926bd2ca6c674170a05bfe3bdd81ffd038da6c26c842642f64550fedfe935a15e4ca31870fb29',
        '0x9fc4018bd96684be88c9e221e4da1bb8f3abd16679dc26c1e8b6e6a1f20cabe69d65201c78607a360370e577bdba587',
        '0xe1bba7a1186bdb5223abde7ada14a23c42a0ca7915af6fe06985e7ed1e4d43b9b3f7055dd4eba6f2bafaaebca731c30',
        '0x19713e47937cd1be0dfd0b8f1d43fb93cd2fcbcb6caf493fd1183e416389e61031bf3a5cce3fbafce813711ad011c132',
        '0x18b46a908f36f6deb918c143fed2edcc523559b8aaf0c2462e6bfe7f911f643249d9cdf41b44d606ce07c8a4d0074d8e',
        '0xb182cac101b9399d155096004f53f447aa7b12a3426b08ec02710e807b4633f06c851c1919211f20d4c04f00b971ef8',
        '0x245a394ad1eca9b72fc00ae7be315dc757b3b080d4c158013e6632d3c40659cc6cf90ad1c232a6442d9d3f5db980133',
        '0x5c129645e44cf1102a159f748c4a3fc5e673d81d7e86568d9ab0f5d396a7ce46ba1049b6579afb7866b1e715475224b',
        '0x15e6be4e990f03ce4ea50b3b42df2eb5cb181d8f84965a3957add4fa95af01b2b665027efec01c7704b456be69c8b604',
    ],
    // yDen
    [
        '0x16112c4c3a9c98b252181140fad0eae9601a6de578980be6eec3232b5be72e7a07f3688ef60c206d01479253b03663c1',
        '0x1962d75c2381201e1a0cbd6c43c348b885c84ff731c4d59ca4a10356f453e01f78a4260763529e3532f6102c2e49a03d',
        '0x58df3306640da276faaae7d6e8eb15778c4855551ae7f310c35a5dd279cd2eca6757cd636f96f891e2538b53dbf67f2',
        '0x16b7d288798e5395f20d23bf89edb4d1d115c5dbddbcd30e123da489e726af41727364f2c28297ada8d26d98445f5416',
        '0xbe0e079545f43e4b00cc912f8228ddcc6d19c9f0f69bbb0542eda0fc9dec916a20b15dc0fd2ededda39142311a5001d',
        '0x8d9e5297186db2d9fb266eaac783182b70152c65550d881c5ecd87b6f0f5a6449f38db9dfa9cce202c6477faaf9b7ac',
        '0x166007c08a99db2fc3ba8734ace9824b5eecfdfa8d0cf8ef5dd365bc400a0051d5fa9c01a58b1fb93d1a1399126a775c',
        '0x16a3ef08be3ea7ea03bcddfabba6ff6ee5a4375efa1f4fd7feb34fd206357132b920f5b00801dee460ee415a15812ed9',
        '0x1866c8ed336c61231a1be54fd1d74cc4f9fb0ce4c6af5920abc5750c4bf39b4852cfe2f7bb9248836b233d9d55535d4a',
        '0x167a55cda70a6e1cea820597d94a84903216f763e13d87bb5308592e7ea7d4fbc7385ea3d529b35e346ef48bb8913f55',
        '0x4d2f259eea405bd48f010a01ad2911d9c6dd039bb61a6290e591b36e636a5c871a5c29f4f83060400f8b49cba8f6aa8',
        '0xaccbb67481d033ff5852c1e48c50c477f94ff8aefce42d28c0f9a88cea7913516f968986f7ebbea9684b529e2561092',
        '0xad6b9514c767fe3c3613144b45f1496543346d98adf02267d5ceef9a00d9b8693000763e3b90ac11e99b138573345cc',
        '0x2660400eb2e4f3b628bdd0d53cd76f2bf565b94e72927c1cb748df27942480e420517bd8714cc80d1fadc1326ed06f7',
        '0xe0fa1d816ddc03e6b24255e0d7819c171c40f65e273b853324efcd6356caa205ca2f570f13497804415473a1d634b8f',
        '0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001', // LAST 1
    ],
].map((i) => i.map((j) => BigInt(j))));
// Optimized SWU Map - Fp to G1
const G1_SWU = (0, weierstrass_ts_1.mapToCurveSimpleSWU)(Fp, {
    A: Fp.create(BigInt('0x144698a3b8e9433d693a02c96d4982b0ea985383ee66a8d8e8981aefd881ac98936f8da0e0f97f5cf428082d584c1d')),
    B: Fp.create(BigInt('0x12e2908d11688030018b12e8753eee3b2016c1f0f24f4070a0b9c14fcef35ef55a23215a316ceaa5d1cc48e98e172be0')),
    Z: Fp.create(BigInt(11)),
});
// SWU Map - Fp2 to G2': y² = x³ + 240i * x + 1012 + 1012i
const G2_SWU = (0, weierstrass_ts_1.mapToCurveSimpleSWU)(Fp2, {
    A: Fp2.create({ c0: Fp.create(_0n), c1: Fp.create(BigInt(240)) }), // A' = 240 * I
    B: Fp2.create({ c0: Fp.create(BigInt(1012)), c1: Fp.create(BigInt(1012)) }), // B' = 1012 * (1 + I)
    Z: Fp2.create({ c0: Fp.create(BigInt(-2)), c1: Fp.create(BigInt(-1)) }), // Z: -(2 + I)
});
function mapToG1(scalars) {
    const { x, y } = G1_SWU(Fp.create(scalars[0]));
    return isogenyMapG1(x, y);
}
function mapToG2(scalars) {
    const { x, y } = G2_SWU(Fp2.fromBigTuple(scalars));
    return isogenyMapG2(x, y);
}
//# sourceMappingURL=bls12-381.js.map
    },
    29: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bls = bls;
/**
 * BLS != BLS.
 * The file implements BLS (Boneh-Lynn-Shacham) signatures.
 * Used in both BLS (Barreto-Lynn-Scott) and BN (Barreto-Naehrig)
 * families of pairing-friendly curves.
 * Consists of two curves: G1 and G2:
 * - G1 is a subgroup of (x, y) E(Fq) over y² = x³ + 4.
 * - G2 is a subgroup of ((x₁, x₂+i), (y₁, y₂+i)) E(Fq²) over y² = x³ + 4(1 + i) where i is √-1
 * - Gt, created by bilinear (ate) pairing e(G1, G2), consists of p-th roots of unity in
 *   Fq^k where k is embedding degree. Only degree 12 is currently supported, 24 is not.
 * Pairing is used to aggregate and verify signatures.
 * There are two modes of operation:
 * - Long signatures:  X-byte keys + 2X-byte sigs (G1 keys + G2 sigs).
 * - Short signatures: 2X-byte keys + X-byte sigs (G2 keys + G1 sigs).
 * @module
 **/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
const curve_ts_1 = require("./curve.js");
const hash_to_curve_ts_1 = require("./hash-to-curve.js");
const modular_ts_1 = require("./modular.js");
const weierstrass_ts_1 = require("./weierstrass.js");
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3);
// Not used with BLS12-381 (no sequential `11` in X). Useful for other curves.
function NAfDecomposition(a) {
    const res = [];
    // a>1 because of marker bit
    for (; a > _1n; a >>= _1n) {
        if ((a & _1n) === _0n)
            res.unshift(0);
        else if ((a & _3n) === _3n) {
            res.unshift(-1);
            a += _1n;
        }
        else
            res.unshift(1);
    }
    return res;
}
function aNonEmpty(arr) {
    if (!Array.isArray(arr) || arr.length === 0)
        throw new Error('expected non-empty array');
}
// This should be enough for bn254, no need to export full stuff?
function createBlsPairing(fields, G1, G2, params) {
    const { Fp2, Fp12 } = fields;
    const { twistType, ateLoopSize, xNegative, postPrecompute } = params;
    // Applies sparse multiplication as line function
    let lineFunction;
    if (twistType === 'multiplicative') {
        lineFunction = (c0, c1, c2, f, Px, Py) => Fp12.mul014(f, c0, Fp2.mul(c1, Px), Fp2.mul(c2, Py));
    }
    else if (twistType === 'divisive') {
        // NOTE: it should be [c0, c1, c2], but we use different order here to reduce complexity of
        // precompute calculations.
        lineFunction = (c0, c1, c2, f, Px, Py) => Fp12.mul034(f, Fp2.mul(c2, Py), Fp2.mul(c1, Px), c0);
    }
    else
        throw new Error('bls: unknown twist type');
    const Fp2div2 = Fp2.div(Fp2.ONE, Fp2.mul(Fp2.ONE, _2n));
    function pointDouble(ell, Rx, Ry, Rz) {
        const t0 = Fp2.sqr(Ry); // Ry²
        const t1 = Fp2.sqr(Rz); // Rz²
        const t2 = Fp2.mulByB(Fp2.mul(t1, _3n)); // 3 * T1 * B
        const t3 = Fp2.mul(t2, _3n); // 3 * T2
        const t4 = Fp2.sub(Fp2.sub(Fp2.sqr(Fp2.add(Ry, Rz)), t1), t0); // (Ry + Rz)² - T1 - T0
        const c0 = Fp2.sub(t2, t0); // T2 - T0 (i)
        const c1 = Fp2.mul(Fp2.sqr(Rx), _3n); // 3 * Rx²
        const c2 = Fp2.neg(t4); // -T4 (-h)
        ell.push([c0, c1, c2]);
        Rx = Fp2.mul(Fp2.mul(Fp2.mul(Fp2.sub(t0, t3), Rx), Ry), Fp2div2); // ((T0 - T3) * Rx * Ry) / 2
        Ry = Fp2.sub(Fp2.sqr(Fp2.mul(Fp2.add(t0, t3), Fp2div2)), Fp2.mul(Fp2.sqr(t2), _3n)); // ((T0 + T3) / 2)² - 3 * T2²
        Rz = Fp2.mul(t0, t4); // T0 * T4
        return { Rx, Ry, Rz };
    }
    function pointAdd(ell, Rx, Ry, Rz, Qx, Qy) {
        // Addition
        const t0 = Fp2.sub(Ry, Fp2.mul(Qy, Rz)); // Ry - Qy * Rz
        const t1 = Fp2.sub(Rx, Fp2.mul(Qx, Rz)); // Rx - Qx * Rz
        const c0 = Fp2.sub(Fp2.mul(t0, Qx), Fp2.mul(t1, Qy)); // T0 * Qx - T1 * Qy == Ry * Qx  - Rx * Qy
        const c1 = Fp2.neg(t0); // -T0 == Qy * Rz - Ry
        const c2 = t1; // == Rx - Qx * Rz
        ell.push([c0, c1, c2]);
        const t2 = Fp2.sqr(t1); // T1²
        const t3 = Fp2.mul(t2, t1); // T2 * T1
        const t4 = Fp2.mul(t2, Rx); // T2 * Rx
        const t5 = Fp2.add(Fp2.sub(t3, Fp2.mul(t4, _2n)), Fp2.mul(Fp2.sqr(t0), Rz)); // T3 - 2 * T4 + T0² * Rz
        Rx = Fp2.mul(t1, t5); // T1 * T5
        Ry = Fp2.sub(Fp2.mul(Fp2.sub(t4, t5), t0), Fp2.mul(t3, Ry)); // (T4 - T5) * T0 - T3 * Ry
        Rz = Fp2.mul(Rz, t3); // Rz * T3
        return { Rx, Ry, Rz };
    }
    // Pre-compute coefficients for sparse multiplication
    // Point addition and point double calculations is reused for coefficients
    // pointAdd happens only if bit set, so wNAF is reasonable. Unfortunately we cannot combine
    // add + double in windowed precomputes here, otherwise it would be single op (since X is static)
    const ATE_NAF = NAfDecomposition(ateLoopSize);
    const calcPairingPrecomputes = (0, utils_ts_1.memoized)((point) => {
        const p = point;
        const { x, y } = p.toAffine();
        // prettier-ignore
        const Qx = x, Qy = y, negQy = Fp2.neg(y);
        // prettier-ignore
        let Rx = Qx, Ry = Qy, Rz = Fp2.ONE;
        const ell = [];
        for (const bit of ATE_NAF) {
            const cur = [];
            ({ Rx, Ry, Rz } = pointDouble(cur, Rx, Ry, Rz));
            if (bit)
                ({ Rx, Ry, Rz } = pointAdd(cur, Rx, Ry, Rz, Qx, bit === -1 ? negQy : Qy));
            ell.push(cur);
        }
        if (postPrecompute) {
            const last = ell[ell.length - 1];
            postPrecompute(Rx, Ry, Rz, Qx, Qy, pointAdd.bind(null, last));
        }
        return ell;
    });
    function millerLoopBatch(pairs, withFinalExponent = false) {
        let f12 = Fp12.ONE;
        if (pairs.length) {
            const ellLen = pairs[0][0].length;
            for (let i = 0; i < ellLen; i++) {
                f12 = Fp12.sqr(f12); // This allows us to do sqr only one time for all pairings
                // NOTE: we apply multiple pairings in parallel here
                for (const [ell, Px, Py] of pairs) {
                    for (const [c0, c1, c2] of ell[i])
                        f12 = lineFunction(c0, c1, c2, f12, Px, Py);
                }
            }
        }
        if (xNegative)
            f12 = Fp12.conjugate(f12);
        return withFinalExponent ? Fp12.finalExponentiate(f12) : f12;
    }
    // Calculates product of multiple pairings
    // This up to x2 faster than just `map(({g1, g2})=>pairing({g1,g2}))`
    function pairingBatch(pairs, withFinalExponent = true) {
        const res = [];
        // Cache precomputed toAffine for all points
        (0, curve_ts_1.normalizeZ)(G1, pairs.map(({ g1 }) => g1));
        (0, curve_ts_1.normalizeZ)(G2, pairs.map(({ g2 }) => g2));
        for (const { g1, g2 } of pairs) {
            if (g1.is0() || g2.is0())
                throw new Error('pairing is not available for ZERO point');
            // This uses toAffine inside
            g1.assertValidity();
            g2.assertValidity();
            const Qa = g1.toAffine();
            res.push([calcPairingPrecomputes(g2), Qa.x, Qa.y]);
        }
        return millerLoopBatch(res, withFinalExponent);
    }
    // Calculates bilinear pairing
    function pairing(Q, P, withFinalExponent = true) {
        return pairingBatch([{ g1: Q, g2: P }], withFinalExponent);
    }
    return {
        Fp12, // NOTE: we re-export Fp12 here because pairing results are Fp12!
        millerLoopBatch,
        pairing,
        pairingBatch,
        calcPairingPrecomputes,
    };
}
function createBlsSig(blsPairing, PubCurve, SigCurve, SignatureCoder, isSigG1) {
    const { Fp12, pairingBatch } = blsPairing;
    function normPub(point) {
        return point instanceof PubCurve.Point ? point : PubCurve.Point.fromHex(point);
    }
    function normSig(point) {
        return point instanceof SigCurve.Point ? point : SigCurve.Point.fromHex(point);
    }
    function amsg(m) {
        if (!(m instanceof SigCurve.Point))
            throw new Error(`expected valid message hashed to ${!isSigG1 ? 'G2' : 'G1'} curve`);
        return m;
    }
    // What matters here is what point pairing API accepts as G1 or G2, not actual size or names
    const pair = !isSigG1
        ? (a, b) => ({ g1: a, g2: b })
        : (a, b) => ({ g1: b, g2: a });
    return {
        // P = pk x G
        getPublicKey(secretKey) {
            // TODO: replace with
            // const sec = PubCurve.Point.Fn.fromBytes(secretKey);
            const sec = (0, weierstrass_ts_1._normFnElement)(PubCurve.Point.Fn, secretKey);
            return PubCurve.Point.BASE.multiply(sec);
        },
        // S = pk x H(m)
        sign(message, secretKey, unusedArg) {
            if (unusedArg != null)
                throw new Error('sign() expects 2 arguments');
            // TODO: replace with
            // PubCurve.Point.Fn.fromBytes(secretKey)
            const sec = (0, weierstrass_ts_1._normFnElement)(PubCurve.Point.Fn, secretKey);
            amsg(message).assertValidity();
            return message.multiply(sec);
        },
        // Checks if pairing of public key & hash is equal to pairing of generator & signature.
        // e(P, H(m)) == e(G, S)
        // e(S, G) == e(H(m), P)
        verify(signature, message, publicKey, unusedArg) {
            if (unusedArg != null)
                throw new Error('verify() expects 3 arguments');
            signature = normSig(signature);
            publicKey = normPub(publicKey);
            const P = publicKey.negate();
            const G = PubCurve.Point.BASE;
            const Hm = amsg(message);
            const S = signature;
            // This code was changed in 1.9.x:
            // Before it was G.negate() in G2, now it's always pubKey.negate
            // e(P, -Q)===e(-P, Q)==e(P, Q)^-1. Negate can be done anywhere (as long it is done once per pair).
            // We just moving sign, but since pairing is multiplicative, we doing X * X^-1 = 1
            const exp = pairingBatch([pair(P, Hm), pair(G, S)]);
            return Fp12.eql(exp, Fp12.ONE);
        },
        // https://ethresear.ch/t/fast-verification-of-multiple-bls-signatures/5407
        // e(G, S) = e(G, SUM(n)(Si)) = MUL(n)(e(G, Si))
        // TODO: maybe `{message: G2Hex, publicKey: G1Hex}[]` instead?
        verifyBatch(signature, messages, publicKeys) {
            aNonEmpty(messages);
            if (publicKeys.length !== messages.length)
                throw new Error('amount of public keys and messages should be equal');
            const sig = normSig(signature);
            const nMessages = messages;
            const nPublicKeys = publicKeys.map(normPub);
            // NOTE: this works only for exact same object
            const messagePubKeyMap = new Map();
            for (let i = 0; i < nPublicKeys.length; i++) {
                const pub = nPublicKeys[i];
                const msg = nMessages[i];
                let keys = messagePubKeyMap.get(msg);
                if (keys === undefined) {
                    keys = [];
                    messagePubKeyMap.set(msg, keys);
                }
                keys.push(pub);
            }
            const paired = [];
            const G = PubCurve.Point.BASE;
            try {
                for (const [msg, keys] of messagePubKeyMap) {
                    const groupPublicKey = keys.reduce((acc, msg) => acc.add(msg));
                    paired.push(pair(groupPublicKey, msg));
                }
                paired.push(pair(G.negate(), sig));
                return Fp12.eql(pairingBatch(paired), Fp12.ONE);
            }
            catch {
                return false;
            }
        },
        // Adds a bunch of public key points together.
        // pk1 + pk2 + pk3 = pkA
        aggregatePublicKeys(publicKeys) {
            aNonEmpty(publicKeys);
            publicKeys = publicKeys.map((pub) => normPub(pub));
            const agg = publicKeys.reduce((sum, p) => sum.add(p), PubCurve.Point.ZERO);
            agg.assertValidity();
            return agg;
        },
        // Adds a bunch of signature points together.
        // pk1 + pk2 + pk3 = pkA
        aggregateSignatures(signatures) {
            aNonEmpty(signatures);
            signatures = signatures.map((sig) => normSig(sig));
            const agg = signatures.reduce((sum, s) => sum.add(s), SigCurve.Point.ZERO);
            agg.assertValidity();
            return agg;
        },
        hash(messageBytes, DST) {
            (0, utils_ts_1.abytes)(messageBytes);
            const opts = DST ? { DST } : undefined;
            return SigCurve.hashToCurve(messageBytes, opts);
        },
        Signature: SignatureCoder,
    };
}
// G1_Point: ProjConstructor<bigint>, G2_Point: ProjConstructor<Fp2>,
function bls(CURVE) {
    // Fields are specific for curve, so for now we'll need to pass them with opts
    const { Fp, Fr, Fp2, Fp6, Fp12 } = CURVE.fields;
    // Point on G1 curve: (x, y)
    const G1_ = (0, weierstrass_ts_1.weierstrassPoints)(CURVE.G1);
    const G1 = Object.assign(G1_, (0, hash_to_curve_ts_1.createHasher)(G1_.Point, CURVE.G1.mapToCurve, {
        ...CURVE.htfDefaults,
        ...CURVE.G1.htfDefaults,
    }));
    // Point on G2 curve (complex numbers): (x₁, x₂+i), (y₁, y₂+i)
    const G2_ = (0, weierstrass_ts_1.weierstrassPoints)(CURVE.G2);
    const G2 = Object.assign(G2_, (0, hash_to_curve_ts_1.createHasher)(G2_.Point, CURVE.G2.mapToCurve, {
        ...CURVE.htfDefaults,
        ...CURVE.G2.htfDefaults,
    }));
    const pairingRes = createBlsPairing(CURVE.fields, G1.Point, G2.Point, {
        ...CURVE.params,
        postPrecompute: CURVE.postPrecompute,
    });
    const { millerLoopBatch, pairing, pairingBatch, calcPairingPrecomputes } = pairingRes;
    const longSignatures = createBlsSig(pairingRes, G1, G2, CURVE.G2.Signature, false);
    const shortSignatures = createBlsSig(pairingRes, G2, G1, CURVE.G1.ShortSignature, true);
    const rand = CURVE.randomBytes || utils_ts_1.randomBytes;
    const randomSecretKey = () => {
        const length = (0, modular_ts_1.getMinHashLength)(Fr.ORDER);
        return (0, modular_ts_1.mapHashToField)(rand(length), Fr.ORDER);
    };
    const utils = {
        randomSecretKey,
        randomPrivateKey: randomSecretKey,
        calcPairingPrecomputes,
    };
    const { ShortSignature } = CURVE.G1;
    const { Signature } = CURVE.G2;
    function normP1Hash(point, htfOpts) {
        return point instanceof G1.Point
            ? point
            : shortSignatures.hash((0, utils_ts_1.ensureBytes)('point', point), htfOpts?.DST);
    }
    function normP2Hash(point, htfOpts) {
        return point instanceof G2.Point
            ? point
            : longSignatures.hash((0, utils_ts_1.ensureBytes)('point', point), htfOpts?.DST);
    }
    function getPublicKey(privateKey) {
        return longSignatures.getPublicKey(privateKey).toBytes(true);
    }
    function getPublicKeyForShortSignatures(privateKey) {
        return shortSignatures.getPublicKey(privateKey).toBytes(true);
    }
    function sign(message, privateKey, htfOpts) {
        const Hm = normP2Hash(message, htfOpts);
        const S = longSignatures.sign(Hm, privateKey);
        return message instanceof G2.Point ? S : Signature.toBytes(S);
    }
    function signShortSignature(message, privateKey, htfOpts) {
        const Hm = normP1Hash(message, htfOpts);
        const S = shortSignatures.sign(Hm, privateKey);
        return message instanceof G1.Point ? S : ShortSignature.toBytes(S);
    }
    function verify(signature, message, publicKey, htfOpts) {
        const Hm = normP2Hash(message, htfOpts);
        return longSignatures.verify(signature, Hm, publicKey);
    }
    function verifyShortSignature(signature, message, publicKey, htfOpts) {
        const Hm = normP1Hash(message, htfOpts);
        return shortSignatures.verify(signature, Hm, publicKey);
    }
    function aggregatePublicKeys(publicKeys) {
        const agg = longSignatures.aggregatePublicKeys(publicKeys);
        return publicKeys[0] instanceof G1.Point ? agg : agg.toBytes(true);
    }
    function aggregateSignatures(signatures) {
        const agg = longSignatures.aggregateSignatures(signatures);
        return signatures[0] instanceof G2.Point ? agg : Signature.toBytes(agg);
    }
    function aggregateShortSignatures(signatures) {
        const agg = shortSignatures.aggregateSignatures(signatures);
        return signatures[0] instanceof G1.Point ? agg : ShortSignature.toBytes(agg);
    }
    function verifyBatch(signature, messages, publicKeys, htfOpts) {
        const Hm = messages.map((m) => normP2Hash(m, htfOpts));
        return longSignatures.verifyBatch(signature, Hm, publicKeys);
    }
    G1.Point.BASE.precompute(4);
    return {
        longSignatures,
        shortSignatures,
        millerLoopBatch,
        pairing,
        pairingBatch,
        verifyBatch,
        fields: {
            Fr,
            Fp,
            Fp2,
            Fp6,
            Fp12,
        },
        params: {
            ateLoopSize: CURVE.params.ateLoopSize,
            twistType: CURVE.params.twistType,
            // deprecated
            r: CURVE.params.r,
            G1b: CURVE.G1.b,
            G2b: CURVE.G2.b,
        },
        utils,
        // deprecated
        getPublicKey,
        getPublicKeyForShortSignatures,
        sign,
        signShortSignature,
        verify,
        verifyShortSignature,
        aggregatePublicKeys,
        aggregateSignatures,
        aggregateShortSignatures,
        G1,
        G2,
        Signature,
        ShortSignature,
    };
}
//# sourceMappingURL=bls.js.map
    },
    30: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.psiFrobenius = psiFrobenius;
exports.tower12 = tower12;
/**
 * Towered extension fields.
 * Rather than implementing a massive 12th-degree extension directly, it is more efficient
 * to build it up from smaller extensions: a tower of extensions.
 *
 * For BLS12-381, the Fp12 field is implemented as a quadratic (degree two) extension,
 * on top of a cubic (degree three) extension, on top of a quadratic extension of Fp.
 *
 * For more info: "Pairings for beginners" by Costello, section 7.3.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
const mod = require("./modular.js");
// Be friendly to bad ECMAScript parsers by not using bigint literals
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3);
function calcFrobeniusCoefficients(Fp, nonResidue, modulus, degree, num = 1, divisor) {
    const _divisor = BigInt(divisor === undefined ? degree : divisor);
    const towerModulus = modulus ** BigInt(degree);
    const res = [];
    for (let i = 0; i < num; i++) {
        const a = BigInt(i + 1);
        const powers = [];
        for (let j = 0, qPower = _1n; j < degree; j++) {
            const power = ((a * qPower - a) / _divisor) % towerModulus;
            powers.push(Fp.pow(nonResidue, power));
            qPower *= modulus;
        }
        res.push(powers);
    }
    return res;
}
// This works same at least for bls12-381, bn254 and bls12-377
function psiFrobenius(Fp, Fp2, base) {
    // GLV endomorphism Ψ(P)
    const PSI_X = Fp2.pow(base, (Fp.ORDER - _1n) / _3n); // u^((p-1)/3)
    const PSI_Y = Fp2.pow(base, (Fp.ORDER - _1n) / _2n); // u^((p-1)/2)
    function psi(x, y) {
        // This x10 faster than previous version in bls12-381
        const x2 = Fp2.mul(Fp2.frobeniusMap(x, 1), PSI_X);
        const y2 = Fp2.mul(Fp2.frobeniusMap(y, 1), PSI_Y);
        return [x2, y2];
    }
    // Ψ²(P) endomorphism (psi2(x) = psi(psi(x)))
    const PSI2_X = Fp2.pow(base, (Fp.ORDER ** _2n - _1n) / _3n); // u^((p^2 - 1)/3)
    // This equals -1, which causes y to be Fp2.neg(y).
    // But not sure if there are case when this is not true?
    const PSI2_Y = Fp2.pow(base, (Fp.ORDER ** _2n - _1n) / _2n); // u^((p^2 - 1)/3)
    if (!Fp2.eql(PSI2_Y, Fp2.neg(Fp2.ONE)))
        throw new Error('psiFrobenius: PSI2_Y!==-1');
    function psi2(x, y) {
        return [Fp2.mul(x, PSI2_X), Fp2.neg(y)];
    }
    // Map points
    const mapAffine = (fn) => (c, P) => {
        const affine = P.toAffine();
        const p = fn(affine.x, affine.y);
        return c.fromAffine({ x: p[0], y: p[1] });
    };
    const G2psi = mapAffine(psi);
    const G2psi2 = mapAffine(psi2);
    return { psi, psi2, G2psi, G2psi2, PSI_X, PSI_Y, PSI2_X, PSI2_Y };
}
const Fp2fromBigTuple = (Fp, tuple) => {
    if (tuple.length !== 2)
        throw new Error('invalid tuple');
    const fps = tuple.map((n) => Fp.create(n));
    return { c0: fps[0], c1: fps[1] };
};
class _Field2 {
    constructor(Fp, opts = {}) {
        this.MASK = _1n;
        const ORDER = Fp.ORDER;
        const FP2_ORDER = ORDER * ORDER;
        this.Fp = Fp;
        this.ORDER = FP2_ORDER;
        this.BITS = (0, utils_ts_1.bitLen)(FP2_ORDER);
        this.BYTES = Math.ceil((0, utils_ts_1.bitLen)(FP2_ORDER) / 8);
        this.isLE = Fp.isLE;
        this.ZERO = { c0: Fp.ZERO, c1: Fp.ZERO };
        this.ONE = { c0: Fp.ONE, c1: Fp.ZERO };
        this.Fp_NONRESIDUE = Fp.create(opts.NONRESIDUE || BigInt(-1));
        this.Fp_div2 = Fp.div(Fp.ONE, _2n); // 1/2
        this.NONRESIDUE = Fp2fromBigTuple(Fp, opts.FP2_NONRESIDUE);
        // const Fp2Nonresidue = Fp2fromBigTuple(opts.FP2_NONRESIDUE);
        this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp, this.Fp_NONRESIDUE, Fp.ORDER, 2)[0];
        this.mulByB = opts.Fp2mulByB;
        Object.seal(this);
    }
    fromBigTuple(tuple) {
        return Fp2fromBigTuple(this.Fp, tuple);
    }
    create(num) {
        return num;
    }
    isValid({ c0, c1 }) {
        function isValidC(num, ORDER) {
            return typeof num === 'bigint' && _0n <= num && num < ORDER;
        }
        return isValidC(c0, this.ORDER) && isValidC(c1, this.ORDER);
    }
    is0({ c0, c1 }) {
        return this.Fp.is0(c0) && this.Fp.is0(c1);
    }
    isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
    }
    eql({ c0, c1 }, { c0: r0, c1: r1 }) {
        return this.Fp.eql(c0, r0) && this.Fp.eql(c1, r1);
    }
    neg({ c0, c1 }) {
        return { c0: this.Fp.neg(c0), c1: this.Fp.neg(c1) };
    }
    pow(num, power) {
        return mod.FpPow(this, num, power);
    }
    invertBatch(nums) {
        return mod.FpInvertBatch(this, nums);
    }
    // Normalized
    add(f1, f2) {
        const { c0, c1 } = f1;
        const { c0: r0, c1: r1 } = f2;
        return {
            c0: this.Fp.add(c0, r0),
            c1: this.Fp.add(c1, r1),
        };
    }
    sub({ c0, c1 }, { c0: r0, c1: r1 }) {
        return {
            c0: this.Fp.sub(c0, r0),
            c1: this.Fp.sub(c1, r1),
        };
    }
    mul({ c0, c1 }, rhs) {
        const { Fp } = this;
        if (typeof rhs === 'bigint')
            return { c0: Fp.mul(c0, rhs), c1: Fp.mul(c1, rhs) };
        // (a+bi)(c+di) = (ac−bd) + (ad+bc)i
        const { c0: r0, c1: r1 } = rhs;
        let t1 = Fp.mul(c0, r0); // c0 * o0
        let t2 = Fp.mul(c1, r1); // c1 * o1
        // (T1 - T2) + ((c0 + c1) * (r0 + r1) - (T1 + T2))*i
        const o0 = Fp.sub(t1, t2);
        const o1 = Fp.sub(Fp.mul(Fp.add(c0, c1), Fp.add(r0, r1)), Fp.add(t1, t2));
        return { c0: o0, c1: o1 };
    }
    sqr({ c0, c1 }) {
        const { Fp } = this;
        const a = Fp.add(c0, c1);
        const b = Fp.sub(c0, c1);
        const c = Fp.add(c0, c0);
        return { c0: Fp.mul(a, b), c1: Fp.mul(c, c1) };
    }
    // NonNormalized stuff
    addN(a, b) {
        return this.add(a, b);
    }
    subN(a, b) {
        return this.sub(a, b);
    }
    mulN(a, b) {
        return this.mul(a, b);
    }
    sqrN(a) {
        return this.sqr(a);
    }
    // Why inversion for bigint inside Fp instead of Fp2? it is even used in that context?
    div(lhs, rhs) {
        const { Fp } = this;
        // @ts-ignore
        return this.mul(lhs, typeof rhs === 'bigint' ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
    }
    inv({ c0: a, c1: b }) {
        // We wish to find the multiplicative inverse of a nonzero
        // element a + bu in Fp2. We leverage an identity
        //
        // (a + bu)(a - bu) = a² + b²
        //
        // which holds because u² = -1. This can be rewritten as
        //
        // (a + bu)(a - bu)/(a² + b²) = 1
        //
        // because a² + b² = 0 has no nonzero solutions for (a, b).
        // This gives that (a - bu)/(a² + b²) is the inverse
        // of (a + bu). Importantly, this can be computing using
        // only a single inversion in Fp.
        const { Fp } = this;
        const factor = Fp.inv(Fp.create(a * a + b * b));
        return { c0: Fp.mul(factor, Fp.create(a)), c1: Fp.mul(factor, Fp.create(-b)) };
    }
    sqrt(num) {
        // This is generic for all quadratic extensions (Fp2)
        const { Fp } = this;
        const Fp2 = this;
        const { c0, c1 } = num;
        if (Fp.is0(c1)) {
            // if c0 is quadratic residue
            if (mod.FpLegendre(Fp, c0) === 1)
                return Fp2.create({ c0: Fp.sqrt(c0), c1: Fp.ZERO });
            else
                return Fp2.create({ c0: Fp.ZERO, c1: Fp.sqrt(Fp.div(c0, this.Fp_NONRESIDUE)) });
        }
        const a = Fp.sqrt(Fp.sub(Fp.sqr(c0), Fp.mul(Fp.sqr(c1), this.Fp_NONRESIDUE)));
        let d = Fp.mul(Fp.add(a, c0), this.Fp_div2);
        const legendre = mod.FpLegendre(Fp, d);
        // -1, Quadratic non residue
        if (legendre === -1)
            d = Fp.sub(d, a);
        const a0 = Fp.sqrt(d);
        const candidateSqrt = Fp2.create({ c0: a0, c1: Fp.div(Fp.mul(c1, this.Fp_div2), a0) });
        if (!Fp2.eql(Fp2.sqr(candidateSqrt), num))
            throw new Error('Cannot find square root');
        // Normalize root: at this point candidateSqrt ** 2 = num, but also -candidateSqrt ** 2 = num
        const x1 = candidateSqrt;
        const x2 = Fp2.neg(x1);
        const { re: re1, im: im1 } = Fp2.reim(x1);
        const { re: re2, im: im2 } = Fp2.reim(x2);
        if (im1 > im2 || (im1 === im2 && re1 > re2))
            return x1;
        return x2;
    }
    // Same as sgn0_m_eq_2 in RFC 9380
    isOdd(x) {
        const { re: x0, im: x1 } = this.reim(x);
        const sign_0 = x0 % _2n;
        const zero_0 = x0 === _0n;
        const sign_1 = x1 % _2n;
        return BigInt(sign_0 || (zero_0 && sign_1)) == _1n;
    }
    // Bytes util
    fromBytes(b) {
        const { Fp } = this;
        if (b.length !== this.BYTES)
            throw new Error('fromBytes invalid length=' + b.length);
        return { c0: Fp.fromBytes(b.subarray(0, Fp.BYTES)), c1: Fp.fromBytes(b.subarray(Fp.BYTES)) };
    }
    toBytes({ c0, c1 }) {
        return (0, utils_ts_1.concatBytes)(this.Fp.toBytes(c0), this.Fp.toBytes(c1));
    }
    cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
        return {
            c0: this.Fp.cmov(c0, r0, c),
            c1: this.Fp.cmov(c1, r1, c),
        };
    }
    reim({ c0, c1 }) {
        return { re: c0, im: c1 };
    }
    Fp4Square(a, b) {
        const Fp2 = this;
        const a2 = Fp2.sqr(a);
        const b2 = Fp2.sqr(b);
        return {
            first: Fp2.add(Fp2.mulByNonresidue(b2), a2), // b² * Nonresidue + a²
            second: Fp2.sub(Fp2.sub(Fp2.sqr(Fp2.add(a, b)), a2), b2), // (a + b)² - a² - b²
        };
    }
    // multiply by u + 1
    mulByNonresidue({ c0, c1 }) {
        return this.mul({ c0, c1 }, this.NONRESIDUE);
    }
    frobeniusMap({ c0, c1 }, power) {
        return {
            c0,
            c1: this.Fp.mul(c1, this.FROBENIUS_COEFFICIENTS[power % 2]),
        };
    }
}
class _Field6 {
    constructor(Fp2) {
        this.MASK = _1n;
        this.Fp2 = Fp2;
        this.ORDER = Fp2.ORDER; // TODO: unused, but need to verify
        this.BITS = 3 * Fp2.BITS;
        this.BYTES = 3 * Fp2.BYTES;
        this.isLE = Fp2.isLE;
        this.ZERO = { c0: Fp2.ZERO, c1: Fp2.ZERO, c2: Fp2.ZERO };
        this.ONE = { c0: Fp2.ONE, c1: Fp2.ZERO, c2: Fp2.ZERO };
        const { Fp } = Fp2;
        const frob = calcFrobeniusCoefficients(Fp2, Fp2.NONRESIDUE, Fp.ORDER, 6, 2, 3);
        this.FROBENIUS_COEFFICIENTS_1 = frob[0];
        this.FROBENIUS_COEFFICIENTS_2 = frob[1];
        Object.seal(this);
    }
    add({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2 } = this;
        return {
            c0: Fp2.add(c0, r0),
            c1: Fp2.add(c1, r1),
            c2: Fp2.add(c2, r2),
        };
    }
    sub({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2 } = this;
        return {
            c0: Fp2.sub(c0, r0),
            c1: Fp2.sub(c1, r1),
            c2: Fp2.sub(c2, r2),
        };
    }
    mul({ c0, c1, c2 }, rhs) {
        const { Fp2 } = this;
        if (typeof rhs === 'bigint') {
            return {
                c0: Fp2.mul(c0, rhs),
                c1: Fp2.mul(c1, rhs),
                c2: Fp2.mul(c2, rhs),
            };
        }
        const { c0: r0, c1: r1, c2: r2 } = rhs;
        const t0 = Fp2.mul(c0, r0); // c0 * o0
        const t1 = Fp2.mul(c1, r1); // c1 * o1
        const t2 = Fp2.mul(c2, r2); // c2 * o2
        return {
            // t0 + (c1 + c2) * (r1 * r2) - (T1 + T2) * (u + 1)
            c0: Fp2.add(t0, Fp2.mulByNonresidue(Fp2.sub(Fp2.mul(Fp2.add(c1, c2), Fp2.add(r1, r2)), Fp2.add(t1, t2)))),
            // (c0 + c1) * (r0 + r1) - (T0 + T1) + T2 * (u + 1)
            c1: Fp2.add(Fp2.sub(Fp2.mul(Fp2.add(c0, c1), Fp2.add(r0, r1)), Fp2.add(t0, t1)), Fp2.mulByNonresidue(t2)),
            // T1 + (c0 + c2) * (r0 + r2) - T0 + T2
            c2: Fp2.sub(Fp2.add(t1, Fp2.mul(Fp2.add(c0, c2), Fp2.add(r0, r2))), Fp2.add(t0, t2)),
        };
    }
    sqr({ c0, c1, c2 }) {
        const { Fp2 } = this;
        let t0 = Fp2.sqr(c0); // c0²
        let t1 = Fp2.mul(Fp2.mul(c0, c1), _2n); // 2 * c0 * c1
        let t3 = Fp2.mul(Fp2.mul(c1, c2), _2n); // 2 * c1 * c2
        let t4 = Fp2.sqr(c2); // c2²
        return {
            c0: Fp2.add(Fp2.mulByNonresidue(t3), t0), // T3 * (u + 1) + T0
            c1: Fp2.add(Fp2.mulByNonresidue(t4), t1), // T4 * (u + 1) + T1
            // T1 + (c0 - c1 + c2)² + T3 - T0 - T4
            c2: Fp2.sub(Fp2.sub(Fp2.add(Fp2.add(t1, Fp2.sqr(Fp2.add(Fp2.sub(c0, c1), c2))), t3), t0), t4),
        };
    }
    addN(a, b) {
        return this.add(a, b);
    }
    subN(a, b) {
        return this.sub(a, b);
    }
    mulN(a, b) {
        return this.mul(a, b);
    }
    sqrN(a) {
        return this.sqr(a);
    }
    create(num) {
        return num;
    }
    isValid({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return Fp2.isValid(c0) && Fp2.isValid(c1) && Fp2.isValid(c2);
    }
    is0({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return Fp2.is0(c0) && Fp2.is0(c1) && Fp2.is0(c2);
    }
    isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
    }
    neg({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return { c0: Fp2.neg(c0), c1: Fp2.neg(c1), c2: Fp2.neg(c2) };
    }
    eql({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2 } = this;
        return Fp2.eql(c0, r0) && Fp2.eql(c1, r1) && Fp2.eql(c2, r2);
    }
    sqrt(_) {
        return (0, utils_ts_1.notImplemented)();
    }
    // Do we need division by bigint at all? Should be done via order:
    div(lhs, rhs) {
        const { Fp2 } = this;
        const { Fp } = Fp2;
        return this.mul(lhs, typeof rhs === 'bigint' ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
    }
    pow(num, power) {
        return mod.FpPow(this, num, power);
    }
    invertBatch(nums) {
        return mod.FpInvertBatch(this, nums);
    }
    inv({ c0, c1, c2 }) {
        const { Fp2 } = this;
        let t0 = Fp2.sub(Fp2.sqr(c0), Fp2.mulByNonresidue(Fp2.mul(c2, c1))); // c0² - c2 * c1 * (u + 1)
        let t1 = Fp2.sub(Fp2.mulByNonresidue(Fp2.sqr(c2)), Fp2.mul(c0, c1)); // c2² * (u + 1) - c0 * c1
        let t2 = Fp2.sub(Fp2.sqr(c1), Fp2.mul(c0, c2)); // c1² - c0 * c2
        // 1/(((c2 * T1 + c1 * T2) * v) + c0 * T0)
        let t4 = Fp2.inv(Fp2.add(Fp2.mulByNonresidue(Fp2.add(Fp2.mul(c2, t1), Fp2.mul(c1, t2))), Fp2.mul(c0, t0)));
        return { c0: Fp2.mul(t4, t0), c1: Fp2.mul(t4, t1), c2: Fp2.mul(t4, t2) };
    }
    // Bytes utils
    fromBytes(b) {
        const { Fp2 } = this;
        if (b.length !== this.BYTES)
            throw new Error('fromBytes invalid length=' + b.length);
        const B2 = Fp2.BYTES;
        return {
            c0: Fp2.fromBytes(b.subarray(0, B2)),
            c1: Fp2.fromBytes(b.subarray(B2, B2 * 2)),
            c2: Fp2.fromBytes(b.subarray(2 * B2)),
        };
    }
    toBytes({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return (0, utils_ts_1.concatBytes)(Fp2.toBytes(c0), Fp2.toBytes(c1), Fp2.toBytes(c2));
    }
    cmov({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }, c) {
        const { Fp2 } = this;
        return {
            c0: Fp2.cmov(c0, r0, c),
            c1: Fp2.cmov(c1, r1, c),
            c2: Fp2.cmov(c2, r2, c),
        };
    }
    fromBigSix(t) {
        const { Fp2 } = this;
        if (!Array.isArray(t) || t.length !== 6)
            throw new Error('invalid Fp6 usage');
        return {
            c0: Fp2.fromBigTuple(t.slice(0, 2)),
            c1: Fp2.fromBigTuple(t.slice(2, 4)),
            c2: Fp2.fromBigTuple(t.slice(4, 6)),
        };
    }
    frobeniusMap({ c0, c1, c2 }, power) {
        const { Fp2 } = this;
        return {
            c0: Fp2.frobeniusMap(c0, power),
            c1: Fp2.mul(Fp2.frobeniusMap(c1, power), this.FROBENIUS_COEFFICIENTS_1[power % 6]),
            c2: Fp2.mul(Fp2.frobeniusMap(c2, power), this.FROBENIUS_COEFFICIENTS_2[power % 6]),
        };
    }
    mulByFp2({ c0, c1, c2 }, rhs) {
        const { Fp2 } = this;
        return {
            c0: Fp2.mul(c0, rhs),
            c1: Fp2.mul(c1, rhs),
            c2: Fp2.mul(c2, rhs),
        };
    }
    mulByNonresidue({ c0, c1, c2 }) {
        const { Fp2 } = this;
        return { c0: Fp2.mulByNonresidue(c2), c1: c0, c2: c1 };
    }
    // Sparse multiplication
    mul1({ c0, c1, c2 }, b1) {
        const { Fp2 } = this;
        return {
            c0: Fp2.mulByNonresidue(Fp2.mul(c2, b1)),
            c1: Fp2.mul(c0, b1),
            c2: Fp2.mul(c1, b1),
        };
    }
    // Sparse multiplication
    mul01({ c0, c1, c2 }, b0, b1) {
        const { Fp2 } = this;
        let t0 = Fp2.mul(c0, b0); // c0 * b0
        let t1 = Fp2.mul(c1, b1); // c1 * b1
        return {
            // ((c1 + c2) * b1 - T1) * (u + 1) + T0
            c0: Fp2.add(Fp2.mulByNonresidue(Fp2.sub(Fp2.mul(Fp2.add(c1, c2), b1), t1)), t0),
            // (b0 + b1) * (c0 + c1) - T0 - T1
            c1: Fp2.sub(Fp2.sub(Fp2.mul(Fp2.add(b0, b1), Fp2.add(c0, c1)), t0), t1),
            // (c0 + c2) * b0 - T0 + T1
            c2: Fp2.add(Fp2.sub(Fp2.mul(Fp2.add(c0, c2), b0), t0), t1),
        };
    }
}
class _Field12 {
    constructor(Fp6, opts) {
        this.MASK = _1n;
        const { Fp2 } = Fp6;
        const { Fp } = Fp2;
        this.Fp6 = Fp6;
        this.ORDER = Fp2.ORDER; // TODO: verify if it's unuesd
        this.BITS = 2 * Fp6.BITS;
        this.BYTES = 2 * Fp6.BYTES;
        this.isLE = Fp6.isLE;
        this.ZERO = { c0: Fp6.ZERO, c1: Fp6.ZERO };
        this.ONE = { c0: Fp6.ONE, c1: Fp6.ZERO };
        this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp2, Fp2.NONRESIDUE, Fp.ORDER, 12, 1, 6)[0];
        this.X_LEN = opts.X_LEN;
        this.finalExponentiate = opts.Fp12finalExponentiate;
    }
    create(num) {
        return num;
    }
    isValid({ c0, c1 }) {
        const { Fp6 } = this;
        return Fp6.isValid(c0) && Fp6.isValid(c1);
    }
    is0({ c0, c1 }) {
        const { Fp6 } = this;
        return Fp6.is0(c0) && Fp6.is0(c1);
    }
    isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
    }
    neg({ c0, c1 }) {
        const { Fp6 } = this;
        return { c0: Fp6.neg(c0), c1: Fp6.neg(c1) };
    }
    eql({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6 } = this;
        return Fp6.eql(c0, r0) && Fp6.eql(c1, r1);
    }
    sqrt(_) {
        (0, utils_ts_1.notImplemented)();
    }
    inv({ c0, c1 }) {
        const { Fp6 } = this;
        let t = Fp6.inv(Fp6.sub(Fp6.sqr(c0), Fp6.mulByNonresidue(Fp6.sqr(c1)))); // 1 / (c0² - c1² * v)
        return { c0: Fp6.mul(c0, t), c1: Fp6.neg(Fp6.mul(c1, t)) }; // ((C0 * T) * T) + (-C1 * T) * w
    }
    div(lhs, rhs) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        const { Fp } = Fp2;
        return this.mul(lhs, typeof rhs === 'bigint' ? Fp.inv(Fp.create(rhs)) : this.inv(rhs));
    }
    pow(num, power) {
        return mod.FpPow(this, num, power);
    }
    invertBatch(nums) {
        return mod.FpInvertBatch(this, nums);
    }
    // Normalized
    add({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6 } = this;
        return {
            c0: Fp6.add(c0, r0),
            c1: Fp6.add(c1, r1),
        };
    }
    sub({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6 } = this;
        return {
            c0: Fp6.sub(c0, r0),
            c1: Fp6.sub(c1, r1),
        };
    }
    mul({ c0, c1 }, rhs) {
        const { Fp6 } = this;
        if (typeof rhs === 'bigint')
            return { c0: Fp6.mul(c0, rhs), c1: Fp6.mul(c1, rhs) };
        let { c0: r0, c1: r1 } = rhs;
        let t1 = Fp6.mul(c0, r0); // c0 * r0
        let t2 = Fp6.mul(c1, r1); // c1 * r1
        return {
            c0: Fp6.add(t1, Fp6.mulByNonresidue(t2)), // T1 + T2 * v
            // (c0 + c1) * (r0 + r1) - (T1 + T2)
            c1: Fp6.sub(Fp6.mul(Fp6.add(c0, c1), Fp6.add(r0, r1)), Fp6.add(t1, t2)),
        };
    }
    sqr({ c0, c1 }) {
        const { Fp6 } = this;
        let ab = Fp6.mul(c0, c1); // c0 * c1
        return {
            // (c1 * v + c0) * (c0 + c1) - AB - AB * v
            c0: Fp6.sub(Fp6.sub(Fp6.mul(Fp6.add(Fp6.mulByNonresidue(c1), c0), Fp6.add(c0, c1)), ab), Fp6.mulByNonresidue(ab)),
            c1: Fp6.add(ab, ab),
        }; // AB + AB
    }
    // NonNormalized stuff
    addN(a, b) {
        return this.add(a, b);
    }
    subN(a, b) {
        return this.sub(a, b);
    }
    mulN(a, b) {
        return this.mul(a, b);
    }
    sqrN(a) {
        return this.sqr(a);
    }
    // Bytes utils
    fromBytes(b) {
        const { Fp6 } = this;
        if (b.length !== this.BYTES)
            throw new Error('fromBytes invalid length=' + b.length);
        return {
            c0: Fp6.fromBytes(b.subarray(0, Fp6.BYTES)),
            c1: Fp6.fromBytes(b.subarray(Fp6.BYTES)),
        };
    }
    toBytes({ c0, c1 }) {
        const { Fp6 } = this;
        return (0, utils_ts_1.concatBytes)(Fp6.toBytes(c0), Fp6.toBytes(c1));
    }
    cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
        const { Fp6 } = this;
        return {
            c0: Fp6.cmov(c0, r0, c),
            c1: Fp6.cmov(c1, r1, c),
        };
    }
    // Utils
    // toString() {
    //   return '' + 'Fp12(' + this.c0 + this.c1 + '* w');
    // },
    // fromTuple(c: [Fp6, Fp6]) {
    //   return new Fp12(...c);
    // }
    fromBigTwelve(t) {
        const { Fp6 } = this;
        return {
            c0: Fp6.fromBigSix(t.slice(0, 6)),
            c1: Fp6.fromBigSix(t.slice(6, 12)),
        };
    }
    // Raises to q**i -th power
    frobeniusMap(lhs, power) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        const { c0, c1, c2 } = Fp6.frobeniusMap(lhs.c1, power);
        const coeff = this.FROBENIUS_COEFFICIENTS[power % 12];
        return {
            c0: Fp6.frobeniusMap(lhs.c0, power),
            c1: Fp6.create({
                c0: Fp2.mul(c0, coeff),
                c1: Fp2.mul(c1, coeff),
                c2: Fp2.mul(c2, coeff),
            }),
        };
    }
    mulByFp2({ c0, c1 }, rhs) {
        const { Fp6 } = this;
        return {
            c0: Fp6.mulByFp2(c0, rhs),
            c1: Fp6.mulByFp2(c1, rhs),
        };
    }
    conjugate({ c0, c1 }) {
        return { c0, c1: this.Fp6.neg(c1) };
    }
    // Sparse multiplication
    mul014({ c0, c1 }, o0, o1, o4) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        let t0 = Fp6.mul01(c0, o0, o1);
        let t1 = Fp6.mul1(c1, o4);
        return {
            c0: Fp6.add(Fp6.mulByNonresidue(t1), t0), // T1 * v + T0
            // (c1 + c0) * [o0, o1+o4] - T0 - T1
            c1: Fp6.sub(Fp6.sub(Fp6.mul01(Fp6.add(c1, c0), o0, Fp2.add(o1, o4)), t0), t1),
        };
    }
    mul034({ c0, c1 }, o0, o3, o4) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        const a = Fp6.create({
            c0: Fp2.mul(c0.c0, o0),
            c1: Fp2.mul(c0.c1, o0),
            c2: Fp2.mul(c0.c2, o0),
        });
        const b = Fp6.mul01(c1, o3, o4);
        const e = Fp6.mul01(Fp6.add(c0, c1), Fp2.add(o0, o3), o4);
        return {
            c0: Fp6.add(Fp6.mulByNonresidue(b), a),
            c1: Fp6.sub(e, Fp6.add(a, b)),
        };
    }
    // A cyclotomic group is a subgroup of Fp^n defined by
    //   GΦₙ(p) = {α ∈ Fpⁿ : α^Φₙ(p) = 1}
    // The result of any pairing is in a cyclotomic subgroup
    // https://eprint.iacr.org/2009/565.pdf
    // https://eprint.iacr.org/2010/354.pdf
    _cyclotomicSquare({ c0, c1 }) {
        const { Fp6 } = this;
        const { Fp2 } = Fp6;
        const { c0: c0c0, c1: c0c1, c2: c0c2 } = c0;
        const { c0: c1c0, c1: c1c1, c2: c1c2 } = c1;
        const { first: t3, second: t4 } = Fp2.Fp4Square(c0c0, c1c1);
        const { first: t5, second: t6 } = Fp2.Fp4Square(c1c0, c0c2);
        const { first: t7, second: t8 } = Fp2.Fp4Square(c0c1, c1c2);
        const t9 = Fp2.mulByNonresidue(t8); // T8 * (u + 1)
        return {
            c0: Fp6.create({
                c0: Fp2.add(Fp2.mul(Fp2.sub(t3, c0c0), _2n), t3), // 2 * (T3 - c0c0)  + T3
                c1: Fp2.add(Fp2.mul(Fp2.sub(t5, c0c1), _2n), t5), // 2 * (T5 - c0c1)  + T5
                c2: Fp2.add(Fp2.mul(Fp2.sub(t7, c0c2), _2n), t7),
            }), // 2 * (T7 - c0c2)  + T7
            c1: Fp6.create({
                c0: Fp2.add(Fp2.mul(Fp2.add(t9, c1c0), _2n), t9), // 2 * (T9 + c1c0) + T9
                c1: Fp2.add(Fp2.mul(Fp2.add(t4, c1c1), _2n), t4), // 2 * (T4 + c1c1) + T4
                c2: Fp2.add(Fp2.mul(Fp2.add(t6, c1c2), _2n), t6),
            }),
        }; // 2 * (T6 + c1c2) + T6
    }
    // https://eprint.iacr.org/2009/565.pdf
    _cyclotomicExp(num, n) {
        let z = this.ONE;
        for (let i = this.X_LEN - 1; i >= 0; i--) {
            z = this._cyclotomicSquare(z);
            if ((0, utils_ts_1.bitGet)(n, i))
                z = this.mul(z, num);
        }
        return z;
    }
}
function tower12(opts) {
    const Fp = mod.Field(opts.ORDER);
    const Fp2 = new _Field2(Fp, opts);
    const Fp6 = new _Field6(Fp2);
    const Fp12 = new _Field12(Fp6, opts);
    return { Fp, Fp2, Fp6, Fp12 };
}
//# sourceMappingURL=tower.js.map
    },
    31: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bn254_weierstrass = exports.bn254 = exports._postPrecompute = exports.bn254_Fr = void 0;
/**
 * bn254, previously known as alt_bn_128, when it had 128-bit security.

Barbulescu-Duquesne 2017 shown it's weaker: just about 100 bits,
so the naming has been adjusted to its prime bit count:
https://hal.science/hal-01534101/file/main.pdf.
Compatible with EIP-196 and EIP-197.

There are huge compatibility issues in the ecosystem:

1. Different libraries call it in different ways: "bn254", "bn256", "alt_bn128", "bn128".
2. libff has bn128, but it's a different curve with different G2:
   https://github.com/scipr-lab/libff/blob/a44f482e18b8ac04d034c193bd9d7df7817ad73f/libff/algebra/curves/bn128/bn128_init.cpp#L166-L169
3. halo2curves bn256 is also incompatible and returns different outputs

We don't implement Point methods toHex / toBytes.
To work around this limitation, has to initialize points on their own from BigInts.
Reason it's not implemented is because [there is no standard](https://github.com/privacy-scaling-explorations/halo2curves/issues/109).
Points of divergence:

- Endianness: LE vs BE (byte-swapped)
- Flags as first hex bits (similar to BLS) vs no-flags
- Imaginary part last in G2 vs first (c0, c1 vs c1, c0)

The goal of our implementation is to support "Ethereum" variant of the curve,
because it at least has specs:

- EIP196 (https://eips.ethereum.org/EIPS/eip-196) describes bn254 ECADD and ECMUL opcodes for EVM
- EIP197 (https://eips.ethereum.org/EIPS/eip-197) describes bn254 pairings
- It's hard: EIPs don't have proper tests. EIP-197 returns boolean output instead of Fp12
- The existing implementations are bad. Some are deprecated:
    - https://github.com/paritytech/bn (old version)
    - https://github.com/ewasm/ethereum-bn128.rs (uses paritytech/bn)
    - https://github.com/zcash-hackworks/bn
    - https://github.com/arkworks-rs/curves/blob/master/bn254/src/lib.rs
- Python implementations use different towers and produce different Fp12 outputs:
    - https://github.com/ethereum/py_pairing
    - https://github.com/ethereum/execution-specs/blob/master/src/ethereum/crypto/alt_bn128.py
- Points are encoded differently in different implementations

### Params
Seed (X): 4965661367192848881
Fr: (36x⁴+36x³+18x²+6x+1)
Fp: (36x⁴+36x³+24x²+6x+1)
(E  / Fp ): Y² = X³+3
(Et / Fp²): Y² = X³+3/(u+9) (D-type twist)
Ate loop size: 6x+2

### Towers
- Fp²[u] = Fp/u²+1
- Fp⁶[v] = Fp²/v³-9-u
- Fp¹²[w] = Fp⁶/w²-v

 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const sha2_js_1 = require("@noble/hashes/sha2.js");
const bls_ts_1 = require("./abstract/bls.js");
const modular_ts_1 = require("./abstract/modular.js");
const tower_ts_1 = require("./abstract/tower.js");
const weierstrass_ts_1 = require("./abstract/weierstrass.js");
const utils_ts_1 = require("./utils.js");
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3);
const _6n = BigInt(6);
const BN_X = BigInt('4965661367192848881');
const BN_X_LEN = (0, utils_ts_1.bitLen)(BN_X);
const SIX_X_SQUARED = _6n * BN_X ** _2n;
const bn254_G1_CURVE = {
    p: BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47'),
    n: BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001'),
    h: _1n,
    a: _0n,
    b: _3n,
    Gx: _1n,
    Gy: BigInt(2),
};
// r == n
// Finite field over r. It's for convenience and is not used in the code below.
exports.bn254_Fr = (0, modular_ts_1.Field)(bn254_G1_CURVE.n);
// Fp2.div(Fp2.mul(Fp2.ONE, _3n), Fp2.NONRESIDUE)
const Fp2B = {
    c0: BigInt('19485874751759354771024239261021720505790618469301721065564631296452457478373'),
    c1: BigInt('266929791119991161246907387137283842545076965332900288569378510910307636690'),
};
const { Fp, Fp2, Fp6, Fp12 } = (0, tower_ts_1.tower12)({
    ORDER: bn254_G1_CURVE.p,
    X_LEN: BN_X_LEN,
    FP2_NONRESIDUE: [BigInt(9), _1n],
    Fp2mulByB: (num) => Fp2.mul(num, Fp2B),
    Fp12finalExponentiate: (num) => {
        const powMinusX = (num) => Fp12.conjugate(Fp12._cyclotomicExp(num, BN_X));
        const r0 = Fp12.mul(Fp12.conjugate(num), Fp12.inv(num));
        const r = Fp12.mul(Fp12.frobeniusMap(r0, 2), r0);
        const y1 = Fp12._cyclotomicSquare(powMinusX(r));
        const y2 = Fp12.mul(Fp12._cyclotomicSquare(y1), y1);
        const y4 = powMinusX(y2);
        const y6 = powMinusX(Fp12._cyclotomicSquare(y4));
        const y8 = Fp12.mul(Fp12.mul(Fp12.conjugate(y6), y4), Fp12.conjugate(y2));
        const y9 = Fp12.mul(y8, y1);
        return Fp12.mul(Fp12.frobeniusMap(Fp12.mul(Fp12.conjugate(r), y9), 3), Fp12.mul(Fp12.frobeniusMap(y8, 2), Fp12.mul(Fp12.frobeniusMap(y9, 1), Fp12.mul(Fp12.mul(y8, y4), r))));
    },
});
// END OF CURVE FIELDS
const { G2psi, psi } = (0, tower_ts_1.psiFrobenius)(Fp, Fp2, Fp2.NONRESIDUE);
/*
No hashToCurve for now (and signatures):

- RFC 9380 doesn't mention bn254 and doesn't provide test vectors
- Overall seems like nobody is using BLS signatures on top of bn254
- Seems like it can utilize SVDW, which is not implemented yet
*/
const htfDefaults = Object.freeze({
    // DST: a domain separation tag defined in section 2.2.5
    DST: 'BN254G2_XMD:SHA-256_SVDW_RO_',
    encodeDST: 'BN254G2_XMD:SHA-256_SVDW_RO_',
    p: Fp.ORDER,
    m: 2,
    k: 128,
    expand: 'xmd',
    hash: sha2_js_1.sha256,
});
const _postPrecompute = (Rx, Ry, Rz, Qx, Qy, pointAdd) => {
    const q = psi(Qx, Qy);
    ({ Rx, Ry, Rz } = pointAdd(Rx, Ry, Rz, q[0], q[1]));
    const q2 = psi(q[0], q[1]);
    pointAdd(Rx, Ry, Rz, q2[0], Fp2.neg(q2[1]));
};
exports._postPrecompute = _postPrecompute;
// cofactor: (36 * X^4) + (36 * X^3) + (30 * X^2) + 6*X + 1
const bn254_G2_CURVE = {
    p: Fp2.ORDER,
    n: bn254_G1_CURVE.n,
    h: BigInt('0x30644e72e131a029b85045b68181585e06ceecda572a2489345f2299c0f9fa8d'),
    a: Fp2.ZERO,
    b: Fp2B,
    Gx: Fp2.fromBigTuple([
        BigInt('10857046999023057135944570762232829481370756359578518086990519993285655852781'),
        BigInt('11559732032986387107991004021392285783925812861821192530917403151452391805634'),
    ]),
    Gy: Fp2.fromBigTuple([
        BigInt('8495653923123431417604973247489272438418190587263600148770280649306958101930'),
        BigInt('4082367875863433681332203403145435568316851327593401208105741076214120093531'),
    ]),
};
/**
 * bn254 (a.k.a. alt_bn128) pairing-friendly curve.
 * Contains G1 / G2 operations and pairings.
 */
exports.bn254 = (0, bls_ts_1.bls)({
    // Fields
    fields: { Fp, Fp2, Fp6, Fp12, Fr: exports.bn254_Fr },
    G1: {
        ...bn254_G1_CURVE,
        Fp,
        htfDefaults: { ...htfDefaults, m: 1, DST: 'BN254G2_XMD:SHA-256_SVDW_RO_' },
        wrapPrivateKey: true,
        allowInfinityPoint: true,
        mapToCurve: utils_ts_1.notImplemented,
        fromBytes: utils_ts_1.notImplemented,
        toBytes: utils_ts_1.notImplemented,
        ShortSignature: {
            fromBytes: utils_ts_1.notImplemented,
            fromHex: utils_ts_1.notImplemented,
            toBytes: utils_ts_1.notImplemented,
            toRawBytes: utils_ts_1.notImplemented,
            toHex: utils_ts_1.notImplemented,
        },
    },
    G2: {
        ...bn254_G2_CURVE,
        Fp: Fp2,
        hEff: BigInt('21888242871839275222246405745257275088844257914179612981679871602714643921549'),
        htfDefaults: { ...htfDefaults },
        wrapPrivateKey: true,
        allowInfinityPoint: true,
        isTorsionFree: (c, P) => P.multiplyUnsafe(SIX_X_SQUARED).equals(G2psi(c, P)), // [p]P = [6X^2]P
        mapToCurve: utils_ts_1.notImplemented,
        fromBytes: utils_ts_1.notImplemented,
        toBytes: utils_ts_1.notImplemented,
        Signature: {
            fromBytes: utils_ts_1.notImplemented,
            fromHex: utils_ts_1.notImplemented,
            toBytes: utils_ts_1.notImplemented,
            toRawBytes: utils_ts_1.notImplemented,
            toHex: utils_ts_1.notImplemented,
        },
    },
    params: {
        ateLoopSize: BN_X * _6n + _2n,
        r: exports.bn254_Fr.ORDER,
        xNegative: false,
        twistType: 'divisive',
    },
    htfDefaults,
    hash: sha2_js_1.sha256,
    postPrecompute: exports._postPrecompute,
});
/**
 * bn254 weierstrass curve with ECDSA.
 * This is very rare and probably not used anywhere.
 * Instead, you should use G1 / G2, defined above.
 * @deprecated
 */
exports.bn254_weierstrass = (0, weierstrass_ts_1.weierstrass)({
    a: BigInt(0),
    b: BigInt(3),
    Fp,
    n: BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617'),
    Gx: BigInt(1),
    Gy: BigInt(2),
    h: BigInt(1),
    hash: sha2_js_1.sha256,
});
//# sourceMappingURL=bn254.js.map
    },
    32: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vesta = exports.pallas = void 0;
/**
 * @deprecated
 * @module
 */
const misc_ts_1 = require("./misc.js");
/** @deprecated */
exports.pallas = misc_ts_1.pallas;
/** @deprecated */
exports.vesta = misc_ts_1.vesta;
//# sourceMappingURL=pasta.js.map
    },
    33: function(require, module, exports) {
"use strict";
/**
 * Audited & minimal JS implementation of
 * [BIP39 mnemonic phrases](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki).
 * @module
 * @example
```js
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
const mn = bip39.generateMnemonic(wordlist);
console.log(mn);
const ent = bip39.mnemonicToEntropy(mn, wordlist)
bip39.entropyToMnemonic(ent, wordlist);
bip39.validateMnemonic(mn, wordlist);
await bip39.mnemonicToSeed(mn, 'password');
bip39.mnemonicToSeedSync(mn, 'password');

// Wordlists
import { wordlist as czech } from '@scure/bip39/wordlists/czech';
import { wordlist as english } from '@scure/bip39/wordlists/english';
import { wordlist as french } from '@scure/bip39/wordlists/french';
import { wordlist as italian } from '@scure/bip39/wordlists/italian';
import { wordlist as japanese } from '@scure/bip39/wordlists/japanese';
import { wordlist as korean } from '@scure/bip39/wordlists/korean';
import { wordlist as portuguese } from '@scure/bip39/wordlists/portuguese';
import { wordlist as simplifiedChinese } from '@scure/bip39/wordlists/simplified-chinese';
import { wordlist as spanish } from '@scure/bip39/wordlists/spanish';
import { wordlist as traditionalChinese } from '@scure/bip39/wordlists/traditional-chinese';
```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMnemonic = generateMnemonic;
exports.mnemonicToEntropy = mnemonicToEntropy;
exports.entropyToMnemonic = entropyToMnemonic;
exports.validateMnemonic = validateMnemonic;
exports.mnemonicToSeed = mnemonicToSeed;
exports.mnemonicToSeedSync = mnemonicToSeedSync;
/*! scure-bip39 - MIT License (c) 2022 Patricio Palladino, Paul Miller (paulmillr.com) */
const pbkdf2_1 = require("@noble/hashes/pbkdf2");
const sha2_1 = require("@noble/hashes/sha2");
const utils_1 = require("@noble/hashes/utils");
const base_1 = require("@scure/base");
// Japanese wordlist
const isJapanese = (wordlist) => wordlist[0] === '\u3042\u3044\u3053\u304f\u3057\u3093';
// Normalization replaces equivalent sequences of characters
// so that any two texts that are equivalent will be reduced
// to the same sequence of code points, called the normal form of the original text.
// https://tonsky.me/blog/unicode/#why-is-a----
function nfkd(str) {
    if (typeof str !== 'string')
        throw new TypeError('invalid mnemonic type: ' + typeof str);
    return str.normalize('NFKD');
}
function normalize(str) {
    const norm = nfkd(str);
    const words = norm.split(' ');
    if (![12, 15, 18, 21, 24].includes(words.length))
        throw new Error('Invalid mnemonic');
    return { nfkd: norm, words };
}
function aentropy(ent) {
    (0, utils_1.abytes)(ent, 16, 20, 24, 28, 32);
}
/**
 * Generate x random words. Uses Cryptographically-Secure Random Number Generator.
 * @param wordlist imported wordlist for specific language
 * @param strength mnemonic strength 128-256 bits
 * @example
 * generateMnemonic(wordlist, 128)
 * // 'legal winner thank year wave sausage worth useful legal winner thank yellow'
 */
function generateMnemonic(wordlist, strength = 128) {
    (0, utils_1.anumber)(strength);
    if (strength % 32 !== 0 || strength > 256)
        throw new TypeError('Invalid entropy');
    return entropyToMnemonic((0, utils_1.randomBytes)(strength / 8), wordlist);
}
const calcChecksum = (entropy) => {
    // Checksum is ent.length/4 bits long
    const bitsLeft = 8 - entropy.length / 4;
    // Zero rightmost "bitsLeft" bits in byte
    // For example: bitsLeft=4 val=10111101 -> 10110000
    return new Uint8Array([((0, sha2_1.sha256)(entropy)[0] >> bitsLeft) << bitsLeft]);
};
function getCoder(wordlist) {
    if (!Array.isArray(wordlist) || wordlist.length !== 2048 || typeof wordlist[0] !== 'string')
        throw new Error('Wordlist: expected array of 2048 strings');
    wordlist.forEach((i) => {
        if (typeof i !== 'string')
            throw new Error('wordlist: non-string element: ' + i);
    });
    return base_1.utils.chain(base_1.utils.checksum(1, calcChecksum), base_1.utils.radix2(11, true), base_1.utils.alphabet(wordlist));
}
/**
 * Reversible: Converts mnemonic string to raw entropy in form of byte array.
 * @param mnemonic 12-24 words
 * @param wordlist imported wordlist for specific language
 * @example
 * const mnem = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
 * mnemonicToEntropy(mnem, wordlist)
 * // Produces
 * new Uint8Array([
 *   0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
 *   0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f
 * ])
 */
function mnemonicToEntropy(mnemonic, wordlist) {
    const { words } = normalize(mnemonic);
    const entropy = getCoder(wordlist).decode(words);
    aentropy(entropy);
    return entropy;
}
/**
 * Reversible: Converts raw entropy in form of byte array to mnemonic string.
 * @param entropy byte array
 * @param wordlist imported wordlist for specific language
 * @returns 12-24 words
 * @example
 * const ent = new Uint8Array([
 *   0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
 *   0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f
 * ]);
 * entropyToMnemonic(ent, wordlist);
 * // 'legal winner thank year wave sausage worth useful legal winner thank yellow'
 */
function entropyToMnemonic(entropy, wordlist) {
    aentropy(entropy);
    const words = getCoder(wordlist).encode(entropy);
    return words.join(isJapanese(wordlist) ? '\u3000' : ' ');
}
/**
 * Validates mnemonic for being 12-24 words contained in `wordlist`.
 */
function validateMnemonic(mnemonic, wordlist) {
    try {
        mnemonicToEntropy(mnemonic, wordlist);
    }
    catch (e) {
        return false;
    }
    return true;
}
const psalt = (passphrase) => nfkd('mnemonic' + passphrase);
/**
 * Irreversible: Uses KDF to derive 64 bytes of key data from mnemonic + optional password.
 * @param mnemonic 12-24 words
 * @param passphrase string that will additionally protect the key
 * @returns 64 bytes of key data
 * @example
 * const mnem = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
 * await mnemonicToSeed(mnem, 'password');
 * // new Uint8Array([...64 bytes])
 */
function mnemonicToSeed(mnemonic, passphrase = '') {
    return (0, pbkdf2_1.pbkdf2Async)(sha2_1.sha512, normalize(mnemonic).nfkd, psalt(passphrase), { c: 2048, dkLen: 64 });
}
/**
 * Irreversible: Uses KDF to derive 64 bytes of key data from mnemonic + optional password.
 * @param mnemonic 12-24 words
 * @param passphrase string that will additionally protect the key
 * @returns 64 bytes of key data
 * @example
 * const mnem = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
 * mnemonicToSeedSync(mnem, 'password');
 * // new Uint8Array([...64 bytes])
 */
function mnemonicToSeedSync(mnemonic, passphrase = '') {
    return (0, pbkdf2_1.pbkdf2)(sha2_1.sha512, normalize(mnemonic).nfkd, psalt(passphrase), { c: 2048, dkLen: 64 });
}

    },
    34: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pbkdf2 = pbkdf2;
exports.pbkdf2Async = pbkdf2Async;
/**
 * PBKDF (RFC 2898). Can be used to create a key from password and salt.
 * @module
 */
const hmac_ts_1 = require("./hmac.js");
// prettier-ignore
const utils_ts_1 = require("./utils.js");
// Common prologue and epilogue for sync/async functions
function pbkdf2Init(hash, _password, _salt, _opts) {
    (0, utils_ts_1.ahash)(hash);
    const opts = (0, utils_ts_1.checkOpts)({ dkLen: 32, asyncTick: 10 }, _opts);
    const { c, dkLen, asyncTick } = opts;
    (0, utils_ts_1.anumber)(c);
    (0, utils_ts_1.anumber)(dkLen);
    (0, utils_ts_1.anumber)(asyncTick);
    if (c < 1)
        throw new Error('iterations (c) should be >= 1');
    const password = (0, utils_ts_1.kdfInputToBytes)(_password);
    const salt = (0, utils_ts_1.kdfInputToBytes)(_salt);
    // DK = PBKDF2(PRF, Password, Salt, c, dkLen);
    const DK = new Uint8Array(dkLen);
    // U1 = PRF(Password, Salt + INT_32_BE(i))
    const PRF = hmac_ts_1.hmac.create(hash, password);
    const PRFSalt = PRF._cloneInto().update(salt);
    return { c, dkLen, asyncTick, DK, PRF, PRFSalt };
}
function pbkdf2Output(PRF, PRFSalt, DK, prfW, u) {
    PRF.destroy();
    PRFSalt.destroy();
    if (prfW)
        prfW.destroy();
    (0, utils_ts_1.clean)(u);
    return DK;
}
/**
 * PBKDF2-HMAC: RFC 2898 key derivation function
 * @param hash - hash function that would be used e.g. sha256
 * @param password - password from which a derived key is generated
 * @param salt - cryptographic salt
 * @param opts - {c, dkLen} where c is work factor and dkLen is output message size
 * @example
 * const key = pbkdf2(sha256, 'password', 'salt', { dkLen: 32, c: Math.pow(2, 18) });
 */
function pbkdf2(hash, password, salt, opts) {
    const { c, dkLen, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
    let prfW; // Working copy
    const arr = new Uint8Array(4);
    const view = (0, utils_ts_1.createView)(arr);
    const u = new Uint8Array(PRF.outputLen);
    // DK = T1 + T2 + ⋯ + Tdklen/hlen
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
        // Ti = F(Password, Salt, c, i)
        const Ti = DK.subarray(pos, pos + PRF.outputLen);
        view.setInt32(0, ti, false);
        // F(Password, Salt, c, i) = U1 ^ U2 ^ ⋯ ^ Uc
        // U1 = PRF(Password, Salt + INT_32_BE(i))
        (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
        Ti.set(u.subarray(0, Ti.length));
        for (let ui = 1; ui < c; ui++) {
            // Uc = PRF(Password, Uc−1)
            PRF._cloneInto(prfW).update(u).digestInto(u);
            for (let i = 0; i < Ti.length; i++)
                Ti[i] ^= u[i];
        }
    }
    return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}
/**
 * PBKDF2-HMAC: RFC 2898 key derivation function. Async version.
 * @example
 * await pbkdf2Async(sha256, 'password', 'salt', { dkLen: 32, c: 500_000 });
 */
async function pbkdf2Async(hash, password, salt, opts) {
    const { c, dkLen, asyncTick, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
    let prfW; // Working copy
    const arr = new Uint8Array(4);
    const view = (0, utils_ts_1.createView)(arr);
    const u = new Uint8Array(PRF.outputLen);
    // DK = T1 + T2 + ⋯ + Tdklen/hlen
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
        // Ti = F(Password, Salt, c, i)
        const Ti = DK.subarray(pos, pos + PRF.outputLen);
        view.setInt32(0, ti, false);
        // F(Password, Salt, c, i) = U1 ^ U2 ^ ⋯ ^ Uc
        // U1 = PRF(Password, Salt + INT_32_BE(i))
        (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
        Ti.set(u.subarray(0, Ti.length));
        await (0, utils_ts_1.asyncLoop)(c - 1, asyncTick, () => {
            // Uc = PRF(Password, Uc−1)
            PRF._cloneInto(prfW).update(u).digestInto(u);
            for (let i = 0; i < Ti.length; i++)
                Ti[i] ^= u[i];
        });
    }
    return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}
//# sourceMappingURL=pbkdf2.js.map
    },
    35: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hmac = exports.HMAC = void 0;
/**
 * HMAC: RFC2104 message authentication code.
 * @module
 */
const utils_ts_1 = require("./utils.js");
class HMAC extends utils_ts_1.Hash {
    constructor(hash, _key) {
        super();
        this.finished = false;
        this.destroyed = false;
        (0, utils_ts_1.ahash)(hash);
        const key = (0, utils_ts_1.toBytes)(_key);
        this.iHash = hash.create();
        if (typeof this.iHash.update !== 'function')
            throw new Error('Expected instance of class which extends utils.Hash');
        this.blockLen = this.iHash.blockLen;
        this.outputLen = this.iHash.outputLen;
        const blockLen = this.blockLen;
        const pad = new Uint8Array(blockLen);
        // blockLen can be bigger than outputLen
        pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
        for (let i = 0; i < pad.length; i++)
            pad[i] ^= 0x36;
        this.iHash.update(pad);
        // By doing update (processing of first block) of outer hash here we can re-use it between multiple calls via clone
        this.oHash = hash.create();
        // Undo internal XOR && apply outer XOR
        for (let i = 0; i < pad.length; i++)
            pad[i] ^= 0x36 ^ 0x5c;
        this.oHash.update(pad);
        (0, utils_ts_1.clean)(pad);
    }
    update(buf) {
        (0, utils_ts_1.aexists)(this);
        this.iHash.update(buf);
        return this;
    }
    digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.abytes)(out, this.outputLen);
        this.finished = true;
        this.iHash.digestInto(out);
        this.oHash.update(out);
        this.oHash.digestInto(out);
        this.destroy();
    }
    digest() {
        const out = new Uint8Array(this.oHash.outputLen);
        this.digestInto(out);
        return out;
    }
    _cloneInto(to) {
        // Create new instance without calling constructor since key already in state and we don't know it.
        to || (to = Object.create(Object.getPrototypeOf(this), {}));
        const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
        to = to;
        to.finished = finished;
        to.destroyed = destroyed;
        to.blockLen = blockLen;
        to.outputLen = outputLen;
        to.oHash = oHash._cloneInto(to.oHash);
        to.iHash = iHash._cloneInto(to.iHash);
        return to;
    }
    clone() {
        return this._cloneInto();
    }
    destroy() {
        this.destroyed = true;
        this.oHash.destroy();
        this.iHash.destroy();
    }
}
exports.HMAC = HMAC;
/**
 * HMAC: RFC2104 message authentication code.
 * @param hash - function that would be used e.g. sha256
 * @param key - message key
 * @param message - message data
 * @example
 * import { hmac } from '@noble/hashes/hmac';
 * import { sha256 } from '@noble/hashes/sha2';
 * const mac1 = hmac(sha256, 'key', 'message');
 */
const hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
exports.hmac = hmac;
exports.hmac.create = (hash, key) => new HMAC(hash, key);
//# sourceMappingURL=hmac.js.map
    },
    36: function(require, module, exports) {
"use strict";
/**
 * Utilities for hex, bytes, CSPRNG.
 * @module
 */
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapXOFConstructorWithOpts = exports.wrapConstructorWithOpts = exports.wrapConstructor = exports.Hash = exports.nextTick = exports.swap32IfBE = exports.byteSwapIfBE = exports.swap8IfBE = exports.isLE = void 0;
exports.isBytes = isBytes;
exports.anumber = anumber;
exports.abytes = abytes;
exports.ahash = ahash;
exports.aexists = aexists;
exports.aoutput = aoutput;
exports.u8 = u8;
exports.u32 = u32;
exports.clean = clean;
exports.createView = createView;
exports.rotr = rotr;
exports.rotl = rotl;
exports.byteSwap = byteSwap;
exports.byteSwap32 = byteSwap32;
exports.bytesToHex = bytesToHex;
exports.hexToBytes = hexToBytes;
exports.asyncLoop = asyncLoop;
exports.utf8ToBytes = utf8ToBytes;
exports.bytesToUtf8 = bytesToUtf8;
exports.toBytes = toBytes;
exports.kdfInputToBytes = kdfInputToBytes;
exports.concatBytes = concatBytes;
exports.checkOpts = checkOpts;
exports.createHasher = createHasher;
exports.createOptHasher = createOptHasher;
exports.createXOFer = createXOFer;
exports.randomBytes = randomBytes;
// We use WebCrypto aka globalThis.crypto, which exists in browsers and node.js 16+.
// node.js versions earlier than v19 don't declare it in global scope.
// For node.js, package.json#exports field mapping rewrites import
// from `crypto` to `cryptoNode`, which imports native module.
// Makes the utils un-importable in browsers without a bundler.
// Once node.js 18 is deprecated (2025-04-30), we can just drop the import.
const crypto_1 = require("@noble/hashes/crypto");
/** Checks if something is Uint8Array. Be careful: nodejs Buffer will return true. */
function isBytes(a) {
    return a instanceof Uint8Array || (ArrayBuffer.isView(a) && a.constructor.name === 'Uint8Array');
}
/** Asserts something is positive integer. */
function anumber(n) {
    if (!Number.isSafeInteger(n) || n < 0)
        throw new Error('positive integer expected, got ' + n);
}
/** Asserts something is Uint8Array. */
function abytes(b, ...lengths) {
    if (!isBytes(b))
        throw new Error('Uint8Array expected');
    if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error('Uint8Array expected of length ' + lengths + ', got length=' + b.length);
}
/** Asserts something is hash */
function ahash(h) {
    if (typeof h !== 'function' || typeof h.create !== 'function')
        throw new Error('Hash should be wrapped by utils.createHasher');
    anumber(h.outputLen);
    anumber(h.blockLen);
}
/** Asserts a hash instance has not been destroyed / finished */
function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
        throw new Error('Hash instance has been destroyed');
    if (checkFinished && instance.finished)
        throw new Error('Hash#digest() has already been called');
}
/** Asserts output is properly-sized byte array */
function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
        throw new Error('digestInto() expects output buffer of length at least ' + min);
    }
}
/** Cast u8 / u16 / u32 to u8. */
function u8(arr) {
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
/** Cast u8 / u16 / u32 to u32. */
function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
/** Zeroize a byte array. Warning: JS provides no guarantees. */
function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
        arrays[i].fill(0);
    }
}
/** Create DataView of an array for easy byte-level manipulation. */
function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
/** The rotate right (circular right shift) operation for uint32 */
function rotr(word, shift) {
    return (word << (32 - shift)) | (word >>> shift);
}
/** The rotate left (circular left shift) operation for uint32 */
function rotl(word, shift) {
    return (word << shift) | ((word >>> (32 - shift)) >>> 0);
}
/** Is current platform little-endian? Most are. Big-Endian platform: IBM */
exports.isLE = (() => new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44)();
/** The byte swap operation for uint32 */
function byteSwap(word) {
    return (((word << 24) & 0xff000000) |
        ((word << 8) & 0xff0000) |
        ((word >>> 8) & 0xff00) |
        ((word >>> 24) & 0xff));
}
/** Conditionally byte swap if on a big-endian platform */
exports.swap8IfBE = exports.isLE
    ? (n) => n
    : (n) => byteSwap(n);
/** @deprecated */
exports.byteSwapIfBE = exports.swap8IfBE;
/** In place byte swap for Uint32Array */
function byteSwap32(arr) {
    for (let i = 0; i < arr.length; i++) {
        arr[i] = byteSwap(arr[i]);
    }
    return arr;
}
exports.swap32IfBE = exports.isLE
    ? (u) => u
    : byteSwap32;
// Built-in hex conversion https://caniuse.com/mdn-javascript_builtins_uint8array_fromhex
const hasHexBuiltin = /* @__PURE__ */ (() => 
// @ts-ignore
typeof Uint8Array.from([]).toHex === 'function' && typeof Uint8Array.fromHex === 'function')();
// Array where index 0xf0 (240) is mapped to string 'f0'
const hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
/**
 * Convert byte array to hex string. Uses built-in function, when available.
 * @example bytesToHex(Uint8Array.from([0xca, 0xfe, 0x01, 0x23])) // 'cafe0123'
 */
function bytesToHex(bytes) {
    abytes(bytes);
    // @ts-ignore
    if (hasHexBuiltin)
        return bytes.toHex();
    // pre-caching improves the speed 6x
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += hexes[bytes[i]];
    }
    return hex;
}
// We use optimized technique to convert hex string to byte array
const asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
        return ch - asciis._0; // '2' => 50-48
    if (ch >= asciis.A && ch <= asciis.F)
        return ch - (asciis.A - 10); // 'B' => 66-(65-10)
    if (ch >= asciis.a && ch <= asciis.f)
        return ch - (asciis.a - 10); // 'b' => 98-(97-10)
    return;
}
/**
 * Convert hex string to byte array. Uses built-in function, when available.
 * @example hexToBytes('cafe0123') // Uint8Array.from([0xca, 0xfe, 0x01, 0x23])
 */
function hexToBytes(hex) {
    if (typeof hex !== 'string')
        throw new Error('hex string expected, got ' + typeof hex);
    // @ts-ignore
    if (hasHexBuiltin)
        return Uint8Array.fromHex(hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
        throw new Error('hex string expected, got unpadded hex of length ' + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
        const n1 = asciiToBase16(hex.charCodeAt(hi));
        const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
        if (n1 === undefined || n2 === undefined) {
            const char = hex[hi] + hex[hi + 1];
            throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
        }
        array[ai] = n1 * 16 + n2; // multiply first octet, e.g. 'a3' => 10*16+3 => 160 + 3 => 163
    }
    return array;
}
/**
 * There is no setImmediate in browser and setTimeout is slow.
 * Call of async fn will return Promise, which will be fullfiled only on
 * next scheduler queue processing step and this is exactly what we need.
 */
const nextTick = async () => { };
exports.nextTick = nextTick;
/** Returns control to thread each 'tick' ms to avoid blocking. */
async function asyncLoop(iters, tick, cb) {
    let ts = Date.now();
    for (let i = 0; i < iters; i++) {
        cb(i);
        // Date.now() is not monotonic, so in case if clock goes backwards we return return control too
        const diff = Date.now() - ts;
        if (diff >= 0 && diff < tick)
            continue;
        await (0, exports.nextTick)();
        ts += diff;
    }
}
/**
 * Converts string to bytes using UTF8 encoding.
 * @example utf8ToBytes('abc') // Uint8Array.from([97, 98, 99])
 */
function utf8ToBytes(str) {
    if (typeof str !== 'string')
        throw new Error('string expected');
    return new Uint8Array(new TextEncoder().encode(str)); // https://bugzil.la/1681809
}
/**
 * Converts bytes to string using UTF8 encoding.
 * @example bytesToUtf8(Uint8Array.from([97, 98, 99])) // 'abc'
 */
function bytesToUtf8(bytes) {
    return new TextDecoder().decode(bytes);
}
/**
 * Normalizes (non-hex) string or Uint8Array to Uint8Array.
 * Warning: when Uint8Array is passed, it would NOT get copied.
 * Keep in mind for future mutable operations.
 */
function toBytes(data) {
    if (typeof data === 'string')
        data = utf8ToBytes(data);
    abytes(data);
    return data;
}
/**
 * Helper for KDFs: consumes uint8array or string.
 * When string is passed, does utf8 decoding, using TextDecoder.
 */
function kdfInputToBytes(data) {
    if (typeof data === 'string')
        data = utf8ToBytes(data);
    abytes(data);
    return data;
}
/** Copies several Uint8Arrays into one. */
function concatBytes(...arrays) {
    let sum = 0;
    for (let i = 0; i < arrays.length; i++) {
        const a = arrays[i];
        abytes(a);
        sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i = 0, pad = 0; i < arrays.length; i++) {
        const a = arrays[i];
        res.set(a, pad);
        pad += a.length;
    }
    return res;
}
function checkOpts(defaults, opts) {
    if (opts !== undefined && {}.toString.call(opts) !== '[object Object]')
        throw new Error('options should be object or undefined');
    const merged = Object.assign(defaults, opts);
    return merged;
}
/** For runtime check if class implements interface */
class Hash {
}
exports.Hash = Hash;
/** Wraps hash function, creating an interface on top of it */
function createHasher(hashCons) {
    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
}
function createOptHasher(hashCons) {
    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
    const tmp = hashCons({});
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    return hashC;
}
function createXOFer(hashCons) {
    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
    const tmp = hashCons({});
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    return hashC;
}
exports.wrapConstructor = createHasher;
exports.wrapConstructorWithOpts = createOptHasher;
exports.wrapXOFConstructorWithOpts = createXOFer;
/** Cryptographically secure PRNG. Uses internal OS-level `crypto.getRandomValues`. */
function randomBytes(bytesLength = 32) {
    if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === 'function') {
        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
    }
    // Legacy Node.js compatibility
    if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === 'function') {
        return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
    }
    throw new Error('crypto.getRandomValues must be defined');
}
//# sourceMappingURL=utils.js.map
    },
    37: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crypto = void 0;
/**
 * Internal webcrypto alias.
 * We prefer WebCrypto aka globalThis.crypto, which exists in node.js 16+.
 * Falls back to Node.js built-in crypto for Node.js <=v14.
 * See utils.ts for details.
 * @module
 */
// @ts-ignore
const nc = require("node:crypto");
exports.crypto = nc && typeof nc === 'object' && 'webcrypto' in nc
    ? nc.webcrypto
    : nc && typeof nc === 'object' && 'randomBytes' in nc
        ? nc
        : undefined;
//# sourceMappingURL=cryptoNode.js.map
    },
    38: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha512_224 = exports.sha512_256 = exports.sha384 = exports.sha512 = exports.sha224 = exports.sha256 = exports.SHA512_256 = exports.SHA512_224 = exports.SHA384 = exports.SHA512 = exports.SHA224 = exports.SHA256 = void 0;
/**
 * SHA2 hash function. A.k.a. sha256, sha384, sha512, sha512_224, sha512_256.
 * SHA256 is the fastest hash implementable in JS, even faster than Blake3.
 * Check out [RFC 4634](https://datatracker.ietf.org/doc/html/rfc4634) and
 * [FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf).
 * @module
 */
const _md_ts_1 = require("./_md.js");
const u64 = require("./_u64.js");
const utils_ts_1 = require("./utils.js");
/**
 * Round constants:
 * First 32 bits of fractional parts of the cube roots of the first 64 primes 2..311)
 */
// prettier-ignore
const SHA256_K = /* @__PURE__ */ Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
/** Reusable temporary buffer. "W" comes straight from spec. */
const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
class SHA256 extends _md_ts_1.HashMD {
    constructor(outputLen = 32) {
        super(64, outputLen, 8, false);
        // We cannot use array here since array allows indexing by variable
        // which means optimizer/compiler cannot use registers.
        this.A = _md_ts_1.SHA256_IV[0] | 0;
        this.B = _md_ts_1.SHA256_IV[1] | 0;
        this.C = _md_ts_1.SHA256_IV[2] | 0;
        this.D = _md_ts_1.SHA256_IV[3] | 0;
        this.E = _md_ts_1.SHA256_IV[4] | 0;
        this.F = _md_ts_1.SHA256_IV[5] | 0;
        this.G = _md_ts_1.SHA256_IV[6] | 0;
        this.H = _md_ts_1.SHA256_IV[7] | 0;
    }
    get() {
        const { A, B, C, D, E, F, G, H } = this;
        return [A, B, C, D, E, F, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F, G, H) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
        this.E = E | 0;
        this.F = F | 0;
        this.G = G | 0;
        this.H = H | 0;
    }
    process(view, offset) {
        // Extend the first 16 words into the remaining 48 words w[16..63] of the message schedule array
        for (let i = 0; i < 16; i++, offset += 4)
            SHA256_W[i] = view.getUint32(offset, false);
        for (let i = 16; i < 64; i++) {
            const W15 = SHA256_W[i - 15];
            const W2 = SHA256_W[i - 2];
            const s0 = (0, utils_ts_1.rotr)(W15, 7) ^ (0, utils_ts_1.rotr)(W15, 18) ^ (W15 >>> 3);
            const s1 = (0, utils_ts_1.rotr)(W2, 17) ^ (0, utils_ts_1.rotr)(W2, 19) ^ (W2 >>> 10);
            SHA256_W[i] = (s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16]) | 0;
        }
        // Compression function main loop, 64 rounds
        let { A, B, C, D, E, F, G, H } = this;
        for (let i = 0; i < 64; i++) {
            const sigma1 = (0, utils_ts_1.rotr)(E, 6) ^ (0, utils_ts_1.rotr)(E, 11) ^ (0, utils_ts_1.rotr)(E, 25);
            const T1 = (H + sigma1 + (0, _md_ts_1.Chi)(E, F, G) + SHA256_K[i] + SHA256_W[i]) | 0;
            const sigma0 = (0, utils_ts_1.rotr)(A, 2) ^ (0, utils_ts_1.rotr)(A, 13) ^ (0, utils_ts_1.rotr)(A, 22);
            const T2 = (sigma0 + (0, _md_ts_1.Maj)(A, B, C)) | 0;
            H = G;
            G = F;
            F = E;
            E = (D + T1) | 0;
            D = C;
            C = B;
            B = A;
            A = (T1 + T2) | 0;
        }
        // Add the compressed chunk to the current hash value
        A = (A + this.A) | 0;
        B = (B + this.B) | 0;
        C = (C + this.C) | 0;
        D = (D + this.D) | 0;
        E = (E + this.E) | 0;
        F = (F + this.F) | 0;
        G = (G + this.G) | 0;
        H = (H + this.H) | 0;
        this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
        (0, utils_ts_1.clean)(SHA256_W);
    }
    destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
        (0, utils_ts_1.clean)(this.buffer);
    }
}
exports.SHA256 = SHA256;
class SHA224 extends SHA256 {
    constructor() {
        super(28);
        this.A = _md_ts_1.SHA224_IV[0] | 0;
        this.B = _md_ts_1.SHA224_IV[1] | 0;
        this.C = _md_ts_1.SHA224_IV[2] | 0;
        this.D = _md_ts_1.SHA224_IV[3] | 0;
        this.E = _md_ts_1.SHA224_IV[4] | 0;
        this.F = _md_ts_1.SHA224_IV[5] | 0;
        this.G = _md_ts_1.SHA224_IV[6] | 0;
        this.H = _md_ts_1.SHA224_IV[7] | 0;
    }
}
exports.SHA224 = SHA224;
// SHA2-512 is slower than sha256 in js because u64 operations are slow.
// Round contants
// First 32 bits of the fractional parts of the cube roots of the first 80 primes 2..409
// prettier-ignore
const K512 = /* @__PURE__ */ (() => u64.split([
    '0x428a2f98d728ae22', '0x7137449123ef65cd', '0xb5c0fbcfec4d3b2f', '0xe9b5dba58189dbbc',
    '0x3956c25bf348b538', '0x59f111f1b605d019', '0x923f82a4af194f9b', '0xab1c5ed5da6d8118',
    '0xd807aa98a3030242', '0x12835b0145706fbe', '0x243185be4ee4b28c', '0x550c7dc3d5ffb4e2',
    '0x72be5d74f27b896f', '0x80deb1fe3b1696b1', '0x9bdc06a725c71235', '0xc19bf174cf692694',
    '0xe49b69c19ef14ad2', '0xefbe4786384f25e3', '0x0fc19dc68b8cd5b5', '0x240ca1cc77ac9c65',
    '0x2de92c6f592b0275', '0x4a7484aa6ea6e483', '0x5cb0a9dcbd41fbd4', '0x76f988da831153b5',
    '0x983e5152ee66dfab', '0xa831c66d2db43210', '0xb00327c898fb213f', '0xbf597fc7beef0ee4',
    '0xc6e00bf33da88fc2', '0xd5a79147930aa725', '0x06ca6351e003826f', '0x142929670a0e6e70',
    '0x27b70a8546d22ffc', '0x2e1b21385c26c926', '0x4d2c6dfc5ac42aed', '0x53380d139d95b3df',
    '0x650a73548baf63de', '0x766a0abb3c77b2a8', '0x81c2c92e47edaee6', '0x92722c851482353b',
    '0xa2bfe8a14cf10364', '0xa81a664bbc423001', '0xc24b8b70d0f89791', '0xc76c51a30654be30',
    '0xd192e819d6ef5218', '0xd69906245565a910', '0xf40e35855771202a', '0x106aa07032bbd1b8',
    '0x19a4c116b8d2d0c8', '0x1e376c085141ab53', '0x2748774cdf8eeb99', '0x34b0bcb5e19b48a8',
    '0x391c0cb3c5c95a63', '0x4ed8aa4ae3418acb', '0x5b9cca4f7763e373', '0x682e6ff3d6b2b8a3',
    '0x748f82ee5defb2fc', '0x78a5636f43172f60', '0x84c87814a1f0ab72', '0x8cc702081a6439ec',
    '0x90befffa23631e28', '0xa4506cebde82bde9', '0xbef9a3f7b2c67915', '0xc67178f2e372532b',
    '0xca273eceea26619c', '0xd186b8c721c0c207', '0xeada7dd6cde0eb1e', '0xf57d4f7fee6ed178',
    '0x06f067aa72176fba', '0x0a637dc5a2c898a6', '0x113f9804bef90dae', '0x1b710b35131c471b',
    '0x28db77f523047d84', '0x32caab7b40c72493', '0x3c9ebe0a15c9bebc', '0x431d67c49c100d4c',
    '0x4cc5d4becb3e42b6', '0x597f299cfc657e2a', '0x5fcb6fab3ad6faec', '0x6c44198c4a475817'
].map(n => BigInt(n))))();
const SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
const SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
// Reusable temporary buffers
const SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
const SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
class SHA512 extends _md_ts_1.HashMD {
    constructor(outputLen = 64) {
        super(128, outputLen, 16, false);
        // We cannot use array here since array allows indexing by variable
        // which means optimizer/compiler cannot use registers.
        // h -- high 32 bits, l -- low 32 bits
        this.Ah = _md_ts_1.SHA512_IV[0] | 0;
        this.Al = _md_ts_1.SHA512_IV[1] | 0;
        this.Bh = _md_ts_1.SHA512_IV[2] | 0;
        this.Bl = _md_ts_1.SHA512_IV[3] | 0;
        this.Ch = _md_ts_1.SHA512_IV[4] | 0;
        this.Cl = _md_ts_1.SHA512_IV[5] | 0;
        this.Dh = _md_ts_1.SHA512_IV[6] | 0;
        this.Dl = _md_ts_1.SHA512_IV[7] | 0;
        this.Eh = _md_ts_1.SHA512_IV[8] | 0;
        this.El = _md_ts_1.SHA512_IV[9] | 0;
        this.Fh = _md_ts_1.SHA512_IV[10] | 0;
        this.Fl = _md_ts_1.SHA512_IV[11] | 0;
        this.Gh = _md_ts_1.SHA512_IV[12] | 0;
        this.Gl = _md_ts_1.SHA512_IV[13] | 0;
        this.Hh = _md_ts_1.SHA512_IV[14] | 0;
        this.Hl = _md_ts_1.SHA512_IV[15] | 0;
    }
    // prettier-ignore
    get() {
        const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    // prettier-ignore
    set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
        this.Ah = Ah | 0;
        this.Al = Al | 0;
        this.Bh = Bh | 0;
        this.Bl = Bl | 0;
        this.Ch = Ch | 0;
        this.Cl = Cl | 0;
        this.Dh = Dh | 0;
        this.Dl = Dl | 0;
        this.Eh = Eh | 0;
        this.El = El | 0;
        this.Fh = Fh | 0;
        this.Fl = Fl | 0;
        this.Gh = Gh | 0;
        this.Gl = Gl | 0;
        this.Hh = Hh | 0;
        this.Hl = Hl | 0;
    }
    process(view, offset) {
        // Extend the first 16 words into the remaining 64 words w[16..79] of the message schedule array
        for (let i = 0; i < 16; i++, offset += 4) {
            SHA512_W_H[i] = view.getUint32(offset);
            SHA512_W_L[i] = view.getUint32((offset += 4));
        }
        for (let i = 16; i < 80; i++) {
            // s0 := (w[i-15] rightrotate 1) xor (w[i-15] rightrotate 8) xor (w[i-15] rightshift 7)
            const W15h = SHA512_W_H[i - 15] | 0;
            const W15l = SHA512_W_L[i - 15] | 0;
            const s0h = u64.rotrSH(W15h, W15l, 1) ^ u64.rotrSH(W15h, W15l, 8) ^ u64.shrSH(W15h, W15l, 7);
            const s0l = u64.rotrSL(W15h, W15l, 1) ^ u64.rotrSL(W15h, W15l, 8) ^ u64.shrSL(W15h, W15l, 7);
            // s1 := (w[i-2] rightrotate 19) xor (w[i-2] rightrotate 61) xor (w[i-2] rightshift 6)
            const W2h = SHA512_W_H[i - 2] | 0;
            const W2l = SHA512_W_L[i - 2] | 0;
            const s1h = u64.rotrSH(W2h, W2l, 19) ^ u64.rotrBH(W2h, W2l, 61) ^ u64.shrSH(W2h, W2l, 6);
            const s1l = u64.rotrSL(W2h, W2l, 19) ^ u64.rotrBL(W2h, W2l, 61) ^ u64.shrSL(W2h, W2l, 6);
            // SHA256_W[i] = s0 + s1 + SHA256_W[i - 7] + SHA256_W[i - 16];
            const SUMl = u64.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
            const SUMh = u64.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
            SHA512_W_H[i] = SUMh | 0;
            SHA512_W_L[i] = SUMl | 0;
        }
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        // Compression function main loop, 80 rounds
        for (let i = 0; i < 80; i++) {
            // S1 := (e rightrotate 14) xor (e rightrotate 18) xor (e rightrotate 41)
            const sigma1h = u64.rotrSH(Eh, El, 14) ^ u64.rotrSH(Eh, El, 18) ^ u64.rotrBH(Eh, El, 41);
            const sigma1l = u64.rotrSL(Eh, El, 14) ^ u64.rotrSL(Eh, El, 18) ^ u64.rotrBL(Eh, El, 41);
            //const T1 = (H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i]) | 0;
            const CHIh = (Eh & Fh) ^ (~Eh & Gh);
            const CHIl = (El & Fl) ^ (~El & Gl);
            // T1 = H + sigma1 + Chi(E, F, G) + SHA512_K[i] + SHA512_W[i]
            // prettier-ignore
            const T1ll = u64.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
            const T1h = u64.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
            const T1l = T1ll | 0;
            // S0 := (a rightrotate 28) xor (a rightrotate 34) xor (a rightrotate 39)
            const sigma0h = u64.rotrSH(Ah, Al, 28) ^ u64.rotrBH(Ah, Al, 34) ^ u64.rotrBH(Ah, Al, 39);
            const sigma0l = u64.rotrSL(Ah, Al, 28) ^ u64.rotrBL(Ah, Al, 34) ^ u64.rotrBL(Ah, Al, 39);
            const MAJh = (Ah & Bh) ^ (Ah & Ch) ^ (Bh & Ch);
            const MAJl = (Al & Bl) ^ (Al & Cl) ^ (Bl & Cl);
            Hh = Gh | 0;
            Hl = Gl | 0;
            Gh = Fh | 0;
            Gl = Fl | 0;
            Fh = Eh | 0;
            Fl = El | 0;
            ({ h: Eh, l: El } = u64.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
            Dh = Ch | 0;
            Dl = Cl | 0;
            Ch = Bh | 0;
            Cl = Bl | 0;
            Bh = Ah | 0;
            Bl = Al | 0;
            const All = u64.add3L(T1l, sigma0l, MAJl);
            Ah = u64.add3H(All, T1h, sigma0h, MAJh);
            Al = All | 0;
        }
        // Add the compressed chunk to the current hash value
        ({ h: Ah, l: Al } = u64.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
        ({ h: Bh, l: Bl } = u64.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
        ({ h: Ch, l: Cl } = u64.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
        ({ h: Dh, l: Dl } = u64.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
        ({ h: Eh, l: El } = u64.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
        ({ h: Fh, l: Fl } = u64.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
        ({ h: Gh, l: Gl } = u64.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
        ({ h: Hh, l: Hl } = u64.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
        this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
        (0, utils_ts_1.clean)(SHA512_W_H, SHA512_W_L);
    }
    destroy() {
        (0, utils_ts_1.clean)(this.buffer);
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
}
exports.SHA512 = SHA512;
class SHA384 extends SHA512 {
    constructor() {
        super(48);
        this.Ah = _md_ts_1.SHA384_IV[0] | 0;
        this.Al = _md_ts_1.SHA384_IV[1] | 0;
        this.Bh = _md_ts_1.SHA384_IV[2] | 0;
        this.Bl = _md_ts_1.SHA384_IV[3] | 0;
        this.Ch = _md_ts_1.SHA384_IV[4] | 0;
        this.Cl = _md_ts_1.SHA384_IV[5] | 0;
        this.Dh = _md_ts_1.SHA384_IV[6] | 0;
        this.Dl = _md_ts_1.SHA384_IV[7] | 0;
        this.Eh = _md_ts_1.SHA384_IV[8] | 0;
        this.El = _md_ts_1.SHA384_IV[9] | 0;
        this.Fh = _md_ts_1.SHA384_IV[10] | 0;
        this.Fl = _md_ts_1.SHA384_IV[11] | 0;
        this.Gh = _md_ts_1.SHA384_IV[12] | 0;
        this.Gl = _md_ts_1.SHA384_IV[13] | 0;
        this.Hh = _md_ts_1.SHA384_IV[14] | 0;
        this.Hl = _md_ts_1.SHA384_IV[15] | 0;
    }
}
exports.SHA384 = SHA384;
/**
 * Truncated SHA512/256 and SHA512/224.
 * SHA512_IV is XORed with 0xa5a5a5a5a5a5a5a5, then used as "intermediary" IV of SHA512/t.
 * Then t hashes string to produce result IV.
 * See `test/misc/sha2-gen-iv.js`.
 */
/** SHA512/224 IV */
const T224_IV = /* @__PURE__ */ Uint32Array.from([
    0x8c3d37c8, 0x19544da2, 0x73e19966, 0x89dcd4d6, 0x1dfab7ae, 0x32ff9c82, 0x679dd514, 0x582f9fcf,
    0x0f6d2b69, 0x7bd44da8, 0x77e36f73, 0x04c48942, 0x3f9d85a8, 0x6a1d36c8, 0x1112e6ad, 0x91d692a1,
]);
/** SHA512/256 IV */
const T256_IV = /* @__PURE__ */ Uint32Array.from([
    0x22312194, 0xfc2bf72c, 0x9f555fa3, 0xc84c64c2, 0x2393b86b, 0x6f53b151, 0x96387719, 0x5940eabd,
    0x96283ee2, 0xa88effe3, 0xbe5e1e25, 0x53863992, 0x2b0199fc, 0x2c85b8aa, 0x0eb72ddc, 0x81c52ca2,
]);
class SHA512_224 extends SHA512 {
    constructor() {
        super(28);
        this.Ah = T224_IV[0] | 0;
        this.Al = T224_IV[1] | 0;
        this.Bh = T224_IV[2] | 0;
        this.Bl = T224_IV[3] | 0;
        this.Ch = T224_IV[4] | 0;
        this.Cl = T224_IV[5] | 0;
        this.Dh = T224_IV[6] | 0;
        this.Dl = T224_IV[7] | 0;
        this.Eh = T224_IV[8] | 0;
        this.El = T224_IV[9] | 0;
        this.Fh = T224_IV[10] | 0;
        this.Fl = T224_IV[11] | 0;
        this.Gh = T224_IV[12] | 0;
        this.Gl = T224_IV[13] | 0;
        this.Hh = T224_IV[14] | 0;
        this.Hl = T224_IV[15] | 0;
    }
}
exports.SHA512_224 = SHA512_224;
class SHA512_256 extends SHA512 {
    constructor() {
        super(32);
        this.Ah = T256_IV[0] | 0;
        this.Al = T256_IV[1] | 0;
        this.Bh = T256_IV[2] | 0;
        this.Bl = T256_IV[3] | 0;
        this.Ch = T256_IV[4] | 0;
        this.Cl = T256_IV[5] | 0;
        this.Dh = T256_IV[6] | 0;
        this.Dl = T256_IV[7] | 0;
        this.Eh = T256_IV[8] | 0;
        this.El = T256_IV[9] | 0;
        this.Fh = T256_IV[10] | 0;
        this.Fl = T256_IV[11] | 0;
        this.Gh = T256_IV[12] | 0;
        this.Gl = T256_IV[13] | 0;
        this.Hh = T256_IV[14] | 0;
        this.Hl = T256_IV[15] | 0;
    }
}
exports.SHA512_256 = SHA512_256;
/**
 * SHA2-256 hash function from RFC 4634.
 *
 * It is the fastest JS hash, even faster than Blake3.
 * To break sha256 using birthday attack, attackers need to try 2^128 hashes.
 * BTC network is doing 2^70 hashes/sec (2^95 hashes/year) as per 2025.
 */
exports.sha256 = (0, utils_ts_1.createHasher)(() => new SHA256());
/** SHA2-224 hash function from RFC 4634 */
exports.sha224 = (0, utils_ts_1.createHasher)(() => new SHA224());
/** SHA2-512 hash function from RFC 4634. */
exports.sha512 = (0, utils_ts_1.createHasher)(() => new SHA512());
/** SHA2-384 hash function from RFC 4634. */
exports.sha384 = (0, utils_ts_1.createHasher)(() => new SHA384());
/**
 * SHA2-512/256 "truncated" hash function, with improved resistance to length extension attacks.
 * See the paper on [truncated SHA512](https://eprint.iacr.org/2010/548.pdf).
 */
exports.sha512_256 = (0, utils_ts_1.createHasher)(() => new SHA512_256());
/**
 * SHA2-512/224 "truncated" hash function, with improved resistance to length extension attacks.
 * See the paper on [truncated SHA512](https://eprint.iacr.org/2010/548.pdf).
 */
exports.sha512_224 = (0, utils_ts_1.createHasher)(() => new SHA512_224());
//# sourceMappingURL=sha2.js.map
    },
    39: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHA512_IV = exports.SHA384_IV = exports.SHA224_IV = exports.SHA256_IV = exports.HashMD = void 0;
exports.setBigUint64 = setBigUint64;
exports.Chi = Chi;
exports.Maj = Maj;
/**
 * Internal Merkle-Damgard hash utils.
 * @module
 */
const utils_ts_1 = require("./utils.js");
/** Polyfill for Safari 14. https://caniuse.com/mdn-javascript_builtins_dataview_setbiguint64 */
function setBigUint64(view, byteOffset, value, isLE) {
    if (typeof view.setBigUint64 === 'function')
        return view.setBigUint64(byteOffset, value, isLE);
    const _32n = BigInt(32);
    const _u32_max = BigInt(0xffffffff);
    const wh = Number((value >> _32n) & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
}
/** Choice: a ? b : c */
function Chi(a, b, c) {
    return (a & b) ^ (~a & c);
}
/** Majority function, true if any two inputs is true. */
function Maj(a, b, c) {
    return (a & b) ^ (a & c) ^ (b & c);
}
/**
 * Merkle-Damgard hash construction base class.
 * Could be used to create MD5, RIPEMD, SHA1, SHA2.
 */
class HashMD extends utils_ts_1.Hash {
    constructor(blockLen, outputLen, padOffset, isLE) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.padOffset = padOffset;
        this.isLE = isLE;
        this.buffer = new Uint8Array(blockLen);
        this.view = (0, utils_ts_1.createView)(this.buffer);
    }
    update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        const { view, buffer, blockLen } = this;
        const len = data.length;
        for (let pos = 0; pos < len;) {
            const take = Math.min(blockLen - this.pos, len - pos);
            // Fast path: we have at least one block in input, cast it to view and process
            if (take === blockLen) {
                const dataView = (0, utils_ts_1.createView)(data);
                for (; blockLen <= len - pos; pos += blockLen)
                    this.process(dataView, pos);
                continue;
            }
            buffer.set(data.subarray(pos, pos + take), this.pos);
            this.pos += take;
            pos += take;
            if (this.pos === blockLen) {
                this.process(view, 0);
                this.pos = 0;
            }
        }
        this.length += data.length;
        this.roundClean();
        return this;
    }
    digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.aoutput)(out, this);
        this.finished = true;
        // Padding
        // We can avoid allocation of buffer for padding completely if it
        // was previously not allocated here. But it won't change performance.
        const { buffer, view, blockLen, isLE } = this;
        let { pos } = this;
        // append the bit '1' to the message
        buffer[pos++] = 0b10000000;
        (0, utils_ts_1.clean)(this.buffer.subarray(pos));
        // we have less than padOffset left in buffer, so we cannot put length in
        // current block, need process it and pad again
        if (this.padOffset > blockLen - pos) {
            this.process(view, 0);
            pos = 0;
        }
        // Pad until full block byte with zeros
        for (let i = pos; i < blockLen; i++)
            buffer[i] = 0;
        // Note: sha512 requires length to be 128bit integer, but length in JS will overflow before that
        // You need to write around 2 exabytes (u64_max / 8 / (1024**6)) for this to happen.
        // So we just write lowest 64 bits of that value.
        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
        this.process(view, 0);
        const oview = (0, utils_ts_1.createView)(out);
        const len = this.outputLen;
        // NOTE: we do division by 4 later, which should be fused in single op with modulo by JIT
        if (len % 4)
            throw new Error('_sha2: outputLen should be aligned to 32bit');
        const outLen = len / 4;
        const state = this.get();
        if (outLen > state.length)
            throw new Error('_sha2: outputLen bigger than state');
        for (let i = 0; i < outLen; i++)
            oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
    }
    _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { blockLen, buffer, length, finished, destroyed, pos } = this;
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        if (length % blockLen)
            to.buffer.set(buffer);
        return to;
    }
    clone() {
        return this._cloneInto();
    }
}
exports.HashMD = HashMD;
/**
 * Initial SHA-2 state: fractional parts of square roots of first 16 primes 2..53.
 * Check out `test/misc/sha2-gen-iv.js` for recomputation guide.
 */
/** Initial SHA256 state. Bits 0..32 of frac part of sqrt of primes 2..19 */
exports.SHA256_IV = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
/** Initial SHA224 state. Bits 32..64 of frac part of sqrt of primes 23..53 */
exports.SHA224_IV = Uint32Array.from([
    0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
]);
/** Initial SHA384 state. Bits 0..64 of frac part of sqrt of primes 23..53 */
exports.SHA384_IV = Uint32Array.from([
    0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
    0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
]);
/** Initial SHA512 state. Bits 0..64 of frac part of sqrt of primes 2..19 */
exports.SHA512_IV = Uint32Array.from([
    0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
]);
//# sourceMappingURL=_md.js.map
    },
    40: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBig = exports.shrSL = exports.shrSH = exports.rotrSL = exports.rotrSH = exports.rotrBL = exports.rotrBH = exports.rotr32L = exports.rotr32H = exports.rotlSL = exports.rotlSH = exports.rotlBL = exports.rotlBH = exports.add5L = exports.add5H = exports.add4L = exports.add4H = exports.add3L = exports.add3H = void 0;
exports.add = add;
exports.fromBig = fromBig;
exports.split = split;
/**
 * Internal helpers for u64. BigUint64Array is too slow as per 2025, so we implement it using Uint32Array.
 * @todo re-check https://issues.chromium.org/issues/42212588
 * @module
 */
const U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
const _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
    if (le)
        return { h: Number(n & U32_MASK64), l: Number((n >> _32n) & U32_MASK64) };
    return { h: Number((n >> _32n) & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
        const { h, l } = fromBig(lst[i], le);
        [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
}
const toBig = (h, l) => (BigInt(h >>> 0) << _32n) | BigInt(l >>> 0);
exports.toBig = toBig;
// for Shift in [0, 32)
const shrSH = (h, _l, s) => h >>> s;
exports.shrSH = shrSH;
const shrSL = (h, l, s) => (h << (32 - s)) | (l >>> s);
exports.shrSL = shrSL;
// Right rotate for Shift in [1, 32)
const rotrSH = (h, l, s) => (h >>> s) | (l << (32 - s));
exports.rotrSH = rotrSH;
const rotrSL = (h, l, s) => (h << (32 - s)) | (l >>> s);
exports.rotrSL = rotrSL;
// Right rotate for Shift in (32, 64), NOTE: 32 is special case.
const rotrBH = (h, l, s) => (h << (64 - s)) | (l >>> (s - 32));
exports.rotrBH = rotrBH;
const rotrBL = (h, l, s) => (h >>> (s - 32)) | (l << (64 - s));
exports.rotrBL = rotrBL;
// Right rotate for shift===32 (just swaps l&h)
const rotr32H = (_h, l) => l;
exports.rotr32H = rotr32H;
const rotr32L = (h, _l) => h;
exports.rotr32L = rotr32L;
// Left rotate for Shift in [1, 32)
const rotlSH = (h, l, s) => (h << s) | (l >>> (32 - s));
exports.rotlSH = rotlSH;
const rotlSL = (h, l, s) => (l << s) | (h >>> (32 - s));
exports.rotlSL = rotlSL;
// Left rotate for Shift in (32, 64), NOTE: 32 is special case.
const rotlBH = (h, l, s) => (l << (s - 32)) | (h >>> (64 - s));
exports.rotlBH = rotlBH;
const rotlBL = (h, l, s) => (h << (s - 32)) | (l >>> (64 - s));
exports.rotlBL = rotlBL;
// JS uses 32-bit signed integers for bitwise operations which means we cannot
// simple take carry out of low bit sum by shift, we need to use division.
function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: (Ah + Bh + ((l / 2 ** 32) | 0)) | 0, l: l | 0 };
}
// Addition with more than 2 elements
const add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
exports.add3L = add3L;
const add3H = (low, Ah, Bh, Ch) => (Ah + Bh + Ch + ((low / 2 ** 32) | 0)) | 0;
exports.add3H = add3H;
const add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
exports.add4L = add4L;
const add4H = (low, Ah, Bh, Ch, Dh) => (Ah + Bh + Ch + Dh + ((low / 2 ** 32) | 0)) | 0;
exports.add4H = add4H;
const add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
exports.add5L = add5L;
const add5H = (low, Ah, Bh, Ch, Dh, Eh) => (Ah + Bh + Ch + Dh + Eh + ((low / 2 ** 32) | 0)) | 0;
exports.add5H = add5H;
// prettier-ignore
const u64 = {
    fromBig, split, toBig,
    shrSH, shrSL,
    rotrSH, rotrSL, rotrBH, rotrBL,
    rotr32H, rotr32L,
    rotlSH, rotlSL, rotlBH, rotlBL,
    add, add3L, add3H, add4L, add4H, add5H, add5L,
};
exports.default = u64;
//# sourceMappingURL=_u64.js.map
    },
    41: function(require, module, exports) {
"use strict";
/*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bytes = exports.stringToBytes = exports.str = exports.bytesToString = exports.hex = exports.utf8 = exports.bech32m = exports.bech32 = exports.base58check = exports.createBase58check = exports.base58xmr = exports.base58xrp = exports.base58flickr = exports.base58 = exports.base64urlnopad = exports.base64url = exports.base64nopad = exports.base64 = exports.base32crockford = exports.base32hexnopad = exports.base32hex = exports.base32nopad = exports.base32 = exports.base16 = exports.utils = void 0;
function isBytes(a) {
    return a instanceof Uint8Array || (ArrayBuffer.isView(a) && a.constructor.name === 'Uint8Array');
}
/** Asserts something is Uint8Array. */
function abytes(b, ...lengths) {
    if (!isBytes(b))
        throw new Error('Uint8Array expected');
    if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error('Uint8Array expected of length ' + lengths + ', got length=' + b.length);
}
function isArrayOf(isString, arr) {
    if (!Array.isArray(arr))
        return false;
    if (arr.length === 0)
        return true;
    if (isString) {
        return arr.every((item) => typeof item === 'string');
    }
    else {
        return arr.every((item) => Number.isSafeInteger(item));
    }
}
// no abytes: seems to have 10% slowdown. Why?!
function afn(input) {
    if (typeof input !== 'function')
        throw new Error('function expected');
    return true;
}
function astr(label, input) {
    if (typeof input !== 'string')
        throw new Error(`${label}: string expected`);
    return true;
}
function anumber(n) {
    if (!Number.isSafeInteger(n))
        throw new Error(`invalid integer: ${n}`);
}
function aArr(input) {
    if (!Array.isArray(input))
        throw new Error('array expected');
}
function astrArr(label, input) {
    if (!isArrayOf(true, input))
        throw new Error(`${label}: array of strings expected`);
}
function anumArr(label, input) {
    if (!isArrayOf(false, input))
        throw new Error(`${label}: array of numbers expected`);
}
/**
 * @__NO_SIDE_EFFECTS__
 */
function chain(...args) {
    const id = (a) => a;
    // Wrap call in closure so JIT can inline calls
    const wrap = (a, b) => (c) => a(b(c));
    // Construct chain of args[-1].encode(args[-2].encode([...]))
    const encode = args.map((x) => x.encode).reduceRight(wrap, id);
    // Construct chain of args[0].decode(args[1].decode(...))
    const decode = args.map((x) => x.decode).reduce(wrap, id);
    return { encode, decode };
}
/**
 * Encodes integer radix representation to array of strings using alphabet and back.
 * Could also be array of strings.
 * @__NO_SIDE_EFFECTS__
 */
function alphabet(letters) {
    // mapping 1 to "b"
    const lettersA = typeof letters === 'string' ? letters.split('') : letters;
    const len = lettersA.length;
    astrArr('alphabet', lettersA);
    // mapping "b" to 1
    const indexes = new Map(lettersA.map((l, i) => [l, i]));
    return {
        encode: (digits) => {
            aArr(digits);
            return digits.map((i) => {
                if (!Number.isSafeInteger(i) || i < 0 || i >= len)
                    throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${letters}`);
                return lettersA[i];
            });
        },
        decode: (input) => {
            aArr(input);
            return input.map((letter) => {
                astr('alphabet.decode', letter);
                const i = indexes.get(letter);
                if (i === undefined)
                    throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
                return i;
            });
        },
    };
}
/**
 * @__NO_SIDE_EFFECTS__
 */
function join(separator = '') {
    astr('join', separator);
    return {
        encode: (from) => {
            astrArr('join.decode', from);
            return from.join(separator);
        },
        decode: (to) => {
            astr('join.decode', to);
            return to.split(separator);
        },
    };
}
/**
 * Pad strings array so it has integer number of bits
 * @__NO_SIDE_EFFECTS__
 */
function padding(bits, chr = '=') {
    anumber(bits);
    astr('padding', chr);
    return {
        encode(data) {
            astrArr('padding.encode', data);
            while ((data.length * bits) % 8)
                data.push(chr);
            return data;
        },
        decode(input) {
            astrArr('padding.decode', input);
            let end = input.length;
            if ((end * bits) % 8)
                throw new Error('padding: invalid, string should have whole number of bytes');
            for (; end > 0 && input[end - 1] === chr; end--) {
                const last = end - 1;
                const byte = last * bits;
                if (byte % 8 === 0)
                    throw new Error('padding: invalid, string has too much padding');
            }
            return input.slice(0, end);
        },
    };
}
/**
 * @__NO_SIDE_EFFECTS__
 */
function normalize(fn) {
    afn(fn);
    return { encode: (from) => from, decode: (to) => fn(to) };
}
/**
 * Slow: O(n^2) time complexity
 */
function convertRadix(data, from, to) {
    // base 1 is impossible
    if (from < 2)
        throw new Error(`convertRadix: invalid from=${from}, base cannot be less than 2`);
    if (to < 2)
        throw new Error(`convertRadix: invalid to=${to}, base cannot be less than 2`);
    aArr(data);
    if (!data.length)
        return [];
    let pos = 0;
    const res = [];
    const digits = Array.from(data, (d) => {
        anumber(d);
        if (d < 0 || d >= from)
            throw new Error(`invalid integer: ${d}`);
        return d;
    });
    const dlen = digits.length;
    while (true) {
        let carry = 0;
        let done = true;
        for (let i = pos; i < dlen; i++) {
            const digit = digits[i];
            const fromCarry = from * carry;
            const digitBase = fromCarry + digit;
            if (!Number.isSafeInteger(digitBase) ||
                fromCarry / from !== carry ||
                digitBase - digit !== fromCarry) {
                throw new Error('convertRadix: carry overflow');
            }
            const div = digitBase / to;
            carry = digitBase % to;
            const rounded = Math.floor(div);
            digits[i] = rounded;
            if (!Number.isSafeInteger(rounded) || rounded * to + carry !== digitBase)
                throw new Error('convertRadix: carry overflow');
            if (!done)
                continue;
            else if (!rounded)
                pos = i;
            else
                done = false;
        }
        res.push(carry);
        if (done)
            break;
    }
    for (let i = 0; i < data.length - 1 && data[i] === 0; i++)
        res.push(0);
    return res.reverse();
}
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const radix2carry = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd(from, to));
const powers = /* @__PURE__ */ (() => {
    let res = [];
    for (let i = 0; i < 40; i++)
        res.push(2 ** i);
    return res;
})();
/**
 * Implemented with numbers, because BigInt is 5x slower
 */
function convertRadix2(data, from, to, padding) {
    aArr(data);
    if (from <= 0 || from > 32)
        throw new Error(`convertRadix2: wrong from=${from}`);
    if (to <= 0 || to > 32)
        throw new Error(`convertRadix2: wrong to=${to}`);
    if (radix2carry(from, to) > 32) {
        throw new Error(`convertRadix2: carry overflow from=${from} to=${to} carryBits=${radix2carry(from, to)}`);
    }
    let carry = 0;
    let pos = 0; // bitwise position in current element
    const max = powers[from];
    const mask = powers[to] - 1;
    const res = [];
    for (const n of data) {
        anumber(n);
        if (n >= max)
            throw new Error(`convertRadix2: invalid data word=${n} from=${from}`);
        carry = (carry << from) | n;
        if (pos + from > 32)
            throw new Error(`convertRadix2: carry overflow pos=${pos} from=${from}`);
        pos += from;
        for (; pos >= to; pos -= to)
            res.push(((carry >> (pos - to)) & mask) >>> 0);
        const pow = powers[pos];
        if (pow === undefined)
            throw new Error('invalid carry');
        carry &= pow - 1; // clean carry, otherwise it will cause overflow
    }
    carry = (carry << (to - pos)) & mask;
    if (!padding && pos >= from)
        throw new Error('Excess padding');
    if (!padding && carry > 0)
        throw new Error(`Non-zero padding: ${carry}`);
    if (padding && pos > 0)
        res.push(carry >>> 0);
    return res;
}
/**
 * @__NO_SIDE_EFFECTS__
 */
function radix(num) {
    anumber(num);
    const _256 = 2 ** 8;
    return {
        encode: (bytes) => {
            if (!isBytes(bytes))
                throw new Error('radix.encode input should be Uint8Array');
            return convertRadix(Array.from(bytes), _256, num);
        },
        decode: (digits) => {
            anumArr('radix.decode', digits);
            return Uint8Array.from(convertRadix(digits, num, _256));
        },
    };
}
/**
 * If both bases are power of same number (like `2**8 <-> 2**64`),
 * there is a linear algorithm. For now we have implementation for power-of-two bases only.
 * @__NO_SIDE_EFFECTS__
 */
function radix2(bits, revPadding = false) {
    anumber(bits);
    if (bits <= 0 || bits > 32)
        throw new Error('radix2: bits should be in (0..32]');
    if (radix2carry(8, bits) > 32 || radix2carry(bits, 8) > 32)
        throw new Error('radix2: carry overflow');
    return {
        encode: (bytes) => {
            if (!isBytes(bytes))
                throw new Error('radix2.encode input should be Uint8Array');
            return convertRadix2(Array.from(bytes), 8, bits, !revPadding);
        },
        decode: (digits) => {
            anumArr('radix2.decode', digits);
            return Uint8Array.from(convertRadix2(digits, bits, 8, revPadding));
        },
    };
}
function unsafeWrapper(fn) {
    afn(fn);
    return function (...args) {
        try {
            return fn.apply(null, args);
        }
        catch (e) { }
    };
}
function checksum(len, fn) {
    anumber(len);
    afn(fn);
    return {
        encode(data) {
            if (!isBytes(data))
                throw new Error('checksum.encode: input should be Uint8Array');
            const sum = fn(data).slice(0, len);
            const res = new Uint8Array(data.length + len);
            res.set(data);
            res.set(sum, data.length);
            return res;
        },
        decode(data) {
            if (!isBytes(data))
                throw new Error('checksum.decode: input should be Uint8Array');
            const payload = data.slice(0, -len);
            const oldChecksum = data.slice(-len);
            const newChecksum = fn(payload).slice(0, len);
            for (let i = 0; i < len; i++)
                if (newChecksum[i] !== oldChecksum[i])
                    throw new Error('Invalid checksum');
            return payload;
        },
    };
}
// prettier-ignore
exports.utils = {
    alphabet, chain, checksum, convertRadix, convertRadix2, radix, radix2, join, padding,
};
// RFC 4648 aka RFC 3548
// ---------------------
/**
 * base16 encoding from RFC 4648.
 * @example
 * ```js
 * base16.encode(Uint8Array.from([0x12, 0xab]));
 * // => '12AB'
 * ```
 */
exports.base16 = chain(radix2(4), alphabet('0123456789ABCDEF'), join(''));
/**
 * base32 encoding from RFC 4648. Has padding.
 * Use `base32nopad` for unpadded version.
 * Also check out `base32hex`, `base32hexnopad`, `base32crockford`.
 * @example
 * ```js
 * base32.encode(Uint8Array.from([0x12, 0xab]));
 * // => 'CKVQ===='
 * base32.decode('CKVQ====');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
exports.base32 = chain(radix2(5), alphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), padding(5), join(''));
/**
 * base32 encoding from RFC 4648. No padding.
 * Use `base32` for padded version.
 * Also check out `base32hex`, `base32hexnopad`, `base32crockford`.
 * @example
 * ```js
 * base32nopad.encode(Uint8Array.from([0x12, 0xab]));
 * // => 'CKVQ'
 * base32nopad.decode('CKVQ');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
exports.base32nopad = chain(radix2(5), alphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), join(''));
/**
 * base32 encoding from RFC 4648. Padded. Compared to ordinary `base32`, slightly different alphabet.
 * Use `base32hexnopad` for unpadded version.
 * @example
 * ```js
 * base32hex.encode(Uint8Array.from([0x12, 0xab]));
 * // => '2ALG===='
 * base32hex.decode('2ALG====');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
exports.base32hex = chain(radix2(5), alphabet('0123456789ABCDEFGHIJKLMNOPQRSTUV'), padding(5), join(''));
/**
 * base32 encoding from RFC 4648. No padding. Compared to ordinary `base32`, slightly different alphabet.
 * Use `base32hex` for padded version.
 * @example
 * ```js
 * base32hexnopad.encode(Uint8Array.from([0x12, 0xab]));
 * // => '2ALG'
 * base32hexnopad.decode('2ALG');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
exports.base32hexnopad = chain(radix2(5), alphabet('0123456789ABCDEFGHIJKLMNOPQRSTUV'), join(''));
/**
 * base32 encoding from RFC 4648. Doug Crockford's version.
 * https://www.crockford.com/base32.html
 * @example
 * ```js
 * base32crockford.encode(Uint8Array.from([0x12, 0xab]));
 * // => '2ANG'
 * base32crockford.decode('2ANG');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
exports.base32crockford = chain(radix2(5), alphabet('0123456789ABCDEFGHJKMNPQRSTVWXYZ'), join(''), normalize((s) => s.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')));
// Built-in base64 conversion https://caniuse.com/mdn-javascript_builtins_uint8array_frombase64
// prettier-ignore
const hasBase64Builtin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toBase64 === 'function' &&
    typeof Uint8Array.fromBase64 === 'function')();
const decodeBase64Builtin = (s, isUrl) => {
    astr('base64', s);
    const re = isUrl ? /^[A-Za-z0-9=_-]+$/ : /^[A-Za-z0-9=+/]+$/;
    const alphabet = isUrl ? 'base64url' : 'base64';
    if (s.length > 0 && !re.test(s))
        throw new Error('invalid base64');
    return Uint8Array.fromBase64(s, { alphabet, lastChunkHandling: 'strict' });
};
/**
 * base64 from RFC 4648. Padded.
 * Use `base64nopad` for unpadded version.
 * Also check out `base64url`, `base64urlnopad`.
 * Falls back to built-in function, when available.
 * @example
 * ```js
 * base64.encode(Uint8Array.from([0x12, 0xab]));
 * // => 'Eqs='
 * base64.decode('Eqs=');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
// prettier-ignore
exports.base64 = hasBase64Builtin ? {
    encode(b) { abytes(b); return b.toBase64(); },
    decode(s) { return decodeBase64Builtin(s, false); },
} : chain(radix2(6), alphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'), padding(6), join(''));
/**
 * base64 from RFC 4648. No padding.
 * Use `base64` for padded version.
 * @example
 * ```js
 * base64nopad.encode(Uint8Array.from([0x12, 0xab]));
 * // => 'Eqs'
 * base64nopad.decode('Eqs');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
exports.base64nopad = chain(radix2(6), alphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'), join(''));
/**
 * base64 from RFC 4648, using URL-safe alphabet. Padded.
 * Use `base64urlnopad` for unpadded version.
 * Falls back to built-in function, when available.
 * @example
 * ```js
 * base64url.encode(Uint8Array.from([0x12, 0xab]));
 * // => 'Eqs='
 * base64url.decode('Eqs=');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
// prettier-ignore
exports.base64url = hasBase64Builtin ? {
    encode(b) { abytes(b); return b.toBase64({ alphabet: 'base64url' }); },
    decode(s) { return decodeBase64Builtin(s, true); },
} : chain(radix2(6), alphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'), padding(6), join(''));
/**
 * base64 from RFC 4648, using URL-safe alphabet. No padding.
 * Use `base64url` for padded version.
 * @example
 * ```js
 * base64urlnopad.encode(Uint8Array.from([0x12, 0xab]));
 * // => 'Eqs'
 * base64urlnopad.decode('Eqs');
 * // => Uint8Array.from([0x12, 0xab])
 * ```
 */
exports.base64urlnopad = chain(radix2(6), alphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'), join(''));
// base58 code
// -----------
const genBase58 = /* @__NO_SIDE_EFFECTS__ */ (abc) => chain(radix(58), alphabet(abc), join(''));
/**
 * base58: base64 without ambigous characters +, /, 0, O, I, l.
 * Quadratic (O(n^2)) - so, can't be used on large inputs.
 * @example
 * ```js
 * base58.decode('01abcdef');
 * // => '3UhJW'
 * ```
 */
exports.base58 = genBase58('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz');
/**
 * base58: flickr version. Check out `base58`.
 */
exports.base58flickr = genBase58('123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ');
/**
 * base58: XRP version. Check out `base58`.
 */
exports.base58xrp = genBase58('rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz');
// Data len (index) -> encoded block len
const XMR_BLOCK_LEN = [0, 2, 3, 5, 6, 7, 9, 10, 11];
/**
 * base58: XMR version. Check out `base58`.
 * Done in 8-byte blocks (which equals 11 chars in decoding). Last (non-full) block padded with '1' to size in XMR_BLOCK_LEN.
 * Block encoding significantly reduces quadratic complexity of base58.
 */
exports.base58xmr = {
    encode(data) {
        let res = '';
        for (let i = 0; i < data.length; i += 8) {
            const block = data.subarray(i, i + 8);
            res += exports.base58.encode(block).padStart(XMR_BLOCK_LEN[block.length], '1');
        }
        return res;
    },
    decode(str) {
        let res = [];
        for (let i = 0; i < str.length; i += 11) {
            const slice = str.slice(i, i + 11);
            const blockLen = XMR_BLOCK_LEN.indexOf(slice.length);
            const block = exports.base58.decode(slice);
            for (let j = 0; j < block.length - blockLen; j++) {
                if (block[j] !== 0)
                    throw new Error('base58xmr: wrong padding');
            }
            res = res.concat(Array.from(block.slice(block.length - blockLen)));
        }
        return Uint8Array.from(res);
    },
};
/**
 * Method, which creates base58check encoder.
 * Requires function, calculating sha256.
 */
const createBase58check = (sha256) => chain(checksum(4, (data) => sha256(sha256(data))), exports.base58);
exports.createBase58check = createBase58check;
/**
 * Use `createBase58check` instead.
 * @deprecated
 */
exports.base58check = exports.createBase58check;
const BECH_ALPHABET = chain(alphabet('qpzry9x8gf2tvdw0s3jn54khce6mua7l'), join(''));
const POLYMOD_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function bech32Polymod(pre) {
    const b = pre >> 25;
    let chk = (pre & 0x1ffffff) << 5;
    for (let i = 0; i < POLYMOD_GENERATORS.length; i++) {
        if (((b >> i) & 1) === 1)
            chk ^= POLYMOD_GENERATORS[i];
    }
    return chk;
}
function bechChecksum(prefix, words, encodingConst = 1) {
    const len = prefix.length;
    let chk = 1;
    for (let i = 0; i < len; i++) {
        const c = prefix.charCodeAt(i);
        if (c < 33 || c > 126)
            throw new Error(`Invalid prefix (${prefix})`);
        chk = bech32Polymod(chk) ^ (c >> 5);
    }
    chk = bech32Polymod(chk);
    for (let i = 0; i < len; i++)
        chk = bech32Polymod(chk) ^ (prefix.charCodeAt(i) & 0x1f);
    for (let v of words)
        chk = bech32Polymod(chk) ^ v;
    for (let i = 0; i < 6; i++)
        chk = bech32Polymod(chk);
    chk ^= encodingConst;
    return BECH_ALPHABET.encode(convertRadix2([chk % powers[30]], 30, 5, false));
}
/**
 * @__NO_SIDE_EFFECTS__
 */
function genBech32(encoding) {
    const ENCODING_CONST = encoding === 'bech32' ? 1 : 0x2bc830a3;
    const _words = radix2(5);
    const fromWords = _words.decode;
    const toWords = _words.encode;
    const fromWordsUnsafe = unsafeWrapper(fromWords);
    function encode(prefix, words, limit = 90) {
        astr('bech32.encode prefix', prefix);
        if (isBytes(words))
            words = Array.from(words);
        anumArr('bech32.encode', words);
        const plen = prefix.length;
        if (plen === 0)
            throw new TypeError(`Invalid prefix length ${plen}`);
        const actualLength = plen + 7 + words.length;
        if (limit !== false && actualLength > limit)
            throw new TypeError(`Length ${actualLength} exceeds limit ${limit}`);
        const lowered = prefix.toLowerCase();
        const sum = bechChecksum(lowered, words, ENCODING_CONST);
        return `${lowered}1${BECH_ALPHABET.encode(words)}${sum}`;
    }
    function decode(str, limit = 90) {
        astr('bech32.decode input', str);
        const slen = str.length;
        if (slen < 8 || (limit !== false && slen > limit))
            throw new TypeError(`invalid string length: ${slen} (${str}). Expected (8..${limit})`);
        // don't allow mixed case
        const lowered = str.toLowerCase();
        if (str !== lowered && str !== str.toUpperCase())
            throw new Error(`String must be lowercase or uppercase`);
        const sepIndex = lowered.lastIndexOf('1');
        if (sepIndex === 0 || sepIndex === -1)
            throw new Error(`Letter "1" must be present between prefix and data only`);
        const prefix = lowered.slice(0, sepIndex);
        const data = lowered.slice(sepIndex + 1);
        if (data.length < 6)
            throw new Error('Data must be at least 6 characters long');
        const words = BECH_ALPHABET.decode(data).slice(0, -6);
        const sum = bechChecksum(prefix, words, ENCODING_CONST);
        if (!data.endsWith(sum))
            throw new Error(`Invalid checksum in ${str}: expected "${sum}"`);
        return { prefix, words };
    }
    const decodeUnsafe = unsafeWrapper(decode);
    function decodeToBytes(str) {
        const { prefix, words } = decode(str, false);
        return { prefix, words, bytes: fromWords(words) };
    }
    function encodeFromBytes(prefix, bytes) {
        return encode(prefix, toWords(bytes));
    }
    return {
        encode,
        decode,
        encodeFromBytes,
        decodeToBytes,
        decodeUnsafe,
        fromWords,
        fromWordsUnsafe,
        toWords,
    };
}
/**
 * bech32 from BIP 173. Operates on words.
 * For high-level, check out scure-btc-signer:
 * https://github.com/paulmillr/scure-btc-signer.
 */
exports.bech32 = genBech32('bech32');
/**
 * bech32m from BIP 350. Operates on words.
 * It was to mitigate `bech32` weaknesses.
 * For high-level, check out scure-btc-signer:
 * https://github.com/paulmillr/scure-btc-signer.
 */
exports.bech32m = genBech32('bech32m');
/**
 * UTF-8-to-byte decoder. Uses built-in TextDecoder / TextEncoder.
 * @example
 * ```js
 * const b = utf8.decode("hey"); // => new Uint8Array([ 104, 101, 121 ])
 * const str = utf8.encode(b); // "hey"
 * ```
 */
exports.utf8 = {
    encode: (data) => new TextDecoder().decode(data),
    decode: (str) => new TextEncoder().encode(str),
};
// Built-in hex conversion https://caniuse.com/mdn-javascript_builtins_uint8array_fromhex
// prettier-ignore
const hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === 'function' &&
    typeof Uint8Array.fromHex === 'function')();
// prettier-ignore
const hexBuiltin = {
    encode(data) { abytes(data); return data.toHex(); },
    decode(s) { astr('hex', s); return Uint8Array.fromHex(s); },
};
/**
 * hex string decoder. Uses built-in function, when available.
 * @example
 * ```js
 * const b = hex.decode("0102ff"); // => new Uint8Array([ 1, 2, 255 ])
 * const str = hex.encode(b); // "0102ff"
 * ```
 */
exports.hex = hasHexBuiltin
    ? hexBuiltin
    : chain(radix2(4), alphabet('0123456789abcdef'), join(''), normalize((s) => {
        if (typeof s !== 'string' || s.length % 2 !== 0)
            throw new TypeError(`hex.decode: expected string, got ${typeof s} with length ${s.length}`);
        return s.toLowerCase();
    }));
// prettier-ignore
const CODERS = {
    utf8: exports.utf8, hex: exports.hex, base16: exports.base16, base32: exports.base32, base64: exports.base64, base64url: exports.base64url, base58: exports.base58, base58xmr: exports.base58xmr
};
const coderTypeError = 'Invalid encoding type. Available types: utf8, hex, base16, base32, base64, base64url, base58, base58xmr';
/** @deprecated */
const bytesToString = (type, bytes) => {
    if (typeof type !== 'string' || !CODERS.hasOwnProperty(type))
        throw new TypeError(coderTypeError);
    if (!isBytes(bytes))
        throw new TypeError('bytesToString() expects Uint8Array');
    return CODERS[type].encode(bytes);
};
exports.bytesToString = bytesToString;
/** @deprecated */
exports.str = exports.bytesToString; // as in python, but for bytes only
/** @deprecated */
const stringToBytes = (type, str) => {
    if (!CODERS.hasOwnProperty(type))
        throw new TypeError(coderTypeError);
    if (typeof str !== 'string')
        throw new TypeError('stringToBytes() expects string');
    return CODERS[type].decode(str);
};
exports.stringToBytes = stringToBytes;
/** @deprecated */
exports.bytes = exports.stringToBytes;
//# sourceMappingURL=index.js.map
    },
    42: function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wordlist = void 0;
exports.wordlist = `abandon
ability
able
about
above
absent
absorb
abstract
absurd
abuse
access
accident
account
accuse
achieve
acid
acoustic
acquire
across
act
action
actor
actress
actual
adapt
add
addict
address
adjust
admit
adult
advance
advice
aerobic
affair
afford
afraid
again
age
agent
agree
ahead
aim
air
airport
aisle
alarm
album
alcohol
alert
alien
all
alley
allow
almost
alone
alpha
already
also
alter
always
amateur
amazing
among
amount
amused
analyst
anchor
ancient
anger
angle
angry
animal
ankle
announce
annual
another
answer
antenna
antique
anxiety
any
apart
apology
appear
apple
approve
april
arch
arctic
area
arena
argue
arm
armed
armor
army
around
arrange
arrest
arrive
arrow
art
artefact
artist
artwork
ask
aspect
assault
asset
assist
assume
asthma
athlete
atom
attack
attend
attitude
attract
auction
audit
august
aunt
author
auto
autumn
average
avocado
avoid
awake
aware
away
awesome
awful
awkward
axis
baby
bachelor
bacon
badge
bag
balance
balcony
ball
bamboo
banana
banner
bar
barely
bargain
barrel
base
basic
basket
battle
beach
bean
beauty
because
become
beef
before
begin
behave
behind
believe
below
belt
bench
benefit
best
betray
better
between
beyond
bicycle
bid
bike
bind
biology
bird
birth
bitter
black
blade
blame
blanket
blast
bleak
bless
blind
blood
blossom
blouse
blue
blur
blush
board
boat
body
boil
bomb
bone
bonus
book
boost
border
boring
borrow
boss
bottom
bounce
box
boy
bracket
brain
brand
brass
brave
bread
breeze
brick
bridge
brief
bright
bring
brisk
broccoli
broken
bronze
broom
brother
brown
brush
bubble
buddy
budget
buffalo
build
bulb
bulk
bullet
bundle
bunker
burden
burger
burst
bus
business
busy
butter
buyer
buzz
cabbage
cabin
cable
cactus
cage
cake
call
calm
camera
camp
can
canal
cancel
candy
cannon
canoe
canvas
canyon
capable
capital
captain
car
carbon
card
cargo
carpet
carry
cart
case
cash
casino
castle
casual
cat
catalog
catch
category
cattle
caught
cause
caution
cave
ceiling
celery
cement
census
century
cereal
certain
chair
chalk
champion
change
chaos
chapter
charge
chase
chat
cheap
check
cheese
chef
cherry
chest
chicken
chief
child
chimney
choice
choose
chronic
chuckle
chunk
churn
cigar
cinnamon
circle
citizen
city
civil
claim
clap
clarify
claw
clay
clean
clerk
clever
click
client
cliff
climb
clinic
clip
clock
clog
close
cloth
cloud
clown
club
clump
cluster
clutch
coach
coast
coconut
code
coffee
coil
coin
collect
color
column
combine
come
comfort
comic
common
company
concert
conduct
confirm
congress
connect
consider
control
convince
cook
cool
copper
copy
coral
core
corn
correct
cost
cotton
couch
country
couple
course
cousin
cover
coyote
crack
cradle
craft
cram
crane
crash
crater
crawl
crazy
cream
credit
creek
crew
cricket
crime
crisp
critic
crop
cross
crouch
crowd
crucial
cruel
cruise
crumble
crunch
crush
cry
crystal
cube
culture
cup
cupboard
curious
current
curtain
curve
cushion
custom
cute
cycle
dad
damage
damp
dance
danger
daring
dash
daughter
dawn
day
deal
debate
debris
decade
december
decide
decline
decorate
decrease
deer
defense
define
defy
degree
delay
deliver
demand
demise
denial
dentist
deny
depart
depend
deposit
depth
deputy
derive
describe
desert
design
desk
despair
destroy
detail
detect
develop
device
devote
diagram
dial
diamond
diary
dice
diesel
diet
differ
digital
dignity
dilemma
dinner
dinosaur
direct
dirt
disagree
discover
disease
dish
dismiss
disorder
display
distance
divert
divide
divorce
dizzy
doctor
document
dog
doll
dolphin
domain
donate
donkey
donor
door
dose
double
dove
draft
dragon
drama
drastic
draw
dream
dress
drift
drill
drink
drip
drive
drop
drum
dry
duck
dumb
dune
during
dust
dutch
duty
dwarf
dynamic
eager
eagle
early
earn
earth
easily
east
easy
echo
ecology
economy
edge
edit
educate
effort
egg
eight
either
elbow
elder
electric
elegant
element
elephant
elevator
elite
else
embark
embody
embrace
emerge
emotion
employ
empower
empty
enable
enact
end
endless
endorse
enemy
energy
enforce
engage
engine
enhance
enjoy
enlist
enough
enrich
enroll
ensure
enter
entire
entry
envelope
episode
equal
equip
era
erase
erode
erosion
error
erupt
escape
essay
essence
estate
eternal
ethics
evidence
evil
evoke
evolve
exact
example
excess
exchange
excite
exclude
excuse
execute
exercise
exhaust
exhibit
exile
exist
exit
exotic
expand
expect
expire
explain
expose
express
extend
extra
eye
eyebrow
fabric
face
faculty
fade
faint
faith
fall
false
fame
family
famous
fan
fancy
fantasy
farm
fashion
fat
fatal
father
fatigue
fault
favorite
feature
february
federal
fee
feed
feel
female
fence
festival
fetch
fever
few
fiber
fiction
field
figure
file
film
filter
final
find
fine
finger
finish
fire
firm
first
fiscal
fish
fit
fitness
fix
flag
flame
flash
flat
flavor
flee
flight
flip
float
flock
floor
flower
fluid
flush
fly
foam
focus
fog
foil
fold
follow
food
foot
force
forest
forget
fork
fortune
forum
forward
fossil
foster
found
fox
fragile
frame
frequent
fresh
friend
fringe
frog
front
frost
frown
frozen
fruit
fuel
fun
funny
furnace
fury
future
gadget
gain
galaxy
gallery
game
gap
garage
garbage
garden
garlic
garment
gas
gasp
gate
gather
gauge
gaze
general
genius
genre
gentle
genuine
gesture
ghost
giant
gift
giggle
ginger
giraffe
girl
give
glad
glance
glare
glass
glide
glimpse
globe
gloom
glory
glove
glow
glue
goat
goddess
gold
good
goose
gorilla
gospel
gossip
govern
gown
grab
grace
grain
grant
grape
grass
gravity
great
green
grid
grief
grit
grocery
group
grow
grunt
guard
guess
guide
guilt
guitar
gun
gym
habit
hair
half
hammer
hamster
hand
happy
harbor
hard
harsh
harvest
hat
have
hawk
hazard
head
health
heart
heavy
hedgehog
height
hello
helmet
help
hen
hero
hidden
high
hill
hint
hip
hire
history
hobby
hockey
hold
hole
holiday
hollow
home
honey
hood
hope
horn
horror
horse
hospital
host
hotel
hour
hover
hub
huge
human
humble
humor
hundred
hungry
hunt
hurdle
hurry
hurt
husband
hybrid
ice
icon
idea
identify
idle
ignore
ill
illegal
illness
image
imitate
immense
immune
impact
impose
improve
impulse
inch
include
income
increase
index
indicate
indoor
industry
infant
inflict
inform
inhale
inherit
initial
inject
injury
inmate
inner
innocent
input
inquiry
insane
insect
inside
inspire
install
intact
interest
into
invest
invite
involve
iron
island
isolate
issue
item
ivory
jacket
jaguar
jar
jazz
jealous
jeans
jelly
jewel
job
join
joke
journey
joy
judge
juice
jump
jungle
junior
junk
just
kangaroo
keen
keep
ketchup
key
kick
kid
kidney
kind
kingdom
kiss
kit
kitchen
kite
kitten
kiwi
knee
knife
knock
know
lab
label
labor
ladder
lady
lake
lamp
language
laptop
large
later
latin
laugh
laundry
lava
law
lawn
lawsuit
layer
lazy
leader
leaf
learn
leave
lecture
left
leg
legal
legend
leisure
lemon
lend
length
lens
leopard
lesson
letter
level
liar
liberty
library
license
life
lift
light
like
limb
limit
link
lion
liquid
list
little
live
lizard
load
loan
lobster
local
lock
logic
lonely
long
loop
lottery
loud
lounge
love
loyal
lucky
luggage
lumber
lunar
lunch
luxury
lyrics
machine
mad
magic
magnet
maid
mail
main
major
make
mammal
man
manage
mandate
mango
mansion
manual
maple
marble
march
margin
marine
market
marriage
mask
mass
master
match
material
math
matrix
matter
maximum
maze
meadow
mean
measure
meat
mechanic
medal
media
melody
melt
member
memory
mention
menu
mercy
merge
merit
merry
mesh
message
metal
method
middle
midnight
milk
million
mimic
mind
minimum
minor
minute
miracle
mirror
misery
miss
mistake
mix
mixed
mixture
mobile
model
modify
mom
moment
monitor
monkey
monster
month
moon
moral
more
morning
mosquito
mother
motion
motor
mountain
mouse
move
movie
much
muffin
mule
multiply
muscle
museum
mushroom
music
must
mutual
myself
mystery
myth
naive
name
napkin
narrow
nasty
nation
nature
near
neck
need
negative
neglect
neither
nephew
nerve
nest
net
network
neutral
never
news
next
nice
night
noble
noise
nominee
noodle
normal
north
nose
notable
note
nothing
notice
novel
now
nuclear
number
nurse
nut
oak
obey
object
oblige
obscure
observe
obtain
obvious
occur
ocean
october
odor
off
offer
office
often
oil
okay
old
olive
olympic
omit
once
one
onion
online
only
open
opera
opinion
oppose
option
orange
orbit
orchard
order
ordinary
organ
orient
original
orphan
ostrich
other
outdoor
outer
output
outside
oval
oven
over
own
owner
oxygen
oyster
ozone
pact
paddle
page
pair
palace
palm
panda
panel
panic
panther
paper
parade
parent
park
parrot
party
pass
patch
path
patient
patrol
pattern
pause
pave
payment
peace
peanut
pear
peasant
pelican
pen
penalty
pencil
people
pepper
perfect
permit
person
pet
phone
photo
phrase
physical
piano
picnic
picture
piece
pig
pigeon
pill
pilot
pink
pioneer
pipe
pistol
pitch
pizza
place
planet
plastic
plate
play
please
pledge
pluck
plug
plunge
poem
poet
point
polar
pole
police
pond
pony
pool
popular
portion
position
possible
post
potato
pottery
poverty
powder
power
practice
praise
predict
prefer
prepare
present
pretty
prevent
price
pride
primary
print
priority
prison
private
prize
problem
process
produce
profit
program
project
promote
proof
property
prosper
protect
proud
provide
public
pudding
pull
pulp
pulse
pumpkin
punch
pupil
puppy
purchase
purity
purpose
purse
push
put
puzzle
pyramid
quality
quantum
quarter
question
quick
quit
quiz
quote
rabbit
raccoon
race
rack
radar
radio
rail
rain
raise
rally
ramp
ranch
random
range
rapid
rare
rate
rather
raven
raw
razor
ready
real
reason
rebel
rebuild
recall
receive
recipe
record
recycle
reduce
reflect
reform
refuse
region
regret
regular
reject
relax
release
relief
rely
remain
remember
remind
remove
render
renew
rent
reopen
repair
repeat
replace
report
require
rescue
resemble
resist
resource
response
result
retire
retreat
return
reunion
reveal
review
reward
rhythm
rib
ribbon
rice
rich
ride
ridge
rifle
right
rigid
ring
riot
ripple
risk
ritual
rival
river
road
roast
robot
robust
rocket
romance
roof
rookie
room
rose
rotate
rough
round
route
royal
rubber
rude
rug
rule
run
runway
rural
sad
saddle
sadness
safe
sail
salad
salmon
salon
salt
salute
same
sample
sand
satisfy
satoshi
sauce
sausage
save
say
scale
scan
scare
scatter
scene
scheme
school
science
scissors
scorpion
scout
scrap
screen
script
scrub
sea
search
season
seat
second
secret
section
security
seed
seek
segment
select
sell
seminar
senior
sense
sentence
series
service
session
settle
setup
seven
shadow
shaft
shallow
share
shed
shell
sheriff
shield
shift
shine
ship
shiver
shock
shoe
shoot
shop
short
shoulder
shove
shrimp
shrug
shuffle
shy
sibling
sick
side
siege
sight
sign
silent
silk
silly
silver
similar
simple
since
sing
siren
sister
situate
six
size
skate
sketch
ski
skill
skin
skirt
skull
slab
slam
sleep
slender
slice
slide
slight
slim
slogan
slot
slow
slush
small
smart
smile
smoke
smooth
snack
snake
snap
sniff
snow
soap
soccer
social
sock
soda
soft
solar
soldier
solid
solution
solve
someone
song
soon
sorry
sort
soul
sound
soup
source
south
space
spare
spatial
spawn
speak
special
speed
spell
spend
sphere
spice
spider
spike
spin
spirit
split
spoil
sponsor
spoon
sport
spot
spray
spread
spring
spy
square
squeeze
squirrel
stable
stadium
staff
stage
stairs
stamp
stand
start
state
stay
steak
steel
stem
step
stereo
stick
still
sting
stock
stomach
stone
stool
story
stove
strategy
street
strike
strong
struggle
student
stuff
stumble
style
subject
submit
subway
success
such
sudden
suffer
sugar
suggest
suit
summer
sun
sunny
sunset
super
supply
supreme
sure
surface
surge
surprise
surround
survey
suspect
sustain
swallow
swamp
swap
swarm
swear
sweet
swift
swim
swing
switch
sword
symbol
symptom
syrup
system
table
tackle
tag
tail
talent
talk
tank
tape
target
task
taste
tattoo
taxi
teach
team
tell
ten
tenant
tennis
tent
term
test
text
thank
that
theme
then
theory
there
they
thing
this
thought
three
thrive
throw
thumb
thunder
ticket
tide
tiger
tilt
timber
time
tiny
tip
tired
tissue
title
toast
tobacco
today
toddler
toe
together
toilet
token
tomato
tomorrow
tone
tongue
tonight
tool
tooth
top
topic
topple
torch
tornado
tortoise
toss
total
tourist
toward
tower
town
toy
track
trade
traffic
tragic
train
transfer
trap
trash
travel
tray
treat
tree
trend
trial
tribe
trick
trigger
trim
trip
trophy
trouble
truck
true
truly
trumpet
trust
truth
try
tube
tuition
tumble
tuna
tunnel
turkey
turn
turtle
twelve
twenty
twice
twin
twist
two
type
typical
ugly
umbrella
unable
unaware
uncle
uncover
under
undo
unfair
unfold
unhappy
uniform
unique
unit
universe
unknown
unlock
until
unusual
unveil
update
upgrade
uphold
upon
upper
upset
urban
urge
usage
use
used
useful
useless
usual
utility
vacant
vacuum
vague
valid
valley
valve
van
vanish
vapor
various
vast
vault
vehicle
velvet
vendor
venture
venue
verb
verify
version
very
vessel
veteran
viable
vibrant
vicious
victory
video
view
village
vintage
violin
virtual
virus
visa
visit
visual
vital
vivid
vocal
voice
void
volcano
volume
vote
voyage
wage
wagon
wait
walk
wall
walnut
want
warfare
warm
warrior
wash
wasp
waste
water
wave
way
wealth
weapon
wear
weasel
weather
web
wedding
weekend
weird
welcome
west
wet
whale
what
wheat
wheel
when
where
whip
whisper
wide
width
wife
wild
will
win
window
wine
wing
wink
winner
winter
wire
wisdom
wise
wish
witness
wolf
woman
wonder
wood
wool
word
work
world
worry
worth
wrap
wreck
wrestle
wrist
write
wrong
yard
year
yellow
you
young
youth
zebra
zero
zone
zoo`.split('\n');

    },
    43: function(require, module, exports) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var base_x_1 = __importDefault(require("base-x"));
var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
exports.default = (0, base_x_1.default)(ALPHABET);

    },
    44: function(require, module, exports) {
'use strict'
// base-x encoding / decoding
// Copyright (c) 2018 base-x contributors
// Copyright (c) 2014-2018 The Bitcoin Core developers (base58.cpp)
// Distributed under the MIT software license, see the accompanying
// file LICENSE or http://www.opensource.org/licenses/mit-license.php.
Object.defineProperty(exports, '__esModule', { value: true })
function base (ALPHABET) {
  if (ALPHABET.length >= 255) { throw new TypeError('Alphabet too long') }
  const BASE_MAP = new Uint8Array(256)
  for (let j = 0; j < BASE_MAP.length; j++) {
    BASE_MAP[j] = 255
  }
  for (let i = 0; i < ALPHABET.length; i++) {
    const x = ALPHABET.charAt(i)
    const xc = x.charCodeAt(0)
    if (BASE_MAP[xc] !== 255) { throw new TypeError(x + ' is ambiguous') }
    BASE_MAP[xc] = i
  }
  const BASE = ALPHABET.length
  const LEADER = ALPHABET.charAt(0)
  const FACTOR = Math.log(BASE) / Math.log(256) // log(BASE) / log(256), rounded up
  const iFACTOR = Math.log(256) / Math.log(BASE) // log(256) / log(BASE), rounded up
  function encode (source) {
    // eslint-disable-next-line no-empty
    if (source instanceof Uint8Array) { } else if (ArrayBuffer.isView(source)) {
      source = new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    } else if (Array.isArray(source)) {
      source = Uint8Array.from(source)
    }
    if (!(source instanceof Uint8Array)) { throw new TypeError('Expected Uint8Array') }
    if (source.length === 0) { return '' }
    // Skip & count leading zeroes.
    let zeroes = 0
    let length = 0
    let pbegin = 0
    const pend = source.length
    while (pbegin !== pend && source[pbegin] === 0) {
      pbegin++
      zeroes++
    }
    // Allocate enough space in big-endian base58 representation.
    const size = ((pend - pbegin) * iFACTOR + 1) >>> 0
    const b58 = new Uint8Array(size)
    // Process the bytes.
    while (pbegin !== pend) {
      let carry = source[pbegin]
      // Apply "b58 = b58 * 256 + ch".
      let i = 0
      for (let it1 = size - 1; (carry !== 0 || i < length) && (it1 !== -1); it1--, i++) {
        carry += (256 * b58[it1]) >>> 0
        b58[it1] = (carry % BASE) >>> 0
        carry = (carry / BASE) >>> 0
      }
      if (carry !== 0) { throw new Error('Non-zero carry') }
      length = i
      pbegin++
    }
    // Skip leading zeroes in base58 result.
    let it2 = size - length
    while (it2 !== size && b58[it2] === 0) {
      it2++
    }
    // Translate the result into a string.
    let str = LEADER.repeat(zeroes)
    for (; it2 < size; ++it2) { str += ALPHABET.charAt(b58[it2]) }
    return str
  }
  function decodeUnsafe (source) {
    if (typeof source !== 'string') { throw new TypeError('Expected String') }
    if (source.length === 0) { return new Uint8Array() }
    let psz = 0
    // Skip and count leading '1's.
    let zeroes = 0
    let length = 0
    while (source[psz] === LEADER) {
      zeroes++
      psz++
    }
    // Allocate enough space in big-endian base256 representation.
    const size = (((source.length - psz) * FACTOR) + 1) >>> 0 // log(58) / log(256), rounded up.
    const b256 = new Uint8Array(size)
    // Process the characters.
    while (psz < source.length) {
      // Find code of next character
      const charCode = source.charCodeAt(psz)
      // Base map can not be indexed using char code
      if (charCode > 255) { return }
      // Decode character
      let carry = BASE_MAP[charCode]
      // Invalid character
      if (carry === 255) { return }
      let i = 0
      for (let it3 = size - 1; (carry !== 0 || i < length) && (it3 !== -1); it3--, i++) {
        carry += (BASE * b256[it3]) >>> 0
        b256[it3] = (carry % 256) >>> 0
        carry = (carry / 256) >>> 0
      }
      if (carry !== 0) { throw new Error('Non-zero carry') }
      length = i
      psz++
    }
    // Skip leading zeroes in b256.
    let it4 = size - length
    while (it4 !== size && b256[it4] === 0) {
      it4++
    }
    const vch = new Uint8Array(zeroes + (size - it4))
    let j = zeroes
    while (it4 !== size) {
      vch[j++] = b256[it4++]
    }
    return vch
  }
  function decode (string) {
    const buffer = decodeUnsafe(string)
    if (buffer) { return buffer }
    throw new Error('Non-base' + BASE + ' character')
  }
  return {
    encode,
    decodeUnsafe,
    decode
  }
}
exports.default = base

    },
    45: function(require, module, exports) {

    },
  };

  var depsMap = {"0":{"@noble/hashes/blake2b":1,"@noble/hashes/blake2s":9,"@noble/hashes/sha256":10,"@noble/hashes/sha512":12,"@noble/hashes/pbkdf2":13,"@noble/hashes/hmac":14,"@noble/hashes/ripemd160":15,"@noble/hashes/utils":4,"@noble/curves/secp256k1":17,"@noble/curves/jubjub":24,"@noble/curves/pasta":32,"@scure/bip39":33,"@scure/bip39/wordlists/english":42,"bs58":43},"1":{"./blake2.js":2},"2":{"./_blake.js":3,"./_md.js":7,"./_u64.js":8,"./utils.js":4},"3":{"./utils.js":4},"4":{"@noble/hashes/crypto":5},"5":{},"6":{},"7":{"./utils.js":4},"8":{},"9":{"./_blake.js":3,"./_md.js":7,"./blake2.js":2},"10":{"./sha2.js":11},"11":{"./_md.js":7,"./_u64.js":8,"./utils.js":4},"12":{"./sha2.js":11},"13":{"./hmac.js":14,"./utils.js":4},"14":{"./utils.js":4},"15":{"./legacy.js":16},"16":{"./_md.js":7,"./utils.js":4},"17":{"@noble/hashes/sha2.js":11,"@noble/hashes/utils.js":4,"./_shortw_utils.js":18,"./abstract/hash-to-curve.js":23,"./abstract/modular.js":22,"./abstract/weierstrass.js":19,"./utils.js":20},"18":{"./abstract/weierstrass.js":19},"19":{"@noble/hashes/hmac.js":14,"@noble/hashes/utils":4,"../utils.js":20,"./curve.js":21,"./modular.js":22},"20":{"@noble/hashes/utils.js":4},"21":{"../utils.js":20,"./modular.js":22},"22":{"../utils.js":20},"23":{"../utils.js":20,"./modular.js":22},"24":{"./misc.js":25},"25":{"@noble/hashes/blake1.js":26,"@noble/hashes/blake2.js":2,"@noble/hashes/sha2.js":11,"@noble/hashes/utils.js":4,"./abstract/edwards.js":27,"./abstract/modular.js":22,"./abstract/weierstrass.js":19,"./bls12-381.js":28,"./bn254.js":31},"26":{"./_blake.js":3,"./_md.js":7,"./_u64.js":8,"./utils.js":4},"27":{"../utils.js":20,"./curve.js":21,"./modular.js":22},"28":{"@noble/hashes/sha2.js":11,"./abstract/bls.js":29,"./abstract/modular.js":22,"./utils.js":20,"./abstract/hash-to-curve.js":23,"./abstract/tower.js":30,"./abstract/weierstrass.js":19},"29":{"../utils.js":20,"./curve.js":21,"./hash-to-curve.js":23,"./modular.js":22,"./weierstrass.js":19},"30":{"../utils.js":20,"./modular.js":22},"31":{"@noble/hashes/sha2.js":11,"./abstract/bls.js":29,"./abstract/modular.js":22,"./abstract/tower.js":30,"./abstract/weierstrass.js":19,"./utils.js":20},"32":{"./misc.js":25},"33":{"@noble/hashes/pbkdf2":34,"@noble/hashes/sha2":38,"@noble/hashes/utils":36,"@scure/base":41},"34":{"./hmac.js":35,"./utils.js":36},"35":{"./utils.js":36},"36":{"@noble/hashes/crypto":37},"37":{"node:crypto":6},"38":{"./_md.js":39,"./_u64.js":40,"./utils.js":36},"39":{"./utils.js":36},"40":{},"41":{},"42":{},"43":{"base-x":44},"44":{},"45":{}};

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
  var exported = customRequire(0);
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
})();
