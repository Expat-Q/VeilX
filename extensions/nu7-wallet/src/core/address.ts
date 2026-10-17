import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import bs58 from "bs58";
import { ADDRESS_PREFIXES } from "./constants.ts";
import type { ZcashNetwork } from "../types.ts";

/**
 * Compute double-SHA256 checksum (first 4 bytes)
 */
export function doubleSha256Checksum(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload)).slice(0, 4);
}

/**
 * Base58Check encode
 */
export function base58CheckEncode(versionPrefix: Uint8Array, payload: Uint8Array): string {
  const body = new Uint8Array(versionPrefix.length + payload.length);
  body.set(versionPrefix, 0);
  body.set(payload, versionPrefix.length);
  const checksum = doubleSha256Checksum(body);
  const full = new Uint8Array(body.length + 4);
  full.set(body, 0);
  full.set(checksum, body.length);
  return bs58.encode(full);
}

/**
 * Base58Check decode with cryptographic checksum verification
 */
export function base58CheckDecode(encoded: string): { prefix: Uint8Array; payload: Uint8Array } {
  const raw = bs58.decode(encoded);
  if (raw.length < 5) {
    throw new Error("Invalid Base58Check string: too short");
  }
  const body = raw.slice(0, raw.length - 4);
  const checksum = raw.slice(raw.length - 4);
  const expected = doubleSha256Checksum(body);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) {
      throw new Error("Invalid Base58Check checksum");
    }
  }
  // Zcash transparent addresses use a 2-byte prefix; WIF uses a 1-byte prefix
  if (raw.length === 26) {
    return { prefix: body.slice(0, 2), payload: body.slice(2) };
  }
  return { prefix: body.slice(0, 1), payload: body.slice(1) };
}

/**
 * Compute HASH160 = RIPEMD160(SHA256(pubKey))
 */
export function hash160(publicKeyBytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(publicKeyBytes));
}

/**
 * Build standard P2PKH scriptPubKey:
 * OP_DUP (0x76) OP_HASH160 (0xa9) PUSH_20 (0x14) <20-byte-pubKeyHash> OP_EQUALVERIFY (0x88) OP_CHECKSIG (0xac)
 */
export function pubKeyHashToScriptPubKey(pubKeyHash: Uint8Array): Uint8Array {
  if (pubKeyHash.length !== 20) {
    throw new Error(`Invalid pubKeyHash length: expected 20, got ${pubKeyHash.length}`);
  }
  const script = new Uint8Array(25);
  script[0] = 0x76; // OP_DUP
  script[1] = 0xa9; // OP_HASH160
  script[2] = 0x14; // Push 20 bytes
  script.set(pubKeyHash, 3);
  script[23] = 0x88; // OP_EQUALVERIFY
  script[24] = 0xac; // OP_CHECKSIG
  return script;
}

/**
 * Build P2SH scriptPubKey:
 * OP_HASH160 (0xa9) PUSH_20 (0x14) <20-byte-scriptHash> OP_EQUAL (0x87)
 */
export function scriptHashToScriptPubKey(scriptHash: Uint8Array): Uint8Array {
  if (scriptHash.length !== 20) {
    throw new Error(`Invalid scriptHash length: expected 20, got ${scriptHash.length}`);
  }
  const script = new Uint8Array(23);
  script[0] = 0xa9; // OP_HASH160
  script[1] = 0x14; // Push 20 bytes
  script.set(scriptHash, 2);
  script[22] = 0x87; // OP_EQUAL
  return script;
}

/**
 * Convert compressed secp256k1 public key to Zcash transparent address (tm... on testnet, t1... on mainnet)
 */
export function publicKeyToZcashAddress(
  compressedPubKey: Uint8Array | string,
  network: ZcashNetwork = "testnet"
): { address: string; pubKeyHashHex: string; scriptPubKeyHex: string } {
  const pubBytes = typeof compressedPubKey === "string" ? hexToBytes(compressedPubKey) : compressedPubKey;
  const pkh = hash160(pubBytes);
  const prefix = ADDRESS_PREFIXES[network].p2pkh;
  const address = base58CheckEncode(prefix, pkh);
  const scriptPubKey = pubKeyHashToScriptPubKey(pkh);
  return {
    address,
    pubKeyHashHex: bytesToHex(pkh),
    scriptPubKeyHex: bytesToHex(scriptPubKey),
  };
}

/**
 * Convert a Zcash transparent address (tm..., t2..., t1..., t3...) to its locking scriptPubKey
 */
export function addressToScriptPubKey(address: string): Uint8Array {
  const { prefix, payload } = base58CheckDecode(address);
  if (prefix.length !== 2 || payload.length !== 20) {
    throw new Error(`Unsupported transparent address format: ${address}`);
  }
  const isP2PKH =
    (prefix[0] === 0x1d && prefix[1] === 0x25) || // testnet tm...
    (prefix[0] === 0x1c && prefix[1] === 0xb8); // mainnet t1...
  if (isP2PKH) {
    return pubKeyHashToScriptPubKey(payload);
  }
  const isP2SH =
    (prefix[0] === 0x1c && prefix[1] === 0xba) || // testnet t2...
    (prefix[0] === 0x1c && prefix[1] === 0xbd); // mainnet t3...
  if (isP2SH) {
    return scriptHashToScriptPubKey(payload);
  }
  throw new Error(`Unrecognized Zcash address prefix: 0x${bytesToHex(prefix)}`);
}

/**
 * Encode a 32-byte private key into WIF (compressed)
 */
export function privateKeyToWIF(privateKey: Uint8Array | string, network: ZcashNetwork = "testnet"): string {
  const privBytes = typeof privateKey === "string" ? hexToBytes(privateKey) : privateKey;
  if (privBytes.length !== 32) {
    throw new Error("Private key must be 32 bytes");
  }
  const payload = new Uint8Array(33);
  payload.set(privBytes, 0);
  payload[32] = 0x01; // compressed pubkey flag
  return base58CheckEncode(new Uint8Array([ADDRESS_PREFIXES[network].wif]), payload);
}

/**
 * Decode a WIF string back into raw 32-byte private key
 */
export function wifToPrivateKey(wif: string): { privateKeyHex: string; network: ZcashNetwork } {
  const { prefix, payload } = base58CheckDecode(wif);
  const netByte = prefix[0];
  const network: ZcashNetwork = netByte === ADDRESS_PREFIXES.testnet.wif ? "testnet" : "mainnet";
  const privKey = payload.length === 33 ? payload.slice(0, 32) : payload;
  return {
    privateKeyHex: bytesToHex(privKey),
    network,
  };
}
