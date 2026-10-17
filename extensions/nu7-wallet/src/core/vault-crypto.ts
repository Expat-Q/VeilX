import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils";
import type { EncryptedVaultEnvelope } from "../types.ts";

function getSubtleCrypto(): SubtleCrypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  // Node.js fallback
  try {
    const c = require("crypto");
    return c.webcrypto?.subtle || c.subtle;
  } catch {
    throw new Error("Web Crypto API (subtle) is unavailable in this runtime environment.");
  }
}

/**
 * Derive an AES-GCM-256 key from a user password using PBKDF2-HMAC-SHA256 (100,000 iterations).
 */
export async function deriveVaultEncryptionKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
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

/**
 * Encrypt a wallet vault object with AES-GCM-256.
 */
export async function encryptVault(
  vaultPlaintext: any,
  password: string
): Promise<EncryptedVaultEnvelope> {
  if (!password || password.length < 4) {
    throw new Error("Password must be at least 4 characters long.");
  }

  const subtle = getSubtleCrypto();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveVaultEncryptionKey(password, salt);

  const enc = new TextEncoder();
  const plaintextBytes = enc.encode(JSON.stringify(vaultPlaintext));
  const ciphertextBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintextBytes
  );

  return {
    version: 2,
    isEncrypted: true,
    saltHex: bytesToHex(salt),
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(ciphertextBuffer)),
    lastUpdated: Date.now(),
  };
}

/**
 * Decrypt an encrypted vault envelope with the user's password.
 */
export async function decryptVault<T = any>(
  envelope: EncryptedVaultEnvelope | any,
  password: string
): Promise<T> {
  if (!isEncryptedVault(envelope)) {
    return envelope as T;
  }

  const subtle = getSubtleCrypto();
  const salt = hexToBytes(envelope.saltHex);
  const iv = hexToBytes(envelope.ivHex);
  const ciphertext = hexToBytes(envelope.ciphertextHex);
  const key = await deriveVaultEncryptionKey(password, salt);

  try {
    const decryptedBuffer = await subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedBuffer)) as T;
  } catch {
    throw new Error("Invalid password or corrupted vault envelope.");
  }
}

/**
 * Check if the given storage data is an encrypted vault envelope.
 */
export function isEncryptedVault(data: any): data is EncryptedVaultEnvelope {
  return Boolean(
    data &&
      typeof data === "object" &&
      data.isEncrypted === true &&
      typeof data.ciphertextHex === "string" &&
      typeof data.saltHex === "string" &&
      typeof data.ivHex === "string"
  );
}
