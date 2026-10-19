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
} from "lucide-react";
import { QRDisplay } from "@/components/ui/QRDisplay";
import { Button } from "@/components/ui/Button";
import { useZecPrice } from "@/lib/price-service";
import { buildZip321Uri } from "@/lib/wallet";
import { InvoiceReceiptCard } from "@/components/ui/InvoiceReceiptCard";

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
            if (data.request.status === "FULFILLED") {
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
      const res = await fetch(`/api/requests/${requestId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidTxid: clean }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.request?.status === "FULFILLED") {
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

            {isSettling && (
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl flex items-center gap-3 text-xs text-amber-900 font-semibold shadow-subtle animate-in fade-in">
                <Loader2 className="w-5 h-5 text-amber-700 animate-spin shrink-0" />
                <div className="space-y-0.5">
                  <p className="font-bold">Payment Broadcasted & Detected!</p>
                  <p className="text-[11px] text-amber-700 font-normal">
                    Confirming on Zcash blockchain and delivering directly to @{request.requesterUsernameSnapshot}...
                  </p>
                </div>
              </div>
            )}

            {/* QR Payment Handoff */}
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
                      const res = await fetch(`/api/requests/${requestId}/settle`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paidTxid: txid }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (res.ok && data.success) {
                        if (data.request?.status === "FULFILLED") {
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
