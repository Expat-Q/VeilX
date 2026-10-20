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
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { connectBrowserWallet, isMobileDevice } from "@/lib/wallet";
import { truncateAddress, getZcashExplorerUrl } from "@/lib/utils";
import { useZecPrice } from "@/lib/price-service";
import { validateZcashAddressFull } from "@/lib/zcash-address";
import { NetworkMismatchAlert } from "@/components/ui/NetworkMismatchAlert";


export interface ClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  tip?: {
    id: string;
    amountZec: number;
    senderHandle?: string;
    memo?: string;
    isAnonymous: boolean;
  } | null;
  tipsToBatchClaim?: any[] | null;
  onClaimSuccess?: (tipId?: string) => void;
}

export function ClaimModal({
  isOpen,
  onClose,
  tip,
  tipsToBatchClaim,
  onClaimSuccess,
}: ClaimModalProps) {
  const [recipientAddress, setRecipientAddress] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isClaimed, setIsClaimed] = useState(false);
  const [isPendingVerification, setIsPendingVerification] = useState(false);
  const [payoutOpid, setPayoutOpid] = useState<string | null>(null);
  const [claimTxid, setClaimTxid] = useState<string | null>(null);
  const [copiedTxid, setCopiedTxid] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  const { formatZecToUsd } = useZecPrice();

  const isBatch = Boolean(tipsToBatchClaim && tipsToBatchClaim.length > 0);
  const batchCount = tipsToBatchClaim?.length || 0;
  const activeTotalZec = isBatch
    ? Math.round((tipsToBatchClaim!.reduce((sum, t) => sum + (t.amountZec || 0), 0)) * 100000000) / 100000000
    : tip?.amountZec || 0;

  const MINING_FEE_ZEC = 0.0001;
  const netReceiveZec = Math.max(0, Math.round((activeTotalZec - MINING_FEE_ZEC) * 100000000) / 100000000);

  const addressValidation = recipientAddress.trim()
    ? validateZcashAddressFull(recipientAddress.trim(), "mainnet")
    : null;

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
        setRecipientAddress(cleaned);
      } catch (err: any) {
        setErrorNotice("Clipboard permission denied. Please paste your address into the field.");
      }
      return;
    }

    setIsAutoFilling(true);
    try {
      const res = await connectBrowserWallet();
      if (res.address && res.address !== "shielded_connected") {
        setRecipientAddress(res.address);
      } else {
        setErrorNotice("Please ensure your Zcash browser extension is unlocked, or paste your address manually.");
      }
    } catch (err: any) {
      setErrorNotice(err.message || "No Zcash browser extension detected. Please paste your address manually.");
    } finally {
      setIsAutoFilling(false);
    }
  };

  const handleClaim = async () => {
    if (!recipientAddress.trim() || (!tip && !isBatch)) return;
    if (addressValidation?.isNetworkMismatch) {
      setErrorNotice("Network Mismatch: You cannot withdraw mainnet funds to a testnet address.");
      return;
    }
    if (addressValidation && !addressValidation.isValid) {
      setErrorNotice(addressValidation.error || "Please enter a valid Zcash address.");
      return;
    }
    setIsClaiming(true);
    setErrorNotice(null);

    try {
      if (isBatch) {
        const res = await fetch("/api/tips/claim-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientShieldedAddress: recipientAddress.trim(),
          }),
        });
        let data: any = {};
        try {
          data = await res.json();
        } catch {
          data = {
            error: res.status === 502 || res.status === 504
              ? "Zero-knowledge proof generation timed out at gateway. Escrow disbursement is processing in the background."
              : `Service response error (${res.status}). Please retry shortly.`,
          };
        }
        if (res.ok && data.success) {
          if (data.status === "PENDING_VERIFICATION") {
            setIsPendingVerification(true);
            setPayoutOpid(data.payoutOpid || null);
          } else {
            setClaimTxid(data.claimTxid || "Broadcasted");
          }
          setIsClaimed(true);
          if (onClaimSuccess) onClaimSuccess();
        } else {
          setErrorNotice(data.error || "Failed to batch claim tips. Please try again.");
        }
      } else if (tip) {
        const res = await fetch(`/api/tips/${tip.id}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientShieldedAddress: recipientAddress.trim(),
          }),
        });
        let data: any = {};
        try {
          data = await res.json();
        } catch {
          data = {
            error: res.status === 502 || res.status === 504
              ? "Zero-knowledge proof generation timed out at gateway. Escrow disbursement is processing in the background."
              : `Service response error (${res.status}). Please retry shortly.`,
          };
        }
        if (res.ok && data.success) {
          if (data.status === "PENDING_VERIFICATION") {
            setIsPendingVerification(true);
            setPayoutOpid(data.payoutOpid || null);
          } else {
            setClaimTxid(data.claimTxid || "Broadcasted");
          }
          setIsClaimed(true);
          if (onClaimSuccess) onClaimSuccess(tip.id);
        } else {
          setErrorNotice(data.error || "Failed to claim tip. Please check the address and try again.");
        }
      }
    } catch (e: any) {
      setErrorNotice(e.message || "Network error. Failed to reach claim service.");
    } finally {
      setIsClaiming(false);
    }
  };

  const handleCopyTxid = () => {
    const textToCopy = claimTxid || payoutOpid;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopiedTxid(true);
    setTimeout(() => setCopiedTxid(false), 2000);
  };

  const handleReset = () => {
    setRecipientAddress("");
    setIsClaiming(false);
    setIsClaimed(false);
    setIsPendingVerification(false);
    setPayoutOpid(null);
    setClaimTxid(null);
    setErrorNotice(null);
    onClose();
  };

  if (!tip && !isBatch) return null;


  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title={
        isClaimed
          ? isBatch
            ? "All Tips Dispatched!"
            : "Shielded Payout Dispatched!"
          : isBatch
          ? `Claim All (${batchCount} Tips)`
          : "Claim Your Tip"
      }
      subtitle={
        isClaimed
          ? `Successfully transferred ${activeTotalZec} ZEC directly into your personal wallet.`
          : isBatch
          ? `Withdraw all ${batchCount} waiting tips (${activeTotalZec} ZEC) in a single shielded transaction.`
          : "Withdraw funds directly to your shielded or transparent Zcash address."
      }
    >
      <div className="space-y-4 text-left">
        {/* Tip Summary & Net Fee Card */}
        <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400">
                {isBatch ? "Total Claimable Balance" : "Claimable Amount"}
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
                {isBatch ? "Bundle" : "Sender"}
              </span>
              <p className="text-xs font-bold text-brown-900">
                {isBatch
                  ? `⚡ ${batchCount} Tips Aggregated`
                  : tip?.isAnonymous
                  ? "🛡️ Anonymous"
                  : `@${tip?.senderHandle}`}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-butter-200/80 flex items-center justify-between text-xs">
            <span className="text-brown-600 font-medium">Network Miner Fee:</span>
            <span className="font-mono text-brown-600 font-semibold">
              -{MINING_FEE_ZEC} ZEC {isBatch ? "(single batch fee)" : ""}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-butter-200/80">
            <span className="text-brown-900 font-bold">Net Payout to Wallet:</span>
            <span className="font-mono text-emerald-850 font-extrabold text-sm">
              {netReceiveZec} ZEC <span className="text-xs font-normal text-brown-500 font-sans">({formatZecToUsd(netReceiveZec)})</span>
            </span>
          </div>
        </div>

        {/* Breakdown for batch claims */}
        {isBatch && tipsToBatchClaim && tipsToBatchClaim.length > 0 && (
          <div className="p-3 bg-white border border-butter-200 rounded-2xl space-y-1.5 max-h-36 overflow-y-auto shadow-subtle">
            <p className="text-[10px] font-bold uppercase tracking-wider text-brown-400">
              Tips Included in this Batch:
            </p>
            {tipsToBatchClaim.map((t: any, idx: number) => (
              <div
                key={t.id || t._id || idx}
                className="flex items-center justify-between text-xs py-1 border-b border-butter-100 last:border-none"
              >
                <span className="text-brown-700 font-medium truncate max-w-[200px]">
                  {t.isAnonymous
                    ? "🛡️ Anonymous"
                    : `@${t.senderHandle || t.senderUsernameSnapshot || "supporter"}`}
                  {t.memo ? ` · "${t.memo}"` : ""}
                </span>
                <span className="font-mono font-bold text-brown-950">
                  {t.amountZec} ZEC
                </span>
              </div>
            ))}
          </div>
        )}

        {!isBatch && tip?.memo && (
          <div className="p-3 bg-white border border-butter-200 rounded-xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400">Memo</span>
            <p className="text-xs text-brown-800 italic mt-0.5">&ldquo;{tip.memo}&rdquo;</p>
          </div>
        )}

        {/* Error Notice */}
        {errorNotice && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorNotice}</span>
          </div>
        )}

        {!isClaimed ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-brown-900">
                  Your Zcash Payout Address
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
                value={recipientAddress}
                onChange={(e) => {
                  setRecipientAddress(e.target.value);
                  setErrorNotice(null);
                }}
                placeholder="u1... (Unified) or zs1... (Sapling) or t1... (Transparent)"
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
                <div className="space-y-2">
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
                  {(addressValidation.type === "p2pkh" || addressValidation.type === "p2sh") && (
                    <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2 text-xs text-amber-900 animate-in fade-in">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="font-bold">Transparent Address Notice</span>
                        <p className="text-[11px] text-amber-800 leading-snug">
                          Transparent addresses do not shield your balance or transaction history on the public blockchain. For complete privacy, consider using a Unified (u1...) or Sapling (zs1...) shielded address.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : addressValidation && !addressValidation.isValid && recipientAddress.trim().length >= 10 ? (
                <p className="text-[11px] text-rose-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span>{addressValidation.error || "Please enter a valid Zcash address starting with 'u' or 't'"}</span>
                </p>
              ) : (
                <p className="text-[11px] text-brown-500">
                  Paste your Unified Address (u1...), Sapling address (zs1...), or transparent address (t1...).
                </p>
              )}
            </div>

            {isClaiming && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5 text-left animate-in fade-in">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-700 shrink-0" />
                  <span>Calculating Shielded Proofs (Est. 30–90s)...</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Zcash shielded transactions calculate zero-knowledge proofs to keep your destination address private on-chain. Please keep this window open.
                </p>
              </div>
            )}

            <Button
              onClick={handleClaim}
              disabled={
                !recipientAddress.trim() ||
                isClaiming ||
                activeTotalZec <= MINING_FEE_ZEC ||
                Boolean(addressValidation && !addressValidation.isValid) ||
                Boolean(addressValidation?.isNetworkMismatch)
              }
              isLoading={isClaiming}
              variant="primary"
              className="w-full h-11 text-sm font-semibold gap-2 mt-2 shadow-subtle"
            >
              <span>{isClaiming ? "Broadcasting Payout..." : `Withdraw ${netReceiveZec} ZEC`}</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            {isPendingVerification ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2.5 text-center animate-in fade-in">
                <div className="w-10 h-10 bg-amber-100 text-amber-800 rounded-full mx-auto flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-950">Payout Submitted & Verifying!</p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Your net withdrawal of {netReceiveZec} ZEC was accepted by the Zcash node. Shielded zero-knowledge proofs are generating in the background.
                  </p>
                </div>

                {payoutOpid && (
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
                      onClick={handleCopyTxid}
                      className="p-1.5 rounded-lg hover:bg-butter-100 text-brown-700 transition-colors shrink-0"
                      title="Copy OpId"
                    >
                      {copiedTxid ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                )}

                <p className="text-[11px] text-amber-700">
                  You can safely close this modal. Your dashboard balance will update automatically once mined into a block.
                </p>
              </div>
            ) : (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2 text-center animate-in fade-in">
                <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-full mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-950">Payout Successfully Broadcasted!</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    The funds were routed directly to your provided Zcash address.
                  </p>
                </div>

                {claimTxid && (
                  <div className="mt-3 p-2 bg-white rounded-xl border border-emerald-200 flex items-center justify-between gap-2">
                    <div className="text-left min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-brown-400 block">
                        Transaction Hash
                      </span>
                      <p className="text-xs font-mono font-medium text-brown-800 truncate">
                        {truncateAddress(claimTxid, 12, 10)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={handleCopyTxid}
                        className="p-1.5 rounded-lg hover:bg-butter-100 text-brown-700 transition-colors"
                        title="Copy Txid"
                      >
                        {copiedTxid ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <a
                        href={getZcashExplorerUrl(claimTxid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-butter-100 text-brown-700 transition-colors inline-flex items-center"
                        title="View on Zcash Block Explorer"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Button onClick={handleReset} variant="outline" className="w-full h-10 text-xs font-semibold">
              Done
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
