"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Link2,
  ShieldCheck,
  Loader2,
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

export default function PayLinkInvoicePage() {
  const params = useParams();
  const slug = params.slug as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isPaid, setIsPaid] = useState(false);
  const [manualTxid, setManualTxid] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [showManualHandoff, setShowManualHandoff] = useState(false);

  const { formatZecToUsd } = useZecPrice();

  const [paylink, setPaylink] = useState<{
    slug: string;
    title: string;
    amountZec: number;
    creatorUsernameSnapshot: string;
    recipientShieldedUa: string;
    escrowDepositAddress?: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!slug) return;
    setIsLoading(true);

    const fetchInvoice = () => {
      fetch(`/api/paylinks/${slug}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.paylink) {
            setPaylink(data.paylink);
            if (data.paylink.status === "PAID") {
              setIsPaid(true);
            }
          }
        })
        .catch((e) => console.warn("Fetch paylink:", e))
        .finally(() => setIsLoading(false));
    };

    fetchInvoice();

    // Poll every 4 seconds to auto-detect incoming payments
    const interval = setInterval(() => {
      if (!isPaid) {
        fetchInvoice();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [slug, isPaid]);

  const handleManualSettle = async () => {
    const clean = manualTxid.trim();
    if (!clean) return;
    setIsSubmittingManual(true);
    setManualError(null);

    try {
      const res = await fetch(`/api/paylinks/${slug}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidTxid: clean }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsPaid(true);
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
          <span>Loading PayLink invoice...</span>
        </div>
      </div>
    );
  }

  if (!paylink) {
    return (
      <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-4 sm:p-6 text-left">
        <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-6 sm:p-8 shadow-modal text-center space-y-5">
          <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl border border-rose-200 mx-auto flex items-center justify-center">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-brown-950">PayLink Not Found</h2>
            <p className="text-xs text-brown-600 leading-relaxed">
              This invoice link does not exist, has expired, or may have been removed by its creator.
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

  const invoice = paylink;

  return (
    <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-4 sm:p-6 text-left">
      <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-6 sm:p-7 shadow-modal space-y-6">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-butter-200">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-bold text-brown-950 hover:text-brown-700 transition-all"
          >
            <img
              src="/VeilX_logo.png"
              alt="VeilX Logo"
              className="w-7 h-7 rounded-lg object-contain bg-white border border-butter-300 p-0.5"
            />
            <span className="font-extrabold text-sm text-brown-950">VeilX PayLink</span>
          </Link>
          <span className="text-[11px] font-mono font-bold text-brown-900 bg-butter-50 px-2.5 py-0.5 rounded-full border border-butter-300">
            One-Time Invoice
          </span>
        </div>

        {!isPaid ? (
          <div className="space-y-5">
            {/* Invoice Summary */}
            <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl space-y-2 shadow-subtle">
              <p className="text-xs text-brown-500 font-semibold uppercase tracking-wider">
                Invoice For
              </p>
              <h3 className="text-base font-bold text-brown-950">{invoice.title}</h3>
              <div className="pt-2 flex justify-between items-center border-t border-butter-200">
                <span className="text-xs text-brown-500">
                  Pay to: <strong>@{invoice.creatorUsernameSnapshot}</strong>
                </span>
                <div className="text-right">
                  <span className="font-mono font-bold text-xl text-brown-900">
                    {invoice.amountZec} ZEC
                  </span>
                  <span className="block text-[11px] font-mono text-brown-500">
                    ≈ {formatZecToUsd(invoice.amountZec)} USD
                  </span>
                </div>
              </div>
            </div>

            {/* QR Payment Handoff */}
            {(() => {
              const depositAddress = invoice.escrowDepositAddress || invoice.recipientShieldedUa;
              return (
                <QRDisplay
                  value={buildZip321Uri({
                    address: depositAddress,
                    amountZec: invoice.amountZec,
                    memo: invoice.title,
                  })}
                  address={depositAddress}
                  amountZec={invoice.amountZec}
                  memo={invoice.title}
                  onPaymentConfirmed={async (txid) => {
                    try {
                      const res = await fetch(`/api/paylinks/${slug}/settle`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paidTxid: txid }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (res.ok && data.success) {
                        setIsPaid(true);
                      } else {
                        setManualError(data.error || "Payment verification failed on server.");
                      }
                    } catch (e: any) {
                      console.warn("Failed to notify server of paylink settlement:", e);
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
                    Paste the 64-character transaction hash (txid) from your wallet to instantly verify and settle this invoice on-chain:
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
                    <span>Verify & Settle Invoice</span>
                  </Button>
                </div>
              )}
            </div>

            <div className="pt-2 text-center">
              <p className="text-[11px] text-brown-500">
                No VeilX account or registration required to pay.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center space-y-4 animate-in fade-in zoom-in-95">
            <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-200 mx-auto flex items-center justify-center">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h4 className="text-xl font-bold text-brown-950">Invoice Paid!</h4>
              <p className="text-xs text-brown-500 mt-1 max-w-xs mx-auto">
                {invoice.amountZec} ZEC has been delivered directly to{" "}
                <strong>@{invoice.creatorUsernameSnapshot}</strong>.
              </p>
            </div>

            {/* Downloadable Official Receipt Card */}
            <InvoiceReceiptCard
              type="paylink"
              recipientUsername={invoice.creatorUsernameSnapshot}
              amountZec={invoice.amountZec}
              amountUsd={formatZecToUsd(invoice.amountZec)}
              txid={manualTxid || undefined}
              escrowAddress={invoice.escrowDepositAddress || invoice.recipientShieldedUa}
              memo={invoice.title}
            />

            <Link href="/" className="block pt-2">
              <Button variant="outline" className="w-full">
                Return to VeilX
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
