"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Inbox,
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
} from "lucide-react";
import { QRDisplay } from "@/components/ui/QRDisplay";
import { Button } from "@/components/ui/Button";
import { useZecPrice } from "@/lib/price-service";
import { buildZip321Uri } from "@/lib/wallet";
import { InvoiceReceiptCard } from "@/components/ui/InvoiceReceiptCard";
import { getZcashExplorerUrl } from "@/lib/utils";

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
            if (data.request.status === "FULFILLED" || data.request.status === "FORWARD_PENDING") {
              setIsPaid(true);
              setIsSettling(false);
            } else if (data.request.status === "CANCELLED") {
              setIsCancelled(true);
              setIsSettling(false);
            } else if (data.request.status === "SETTLING") {
              setIsSettling(true);
            }
          }
        })
        .catch((e) => console.warn("Fetch request:", e))
        .finally(() => setIsLoading(false));
    };

    fetchRequest();

    // Poll every 4 seconds to auto-detect payment and block confirmation
    const interval = setInterval(() => {
      if (!isPaid && !isCancelled) {
        fetchRequest();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [requestId, isPaid, isCancelled]);

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
      const res = await fetch(`/api/requests/${requestId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidTxid: clean }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.request?.status === "FULFILLED" || data.request?.status === "FORWARD_PENDING") {
          setIsPaid(true);
          setIsSettling(false);
        } else {
          setIsSettling(true);
        }
      } else {
        setManualError(data.error || "Failed to verify transaction. Please ensure the transaction has mined.");
      }
    } catch (e: any) {
      setManualError(e.message || "Network error. Failed to reach verification service.");
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

  return (
    <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-4 sm:p-6 text-left">
      <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-6 sm:p-7 shadow-modal space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-butter-200">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brown-600 hover:text-brown-950 transition-all"
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
            <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl border border-rose-200 mx-auto flex items-center justify-center">
              <XCircle className="w-8 h-8" />
            </div>

            <div>
              <h4 className="text-xl font-bold text-brown-950">Request Declined</h4>
              <p className="text-xs text-brown-500 mt-1 max-w-xs mx-auto">
                This payment request has been cancelled and can no longer be settled.
              </p>
            </div>

            <Link href="/" className="block pt-2">
              <Button variant="outline" className="w-full">
                Go to VeilX Home
              </Button>
            </Link>
          </div>
        ) : !isPaid ? (
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

            {isSettling ? (
              <div className="p-5 bg-butter-50 border border-butter-200 rounded-3xl space-y-4 text-center shadow-subtle animate-in fade-in zoom-in-95">
                <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" />
                  <div className="w-14 h-14 bg-amber-100 text-amber-800 rounded-2xl border border-amber-300 flex items-center justify-center shadow-sm">
                    <Loader2 className="w-7 h-7 animate-spin text-amber-700" />
                  </div>
                </div>

                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold mb-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span>Payment Broadcasted on Zcash Blockchain</span>
                  </div>
                  <h4 className="text-lg font-bold text-brown-950">Awaiting 1 Block Confirmation</h4>
                  <p className="text-xs text-brown-600 mt-1 max-w-sm mx-auto leading-relaxed">
                    Your shielded payment has been detected in the mempool! Zcash consensus requires 1 confirmed block to seal your note into the Orchard Merkle tree before private forwarding to @{request.requesterUsernameSnapshot}.
                  </p>
                </div>

                {(() => {
                  const activeTxid = request.paidTxid || submittedTxid || manualTxid;
                  if (!activeTxid) return null;
                  return (
                    <div className="p-3 bg-white border border-butter-300 rounded-2xl space-y-1.5 text-left shadow-subtle">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-brown-500 uppercase tracking-wider">
                          Transaction Hash (txid)
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(activeTxid);
                              setCopiedTxid(true);
                              setTimeout(() => setCopiedTxid(false), 2000);
                            }}
                            className="text-[11px] font-semibold text-brown-700 hover:text-brown-950 flex items-center gap-1 transition-colors"
                          >
                            {copiedTxid ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedTxid ? "Copied" : "Copy"}</span>
                          </button>
                          <a
                            href={getZcashExplorerUrl(activeTxid)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-semibold text-brown-700 hover:text-brown-950 flex items-center gap-1 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Explorer</span>
                          </a>
                        </div>
                      </div>
                      <p className="font-mono text-xs text-brown-950 break-all bg-butter-50/50 p-2 rounded-xl border border-butter-200">
                        {activeTxid}
                      </p>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <span className="text-[10px] uppercase font-bold text-emerald-700 block">1. Broadcast</span>
                    <span className="text-xs font-bold text-emerald-950 flex items-center justify-center gap-1 mt-0.5">
                      ✓ Sent
                    </span>
                  </div>
                  <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl">
                    <span className="text-[10px] uppercase font-bold text-amber-700 block">2. On-Chain Seal</span>
                    <span className="text-xs font-bold text-amber-950 flex items-center justify-center gap-1 mt-0.5">
                      <Loader2 className="w-3 h-3 animate-spin text-amber-700" /> Confirming
                    </span>
                  </div>
                  <div className="p-2.5 bg-butter-100 border border-butter-200 rounded-xl text-brown-400">
                    <span className="text-[10px] uppercase font-bold text-brown-400 block">3. Shielded Delivery</span>
                    <span className="text-xs font-bold text-brown-500 block mt-0.5">Auto-disburse</span>
                  </div>
                </div>

                <p className="text-[11px] text-brown-500 italic">
                  This page automatically updates in real-time. You can safely close or remain on this tab.
                </p>
              </div>
            ) : (
              <>
                {/* QR Payment Handoff */}
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-950 text-left mb-3 shadow-subtle">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-bold">🛡️ Shielded Payment Required</span>
                    <p className="text-[11px] text-emerald-800 leading-relaxed">
                      Please pay this request using your shielded wallet (Zashi, YWallet, or Noir). Your personal address and balance are never revealed.
                    </p>
                  </div>
                </div>
                {(() => {
                  const depositAddress = request.escrowDepositAddress;
                  if (!depositAddress) return null;
                  return (
                    <QRDisplay
                      value={buildZip321Uri({
                        address: depositAddress,
                        amountZec: request.amountZec,
                        memo: request.memo || "VeilX Payment Request",
                      })}
                      address={depositAddress}
                      amountZec={request.amountZec}
                      memo={request.memo || "VeilX Payment Request"}
                      onPaymentConfirmed={async (txid) => {
                        try {
                          setSubmittedTxid(txid);
                          const res = await fetch(`/api/requests/${requestId}/settle`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ paidTxid: txid }),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (res.ok && data.success) {
                            if (data.request?.status === "FULFILLED" || data.request?.status === "FORWARD_PENDING") {
                              setIsPaid(true);
                              setIsSettling(false);
                            } else {
                              setIsSettling(true);
                            }
                          } else {
                            setManualError(data.error || "Payment verification failed on server.");
                          }
                        } catch (e: any) {
                          console.warn("Failed to notify server of payment:", e);
                          setManualError(e.message || "Failed to reach server for settlement verification.");
                        }
                      }}
                    />
                  );
                })()}

                {/* Mobile Receipt Handoff Accordion */}
                <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl space-y-2.5 text-left shadow-subtle">
                  <button
                    type="button"
                    onClick={() => setShowManualHandoff(!showManualHandoff)}
                    className="w-full flex items-center justify-between text-xs font-bold text-brown-900 hover:text-brown-950 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-brown-600" />
                      <span>Paid using Mobile Wallet (Zashi / Ywallet)?</span>
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
                        Paste the 64-character transaction hash (txid) from your wallet to instantly verify and complete this request on-chain:
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
                        className="w-full h-9 text-xs font-bold"
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
                    className="w-full text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-9"
                    isLoading={isDeclining}
                  >
                    Decline / Cancel Request
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="py-6 text-center space-y-4 animate-in fade-in zoom-in-95">
            <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-200 mx-auto flex items-center justify-center">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h4 className="text-xl font-bold text-brown-950">Payment Settled!</h4>
              <p className="text-xs text-brown-500 mt-1 max-w-xs mx-auto">
                {request.amountZec} ZEC has been delivered directly to{" "}
                <strong>@{request.requesterUsernameSnapshot}</strong>.
              </p>
            </div>

            {/* Downloadable Official Receipt Card */}
            <InvoiceReceiptCard
              type="request"
              recipientUsername={request.requesterUsernameSnapshot}
              amountZec={request.amountZec}
              amountUsd={formatZecToUsd(request.amountZec)}
              txid={manualTxid || undefined}
              escrowAddress={request.escrowDepositAddress || request.recipientShieldedUa}
              memo={request.memo}
              payerUsername={request.targetUsernameSnapshot}
            />

            <Link href="/" className="block pt-2">
              <Button variant="outline" className="w-full">
                Go to VeilX Home
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
