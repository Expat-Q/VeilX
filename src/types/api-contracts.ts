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
  destinationAddress?: string;
  proofBundle: OrchardActionBundle;
  pcztSignedHex?: string;
  expiryHeight?: number;
}

export interface PcztFinalizeResponse {
  success: boolean;
  txid?: string; // Genuine 64-char hex transaction ID
  explorerUrl?: string;
  status?: "SETTLED" | "BROADCAST_CONFIRMING";
  error?: string;
}

// POST /api/tips
export interface CreateTipRequest {
  recipientUsername: string;
  recipientXUserId?: string;
  amountZec: number;
  isAnonymous?: boolean;
  memo?: string;
}

export interface CreateTipResponse {
  success: boolean;
  tip?: any;
  error?: string;
}

// POST /api/tips/[id]/claim
export interface ClaimTipRequest {
  recipientShieldedAddress: string;
}

export interface ClaimTipResponse {
  success: boolean;
  tip?: any;
  claimTxid?: string;
  status?: string;
  payoutOpid?: string;
  message?: string;
  error?: string;
}

// POST /api/tips/claim-all
export interface ClaimAllTipsRequest {
  recipientShieldedAddress: string;
}

export interface ClaimAllTipsResponse {
  success: boolean;
  count?: number;
  totalCount?: number;
  totalAmountZec?: number;
  results?: Array<{
    tipId: string;
    success: boolean;
    claimTxid?: string;
    error?: string;
  }>;
  tips?: any[];
  message?: string;
  error?: string;
}

// POST /api/paylinks
export interface CreatePayLinkRequest {
  title: string;
  amountZec: number;
  recipientShieldedUa: string;
}

export interface CreatePayLinkResponse {
  success: boolean;
  paylink?: any;
  error?: string;
}

// POST /api/paylinks/[slug]/settle
export interface SettlePayLinkRequest {
  paidTxid: string;
}

export interface SettlePayLinkResponse {
  success: boolean;
  paylink?: any;
  message?: string;
  error?: string;
}

// POST /api/requests
export interface CreatePaymentRequestRequest {
  targetUsername: string;
  targetXUserId?: string;
  amountZec: number;
  memo?: string;
  recipientShieldedUa: string;
}

export interface CreatePaymentRequestResponse {
  success: boolean;
  request?: any;
  error?: string;
}

// POST /api/requests/[id]/settle
export interface SettlePaymentRequestRequest {
  paidTxid: string;
}

export interface SettlePaymentRequestResponse {
  success: boolean;
  request?: any;
  message?: string;
  error?: string;
}
