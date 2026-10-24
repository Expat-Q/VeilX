import crypto from "crypto";

/**
 * Base58 alphabet (Bitcoin/Zcash standard)
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58CheckEncode(payload: Buffer): string {
  const check1 = crypto.createHash("sha256").update(payload).digest();
  const check2 = crypto.createHash("sha256").update(check1).digest();
  const checksum = check2.subarray(0, 4);
  const full = Buffer.concat([payload, checksum]);

  let num = BigInt("0x" + full.toString("hex"));
  let str = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    str = ALPHABET[rem] + str;
  }
  for (let i = 0; i < full.length && full[i] === 0; i++) {
    str = "1" + str;
  }
  return str;
}

/**
 * Converts a 32-byte secp256k1 private key hex into a canonical Zcash transparent address (t1... on mainnet, tm... on testnet)
 */
export function privateKeyHexToZcashAddress(
  privKeyHex: string,
  network: "mainnet" | "testnet" = (process.env.NEXT_PUBLIC_ZCASH_NETWORK as "mainnet" | "testnet") || "mainnet"
): string {
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(privKeyHex, "hex"));
  const pubKey = ecdh.getPublicKey(null, "compressed"); // 33 bytes compressed secp256k1 pubkey

  const sha = crypto.createHash("sha256").update(pubKey).digest();
  const ripemd160 = crypto.createHash("ripemd160").update(sha).digest();

  // Zcash Transparent P2PKH Prefix:
  // Mainnet: 0x1C, 0xB8 (produces "t1...")
  // Testnet: 0x1D, 0x25 (produces "tm...")
  const prefix = network === "testnet" ? Buffer.from([0x1d, 0x25]) : Buffer.from([0x1c, 0xb8]);
  const payload = Buffer.concat([prefix, ripemd160]);

  return base58CheckEncode(payload);
}

/**
 * Deterministically derives a unique transparent escrow keypair for any tip, paylink, or payment request.
 * Completely eliminates the single shared transparent escrow vault.
 *
 * @param entityId Unique identifier for the tip, invoice, or payment request (e.g. tipId, slug, requestId)
 * @param network Target network ('mainnet' or 'testnet')
 * @returns { address: string, privateKeyHex: string }
 */
export function deriveTipEscrowKeypair(
  entityId: string,
  network?: "mainnet" | "testnet"
): {
  address: string;
  privateKeyHex: string;
} {
  const masterKeyHex = process.env.ESCROW_PLATFORM_TRANSPARENT_KEY;
  if (!masterKeyHex || masterKeyHex.length < 64) {
    throw new Error(
      "FATAL: ESCROW_PLATFORM_TRANSPARENT_KEY environment variable is missing or insecure."
    );
  }

  const masterKeyBuf = Buffer.from(masterKeyHex, "hex");
  const childKeyBuf = crypto
    .createHmac("sha256", masterKeyBuf)
    .update(`veilx:escrow:${entityId.trim()}`)
    .digest();

  const childKeyHex = childKeyBuf.toString("hex");
  const address = privateKeyHexToZcashAddress(childKeyHex, network);

  return {
    address,
    privateKeyHex: childKeyHex,
  };
}

/**
 * Convenience helper to get just the unique transparent deposit address for an entity
 */
export function getTipEscrowAddress(entityId: string): string {
  return deriveTipEscrowKeypair(entityId).address;
}
