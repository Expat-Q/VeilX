/**
 * Zcash NU7 (Network Upgrade 7) Protocol Constants
 * Specifications: ZIP 259 (NU7 Deployment), ZIP 225 (v5 Tx Format),
 * ZIP 244 (Non-Malleable TxId & Sighash), ZIP 218 (25s Blocks), ZIP 235/317 (Fees)
 */

/**
 * Consensus Branch IDs
 * NU7 (ZIP 259): 0x77190AD9 — Activated on Testnet at block 4,465,026
 */
export const CONSENSUS_BRANCH_ID = {
  NU5: 0xc2d6d0b4,
  NU6: 0x4115ba96,
  IRONWOOD: 0x37a5165b, // NU6.3 (Ironwood) — Currently active on Testnet
  NU7: 0x77190ad9,     // NU7 (ZIP 259)
} as const;

/**
 * Active Consensus Branch ID on Zcash Testnet:
 * Live testnet nodes currently run Ironwood (0x37A5165B).
 */
export const ACTIVE_TESTNET_BRANCH_ID = CONSENSUS_BRANCH_ID.IRONWOOD;
export const NU7_BRANCH_ID = CONSENSUS_BRANCH_ID.NU7;
export const NU7_BRANCH_ID_HEX = "77190ad9";

/**
 * Little-endian 4-byte representation of NU7 Consensus Branch ID (0x77190AD9 -> d9 0a 19 77)
 */
export const NU7_BRANCH_ID_LE = new Uint8Array([0xd9, 0x0a, 0x19, 0x77]);
export const IRONWOOD_BRANCH_ID_LE = new Uint8Array([0x5b, 0x16, 0xa5, 0x37]);

/**
 * ZIP 225 Transaction Version 5 Header Constants
 * Bit 31 (fOverwintered) = 1, Version = 5 -> 0x80000005
 */
export const TX_V5_HEADER = 0x80000005;
export const TX_V5_VERSION_GROUP_ID = 0x26a7270a;

/**
 * NU7 Testnet Activation & Timing Parameters (ZIP 218)
 */
export const NU7_TESTNET_ACTIVATION_HEIGHT = 4_465_026;
export const NU7_BLOCK_SPACING_SECONDS = 25; // Reduced from 75s in NU7
export const DEFAULT_EXPIRY_DELTA_BLOCKS = 120; // ~50 minutes at 25s blocks

/**
 * Currency & Fee Constants (ZIP 317 & ZIP 235 Network Sustainability Mechanism)
 */
export const ZATOSHIS_PER_ZEC = 100_000_000n;
export const MARGINAL_FEE_ZATOSHIS = 5_000n; // 0.00005 ZEC per logical action
export const GRACE_ACTIONS = 2n;
export const DEFAULT_FEE_ZATOSHIS = 10_000n; // 0.0001 ZEC standard 2-action fee
export const NSM_BURN_NUMERATOR = 6n; // 60% of fees routed to NSM reserve in NU7 (ZIP 235)
export const NSM_BURN_DENOMINATOR = 10n;

/**
 * SIGHASH Types (ZIP 244)
 */
export const SIGHASH_ALL = 0x01;
export const SIGHASH_NONE = 0x02;
export const SIGHASH_SINGLE = 0x03;
export const SIGHASH_ANYONECANPAY = 0x80;

/**
 * ZIP 244 16-Byte BLAKE2b-256 Personalization Strings
 */
export const ZIP244_PERSONALIZATION = {
  HEADERS: "ZTxIdHeadersHash", // 16 bytes
  TRANSPARENT: "ZTxIdTranspaHash", // 16 bytes
  PREVOUTS: "ZTxIdPrevoutHash", // 16 bytes
  SEQUENCE: "ZTxIdSequencHash", // 16 bytes
  OUTPUTS: "ZTxIdOutputsHash", // 16 bytes
  AMOUNTS: "ZTxTrAmountsHash", // 16 bytes
  SCRIPTPUBKEYS: "ZTxTrScriptsHash", // 16 bytes
  TXIN: "Zcash___TxInHash", // 16 bytes (3 underscores)
  SAPLING: "ZTxIdSaplingHash", // 16 bytes
  ORCHARD: "ZTxIdOrchardHash", // 16 bytes
  TX_HASH_PREFIX: "ZcashTxHash_", // 12 bytes + 4-byte LE branch ID = 16 bytes
} as const;

/**
 * Base58Check Version Prefixes
 */
export const ADDRESS_PREFIXES = {
  testnet: {
    p2pkh: new Uint8Array([0x1d, 0x25]), // Produces 'tm...' addresses
    p2sh: new Uint8Array([0x1c, 0xba]), // Produces 't2...' addresses
    wif: 0xef, // Testnet WIF private key prefix
    bip44CoinType: 1, // Testnet coin type
  },
  mainnet: {
    p2pkh: new Uint8Array([0x1c, 0xb8]), // Produces 't1...' addresses
    p2sh: new Uint8Array([0x1c, 0xbd]), // Produces 't3...' addresses
    wif: 0x80, // Mainnet WIF private key prefix
    bip44CoinType: 133, // ZEC coin type
  },
} as const;

/**
 * Build the 16-byte top-level BLAKE2b personalization string for any consensus branch ID
 */
export function getTxHashPersonalization(consensusBranchId: number = NU7_BRANCH_ID): Uint8Array {
  const prefix = new TextEncoder().encode(ZIP244_PERSONALIZATION.TX_HASH_PREFIX);
  const branchBytes = new Uint8Array(4);
  const view = new DataView(branchBytes.buffer);
  view.setUint32(0, consensusBranchId >>> 0, true); // little-endian
  const out = new Uint8Array(16);
  out.set(prefix, 0);
  out.set(branchBytes, 12);
  return out;
}
