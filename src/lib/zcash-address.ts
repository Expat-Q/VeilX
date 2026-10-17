import { sha256 } from "@noble/hashes/sha256";
import type { Network } from "@noir-wallet/sdk";

// Base58 Alphabet
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP.set(ALPHABET[i], i);
}

// Bech32 / Bech32m Alphabet
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_MAP = new Map<string, number>();
for (let i = 0; i < BECH32_CHARSET.length; i++) {
  BECH32_MAP.set(BECH32_CHARSET[i], i);
}

/**
 * Base58 decoding with double-SHA256 checksum verification
 */
function decodeBase58Check(address: string): { prefix: number[]; payload: number[] } | null {
  if (address.length < 26 || address.length > 36) return null;

  const bytes: number[] = [0];
  for (let i = 0; i < address.length; i++) {
    const val = ALPHABET_MAP.get(address[i]);
    if (val === undefined) return null;

    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Add leading zeroes
  for (let i = 0; i < address.length && address[i] === "1"; i++) {
    bytes.push(0);
  }

  bytes.reverse();
  if (bytes.length < 5) return null;

  const data = bytes.slice(0, bytes.length - 4);
  const checksum = bytes.slice(bytes.length - 4);

  // Verify double SHA256 checksum
  const hash1 = sha256(new Uint8Array(data));
  const hash2 = sha256(hash1);

  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== hash2[i]) {
      return null; // Invalid checksum
    }
  }

  return {
    prefix: data.slice(0, 2),
    payload: data.slice(2),
  };
}

/**
 * Bech32 & Bech32m Polymod Checksum Calculator
 */
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

/**
 * Validates Bech32 (Sapling) or Bech32m (Unified) encoding with checksum
 */
function verifyBech32Encoding(
  address: string,
  expectedHrp: string,
  mode: "bech32" | "bech32m" = "bech32"
): boolean {
  const lower = address.toLowerCase();
  const sepPos = lower.lastIndexOf("1");
  if (sepPos < 1 || sepPos + 7 > lower.length) return false;

  const hrp = lower.slice(0, sepPos);
  if (hrp !== expectedHrp) return false;

  const data: number[] = [];
  for (let i = sepPos + 1; i < lower.length; i++) {
    const d = BECH32_MAP.get(lower[i]);
    if (d === undefined) return false;
    data.push(d);
  }

  const values = hrpExpand(hrp).concat(data);
  const polymod = bech32Polymod(values);

  // Bech32 constant is 1; Bech32m constant is 0x2bc830a3
  const expectedConstant = mode === "bech32m" ? 0x2bc830a3 : 1;
  return polymod === expectedConstant;
}

export type ZcashAddressType = "p2pkh" | "p2sh" | "sapling" | "unified" | "unknown";

export interface ZcashAddressValidationResult {
  isValid: boolean;
  network?: Network;
  type?: ZcashAddressType;
  error?: string;
  isNetworkMismatch?: boolean;
}

/**
 * Full cryptographic Zcash Address Validator
 * Verifies Base58Check double-SHA256 checksums, Bech32 (Sapling) & Bech32m (Unified) checksums,
 * address prefixes, lengths, and network compatibility.
 */
export function validateZcashAddressFull(
  address: string,
  targetNetwork: Network = "mainnet"
): ZcashAddressValidationResult {
  if (!address || typeof address !== "string") {
    return { isValid: false, error: "Address is empty or not a string" };
  }

  const clean = address.trim();

  // Quick prefix check for clear testnet addresses when targetNetwork is mainnet
  const isObviousTestnetPrefix =
    clean.startsWith("utest1") ||
    clean.startsWith("tm") ||
    clean.startsWith("t2") ||
    clean.startsWith("ztestsapling1");

  // 1. Check Transparent Base58Check addresses (t1, t3, tm, t2)
  if (clean.startsWith("t1") || clean.startsWith("t3") || clean.startsWith("tm") || clean.startsWith("t2")) {
    const decoded = decodeBase58Check(clean);
    if (!decoded) {
      if (isObviousTestnetPrefix && targetNetwork === "mainnet") {
        return {
          isValid: false,
          isNetworkMismatch: true,
          network: "testnet",
          error: "You entered a Testnet address, but VeilX is running on Zcash Mainnet.",
        };
      }
      return { isValid: false, error: "Invalid Base58Check encoding or checksum mismatch" };
    }

    const [b0, b1] = decoded.prefix;

    // Mainnet: t1 = [0x1C, 0xB8], t3 = [0x1C, 0xBD]
    if (b0 === 0x1c && b1 === 0xb8) {
      if (targetNetwork && targetNetwork !== "mainnet") {
        return { isValid: false, isNetworkMismatch: true, error: "Address belongs to mainnet, but target is testnet", network: "mainnet", type: "p2pkh" };
      }
      return { isValid: true, network: "mainnet", type: "p2pkh" };
    }

    if (b0 === 0x1c && b1 === 0xbd) {
      if (targetNetwork && targetNetwork !== "mainnet") {
        return { isValid: false, isNetworkMismatch: true, error: "Address belongs to mainnet, but target is testnet", network: "mainnet", type: "p2sh" };
      }
      return { isValid: true, network: "mainnet", type: "p2sh" };
    }

    // Testnet: tm = [0x1D, 0x25], t2 = [0x1C, 0xBA]
    if (b0 === 0x1d && b1 === 0x25) {
      if (targetNetwork && targetNetwork !== "testnet") {
        return { isValid: false, isNetworkMismatch: true, error: "Address belongs to testnet, but target is mainnet", network: "testnet", type: "p2pkh" };
      }
      return { isValid: true, network: "testnet", type: "p2pkh" };
    }

    if (b0 === 0x1c && b1 === 0xba) {
      if (targetNetwork && targetNetwork !== "testnet") {
        return { isValid: false, isNetworkMismatch: true, error: "Address belongs to testnet, but target is mainnet", network: "testnet", type: "p2sh" };
      }
      return { isValid: true, network: "testnet", type: "p2sh" };
    }

    return { isValid: false, error: "Unrecognized transparent address prefix bytes" };
  }

  // 2. Check Sapling Bech32 addresses (zs1, ztestsapling1)
  if (clean.startsWith("zs1")) {
    const valid = verifyBech32Encoding(clean, "zs", "bech32");
    if (!valid) return { isValid: false, error: "Invalid Sapling Bech32 checksum" };
    if (targetNetwork && targetNetwork !== "mainnet") {
      return { isValid: false, isNetworkMismatch: true, error: "Mainnet Sapling address cannot be used on testnet", network: "mainnet", type: "sapling" };
    }
    return { isValid: true, network: "mainnet", type: "sapling" };
  }

  if (clean.startsWith("ztestsapling1")) {
    const valid = verifyBech32Encoding(clean, "ztestsapling", "bech32");
    if (targetNetwork && targetNetwork !== "testnet") {
      return {
        isValid: false,
        isNetworkMismatch: true,
        error: "Testnet Sapling address cannot be used on mainnet",
        network: "testnet",
        type: "sapling",
      };
    }
    if (!valid) return { isValid: false, error: "Invalid Testnet Sapling Bech32 checksum" };
    return { isValid: true, network: "testnet", type: "sapling" };
  }

  // 3. Check Unified Addresses Bech32m (u1, utest1)
  if (clean.startsWith("u1")) {
    const valid = verifyBech32Encoding(clean, "u", "bech32m");
    if (!valid) {
      return { isValid: false, error: "Invalid Unified Address Bech32m checksum" };
    }
    if (targetNetwork && targetNetwork !== "mainnet") {
      return { isValid: false, isNetworkMismatch: true, error: "Mainnet Unified address cannot be used on testnet", network: "mainnet", type: "unified" };
    }
    return { isValid: true, network: "mainnet", type: "unified" };
  }

  if (clean.startsWith("utest1")) {
    const valid = verifyBech32Encoding(clean, "utest", "bech32m");
    if (targetNetwork && targetNetwork !== "testnet") {
      return {
        isValid: false,
        isNetworkMismatch: true,
        error: "Testnet Unified address cannot be used on mainnet",
        network: "testnet",
        type: "unified",
      };
    }
    if (!valid) {
      return { isValid: false, error: "Invalid Testnet Unified Address Bech32m checksum" };
    }
    return { isValid: true, network: "testnet", type: "unified" };
  }

  // If starts with obvious testnet prefix but failed above:
  if (isObviousTestnetPrefix && targetNetwork === "mainnet") {
    return {
      isValid: false,
      isNetworkMismatch: true,
      network: "testnet",
      error: "You entered a Testnet address, but VeilX is running on Zcash Mainnet.",
    };
  }

  return { isValid: false, error: "Unrecognized Zcash address format or prefix" };
}
