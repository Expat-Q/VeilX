// Shared Types: src/types/pczt.ts
// Contract B: End-to-End PCZT Proving Lifecycle & Web Worker Protocol

export interface ShieldingPcztParams {
  itemType: "tip" | "paylink" | "request";
  itemId: string;
  transparentUtxo: {
    txid: string;
    vout: number;
    amountZats: number;
    scriptPubKeyHex: string;
    escrowAddress: string;
  };
  payoutValueZats: number;
  feeZats: number; // Exactly 10,000 (ZIP-317)
  recipientRawOrchardHex: string; // Exactly 86 hex characters (43 bytes)
  memoHex: string; // 1024 hex characters (512 bytes)
  expiryHeight: number;
  network: "mainnet" | "testnet";
}

export interface OrchardActionItem {
  cv: string; // 32 bytes hex
  nullifier: string; // 32 bytes hex
  rk: string; // 32 bytes hex
  cmx: string; // 32 bytes hex
  ephemeralKey: string; // 32 bytes hex
  encCiphertext: string; // 580 bytes hex
  outCiphertext: string; // 80 bytes hex
}

export interface OrchardActionBundle {
  actions: OrchardActionItem[];
  flags: number; // 0x01
  valueBalanceZats: number; // negative
  anchorHex: string; // 64 hex zeros (Anchor::empty_tree())
  proofHex: string; // Halo 2 proof hex bytes
  spendAuthSigs: string[]; // empty for shielding
}

export interface ProverWorkerMessageInput {
  action: "PROVE_SHIELDING";
  params: ShieldingPcztParams;
}

export interface ProverWorkerProgressOutput {
  type: "PROGRESS";
  stage: "INIT" | "PREPARING" | "PROVING" | "FINALIZING";
  percent: number;
  message: string;
}

export interface ProverWorkerSuccessOutput {
  type: "SUCCESS";
  orchardActionBundle: OrchardActionBundle;
  pcztSignedHex?: string;
}

export interface ProverWorkerErrorOutput {
  type: "ERROR";
  error: string;
}

export type ProverWorkerMessageOutput =
  | ProverWorkerProgressOutput
  | ProverWorkerSuccessOutput
  | ProverWorkerErrorOutput;
