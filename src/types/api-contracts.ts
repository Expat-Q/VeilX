// Shared API Contracts: src/types/api-contracts.ts
import { ShieldingPcztParams, OrchardActionBundle } from "./pczt";

// POST /api/escrow/pczt-prepare
export interface PcztPrepareRequest {
  tipId?: string;
  paylinkSlug?: string;
  requestId?: string;
  destinationAddress: string; // Validated Unified or Orchard address
}

export interface PcztPrepareResponse {
  success: boolean;
  pcztParams?: ShieldingPcztParams;
  error?: string;
}

// POST /api/escrow/pczt-finalize
export interface PcztFinalizeRequest {
  tipId?: string;
  paylinkSlug?: string;
  requestId?: string;
  destinationAddress: string;
  proofBundle: OrchardActionBundle;
}

export interface PcztFinalizeResponse {
  success: boolean;
  txid?: string; // Genuine 64-char hex transaction ID
  explorerUrl?: string;
  status?: "SETTLED" | "BROADCAST_CONFIRMING";
  error?: string;
}
