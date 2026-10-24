/**
 * Client-Side PCZT Halo 2 Prover Service (ZIP-374 / ZIP-225)
 * Orchestrates background Web Worker execution for shielded escrow claims and shielding.
 */

export {
  getSharedWorker,
  prewarmProverInBackground,
  proveShieldingInWorker,
  proveEscrowPcztInWorker,
} from "./worker-client";

export interface ProverProgress {
  stage: string;
  percent: number;
  message: string;
}

export interface ClientProvedPczt {
  sighash_hex: string;
  proof_hex: string;
  actions: Array<{
    cv_net_hex: string;
    nullifier_hex: string;
    rk_hex: string;
    cmx_hex: string;
    epk_hex: string;
    enc_ciphertext_hex: string;
    out_ciphertext_hex: string;
  }>;
  anchor_hex: string;
  flags: number;
  value_balance_zatoshis: number;
}
