export type ZcashNetwork = "testnet" | "mainnet";

export interface DerivedAccount {
  index: number;
  derivationPath: string;
  privateKeyHex: string;
  wif: string;
  publicKeyHex: string;
  pubKeyHashHex: string;
  address: string; // e.g., tm... on testnet, t1... on mainnet
  scriptPubKeyHex: string;
  saplingAddress: string; // e.g., ztestsapling1... on testnet, zs1... on mainnet
  unifiedAddress: string; // e.g., utest1... on testnet, u1... on mainnet (ZIP-316 F4Jumble + Bech32m)
}

export interface WalletVault {
  mnemonic?: string;
  seedHex: string;
  network: ZcashNetwork;
  consensusBranchId: number;
  accounts: DerivedAccount[];
  createdAt: string;
}

export interface TransparentUTXO {
  txid: string; // 32-byte hex (big-endian standard display order)
  vout: number; // output index
  scriptPubKeyHex: string;
  satoshis: bigint; // value in zatoshis (1 ZEC = 100_000_000 zatoshis)
  height?: number;
}

export interface TransparentOutput {
  address: string;
  scriptPubKeyHex: string;
  satoshis: bigint;
}

export interface UnsignedV5Transaction {
  version: number; // 0x80000005
  versionGroupId: number; // 0x26A7270A
  consensusBranchId: number; // 0x77190AD9 for NU7
  lockTime: number;
  expiryHeight: number;
  inputs: Array<{
    utxo: TransparentUTXO;
    sequence: number;
  }>;
  outputs: TransparentOutput[];
}

export interface SignedV5Transaction {
  txid: string; // ZIP 244 non-malleable txid (hex, display order)
  rawHex: string; // Full serialized v5 transaction ready for sendrawtransaction
  feeZatoshis: bigint;
  consensusBranchIdHex: string;
  expiryHeight: number;
  inputDigests: string[]; // Per-input ZIP 244 sighashes
}

export interface ZebraBlockchainInfo {
  chain: string;
  blocks: number;
  bestblockhash: string;
  estimatedheight?: number;
  consensus: {
    chaintip: string;
    nextblock: string;
  };
}

export interface ShieldedSendParams {
  fromAccount?: number;
  toAddress: string;
  amountZec: number;
  memo?: string;
}

export interface ShieldedSendResult {
  txid: string;
  engine: "webzjs-wasm" | "rust-cli-nu7" | "zallet-rpc";
  consensusBranchId: string;
}

export interface ShieldedBalance {
  orchardZatoshis: bigint;
  saplingZatoshis: bigint;
  transparentZatoshis: bigint;
  totalZec: number;
}

export interface ShieldedEngine {
  readonly engineName: "webzjs-wasm" | "rust-cli-nu7" | "zallet-rpc";
  init(seedHex?: string): Promise<void>;
  sync(): Promise<{ syncedHeight: number; consensusBranchId: string }>;
  getUnifiedAddress(accountIndex?: number): Promise<string>;
  getBalance(accountIndex?: number): Promise<ShieldedBalance>;
  sendShielded(params: ShieldedSendParams): Promise<ShieldedSendResult>;
}

export interface EncryptedVaultEnvelope {
  version: number;
  isEncrypted: true;
  saltHex: string;
  ivHex: string;
  ciphertextHex: string;
  lastUpdated: number;
}

