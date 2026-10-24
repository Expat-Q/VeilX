"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ShieldCheck,
  Check,
  Copy,
  Loader2,
  XCircle,
  Smartphone,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { QRDisplay } from "@/components/ui/QRDisplay";
import { Button } from "@/components/ui/Button";
import { useZecPrice } from "@/lib/price-service";
import { buildZip321Uri } from "@/lib/wallet";
import { InvoiceReceiptCard } from "@/components/ui/InvoiceReceiptCard";
import { getZcashExplorerUrl, truncateAddress } from "@/lib/utils";
import {
  proveShieldingInWorker,
  prewarmProverInBackground,
} from "@/lib/pczt/worker-client";
import { ProverWorkerProgressOutput } from "@/types/pczt";

export default function RequestDetailsPage() {
  const params = useParams();
  const requestId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isPaid, setIsPaid] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [manualTxid, setManualTxid] = useState("");
  const [submittedTxid, setSubmittedTxid] = useState("");
  const [copiedTxid, setCopiedTxid] = useState(false);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [showManualHandoff, setShowManualHandoff] = useState(false);

  const { formatZecToUsd } = useZecPrice();

  const [requestData, setRequestData] = useState<{
    _id: string;
    requesterUsernameSnapshot: string;
    targetUsernameSnapshot: string;
    amountZec: number;
    memo?: string;
    recipientShieldedUa: string;
    escrowDepositAddress?: string;
    status: string;
    paidTxid?: string;
    confirmations?: number;
    forwardTxid?: string;
  } | null>(null);

  useEffect(() => {
    if (!requestId) return;
    setIsLoading(true);

    const fetchRequest = () => {
      fetch(`/api/requests/${requestId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.request) {
            setRequestData(data.request);
            if (data.request.status === "CANCELLED") {
              setIsCancelled(true);
              setIsSettling(false);
            } else {
              // SEC-03, FE-01: Decouple settlement from receipt.
              // Only confirm isPaid when forwardTxid is verified on-chain.
              const hasVerifiedForward = Boolean(data.request.forwardTxid);
              const isConfirmedSettled =
                (data.request.status === "FULFILLED" ||
                  data.request.status === "PAID" ||
                  data.request.status === "SETTLED") &&
                hasVerifiedForward;

              if (isConfirmedSettled) {
                setIsPaid(true);
                setIsSettling(false);
              } else if (
                data.request.status === "SETTLING" ||
                data.request.status === "FORWARD_PENDING" ||
                Boolean(data.request.paidTxid)
              ) {
                setIsPaid(false);
                setIsSettling(true);
              }
            }
          }
        })
        .catch((e) => console.warn("Fetch request:", e))
        .finally(() => setIsLoading(false));
    };

    fetchRequest();
    prewarmProverInBackground();

    // Poll every 3.5 seconds to track status and forward confirmations
    const interval = setInterval(() => {
      if (!isCancelled && !requestData?.forwardTxid && !isProvingRef.current) {
        fetchRequest();
      }
    }, 3500);

    return () => clearInterval(interval);
  }, [requestId, isCancelled, requestData?.forwardTxid]);

  const [proverStage, setProverStage] = useState<string>("");
  const [proverPercent, setProverPercent] = useState<number>(0);
  const [proverMessage, setProverMessage] = useState<string>("");
  const isProvingRef = useRef(false);

  const activeDepositTxid = requestData?.paidTxid || submittedTxid || manualTxid;

  // Background auto-forwarding attempt (non-blocking for payer)
  useEffect(() => {
    const hasDetectedPayment = Boolean(activeDepositTxid || isSettling);
    if (!hasDetectedPayment || requestData?.forwardTxid || isProvingRef.current || !requestId) {
      return;
    }

    let cancelled = false;

    const attemptAutoProve = async () => {
      // Wait for at least 1 confirmation
      if (requestData?.paidTxid && (!requestData.confirmations || requestData.confirmations < 1)) {
        setProverStage("AWAITING_CONFIRMATION");
        setProverPercent(15);
        setProverMessage("Payment detected! Confirming on Zcash network...");
        return;
      }

      try {
        isProvingRef.current = true;
        setProverStage("PREPARING");
        setProverPercent(20);
        setProverMessage("Preparing secure shielded transfer to requester...");

        const prepRes = await fetch("/api/escrow/pczt-prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
        });
        const prepData = await prepRes.json().catch(() => ({}));
        if (cancelled || !prepRes.ok || !prepData.success || !prepData.pcztParams) {
          isProvingRef.current = false;
          return;
        }

        setProverStage("PROVING");
        setProverPercent(35);
        setProverMessage("Securing payment on your device (Halo 2 ZK proof)...");

        const proverResult = await proveShieldingInWorker(
          prepData.pcztParams,
          (progress: ProverWorkerProgressOutput) => {
            if (cancelled) return;
            setProverStage(progress.stage);
            setProverPercent(progress.percent);
            setProverMessage(progress.message);
          }
        );

        if (cancelled) return;

        setProverStage("FINALIZING");
        setProverPercent(95);
        setProverMessage("Broadcasting shielded disbursement to Zcash network...");

        const finalizeRes = await fetch("/api/escrow/pczt-finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            destinationAddress: requestData?.recipientShieldedUa,
            proofBundle: proverResult.orchardActionBundle,
            pcztParams: prepData.pcztParams,
          }),
        });
        const finalizeData = await finalizeRes.json().catch(() => ({}));
        if (finalizeRes.ok && finalizeData.success && finalizeData.txid) {
          setRequestData((prev) =>
            prev
              ? {
                  ...prev,
                  forwardTxid: finalizeData.txid,
                  status: "FULFILLED",
                }
              : null
          );
          setIsPaid(true);
          setIsSettling(false);
        }
      } catch (err) {
        console.warn("[AutoForwarder] Client proof attempt:", err);
      } finally {
        isProvingRef.current = false;
      }
    };

    attemptAutoProve();

    return () => {
      cancelled = true;
    };
  }, [isSettling, requestId, requestData?.confirmations, requestData?.paidTxid, requestData?.forwardTxid, activeDepositTxid]);

  const handleDecline = async () => {
    setIsDeclining(true);
    setDeclineError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/reject`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsCancelled(true);
        setIsSettling(false);
      } else {
        setDeclineError(data.error || "Failed to decline request. (You must be the recipient or creator)");
      }
    } catch (err: any) {
      setDeclineError(err.message || "Failed to decline request.");
    } finally {
      setIsDeclining(false);
    }
  };

  const handleManualSettle = async () => {
    const clean = manualTxid.trim();
    if (!clean) return;
    setIsSubmittingManual(true);
    setManualError(null);

    try {
      setSubmittedTxid(clean);
      // SEC-03: Switch to SETTLING state. Do NOT trigger false isPaid success.
      setIsSettling(true);
      setIsPaid(false);

      const res = await fetch(`/api/requests/${requestId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidTxid: clean }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.request) {
        setRequestData(data.request);
        if (data.request.forwardTxid && (data.request.status === "FULFILLED" || data.request.status === "SETTLED")) {
          setIsPaid(true);
          setIsSettling(false);
        }
      }
    } catch (e: any) {
      console.warn("Manual settle submit:", e);
    } finally {
      setIsSubmittingManual(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-butter-100 flex items-center justify-center p-4">
        <div className="flex items-center gap-2 text-brown-900 font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading payment request...</span>
        </div>
      </div>
    );
  }

  if (!requestData) {
    return (
      <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-4 sm:p-6 text-left">
        <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-6 sm:p-8 shadow-modal text-center space-y-5">
          <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl border border-rose-200 mx-auto flex items-center justify-center">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-brown-950">Payment Request Not Found</h2>
            <p className="text-xs text-brown-600 leading-relaxed">
              This payment request does not exist, has expired, or may have been deleted.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center w-full py-3 px-4 rounded-full bg-brown-900 text-white font-bold text-xs hover:bg-brown-950 transition-all shadow-subtle"
          >
            Return to VeilX Home
          </Link>
        </div>
      </div>
    );
  }

  const request = requestData;
  const isSettlementInProgress = !isPaid && (isSettling || Boolean(activeDepositTxid) || request.status === "SETTLING" || request.status === "FORWARD_PENDING");

  return (
    <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-4 sm:p-6 text-left">
      <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-6 sm:p-7 shadow-modal space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-butter-200">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brown-600 hover:text-brown-950 transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to VeilX</span>
          </Link>
          <span className="text-[11px] font-mono font-bold text-brown-900 bg-butter-50 px-2.5 py-0.5 rounded-full border border-butter-300">
            Direct Request
          </span>
        </div>

        {isCancelled ? (
          <div className="py-6 text-center space-y-4 animate-in fade-in zoom-in-95">
            <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl border border-rose-200 mx-auto flex items-center justify-center shadow-subtle">
              <XCircle className="w-8 h-8" />
            </div>

            <div>
              <h4 className="text-xl font-bold text-brown-950">Request Declined</h4>
              <p className="text-xs text-brown-500 mt-1 max-w-xs mx-auto">
                This payment request has been cancelled and can no longer be settled.
              </p>
            </div>

            <Link href="/" className="block pt-2">
              <Button variant="outline" className="w-full cursor-pointer">
                Go to VeilX Home
              </Button>
            </Link>
          </div>
        ) : isSettlementInProgress ? (
          /* ============================================================== */
          /* VIEW 1: SETTLING PROGRESS CARD (SEC-03, FE-01)                 */
          /* ============================================================== */
          <div className="space-y-5 animate-in fade-in zoom-in-95">
            <div className="p-5 bg-butter-50 border border-butter-300 rounded-3xl space-y-4 text-center shadow-subtle">
              <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" />
                <div className="w-14 h-14 bg-amber-100 text-amber-900 rounded-2xl border border-amber-300 flex items-center justify-center shadow-sm">
                  <Loader2 className="w-7 h-7 animate-spin text-amber-700" />
                </div>
              </div>

              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-950 border border-amber-300 text-xs font-bold mb-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>Settlement in Progress</span>
                </div>
                <h4 className="text-lg font-bold text-brown-950">
                  Payment detected! Settling shielded payout...
                </h4>
                <p className="text-xs text-brown-600 max-w-sm mx-auto leading-relaxed">
                  Your payment has been received. VeilX is generating a zero-knowledge proof to forward funds directly into @{request.requesterUsernameSnapshot}&apos;s private Orchard wallet.
                </p>
              </div>

              {/* Live Real-Time Proving Progress Bar */}
              <div className="p-3.5 bg-white border border-butter-300 rounded-2xl space-y-2.5 text-left shadow-subtle">
                <div className="flex items-center justify-between text-xs font-bold text-brown-900">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-brown-700" />
                    <span>{proverStage || "PROVING"}</span>
                  </span>
                  <span className="font-mono text-xs font-extrabold text-brown-800">
                    {Math.max(15, proverPercent)}%
                  </span>
                </div>

                <div className="w-full bg-butter-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-brown-900 h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(15, proverPercent)}%` }}
                  />
                </div>

                <p className="text-[11px] text-brown-600 font-medium">
                  {proverMessage || "Securing zero-knowledge proof for private shielded disbursement..."}
                </p>
              </div>

              {/* Deposit TxID Display */}
              {activeDepositTxid && (
                <div className="p-3 bg-white border border-butter-200 rounded-2xl space-y-1 text-left shadow-subtle">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400">
                      Deposit Transaction Hash (txid)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(activeDepositTxid);
                          setCopiedTxid(true);
                          setTimeout(() => setCopiedTxid(false), 2000);
                        }}
                        className="text-[11px] font-semibold text-brown-700 hover:text-brown-950 flex items-center gap-1 transition-colors"
                      >
                        {copiedTxid ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedTxid ? "Copied" : "Copy"}</span>
                      </button>
                      <a
                        href={getZcashExplorerUrl(activeDepositTxid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-brown-700 hover:text-brown-950 flex items-center gap-1 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Explorer</span>
                      </a>
                    </div>
                  </div>
                  <p className="font-mono text-xs text-brown-900 truncate font-semibold">
                    {truncateAddress(activeDepositTxid, 14, 12)}
                  </p>
                </div>
              )}

              {/* Privacy Invariant Assurance */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-950 text-left">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold">🛡️ Genuine Shielded Payout</span>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    Zero transparent recipient outputs are created. Funds disburse strictly into shielded Orchard notes.
                  </p>
                </div>
              </div>

              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-center gap-2 text-[11px] text-amber-900 font-medium animate-pulse">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Please keep this window open while shielded settlement finalizes.</span>
              </div>
            </div>
          </div>
        ) : !isPaid ? (
          /* ============================================================== */
          /* VIEW 2: UNPAID REQUEST & QR PAYMENT                            */
          /* ============================================================== */
          <div className="space-y-5">
            {/* Request Summary Card */}
            <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl space-y-2.5 shadow-subtle">
              <div className="flex justify-between items-center text-xs">
                <span className="text-brown-500">Requested by:</span>
                <span className="font-bold text-brown-950">
                  @{request.requesterUsernameSnapshot}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-brown-500">Target:</span>
                <span className="font-bold text-brown-800">
                  @{request.targetUsernameSnapshot}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-butter-200">
                <span className="text-xs text-brown-500">Amount:</span>
                <div className="text-right">
                  <span className="font-mono font-bold text-2xl text-brown-950">
                    {request.amountZec} ZEC
                  </span>
                  <span className="block text-[11px] font-mono text-brown-500">
                    ≈ {formatZecToUsd(request.amountZec)} USD
                  </span>
                </div>
              </div>
              {request.memo && (
                <div className="pt-2 border-t border-butter-200 text-xs text-brown-700 italic">
                  &ldquo;{request.memo}&rdquo;
                </div>
              )}
            </div>

            {declineError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                {declineError}
              </div>
            )}

            {/* QR Payment Handoff */}
            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-950 text-left mb-3 shadow-subtle">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-emerald-900">🛡️ Direct Shielded Inflow (100% Private)</span>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Scan using your mobile Zcash wallet (Zashi, YWallet, or Noir). Your payment is held in an isolated single-use escrow before shielded disbursement.
                </p>
              </div>
            </div>

            {/* FE-02: Address Hygiene. Show dynamic derived escrow address or clean loading state */}
            {request.escrowDepositAddress ? (
              <QRDisplay
                value={buildZip321Uri({
                  address: request.escrowDepositAddress,
                  amountZec: request.amountZec,
                  memo: request.memo || "VeilX Payment Request",
                })}
                address={request.escrowDepositAddress}
                amountZec={request.amountZec}
                memo={request.memo || "VeilX Payment Request"}
                onPaymentConfirmed={async (txid) => {
                  try {
                    setSubmittedTxid(txid);
                    // SEC-03: Transition to SETTLING, do not show false receipt
                    setIsSettling(true);
                    setIsPaid(false);
                    const res = await fetch(`/api/requests/${requestId}/settle`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ paidTxid: txid }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok && data.success && data.request) {
                      setRequestData(data.request);
                      if (data.request.forwardTxid) {
                        setIsPaid(true);
                        setIsSettling(false);
                      }
                    }
                  } catch (e: any) {
                    console.warn("Failed to notify server of payment:", e);
                  }
                }}
              />
            ) : (
              <div className="p-8 bg-butter-50 border border-butter-200 rounded-2xl flex flex-col items-center justify-center text-center space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-brown-700" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-brown-950">Generating Shielded Escrow Address...</p>
                  <p className="text-[11px] text-brown-500">Deriving unique deterministic escrow address for this request.</p>
                </div>
              </div>
            )}

            {/* Mobile Receipt Handoff Accordion */}
            <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl space-y-2.5 text-left shadow-subtle">
              <button
                type="button"
                onClick={() => setShowManualHandoff(!showManualHandoff)}
                className="w-full flex items-center justify-between text-xs font-bold text-brown-900 hover:text-brown-950 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-brown-600" />
                  <span>Paid using Mobile Wallet (Zashi / YWallet)?</span>
                </div>
                {showManualHandoff ? (
                  <ChevronUp className="w-4 h-4 text-brown-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-brown-500" />
                )}
              </button>

              {showManualHandoff && (
                <div className="space-y-2.5 pt-1 animate-in fade-in">
                  <p className="text-[11px] text-brown-600 leading-relaxed">
                    Paste the 64-character transaction hash (txid) from your wallet to verify and complete this request on-chain:
                  </p>

                  <div className="space-y-1.5">
                    <input
                      type="text"
                      placeholder="e.g. 8f4a2c91834... (Transaction Hash)"
                      value={manualTxid}
                      onChange={(e) => {
                        setManualTxid(e.target.value);
                        setManualError(null);
                      }}
                      className="w-full h-10 px-3 bg-white border border-butter-300 rounded-xl font-mono text-xs text-brown-950 placeholder:text-brown-400 focus:outline-none focus:border-brown-900 focus:ring-1 focus:ring-brown-900"
                    />
                    {manualError && (
                      <p className="text-[11px] text-rose-600 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span>{manualError}</span>
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={handleManualSettle}
                    disabled={!manualTxid.trim() || isSubmittingManual}
                    isLoading={isSubmittingManual}
                    variant="primary"
                    className="w-full h-9 text-xs font-bold cursor-pointer"
                  >
                    <span>Verify & Settle Request</span>
                  </Button>
                </div>
              )}
            </div>

            {/* Decline Option */}
            <div className="pt-1 text-center">
              <Button
                onClick={handleDecline}
                variant="ghost"
                className="w-full text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-9 cursor-pointer"
                isLoading={isDeclining}
              >
                Decline / Cancel Request
              </Button>
            </div>
          </div>
        ) : (
          /* ========================================================== */
          /* VIEW 3: VERIFIED RECEIPT SCREEN (ONLY ON CONFIRMED SETTLED)*/
          /* ========================================================== */
          <div className="py-2 text-center space-y-4 animate-in fade-in zoom-in-95">
            <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-200 mx-auto flex items-center justify-center shadow-subtle">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h4 className="text-xl font-bold text-brown-950">
                Payment Confirmed! Receipt Generated
              </h4>
              <p className="text-xs text-brown-500 max-w-xs mx-auto">
                Payment sent to <strong>@{request.requesterUsernameSnapshot}</strong>.
              </p>
            </div>

            {/* Verified Delivery Status Indicator */}
            {request.forwardTxid && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-950 shadow-subtle text-left">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold">Delivered to recipient!</span>
                </div>
                <a
                  href={getZcashExplorerUrl(request.forwardTxid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-emerald-800 hover:text-emerald-950 flex items-center gap-1 underline"
                >
                  <span>Tx: {truncateAddress(request.forwardTxid, 5, 4)}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {/* Deposit TxID Card */}
            {activeDepositTxid && (
              <div className="p-2.5 bg-butter-50/80 rounded-xl border border-butter-200 text-left text-xs flex items-center justify-between gap-2 shadow-subtle">
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400 block">
                    Deposit Transaction Hash (txid)
                  </span>
                  <p className="font-mono text-xs text-brown-900 truncate font-semibold">
                    {truncateAddress(activeDepositTxid, 12, 10)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(activeDepositTxid);
                      setCopiedTxid(true);
                      setTimeout(() => setCopiedTxid(false), 2000);
                    }}
                    className="p-1.5 rounded-lg hover:bg-butter-100 text-brown-700 transition-colors cursor-pointer"
                    title="Copy Txid"
                  >
                    {copiedTxid ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={getZcashExplorerUrl(activeDepositTxid)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg hover:bg-butter-100 text-brown-700 transition-colors inline-flex items-center"
                    title="View on Zcash Block Explorer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}

            {/* Payout Breakdown Pill */}
            <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl space-y-1.5 text-xs text-left shadow-subtle font-mono">
              <div className="flex justify-between items-center text-brown-600">
                <span>Amount Paid:</span>
                <span>{request.amountZec} ZEC</span>
              </div>
              <div className="flex justify-between items-center text-brown-500 text-[11px]">
                <span>Zcash Miner Fee:</span>
                <span>-0.0001 ZEC</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-butter-200 text-emerald-800 font-bold text-xs">
                <span>Net Delivered to Wallet:</span>
                <span>{Math.max(0, Math.round((request.amountZec - 0.0001) * 100000000) / 100000000)} ZEC</span>
              </div>
            </div>

            {/* Downloadable Official Receipt Card */}
            <InvoiceReceiptCard
              type="request"
              recipientUsername={request.requesterUsernameSnapshot}
              amountZec={request.amountZec}
              amountUsd={formatZecToUsd(request.amountZec)}
              txid={request.forwardTxid || activeDepositTxid || undefined}
              escrowAddress={request.escrowDepositAddress || request.recipientShieldedUa}
              memo={request.memo}
              payerUsername={request.targetUsernameSnapshot}
            />

            <Link href="/" className="block pt-2">
              <Button variant="outline" className="w-full cursor-pointer">
                Go to VeilX Home
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
