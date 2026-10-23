"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  ArrowRight,
  Wallet,
  CheckCircle2,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  Clock,
  Clipboard,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Shield,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { connectBrowserWallet, isMobileDevice } from "@/lib/wallet";
import { truncateAddress, getZcashExplorerUrl } from "@/lib/utils";
import { useZecPrice } from "@/lib/price-service";
import { validateZcashAddressFull } from "@/lib/zcash-address";
import { NetworkMismatchAlert } from "@/components/ui/NetworkMismatchAlert";
import { proveEscrowPcztInWorker, prewarmProverInBackground, ProverProgress } from "@/lib/pczt/pczt-client-prover";

export type ClaimModalState =
  | "IDLE"
  | "PREPARING"
  | "PROVING"
  | "FINALIZING"
  | "SUCCESS"
  | "ERROR_RETRY";

export interface ClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  tip?: {
    id: string;
    amountZec: number;
    senderHandle?: string;
    memo?: string;
    isAnonymous: boolean;
    recipientShieldedUa?: string;
    title?: string;
    slug?: string;
    type?: string;
    depositTxid?: string;
    paidTxid?: string;
    fundingTxid?: string;
    forwardTxid?: string;
    claimTxid?: string;
    payoutError?: string;
  } | null;
  onClaimSuccess?: (tipId?: string) => void;
}

function sanitizeErrorMessage(err: any): { friendly: string; technical: string } {
  const raw =
    err?.message ||
    (typeof err === "string" ? err : "An unexpected error occurred during claim.");
  let friendly =
    "The Zcash network may be busy or your proof needs to be resubmitted.";

  const lower = raw.toLowerCase();
  if (lower.includes("mempool") || lower.includes("conflict")) {
    friendly =
      "A transaction is currently processing in the mempool. Please wait a moment and try again.";
  } else if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    raw.includes("504") ||
    raw.includes("502")
  ) {
    friendly =
      "The connection timed out while communicating with the Zcash network. Your funds remain safe in escrow.";
  } else if (lower.includes("insufficient") || lower.includes("balance")) {
    friendly =
      "Escrow balance is synchronizing with latest block confirmations. Please try again shortly.";
  } else if (lower.includes("network error") || lower.includes("failed to fetch")) {
    friendly =
      "Network connection interrupted. Please check your internet connection and try again.";
  } else if (lower.includes("invalid address") || lower.includes("address")) {
    friendly =
      "The destination address could not be validated by the node. Please verify your address.";
  }

  const cleanTech = raw
    .replace(/t1[a-zA-Z0-9]{33}/g, "shielded-vault")
    .slice(0, 300);

  return { friendly, technical: cleanTech };
}

export function ClaimModal({
  isOpen,
  onClose,
  tip,
  onClaimSuccess,
}: ClaimModalProps) {
  const [recipientAddress, setRecipientAddress] = useState("");
  const [claimState, setClaimState] = useState<ClaimModalState>("IDLE");
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Prover progress
  const [proverStage, setProverStage] = useState<string>("");
  const [proverPercent, setProverPercent] = useState<number>(0);
  const [proverMessage, setProverMessage] = useState<string>("");

  // Error handling
  const [errorFriendly, setErrorFriendly] = useState<string>("");
  const [errorTechnical, setErrorTechnical] = useState<string>("");
  const [showTechDetails, setShowTechDetails] = useState<boolean>(false);
  const [inlineNotice, setInlineNotice] = useState<string | null>(null);

  // Receipts / TxIDs
  const [outflowTxid, setOutflowTxid] = useState<string | null>(null);
  const [payoutOpid, setPayoutOpid] = useState<string | null>(null);
  const [copiedOutflow, setCopiedOutflow] = useState(false);
  const [copiedDeposit, setCopiedDeposit] = useState(false);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  useEffect(() => {
    if (isOpen) {
      prewarmProverInBackground();
    }
  }, [isOpen]);

  useEffect(() => {
    if (tip && tip.recipientShieldedUa) {
      setRecipientAddress(tip.recipientShieldedUa);
    } else if (!isOpen) {
      handleResetState();
    }
  }, [tip, isOpen]);

  // Tab guard alert during active cryptographic / network transitions
  const isTransitioning =
    claimState === "PREPARING" ||
    claimState === "PROVING" ||
    claimState === "FINALIZING";

  useEffect(() => {
    if (!isTransitioning) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "Transaction is currently being secured on your device. Leaving now will interrupt the transfer.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isTransitioning]);

  const { formatZecToUsd } = useZecPrice();

  const isLockedAddress = Boolean(tip?.recipientShieldedUa);
  const activeTotalZec = tip?.amountZec || 0;
  const MINING_FEE_ZEC = 0.0001;
  const netReceiveZec = Math.max(
    0,
    Math.round((activeTotalZec - MINING_FEE_ZEC) * 100000000) / 100000000
  );

  const depositTxid =
    tip?.paidTxid ||
    tip?.fundingTxid ||
    tip?.depositTxid ||
    (tip as any)?.txid ||
    null;

  const addressValidation = recipientAddress.trim()
    ? validateZcashAddressFull(recipientAddress.trim(), "mainnet")
    : null;

  const handleResetState = () => {
    setRecipientAddress(tip?.recipientShieldedUa || "");
    setClaimState("IDLE");
    setProverPercent(0);
    setProverStage("");
    setProverMessage("");
    setErrorFriendly("");
    setErrorTechnical("");
    setShowTechDetails(false);
    setInlineNotice(null);
    setOutflowTxid(null);
    setPayoutOpid(null);
  };

  const handleFullClose = () => {
    handleResetState();
    onClose();
  };

  const handleAutoFillWallet = async () => {
    setInlineNotice(null);

    // Mobile UX: 1-tap paste from clipboard
    if (isMobile) {
      try {
        if (!navigator.clipboard?.readText) {
          setInlineNotice("Clipboard access unavailable. Please paste your address manually.");
          return;
        }
        const text = await navigator.clipboard.readText();
        const cleaned = text.trim();
        if (!cleaned) {
          setInlineNotice(
            "Clipboard is empty. Copy your address from your wallet (Zashi, YWallet) first."
          );
          return;
        }
        setRecipientAddress(cleaned);
      } catch {
        setInlineNotice("Clipboard permission denied. Please paste your address into the field.");
      }
      return;
    }

    setIsAutoFilling(true);
    try {
      const res = await connectBrowserWallet();
      if (res.address && res.address !== "shielded_connected") {
        setRecipientAddress(res.address);
      } else {
        setInlineNotice(
          "Please ensure your Zcash browser extension is unlocked, or paste your address manually."
        );
      }
    } catch (err: any) {
      setInlineNotice(
        err.message || "No Zcash browser extension detected. Please paste your address manually."
      );
    } finally {
      setIsAutoFilling(false);
    }
  };

  const handleClaim = async () => {
    if (!recipientAddress.trim() || !tip) return;

    if (addressValidation?.isNetworkMismatch) {
      setInlineNotice("Network Mismatch: You cannot withdraw mainnet funds to a testnet address.");
      return;
    }
    if (addressValidation && !addressValidation.isValid) {
      setInlineNotice(addressValidation.error || "Please enter a valid Zcash address.");
      return;
    }

    setInlineNotice(null);
    setClaimState("PREPARING");
    setProverPercent(10);
    setProverStage("PREPARING");
    setProverMessage("Verifying escrow note and setting up Zcash transaction...");

    const itemPayload: any = {};
    if (tip.slug) {
      itemPayload.paylinkSlug = tip.slug;
    } else if (tip.type === "request" || tip.id?.startsWith("req_")) {
      itemPayload.requestId = tip.id;
    } else {
      itemPayload.tipId = tip.id;
    }

    try {
      // 1. Pure Shielded Claim with Client-Side PCZT (ZIP-374)
      if (addressValidation?.type === "unified") {
        setClaimState("PREPARING");
        setProverPercent(15);
        setProverMessage("Preparing client-side zero-knowledge transaction...");

        const prepRes = await fetch("/api/escrow/pczt-prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...itemPayload,
            destinationAddress: recipientAddress.trim(),
          }),
        });

        const prepData = await prepRes.json().catch(() => ({}));
        if (!prepRes.ok || !prepData.success) {
          throw new Error(prepData.error || "Failed to prepare shielded escrow transaction.");
        }

        setClaimState("PROVING");
        setProverStage("PROVING");
        setProverPercent(25);
        setProverMessage("Generating zero-knowledge proof...");

        const { result: provedResult } = await proveEscrowPcztInWorker(
          prepData.pcztParams,
          (progress: ProverProgress) => {
            setProverStage(progress.stage);
            // Scale progress gracefully between 25% and 85%
            const mappedPercent = Math.max(
              25,
              Math.min(85, Math.round(25 + progress.percent * 0.6))
            );
            setProverPercent(mappedPercent);
            if (progress.stage === "PROVING") {
              setProverMessage("Generating zero-knowledge proof...");
            } else if (progress.stage === "FINALIZING") {
              setProverMessage("Finalizing transaction cryptographic proof...");
            } else {
              setProverMessage(progress.message || "Generating zero-knowledge proof...");
            }
          }
        );

        setClaimState("FINALIZING");
        setProverStage("FINALIZING");
        setProverPercent(95);
        setProverMessage("Submitting shielded transaction to Zcash consensus nodes...");

        const finalizeRes = await fetch("/api/escrow/pczt-finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...itemPayload,
            pcztParams: prepData.pcztParams,
            expiryHeight: prepData.expiryHeight,
            consensusBranchId: prepData.consensusBranchId,
            provedResult,
          }),
        });

        const finalizeData = await finalizeRes.json().catch(() => ({}));
        if (!finalizeRes.ok || !finalizeData.success) {
          throw new Error(finalizeData.error || "Failed to finalize and broadcast transaction.");
        }

        setOutflowTxid(finalizeData.txid || "Broadcasted");
        setClaimState("SUCCESS");
        if (onClaimSuccess) onClaimSuccess(tip.id);
        return;
      }

      // 2. Transparent Outflow Fallback
      let res: Response;
      if (tip.slug) {
        res = await fetch(`/api/paylinks/${tip.slug}/retry-forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipientAddress: recipientAddress.trim() }),
        });
      } else if (tip.type === "request" || tip.id?.startsWith("req_")) {
        res = await fetch(`/api/requests/${tip.id}/retry-forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipientAddress: recipientAddress.trim() }),
        });
      } else {
        res = await fetch(`/api/tips/${tip.id}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientShieldedAddress: recipientAddress.trim(),
          }),
        });
      }

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {
          error:
            res.status === 502 || res.status === 504
              ? "Zero-knowledge proof generation timed out at gateway. Escrow disbursement is processing in the background."
              : `Service response error (${res.status}). Please retry shortly.`,
        };
      }

      if (res.ok && data.success) {
        if (data.status === "PENDING_VERIFICATION") {
          setPayoutOpid(data.payoutOpid || null);
        }
        setOutflowTxid(data.claimTxid || data.forwardTxid || "Broadcasted");
        setClaimState("SUCCESS");
        if (onClaimSuccess) onClaimSuccess(tip.id);
      } else {
        throw new Error(data.error || "Failed to claim funds. Please check the address and try again.");
      }
    } catch (err: any) {
      console.warn("[ClaimModal] Claim error:", err);
      const { friendly, technical } = sanitizeErrorMessage(err);
      setErrorFriendly(friendly);
      setErrorTechnical(technical);
      setClaimState("ERROR_RETRY");
    }
  };

  const handleCopyOutflowTxid = () => {
    const textToCopy = outflowTxid || payoutOpid;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopiedOutflow(true);
    setTimeout(() => setCopiedOutflow(false), 2000);
  };

  const handleCopyDepositTxid = () => {
    if (!depositTxid) return;
    navigator.clipboard.writeText(depositTxid);
    setCopiedDeposit(true);
    setTimeout(() => setCopiedDeposit(false), 2000);
  };

  if (!tip) return null;

  // Modal title and subtitle based on explicit visual state
  const getModalHeader = () => {
    switch (claimState) {
      case "PREPARING":
        return {
          title: "Preparing Secure Transfer...",
          subtitle: "Verifying escrow note and setting up Zcash transaction...",
        };
      case "PROVING":
        return {
          title: "Securing Payment On Your Device...",
          subtitle: "Generating zero-knowledge proof privately in your browser...",
        };
      case "FINALIZING":
        return {
          title: "Broadcasting to Zcash Network...",
          subtitle: "Submitting shielded transaction to Zcash consensus nodes...",
        };
      case "SUCCESS":
        return {
          title: "Transfer Complete!",
          subtitle: "Funds have been successfully dispatched to your wallet.",
        };
      case "ERROR_RETRY":
        return {
          title: "Transfer Couldn't Be Broadcasted",
          subtitle: "Your funds are 100% safe in the escrow vault.",
        };
      case "IDLE":
      default:
        return {
          title: tip.title
            ? `Disburse: ${tip.title}`
            : tip.type === "paylink"
            ? "Disburse PayLink Invoice"
            : tip.type === "request"
            ? "Disburse Payment Request"
            : "Claim Your Shielded Tip",
          subtitle: "Withdraw funds directly to your shielded Orchard or transparent Zcash address.",
        };
    }
  };

  const headerInfo = getModalHeader();

  return (
    <Modal
      isOpen={isOpen}
      onClose={isTransitioning ? () => {} : handleFullClose}
      title={headerInfo.title}
      subtitle={headerInfo.subtitle}
    >
      <div className="space-y-4 text-left">
        {/* ============================================================== */}
        {/* STATE 1: IDLE (Address Input & Summary)                       */}
        {/* ============================================================== */}
        {claimState === "IDLE" && (
          <div className="space-y-4">
            {/* Tip Summary & Net Fee Card */}
            <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl space-y-3 shadow-subtle">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400">
                    Claimable Amount
                  </span>
                  <p className="text-2xl font-mono font-extrabold text-brown-950">
                    {activeTotalZec} <span className="text-base font-bold text-brown-700">ZEC</span>
                  </p>
                  <p className="text-xs text-brown-500 font-mono">
                    ≈ {formatZecToUsd(activeTotalZec)} USD
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400">
                    Sender / Source
                  </span>
                  <p className="text-xs font-bold text-brown-900">
                    {tip.isAnonymous
                      ? "🛡️ Anonymous"
                      : tip.senderHandle
                      ? `@${tip.senderHandle}`
                      : tip.slug
                      ? `PayLink Invoice`
                      : tip.type === "request"
                      ? `Payment Request`
                      : "Supporter"}
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-butter-200/80 flex items-center justify-between text-xs">
                <span className="text-brown-600 font-medium">Network Miner Fee:</span>
                <span className="font-mono text-brown-600 font-semibold">
                  -{MINING_FEE_ZEC} ZEC
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-butter-200/80">
                <span className="text-brown-900 font-bold">Net Payout to Wallet:</span>
                <span className="font-mono text-emerald-850 font-extrabold text-sm">
                  {netReceiveZec} ZEC{" "}
                  <span className="text-xs font-normal text-brown-500 font-sans">
                    ({formatZecToUsd(netReceiveZec)})
                  </span>
                </span>
              </div>
            </div>

            {tip.memo && (
              <div className="p-3 bg-white border border-butter-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400">
                  Memo
                </span>
                <p className="text-xs text-brown-800 italic mt-0.5">&ldquo;{tip.memo}&rdquo;</p>
              </div>
            )}

            {/* Inline validation alert */}
            {inlineNotice && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{inlineNotice}</span>
              </div>
            )}

            {/* Address Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-brown-900">
                  Your Payout Address (u1...)
                </label>
                {isLockedAddress ? (
                  <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    🔒 Locked to settlement address
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleAutoFillWallet}
                    disabled={isAutoFilling}
                    className="text-xs font-bold text-brown-800 hover:text-brown-950 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {isMobile ? (
                      <>
                        <Clipboard className="w-3.5 h-3.5" />
                        <span>Paste from Clipboard</span>
                      </>
                    ) : (
                      <>
                        <Wallet className="w-3.5 h-3.5" />
                        <span>{isAutoFilling ? "Detecting..." : "Autofill Wallet"}</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {isLockedAddress ? (
                <div className="p-2.5 bg-butter-50/60 border border-butter-300 rounded-xl font-mono text-xs text-brown-900 break-all select-all">
                  {recipientAddress}
                </div>
              ) : (
                <Input
                  value={recipientAddress}
                  onChange={(e) => {
                    setRecipientAddress(e.target.value);
                    setInlineNotice(null);
                  }}
                  placeholder="u1... (Your personal shielded Orchard address from Zashi or YWallet)"
                  className={`font-mono text-xs ${
                    addressValidation
                      ? addressValidation.isValid
                        ? "border-emerald-400 focus:ring-emerald-400"
                        : "border-rose-300 focus:ring-rose-300"
                      : ""
                  }`}
                />
              )}

              {/* Dynamic Address Badges */}
              {addressValidation?.isNetworkMismatch ? (
                <NetworkMismatchAlert isNetworkMismatch={true} />
              ) : addressValidation?.isValid ? (
                <div className="space-y-2 pt-1">
                  {addressValidation.type === "unified" ? (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2 text-xs text-emerald-950 animate-in fade-in">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="font-bold">
                          🛡️ 100% Shielded Outflow (Maximum Privacy)
                        </span>
                        <p className="text-[11px] text-emerald-800 leading-snug">
                          Funds disburse directly into your personal Orchard pool with zero on-chain traceability.
                        </p>
                      </div>
                    </div>
                  ) : addressValidation.type === "p2pkh" || addressValidation.type === "p2sh" ? (
                    <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2 text-xs text-amber-950 animate-in fade-in">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="font-bold">
                          ⚠️ Public Exposure Warning (Transparent Outflow)
                        </span>
                        <p className="text-[11px] text-amber-900 leading-snug">
                          Withdrawing to a transparent address exposes your payout amount and destination address on public block explorers. For complete privacy, we strongly recommend using your wallet&apos;s shielded Orchard address (<code className="font-mono font-bold">u1...</code>).
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2 text-xs text-amber-950 animate-in fade-in">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="font-bold">Sapling Address Detected</span>
                        <p className="text-[11px] text-amber-800 leading-snug">
                          Please provide an Orchard Unified address (<code className="font-mono font-bold text-amber-950">u1...</code>) from Zashi or YWallet for secure private withdrawal.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : addressValidation && !addressValidation.isValid && recipientAddress.trim().length >= 10 ? (
                <p className="text-[11px] text-rose-600 flex items-center gap-1 font-medium pt-1">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span>{addressValidation.error || "Please enter a valid Zcash address starting with 'u1' or 't1'"}</span>
                </p>
              ) : (
                <p className="text-[11px] text-brown-500 pt-1">
                  Paste your wallet&apos;s shielded address (starts with u1...) for zero-knowledge private settlement.
                </p>
              )}
            </div>

            <Button
              onClick={handleClaim}
              disabled={
                !recipientAddress.trim() ||
                activeTotalZec <= MINING_FEE_ZEC ||
                Boolean(addressValidation && !addressValidation.isValid) ||
                Boolean(addressValidation?.isNetworkMismatch) ||
                Boolean(
                  addressValidation &&
                    addressValidation.type !== "unified" &&
                    addressValidation.type !== "p2pkh" &&
                    addressValidation.type !== "p2sh"
                )
              }
              variant="primary"
              className="w-full h-11 text-sm font-semibold gap-2 mt-2 shadow-subtle cursor-pointer"
            >
              <span>Disburse {netReceiveZec} ZEC to Wallet</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE 2: PREPARING                                             */}
        {/* ============================================================== */}
        {claimState === "PREPARING" && (
          <div className="space-y-4 py-4 text-center animate-in fade-in">
            <div className="w-14 h-14 bg-butter-100 text-brown-900 rounded-2xl border border-butter-300 mx-auto flex items-center justify-center shadow-subtle">
              <Loader2 className="w-7 h-7 animate-spin text-brown-800" />
            </div>

            <div className="space-y-1">
              <h4 className="text-base font-bold text-brown-950">
                Preparing Secure Transfer...
              </h4>
              <p className="text-xs text-brown-600 max-w-sm mx-auto">
                Verifying escrow note and setting up Zcash transaction...
              </p>
            </div>

            {/* Tab Guard Banner */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2 text-xs text-amber-900 font-medium text-left">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>⚡ Please keep this tab open until your transfer is broadcasted to the network.</span>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE 3: PROVING                                               */}
        {/* ============================================================== */}
        {claimState === "PROVING" && (
          <div className="space-y-4 py-2 text-left animate-in fade-in">
            {/* Tab Guard Banner */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2 text-xs text-amber-900 font-medium animate-pulse">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>⚡ Please keep this tab open until your transfer is broadcasted to the network.</span>
            </div>

            <div className="p-4 bg-butter-50/90 border border-butter-300 rounded-2xl space-y-3 shadow-subtle">
              <div className="flex items-center justify-between text-xs font-bold text-brown-950">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-brown-800 shrink-0" />
                  <span>Securing Payment On Your Device...</span>
                </div>
                <span className="font-mono text-xs font-extrabold text-brown-800">
                  {proverPercent}%
                </span>
              </div>

              {/* Animated Progress Bar */}
              <div className="w-full bg-butter-200/80 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-brown-900 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(10, proverPercent)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-brown-600 font-medium">
                <span>{proverMessage || "Generating zero-knowledge proof..."}</span>
                <span className="text-[10px] text-brown-500">Stage: Halo 2 / Orchard</span>
              </div>

              <div className="p-2.5 bg-white border border-butter-200 rounded-xl flex items-start gap-2 text-[11px] text-brown-800 leading-snug">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  This runs privately in your browser. Your private keys never leave your device.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE 4: FINALIZING                                            */}
        {/* ============================================================== */}
        {claimState === "FINALIZING" && (
          <div className="space-y-4 py-2 text-left animate-in fade-in">
            {/* Tab Guard Banner */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2 text-xs text-amber-900 font-medium">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>⚡ Please keep this tab open until your transfer is broadcasted to the network.</span>
            </div>

            <div className="p-4 bg-butter-50/90 border border-butter-300 rounded-2xl space-y-3 shadow-subtle">
              <div className="flex items-center justify-between text-xs font-bold text-brown-950">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-brown-800 shrink-0" />
                  <span>Broadcasting to Zcash Network...</span>
                </div>
                <span className="font-mono text-xs font-extrabold text-brown-800">95%</span>
              </div>

              <div className="w-full bg-butter-200/80 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-600 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: "95%" }}
                />
              </div>

              <p className="text-[11px] text-brown-700 leading-relaxed font-medium">
                Submitting shielded transaction to Zcash consensus nodes...
              </p>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE 5: SUCCESS (Dual-TxID Receipt Card)                      */}
        {/* ============================================================== */}
        {claimState === "SUCCESS" && (
          <div className="space-y-4 py-2 animate-in fade-in">
            {payoutOpid && !outflowTxid ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2.5 text-center">
                <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-2xl mx-auto flex items-center justify-center">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-amber-950">Payout Submitted & Verifying!</h4>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Your net withdrawal of {netReceiveZec} ZEC was accepted by the Zcash node. Shielded zero-knowledge proofs are generating in the background.
                  </p>
                </div>
                <div className="p-2.5 bg-white rounded-xl border border-amber-200 flex items-center justify-between gap-2 text-left">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400 block">
                      Operation ID
                    </span>
                    <p className="text-xs font-mono font-medium text-brown-800 truncate">
                      {payoutOpid}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyOutflowTxid}
                    className="p-1.5 rounded-lg hover:bg-butter-100 text-brown-700 transition-colors shrink-0"
                    title="Copy OpId"
                  >
                    {copiedOutflow ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-3.5 text-center shadow-subtle">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl mx-auto flex items-center justify-center shadow-sm">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-emerald-950">Transfer Complete!</h4>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Funds have been successfully dispatched to your wallet.
                  </p>
                </div>

                {/* Dual-TxID Receipt Card */}
                <div className="bg-white rounded-2xl border border-emerald-200 p-3 space-y-2.5 text-left text-xs shadow-subtle">
                  {/* Row 1: Deposit TxID if available */}
                  {depositTxid && (
                    <div className="p-2 bg-butter-50/70 rounded-xl border border-butter-200 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-brown-500 flex items-center gap-1">
                          <ArrowDownLeft className="w-3 h-3 text-brown-600" />
                          <span>📥 Deposit (Funding TxID)</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleCopyDepositTxid}
                            className="p-1 rounded hover:bg-butter-200 text-brown-600 transition-colors"
                            title="Copy Deposit TxID"
                          >
                            {copiedDeposit ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <a
                            href={getZcashExplorerUrl(depositTxid)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded hover:bg-butter-200 text-brown-600 transition-colors inline-flex items-center"
                            title="View on Zcash Block Explorer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                      <p className="font-mono text-xs text-brown-900 truncate">
                        {truncateAddress(depositTxid, 12, 10)}
                      </p>
                    </div>
                  )}

                  {/* Row 2: Outflow TxID (Disbursement) */}
                  {outflowTxid && (
                    <div className="p-2 bg-emerald-50/50 rounded-xl border border-emerald-200 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                          <ArrowUpRight className="w-3 h-3 text-emerald-600" />
                          <span>📤 Disbursed (Outflow TxID)</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleCopyOutflowTxid}
                            className="p-1 rounded hover:bg-emerald-100 text-emerald-700 transition-colors"
                            title="Copy Outflow TxID"
                          >
                            {copiedOutflow ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {outflowTxid !== "Broadcasted" && (
                            <a
                              href={getZcashExplorerUrl(outflowTxid)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded hover:bg-emerald-100 text-emerald-700 transition-colors inline-flex items-center"
                              title="View on Zcash Block Explorer"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      <p className="font-mono text-xs text-emerald-950 truncate font-semibold">
                        {outflowTxid === "Broadcasted"
                          ? "Broadcasted to network"
                          : truncateAddress(outflowTxid, 12, 10)}
                      </p>
                    </div>
                  )}

                  {/* Net received info */}
                  <div className="pt-1 flex items-center justify-between text-[11px] text-brown-600 border-t border-butter-200">
                    <span>Net Received:</span>
                    <span className="font-mono font-bold text-emerald-850">
                      {netReceiveZec} ZEC ({formatZecToUsd(netReceiveZec)})
                    </span>
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={handleFullClose}
              variant="outline"
              className="w-full h-10 text-xs font-semibold cursor-pointer"
            >
              Done
            </Button>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE 6: ERROR_RETRY (Graceful Failure & Resilient Recovery)    */}
        {/* ============================================================== */}
        {claimState === "ERROR_RETRY" && (
          <div className="space-y-4 py-2 animate-in fade-in">
            <div className="p-4 bg-amber-50/80 border border-amber-300 rounded-2xl space-y-3 text-left shadow-subtle">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-amber-100 text-amber-800 rounded-xl border border-amber-300 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-amber-950">
                    Transfer Couldn&apos;t Be Broadcasted
                  </h4>
                  <p className="text-xs text-amber-900 leading-relaxed">
                    Your funds are 100% safe in the escrow vault. The Zcash network may be busy or your proof needs to be resubmitted.
                  </p>
                </div>
              </div>

              {/* Friendly error message */}
              <div className="p-2.5 bg-white rounded-xl border border-amber-200 text-xs text-amber-900 font-medium">
                {errorFriendly || "Temporary network issue. Your escrow balance remains untouched."}
              </div>

              {/* Collapsible Technical Details */}
              {errorTechnical && (
                <div className="space-y-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowTechDetails(!showTechDetails)}
                    className="text-[11px] font-semibold text-brown-600 hover:text-brown-900 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>Technical Details</span>
                    {showTechDetails ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {showTechDetails && (
                    <div className="p-2.5 bg-butter-50/80 rounded-xl border border-butter-200 font-mono text-[10px] text-brown-700 break-all select-all leading-normal">
                      {errorTechnical}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons: Try Again vs Close */}
            <div className="space-y-2">
              <Button
                onClick={handleClaim}
                variant="primary"
                className="w-full h-11 text-xs font-bold gap-2 shadow-subtle cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Transfer</span>
              </Button>

              <Button
                onClick={handleFullClose}
                variant="ghost"
                className="w-full h-9 text-xs text-brown-600 hover:text-brown-950 cursor-pointer"
              >
                Close & Claim Later from Dashboard
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
