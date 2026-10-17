"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AmountInput } from "@/components/ui/AmountInput";
import { connectBrowserWallet } from "@/lib/wallet";
import { validateZcashAddressFull } from "@/lib/zcash-address";
import { NetworkMismatchAlert } from "@/components/ui/NetworkMismatchAlert";
import { useZecPrice } from "@/lib/price-service";

export interface PayLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PayLinkModal({ isOpen, onClose }: PayLinkModalProps) {
  const [title, setTitle] = useState("");
  const [amountZec, setAmountZec] = useState("1.0");
  const [shieldedUa, setShieldedUa] = useState("");
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [createdPayLink, setCreatedPayLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const { formatZecToUsd } = useZecPrice();
  const addressValidation = shieldedUa.trim() ? validateZcashAddressFull(shieldedUa.trim(), "mainnet") : null;

  const handleAutoFillWallet = async () => {
    setIsAutoFilling(true);
    setErrorNotice(null);
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
      title={createdPayLink ? "PayLink Ready!" : "Create Shielded PayLink"}
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
            label="Requested Amount (ZEC)"
          />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-brown-900">
                Your Payout Address
              </label>
              <button
                type="button"
                onClick={handleAutoFillWallet}
                disabled={isAutoFilling}
                className="text-xs font-bold text-brown-800 hover:text-brown-950 flex items-center gap-1 transition-colors"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{isAutoFilling ? "Detecting..." : "Autofill Wallet"}</span>
              </button>
            </div>
            <Input
              value={shieldedUa}
              onChange={(e) => {
                setShieldedUa(e.target.value);
                setErrorNotice(null);
              }}
              placeholder="u1... (Unified) or zs1... (Sapling) or t1..."
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
              <p className="text-[11px] text-emerald-700 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>
                  Valid Mainnet{" "}
                  {addressValidation.type === "unified"
                    ? "Unified"
                    : addressValidation.type === "sapling"
                    ? "Sapling"
                    : "Transparent"}{" "}
                  address
                </span>
              </p>
            ) : addressValidation && !addressValidation.isValid && shieldedUa.trim().length >= 10 ? (
              <p className="text-[11px] text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>{addressValidation.error || "Please enter a valid Zcash address starting with 'u' or 't'"}</span>
              </p>
            ) : (
              <p className="text-[11px] text-brown-500">
                When paid, funds settle directly to this address with encrypted sender notes.
              </p>
            )}
          </div>

          <div className="pt-2">
            <Button
              onClick={handleCreatePayLink}
              disabled={
                !title.trim() ||
                !amountZec ||
                !shieldedUa.trim() ||
                isLoading ||
                Boolean(addressValidation && !addressValidation.isValid) ||
                Boolean(addressValidation?.isNetworkMismatch)
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
