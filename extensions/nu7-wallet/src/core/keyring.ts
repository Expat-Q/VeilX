import { secp256k1 } from "@noble/curves/secp256k1";
import { hmac } from "@noble/hashes/hmac";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils";
import { ADDRESS_PREFIXES, NU7_BRANCH_ID } from "./constants.ts";
import { privateKeyToWIF, publicKeyToZcashAddress, wifToPrivateKey } from "./address.ts";
import {
  deriveOrchardRawReceiver,
  deriveSaplingAddress,
  encodeUnifiedAddress,
} from "./unified-address.ts";
import type { DerivedAccount, WalletVault, ZcashNetwork } from "../types.ts";

const SECP256K1_N = secp256k1.CURVE.n;

/**
 * Compact 256-word deterministic wordlist for human-readable seed phrases when offline,
 * while also accepting any standard 12/24-word BIP-39 mnemonic phrase via PBKDF2-HMAC-SHA512.
 */
const DETERMINISTIC_WORDS = [
  "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
  "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
  "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
  "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance",
  "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
  "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
  "alcohol", "alert", "alien", "all", "alley", "allow", "almost", "alone",
  "alpha", "already", "also", "alter", "always", "amateur", "amazing", "among",
  "amount", "amused", "analyst", "anchor", "ancient", "anger", "angle", "angry",
  "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
  "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april",
  "arch", "arctic", "area", "arena", "argue", "arm", "armed", "armor",
  "army", "around", "arrange", "arrest", "arrive", "arrow", "art", "artefact",
  "artist", "artwork", "ask", "aspect", "assault", "asset", "assist", "assume",
  "asthma", "athlete", "atom", "attack", "attend", "attitude", "attract", "auction",
  "audit", "august", "aunt", "author", "auto", "autumn", "average", "avocado",
  "avoid", "awake", "aware", "away", "awesome", "awful", "awkward", "axis",
  "baby", "bachelor", "bacon", "badge", "bag", "balance", "balcony", "ball",
  "bamboo", "banana", "banner", "bar", "barely", "bargain", "barrel", "base",
  "basic", "basket", "battle", "beach", "bean", "beauty", "because", "become",
  "beef", "before", "begin", "behave", "behind", "believe", "below", "belt",
  "bench", "benefit", "best", "betray", "better", "between", "beyond", "bicycle",
  "bid", "bike", "bind", "biology", "bird", "birth", "bitter", "black",
  "blade", "blame", "blanket", "blast", "bleak", "bless", "blind", "blood",
  "blossom", "blouse", "blue", "blur", "blush", "board", "boat", "body",
  "boil", "bomb", "bone", "bonus", "book", "boost", "border", "boring",
  "borrow", "boss", "bottom", "bounce", "box", "boy", "bracket", "brain",
  "brand", "brass", "brave", "bread", "breeze", "brick", "bridge", "brief",
  "bright", "bring", "brisk", "broccoli", "broken", "bronze", "broom", "brother",
  "brown", "brush", "bubble", "buddy", "budget", "buffalo", "build", "bulb",
  "bulk", "bullet", "bundle", "bunker", "burden", "burger", "burst", "bus",
  "business", "busy", "butter", "buyer", "buzz", "cabbage", "cabin", "cable",
];

/**
 * Generate a 24-word mnemonic phrase from cryptographic entropy
 */
export function generateMnemonic24(): string {
  const entropy = randomBytes(24);
  const words: string[] = [];
  for (let i = 0; i < 24; i++) {
    words.push(DETERMINISTIC_WORDS[entropy[i]]);
  }
  return words.join(" ");
}

/**
 * Standard BIP-39 Mnemonic-to-Seed derivation (PBKDF2-HMAC-SHA512, 2048 rounds)
 */
export function mnemonicToSeed(mnemonic: string, passphrase: string = ""): Uint8Array {
  const normalizedMnemonic = mnemonic.trim().replace(/\s+/g, " ").normalize("NFKD");
  const salt = ("mnemonic" + passphrase).normalize("NFKD");
  return pbkdf2(sha512, new TextEncoder().encode(normalizedMnemonic), new TextEncoder().encode(salt), {
    c: 2048,
    dkLen: 64,
  });
}

interface HDNode {
  privateKey: Uint8Array;
  chainCode: Uint8Array;
}

/**
 * BIP-32 Master Node from 64-byte seed
 */
export function masterNodeFromSeed(seed: Uint8Array): HDNode {
  const I = hmac(sha512, new TextEncoder().encode("Bitcoin seed"), seed);
  return {
    privateKey: I.slice(0, 32),
    chainCode: I.slice(32, 64),
  };
}

/**
 * BIP-32 Child Key Derivation (CKDpriv)
 */
export function deriveChildKey(parent: HDNode, index: number, hardened: boolean): HDNode {
  const data = new Uint8Array(37);
  const actualIndex = hardened ? (index | 0x80000000) >>> 0 : index >>> 0;

  if (hardened) {
    data[0] = 0x00;
    data.set(parent.privateKey, 1);
  } else {
    const pub = secp256k1.getPublicKey(parent.privateKey, true);
    data.set(pub, 0);
  }

  const view = new DataView(data.buffer);
  view.setUint32(33, actualIndex, false); // big-endian index

  const I = hmac(sha512, parent.chainCode, data);
  const IL = BigInt("0x" + bytesToHex(I.slice(0, 32)));
  const kPar = BigInt("0x" + bytesToHex(parent.privateKey));
  const childKeyInt = (IL + kPar) % SECP256K1_N;

  if (IL >= SECP256K1_N || childKeyInt === 0n) {
    return deriveChildKey(parent, index + 1, hardened);
  }

  const childHex = childKeyInt.toString(16).padStart(64, "0");
  return {
    privateKey: hexToBytes(childHex),
    chainCode: I.slice(32, 64),
  };
}

/**
 * Derive a BIP-44 path such as "m/44'/1'/0'/0/0"
 */
export function derivePath(seed: Uint8Array, path: string): HDNode {
  const segments = path.replace(/^m\/?/, "").split("/").filter(Boolean);
  let node = masterNodeFromSeed(seed);

  for (const seg of segments) {
    const hardened = seg.endsWith("'") || seg.endsWith("h");
    const index = parseInt(seg.replace(/['h]$/, ""), 10);
    if (isNaN(index) || index < 0) {
      throw new Error(`Invalid BIP-32 path segment: ${seg}`);
    }
    node = deriveChildKey(node, index, hardened);
  }

  return node;
}

/**
 * Derive a full Zcash account (Transparent P2PKH + Sapling Shielded + ZIP-316 Unified Address)
 */
export function deriveZcashAccount(
  seed: Uint8Array,
  accountIndex: number = 0,
  network: ZcashNetwork = "testnet"
): DerivedAccount {
  const coinType = ADDRESS_PREFIXES[network].bip44CoinType;
  const derivationPath = `m/44'/${coinType}'/0'/0/${accountIndex}`;
  const node = derivePath(seed, derivationPath);
  const privateKeyHex = bytesToHex(node.privateKey);
  const pubKeyBytes = secp256k1.getPublicKey(node.privateKey, true);
  const publicKeyHex = bytesToHex(pubKeyBytes);
  const { address, pubKeyHashHex, scriptPubKeyHex } = publicKeyToZcashAddress(pubKeyBytes, network);
  const wif = privateKeyToWIF(node.privateKey, network);

  // Derive Sapling Shielded (ztestsapling1...) & Orchard Raw Receiver -> ZIP-316 Unified Address (utest1...)
  const { saplingAddress, saplingRawReceiver } = deriveSaplingAddress(seed, accountIndex, network);
  const orchardRawReceiver = deriveOrchardRawReceiver(seed, accountIndex);
  const unifiedAddress = encodeUnifiedAddress({
    network,
    p2pkhPubKeyHash: pubKeyHashHex,
    saplingRawReceiver,
    orchardRawReceiver,
  });

  return {
    index: accountIndex,
    derivationPath,
    privateKeyHex,
    wif,
    publicKeyHex,
    pubKeyHashHex,
    address,
    scriptPubKeyHex,
    saplingAddress,
    unifiedAddress,
  };
}

/**
 * Import a single account directly from a WIF or 64-char hex private key
 */
export function accountFromPrivateKey(
  keyOrWif: string,
  network: ZcashNetwork = "testnet"
): DerivedAccount {
  let privateKeyHex: string;
  let resolvedNetwork = network;

  if (/^[0-9a-fA-F]{64}$/.test(keyOrWif.trim())) {
    privateKeyHex = keyOrWif.trim().toLowerCase();
  } else {
    const decoded = wifToPrivateKey(keyOrWif.trim());
    privateKeyHex = decoded.privateKeyHex;
    resolvedNetwork = decoded.network;
  }

  const privBytes = hexToBytes(privateKeyHex);
  const pubBytes = secp256k1.getPublicKey(privBytes, true);
  const publicKeyHex = bytesToHex(pubBytes);
  const { address, pubKeyHashHex, scriptPubKeyHex } = publicKeyToZcashAddress(pubBytes, resolvedNetwork);
  const wif = privateKeyToWIF(privBytes, resolvedNetwork);

  const pseudoSeed = sha512(privBytes);
  const { saplingAddress, saplingRawReceiver } = deriveSaplingAddress(pseudoSeed, 0, resolvedNetwork);
  const orchardRawReceiver = deriveOrchardRawReceiver(pseudoSeed, 0);
  const unifiedAddress = encodeUnifiedAddress({
    network: resolvedNetwork,
    p2pkhPubKeyHash: pubKeyHashHex,
    saplingRawReceiver,
    orchardRawReceiver,
  });

  return {
    index: 0,
    derivationPath: "imported",
    privateKeyHex,
    wif,
    publicKeyHex,
    pubKeyHashHex,
    address,
    scriptPubKeyHex,
    saplingAddress,
    unifiedAddress,
  };
}

/**
 * Create a new NU7 Wallet Vault with mnemonic & derived accounts
 */
export function createWalletVault(
  options: {
    mnemonic?: string;
    network?: ZcashNetwork;
    accountCount?: number;
  } = {}
): WalletVault {
  const network = options.network || "testnet";
  const mnemonic = options.mnemonic || generateMnemonic24();
  const seed = mnemonicToSeed(mnemonic);
  const accountCount = options.accountCount || 1;
  const accounts: DerivedAccount[] = [];

  for (let i = 0; i < accountCount; i++) {
    accounts.push(deriveZcashAccount(seed, i, network));
  }

  return {
    mnemonic,
    seedHex: bytesToHex(seed),
    network,
    consensusBranchId: NU7_BRANCH_ID,
    accounts,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Sign an arbitrary UTF-8 message using a Zcash account's secp256k1 private key
 */
export function signMessageWithAccount(account: DerivedAccount, message: string): string {
  const msgHash = sha256(new TextEncoder().encode(message));
  const sig = secp256k1.sign(msgHash, hexToBytes(account.privateKeyHex));
  return sig.toCompactHex();
}
