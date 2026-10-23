"use client";

import React, { useState, useEffect } from "react";
import {
  Link2,
  Copy,
  Check,
  ExternalLink,
  Wallet,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Clipboard,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AmountInput } from "@/components/ui/AmountInput";
import { connectBrowserWallet, isMobileDevice } from "@/lib/wallet";
import { validateZcashAddressFull } from "@/lib/zcash-address";
import { NetworkMismatchAlert } from "@/components/ui/NetworkMismatchAlert";
import { useZecPrice } from "@/lib/price-service";
import { formatZecValue } from "@/lib/utils";

export interface PayLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PayLinkModal({ isOpen, onClose }: PayLinkModalProps) {
  const [title, setTitle] = useState("");
  const [amountZec, setAmountZec] = useState("1.0");
  const [shieldedUa, setShieldedUa] = useState("");
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [createdPayLink, setCreatedPayLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  const { formatZecToUsd } = useZecPrice();
  const addressValidation = shieldedUa.trim() ? validateZcashAddressFull(shieldedUa.trim(), "mainnet") : null;

  const handleAutoFillWallet = async () => {
    setErrorNotice(null);

    // Mobile UX: 1-tap paste from clipboard rather than failing extension injection
    if (isMobile) {
      try {
        if (!navigator.clipboard?.readText) {
          setErrorNotice("Clipboard access unavailable. Please paste your address manually.");
          return;
        }
        const text = await navigator.clipboard.readText();
        const cleaned = text.trim();
        if (!cleaned) {
          setErrorNotice("Clipboard is empty. Copy your address from your wallet (Zashi, YWallet) first.");
          return;
        }
        setShieldedUa(cleaned);
      } catch (err: any) {
        setErrorNotice("Clipboard permission denied. Please paste your address into the field.");
      }
      return;
    }

    setIsAutoFilling(true);
    try {
      const res = await connectBrowserWallet();
      if (res.address && res.address !== "shielded_connected") {
        setShieldedUa(res.address);
      } else {
        setErrorNotice("Zcash browser wallet not detected or locked. Please paste your address manually.");
      }
    } catch (err: any) {
      setErrorNotice(err.message || "Zcash browser wallet not detected. Please paste your address manually.");
    } finally {
      setIsAutoFilling(false);
    }
  };

  const handleCreatePayLink = async () => {
    if (!title.trim() || !amountZec || !shieldedUa.trim()) return;
    setIsLoading(true);
    setErrorNotice(null);

    try {
      const res = await fetch("/api/paylinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          amountZec,
          recipientShieldedUa: shieldedUa.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.paylink) {
        setCreatedPayLink(`${window.location.origin}/pay/${data.paylink.slug}`);
      } else {
        setErrorNotice(data.error || "Failed to generate PayLink.");
      }
    } catch (e: any) {
      setErrorNotice(e.message || "Network error. Failed to reach PayLink service.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!createdPayLink) return;
    navigator.clipboard.writeText(createdPayLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setTitle("");
    setAmountZec("1.0");
    setShieldedUa("");
    setCreatedPayLink(null);
    setErrorNotice(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title={createdPayLink ? "PayLink Ready!" : "Create PayLink Invoice"}
      subtitle={
        createdPayLink
          ? "Share this one-time invoice link to receive private payments"
          : "Generate a custom invoice link for clients or services"
      }
    >
      {!createdPayLink ? (
        <div className="space-y-4 text-left">
          {errorNotice && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorNotice}</span>
            </div>
          )}

          <Input
            label="Invoice Title / Description"
            placeholder="e.g. Website Design Commission"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrorNotice(null);
            }}
          />

          <AmountInput
            value={amountZec}
            onChange={(v) => {
              setAmountZec(v);
              setErrorNotice(null);
            }}
            label="Requested Amount (Min 0.0002 ZEC)"
          />
          {parseFloat(amountZec) > 0 && parseFloat(amountZec) < 0.0002 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-xl">
              ⚠️ Minimum amount is 0.0002 ZEC to cover the 0.0001 ZEC Zcash network miner fee.
            </p>
          )}
          {parseFloat(amountZec) >= 0.0002 && (
            <p className="text-[11px] text-brown-500 font-mono">
              Net received in your wallet: {formatZecValue(Math.max(0, Math.round((parseFloat(amountZec) - 0.0001) * 100000000) / 100000000))} ZEC (after 0.0001 miner fee)
            </p>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-brown-900">
                Your Payout Address (u1...)
              </label>
              <button
                type="button"
                onClick={handleAutoFillWallet}
                disabled={isAutoFilling}
                className="text-xs font-bold text-brown-800 hover:text-brown-950 flex items-center gap-1.5 transition-colors"
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
            </div>
            <Input
              value={shieldedUa}
              onChange={(e) => {
                setShieldedUa(e.target.value);
                setErrorNotice(null);
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
            {addressValidation?.isNetworkMismatch ? (
              <NetworkMismatchAlert isNetworkMismatch={true} />
            ) : addressValidation?.isValid ? (
              <div className="space-y-1.5">
                {addressValidation.type === "unified" ? (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2 text-xs text-emerald-950 animate-in fade-in">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-bold">🛡️ Shielded Merchant Settlement</span>
                      <p className="text-[11px] text-emerald-800 leading-snug">
                        All payments will be delivered with complete privacy directly to your Orchard address.
                      </p>
                    </div>
                  </div>
                ) : (addressValidation.type === "p2pkh" || addressValidation.type === "p2sh") ? (
                  <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2 text-xs text-amber-950 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-bold">⚠️ Public Ledger Notice</span>
                      <p className="text-[11px] text-amber-900 leading-snug">
                        You entered a transparent address (<code className="font-mono font-bold text-amber-950">t1...</code>). All payments forwarded to this address will be publicly visible to anyone inspecting the Zcash blockchain. Use your shielded address (<code className="font-mono font-bold text-amber-950">u1...</code>) to keep your revenue confidential.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2 text-xs text-amber-950 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-bold">Sapling Address Detected</span>
                      <p className="text-[11px] text-amber-800 leading-snug">
                        Please provide an Orchard Unified address (<code className="font-mono font-bold text-amber-950">u1...</code>) from Zashi or YWallet for maximum privacy.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : addressValidation && !addressValidation.isValid && shieldedUa.trim().length >= 10 ? (
              <p className="text-[11px] text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>{addressValidation.error || "Please enter a valid Zcash address starting with 'u' or 't'"}</span>
              </p>
            ) : (
              <p className="text-[11px] text-brown-500">
                When paid by client, funds are settled directly into your wallet with complete privacy.
              </p>
            )}
          </div>

          <div className="pt-2">
            <Button
              onClick={handleCreatePayLink}
              disabled={
                !title.trim() ||
                !amountZec ||
                parseFloat(amountZec) < 0.0002 ||
                !shieldedUa.trim() ||
                isLoading ||
                Boolean(addressValidation && !addressValidation.isValid) ||
                Boolean(addressValidation?.isNetworkMismatch) ||
                Boolean(
                  addressValidation &&
                  addressValidation.type !== "unified" &&
                  addressValidation.type !== "p2pkh" &&
                  addressValidation.type !== "p2sh"
                )
              }
              isLoading={isLoading}
              variant="primary"
              className="w-full h-11 text-sm font-semibold gap-2 shadow-subtle"
            >
              <span>{isLoading ? "Generating Link..." : "Create PayLink"}</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5 text-left pt-1">
          <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-brown-900">Live Link Generated</span>
            </div>

            <div className="p-2.5 bg-white rounded-xl border border-butter-200 flex items-center justify-between gap-2">
              <p className="text-xs font-mono text-brown-800 truncate select-all">{createdPayLink}</p>
              <button
                onClick={handleCopy}
                className="p-1.5 rounded-lg hover:bg-butter-100 text-brown-700 transition-colors shrink-0"
                title="Copy Link"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="text-xs text-brown-600 space-y-1">
              <p>
                <strong>Title:</strong> {title}
              </p>
              <p>
                <strong>Amount:</strong> {amountZec} ZEC{" "}
                <span className="font-mono text-brown-500">
                  (≈ {formatZecToUsd(amountZec)} USD)
                </span>
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => window.open(createdPayLink, "_blank")}
              variant="outline"
              className="flex-1 h-10 text-xs font-semibold gap-1.5"
            >
              <span>Open PayLink</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
            <Button onClick={handleReset} variant="primary" className="flex-1 h-10 text-xs font-semibold">
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
