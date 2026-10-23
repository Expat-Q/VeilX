"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Send,
  Inbox,
  Link2,
  Shield,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CheckCircle2,
  Share2,
  Copy,
  Check,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { XLogo } from "@/components/ui/XLogo";
import { formatUsd, formatZecValue, truncateAddress, getZcashExplorerUrl } from "@/lib/utils";
import { useZecPrice } from "@/lib/price-service";
import { prewarmProverInBackground } from "@/lib/pczt/pczt-client-prover";

export interface DashboardOverviewProps {
  user: {
    id?: string;
    userId?: string;
    name?: string;
    username?: string;
    profileImageUrl?: string;
    referralCount?: number;
    referralRewardsZec?: number;
    referralPoints?: number;
  };
  onOpenTip: () => void;
  onOpenRequest: () => void;
  onOpenPayLink: () => void;
  onOpenClaim: (tip: any) => void;
  onLogout?: () => void;
}

export function DashboardOverview({
  user,
  onOpenTip,
  onOpenRequest,
  onOpenPayLink,
  onOpenClaim,
  onLogout,
}: DashboardOverviewProps) {
  const [activeFilter, setActiveFilter] = useState<"all" | "received" | "sent">("all");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedTxidMap, setCopiedTxidMap] = useState<Record<string, boolean>>({});
  const [copiedPayLinkMap, setCopiedPayLinkMap] = useState<Record<string, boolean>>({});
  const [isActionLoadingMap, setIsActionLoadingMap] = useState<Record<string, boolean>>({});
  const [confirmDeclineId, setConfirmDeclineId] = useState<string | null>(null);

  const [activity, setActivity] = useState<any[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(true);

  // Live real-time ZEC price feed
  const { priceUsd, change24h, formatZecToUsd, refetchPrice } = useZecPrice();

  const safeUsername = (user?.username || "").toLowerCase();
  const safeUserId = user?.userId || user?.id || "";
  const safeName = user?.name || user?.username || "Creator";

  const handleCopyTxid = (id: string, txid: string) => {
    navigator.clipboard.writeText(txid);
    setCopiedTxidMap((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopiedTxidMap((prev) => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const handleCopyPayLink = (slug: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://veilx.cash";
    navigator.clipboard.writeText(`${origin}/pay/${slug}`);
    setCopiedPayLinkMap((prev) => ({ ...prev, [slug]: true }));
    setTimeout(() => {
      setCopiedPayLinkMap((prev) => ({ ...prev, [slug]: false }));
    }, 2000);
  };

  const handleDeclineRequest = async (requestId: string) => {
    setIsActionLoadingMap((prev) => ({ ...prev, [requestId]: true }));
    try {
      const res = await fetch(`/api/requests/${requestId}/reject`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchLiveActivity();
      }
    } catch (err) {
      console.error("Failed to decline request:", err);
    } finally {
      setIsActionLoadingMap((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    setIsActionLoadingMap((prev) => ({ ...prev, [requestId]: true }));
    try {
      const res = await fetch(`/api/requests/${requestId}/reject`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchLiveActivity();
      }
    } catch (err) {
      console.error("Failed to cancel request:", err);
    } finally {
      setIsActionLoadingMap((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  const handleRetryPayLinkForward = async (slug: string) => {
    setIsActionLoadingMap((prev) => ({ ...prev, [slug]: true }));
    try {
      const res = await fetch(`/api/paylinks/${slug}/retry-forward`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchLiveActivity();
      } else {
        const data = await res.json().catch(() => ({}));
        const rawErr = data.error || "Failed to retry payout. Payout is queued in background forwarder.";
        const cleanErr = rawErr.replace(/t1[a-zA-Z0-9]{33}/g, "shielded escrow vault");
        alert(cleanErr);
      }
    } catch (err: any) {
      console.error("Failed to retry paylink forward:", err);
      alert("Payout is currently queued in the background forwarder.");
    } finally {
      setIsActionLoadingMap((prev) => ({ ...prev, [slug]: false }));
    }
  };

  const handleRetryRequestForward = async (requestId: string) => {
    setIsActionLoadingMap((prev) => ({ ...prev, [requestId]: true }));
    try {
      const res = await fetch(`/api/requests/${requestId}/retry-forward`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchLiveActivity();
      } else {
        const data = await res.json().catch(() => ({}));
        const rawErr = data.error || "Failed to retry payout. Payout is queued in background forwarder.";
        const cleanErr = rawErr.replace(/t1[a-zA-Z0-9]{33}/g, "shielded escrow vault");
        alert(cleanErr);
      }
    } catch (err: any) {
      console.error("Failed to retry request forward:", err);
      alert("Payout is currently queued in the background forwarder.");
    } finally {
      setIsActionLoadingMap((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  const fetchLiveActivity = useCallback(async () => {
    try {
      const [tipsRes, reqsRes, paylinksRes] = await Promise.allSettled([
        fetch("/api/tips"),
        fetch("/api/requests"),
        fetch("/api/paylinks"),
      ]);

      const newActivity: any[] = [];

      // 1. Process Live Tips
      if (tipsRes.status === "fulfilled") {
        const tipsData = await tipsRes.value.json();
        if (tipsData.success && Array.isArray(tipsData.tips)) {
          tipsData.tips.forEach((t: any) => {
            const senderSnapshot = (t.senderUsernameSnapshot || "").toLowerCase();
            const recipientSnapshot = (t.recipientUsernameSnapshot || "").toLowerCase();
            const isUserSender = (safeUsername && senderSnapshot === safeUsername) || (safeUserId && t.senderUserId && String(t.senderUserId) === String(safeUserId));
            const isUserRecipient = safeUsername ? recipientSnapshot === safeUsername : false;
            
            if (isUserSender || isUserRecipient) {
              const createdDate = t.createdAt ? new Date(t.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }) : "Recent";

              const txid = t.claimTxid || t.fundingTxid || undefined;
              const numericAmount = typeof t.amountZec === "number" ? t.amountZec : parseFloat(t.amountZec) || 0;

              newActivity.push({
                id: t._id || t.id,
                type: isUserRecipient ? "received" : "sent",
                amountZec: numericAmount,
                senderHandle: t.isAnonymous ? "anonymous" : t.senderUsernameSnapshot || "supporter",
                recipientHandle: t.recipientUsernameSnapshot,
                isAnonymous: t.isAnonymous,
                memo: t.memo,
                status: t.status,
                txid,
                paidTxid: t.fundingTxid,
                forwardTxid: t.claimTxid,
                depositTxid: t.fundingTxid,
                outflowTxid: t.claimTxid,
                recipientShieldedUa: t.recipientShieldedAddress,
                date: createdDate,
                rawDate: t.createdAt ? new Date(t.createdAt).getTime() : 0,
              });
            }
          });
        }
      }

      // 2. Process Live Payment Requests
      if (reqsRes.status === "fulfilled") {
        const reqsData = await reqsRes.value.json();
        if (reqsData.success && Array.isArray(reqsData.requests)) {
          reqsData.requests.forEach((r: any) => {
            const createdDate = r.createdAt ? new Date(r.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }) : "Recent";

            const targetSnapshot = (r.targetUsernameSnapshot || "").toLowerCase();
            const isIncoming = safeUsername ? targetSnapshot === safeUsername : false;

            const depositTxid = r.paidTxid || undefined;
            const outflowTxid = r.forwardTxid || undefined;
            const payoutError = r.payoutError || undefined;

            // Perspective-aware TxID:
            // - Payer (isIncoming): shows r.paidTxid (deposit into escrow)
            // - Requester (!isIncoming): shows r.forwardTxid (outflow payout to user's wallet), falling back to r.paidTxid
            const txid = isIncoming ? (depositTxid || outflowTxid) : (outflowTxid || depositTxid);
            const numericAmount = typeof r.amountZec === "number" ? r.amountZec : parseFloat(r.amountZec) || 0;

            newActivity.push({
              id: r._id || r.id,
              type: "request",
              isIncoming,
              requesterHandle: r.requesterUsernameSnapshot,
              targetHandle: r.targetUsernameSnapshot,
              amountZec: numericAmount,
              memo: r.memo,
              recipientShieldedUa: r.recipientShieldedUa,
              status: r.status,
              cancelledByRole: r.cancelledByRole,
              cancelledByUsername: r.cancelledByUsername,
              txid,
              paidTxid: depositTxid,
              forwardTxid: outflowTxid,
              depositTxid,
              outflowTxid,
              payoutError,
              date: createdDate,
              rawDate: r.createdAt ? new Date(r.createdAt).getTime() : 0,
            });
          });
        }
      }

      // 3. Process Live PayLinks
      if (paylinksRes.status === "fulfilled") {
        const paylinksData = await paylinksRes.value.json();
        if (paylinksData.success && Array.isArray(paylinksData.paylinks)) {
          paylinksData.paylinks.forEach((p: any) => {
            const createdDate = p.createdAt ? new Date(p.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }) : "Recent";

            const depositTxid = p.paidTxid || undefined;
            const outflowTxid = p.forwardTxid || undefined;
            const payoutError = p.payoutError || undefined;

            // PayLink creator receives the forward payout:
            const txid = outflowTxid || depositTxid || undefined;
            const numericAmount = typeof p.amountZec === "number" ? p.amountZec : parseFloat(p.amountZec) || 0;

            newActivity.push({
              id: p._id || p.id || p.slug,
              type: "paylink",
              slug: p.slug,
              title: p.title,
              amountZec: numericAmount,
              recipientShieldedUa: p.recipientShieldedUa,
              status: p.status || "UNPAID",
              txid,
              paidTxid: depositTxid,
              forwardTxid: outflowTxid,
              depositTxid,
              outflowTxid,
              payoutError,
              date: createdDate,
              rawDate: p.createdAt ? new Date(p.createdAt).getTime() : 0,
            });
          });
        }
      }

      // Sort newest first
      newActivity.sort((a, b) => b.rawDate - a.rawDate);
      setActivity(newActivity);
    } catch (e) {
      console.warn("Failed to fetch live activity:", e);
    } finally {
      setIsLoadingActivity(false);
    }
  }, [safeUsername]);

  // Initial load and live polling
  useEffect(() => {
    fetchLiveActivity();
    // Pre-warm the Orchard Halo 2 prover in Web Worker during dashboard idle time
    prewarmProverInBackground();
    const interval = setInterval(fetchLiveActivity, 8000);
    return () => clearInterval(interval);
  }, [fetchLiveActivity]);

  const isItemReadyToDisburse = (a: any) => {
    // 1. Tips received in escrow
    if (a.type === "received" && a.status === "FUNDED") return true;
    // 2. PayLinks awaiting forward / disbursement
    if (a.type === "paylink") {
      if (a.paidTxid && !a.forwardTxid) return true;
      if (a.status === "SETTLING" || a.status === "FORWARD_PENDING" || Boolean(a.payoutError)) return true;
    }
    // 3. Outgoing requests fulfilled by target awaiting disbursement to user
    if (a.type === "request" && !a.isIncoming) {
      if (a.paidTxid && !a.forwardTxid) return true;
      if (a.status === "SETTLING" || a.status === "FORWARD_PENDING" || Boolean(a.payoutError)) return true;
    }
    return false;
  };

  const allClaimable = activity.filter(isItemReadyToDisburse);
  const pendingTips = allClaimable;

  const syncingTips = activity.filter(
    (a) => a.type === "received" && (a.status === "CLAIMING" || a.status === "PENDING_VERIFICATION" || a.status === "FUNDING_DETECTED")
  );

  const pendingIncomingTotal = allClaimable.reduce(
    (acc, curr) => acc + (typeof curr.amountZec === "number" ? curr.amountZec : parseFloat(curr.amountZec) || 0),
    0
  );
  const safePendingTotal = typeof pendingIncomingTotal === "number" && !isNaN(pendingIncomingTotal) ? pendingIncomingTotal : 0;

  const isItemSettledAndDisbursed = (a: any) => {
    if (a.type === "received" && a.status === "CLAIMED") return true;
    if (a.type === "paylink" && a.paidTxid && a.forwardTxid) return true;
    if (a.type === "request" && !a.isIncoming && a.paidTxid && a.forwardTxid) return true;
    return false;
  };

  const claimedItems = activity.filter(isItemSettledAndDisbursed);
  const totalClaimedZec = claimedItems.reduce(
    (acc, curr) => acc + (typeof curr.amountZec === "number" ? curr.amountZec : parseFloat(curr.amountZec) || 0),
    0
  );
  const safeClaimedTotal = typeof totalClaimedZec === "number" && !isNaN(totalClaimedZec) ? totalClaimedZec : 0;

  // Calculate Total Sent / Outflow (Tips sent + Payment Requests fulfilled/paid)
  const isItemSentOrPaid = (a: any) => {
    // 1. Tips sent by the user (must be at least funded in escrow or claimed)
    if (a.type === "sent") {
      return a.status === "FUNDED" || a.status === "CLAIMED" || a.status === "CLAIMING" || a.status === "FUNDING_DETECTED";
    }
    // 2. Incoming requests paid by the user (target has paid/broadcasted)
    if (a.type === "request" && a.isIncoming) {
      return a.status === "FULFILLED" || a.status === "FORWARD_PENDING" || a.status === "SETTLING" || Boolean(a.paidTxid);
    }
    return false;
  };

  const sentItems = activity.filter(isItemSentOrPaid);
  const totalSentZec = sentItems.reduce(
    (acc, curr) => acc + (typeof curr.amountZec === "number" ? curr.amountZec : parseFloat(curr.amountZec) || 0),
    0
  );
  const safeSentTotal = typeof totalSentZec === "number" && !isNaN(totalSentZec) ? totalSentZec : 0;

  const handleTriggerClaim = () => {
    if (pendingTips.length > 0) {
      const item = pendingTips[0];
      onOpenClaim({
        id: item.id,
        slug: item.slug,
        title: item.title,
        type: item.type,
        amountZec: item.amountZec,
        memo: item.title || item.memo,
        isAnonymous: item.isAnonymous || false,
        recipientShieldedUa: item.recipientShieldedUa,
        paidTxid: item.paidTxid,
        forwardTxid: item.forwardTxid,
        depositTxid: item.depositTxid || item.paidTxid,
        payoutError: item.payoutError,
      });
    }
  };

  const filteredActivity = activity.filter((item) => {
    if (activeFilter === "received") {
      // Inflow: funds received by user
      return (
        item.type === "received" ||
        item.type === "paylink" ||
        (item.type === "request" && !item.isIncoming)
      );
    }
    if (activeFilter === "sent") {
      // Outflow: funds sent / paid out by user
      return item.type === "sent" || (item.type === "request" && item.isIncoming);
    }
    return true;
  });

  const tipUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/tip/${user?.username || "creator"}`
      : `https://veilx.cash/tip/${user?.username || "creator"}`;

  const handleCopyTipLink = () => {
    navigator.clipboard.writeText(tipUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const safeChange24h = typeof change24h === "number" && !isNaN(change24h) ? change24h : 0;
  const safePriceUsd = typeof priceUsd === "number" && !isNaN(priceUsd) ? priceUsd : 38.5;

  return (
    <div className="w-full max-w-2xl mx-auto px-3.5 sm:px-6 py-2 sm:py-6 pb-28 sm:pb-8 space-y-5 sm:space-y-6">
      {/* 1. Central Balance / Overview Card */}
      <div className="p-5 sm:p-8 bg-white border border-butter-300 rounded-[28px] sm:rounded-[32px] shadow-elevated space-y-5 sm:space-y-6 text-left relative overflow-hidden">
        {/* Live ZEC Price Badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-brown-500 whitespace-nowrap">
              Shielded Balance
            </span>
          </div>

          <button
            type="button"
            onClick={() => refetchPrice()}
            title="Click to refresh live ZEC price"
            className="cursor-pointer flex items-center gap-1 sm:gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 bg-butter-50 hover:bg-butter-100 border border-butter-200 rounded-full transition-all text-[10px] sm:text-[11px] font-mono font-bold text-brown-800 shadow-subtle shrink-0 whitespace-nowrap active:scale-95"
          >
            <span className="whitespace-nowrap">1 ZEC ≈ {formatUsd(safePriceUsd)}</span>
            <span className={`text-[9px] sm:text-[10px] font-semibold flex items-center whitespace-nowrap ${safeChange24h >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {safeChange24h >= 0 ? <TrendingUp className="w-2.5 h-2.5 sm:w-3 sm:h-3 inline mr-0.5 shrink-0" /> : <TrendingDown className="w-2.5 h-2.5 sm:w-3 sm:h-3 inline mr-0.5 shrink-0" />}
              {safeChange24h >= 0 ? "+" : ""}{safeChange24h.toFixed(1)}%
            </span>
          </button>
        </div>

        <div className="text-center space-y-2 py-2">
          {safePendingTotal > 0 ? (
            <>
              <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-brown-400">
                Pending Shielded Tips to Claim
              </p>
              <p className="text-3xl sm:text-5xl font-mono font-extrabold text-brown-950 tracking-tight">
                {formatZecValue(safePendingTotal)} <span className="text-xl sm:text-2xl font-bold text-brown-700">ZEC</span>
              </p>
              <p className="text-xs font-medium text-brown-500">
                ≈ {formatZecToUsd(safePendingTotal)} USD
                {syncingTips.length > 0 && allClaimable.length === 0 && (
                  <span className="block text-amber-600 font-semibold mt-1">
                    ({syncingTips.length} transaction currently syncing escrow payout...)
                  </span>
                )}
              </p>
            </>
          ) : safeClaimedTotal > 0 ? (
            <>
              <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-700">
                Total Shielded Disbursed
              </p>
              <p className="text-3xl sm:text-5xl font-mono font-extrabold text-brown-950 tracking-tight">
                {formatZecValue(safeClaimedTotal)} <span className="text-xl sm:text-2xl font-bold text-brown-700">ZEC</span>
              </p>
              <p className="text-xs font-medium text-brown-500">
                ≈ {formatZecToUsd(safeClaimedTotal)} USD
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-brown-400">
                Shielded Escrow Balance
              </p>
              <p className="text-3xl sm:text-5xl font-mono font-extrabold text-brown-950 tracking-tight">
                0.00 <span className="text-xl sm:text-2xl font-bold text-brown-700">ZEC</span>
              </p>
              <p className="text-xs font-medium text-brown-500">
                ≈ $0.00 USD
              </p>
            </>
          )}

          {/* Minimalist Inflow & Outflow Ledger Bar */}
          <div className="pt-2 flex items-center justify-center">
            <div className="inline-flex items-center gap-3 px-3.5 py-1.5 bg-butter-50/80 border border-butter-200/90 rounded-full text-xs shadow-subtle divide-x divide-butter-300">
              <div className="flex items-center gap-1.5 text-emerald-800">
                <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-[11px] font-semibold text-brown-600">Received:</span>
                <span className="font-mono font-bold text-emerald-950">
                  +{formatZecValue(safeClaimedTotal + safePendingTotal)} ZEC
                </span>
              </div>
              <div className="flex items-center gap-1.5 pl-3 text-rose-800">
                <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                <span className="text-[11px] font-semibold text-brown-600">Sent:</span>
                <span className="font-mono font-bold text-rose-950">
                  -{formatZecValue(safeSentTotal)} ZEC
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Claim All Banner Pill if user has pending tips, else Share Link Banner */}
        {pendingTips.length > 0 ? (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 shadow-subtle animate-in fade-in">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-subtle">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-emerald-950 truncate">
                  {pendingTips.length === 1 ? "1 Payment Ready to Disburse" : `${pendingTips.length} Payments Ready to Disburse`}
                </p>
                <p className="text-[11px] text-emerald-700 font-mono">
                  {formatZecValue(safePendingTotal)} ZEC ready to claim
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleTriggerClaim}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-subtle transition-all shrink-0 active:scale-95 flex items-center gap-1.5"
            >
              <span>Claim</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl flex items-center justify-between gap-3 shadow-subtle animate-in fade-in">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-butter-200 text-brown-900 flex items-center justify-center shrink-0 shadow-subtle">
                <Share2 className="w-4 h-4 text-brown-800" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-brown-900 truncate">
                  Your Tip Link is Active
                </p>
                <p className="text-[11px] text-brown-600 truncate font-mono">
                  {tipUrl.replace(/^https?:\/\//, "")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyTipLink}
              className="px-3.5 py-2 bg-brown-900 hover:bg-brown-950 text-white font-bold text-xs rounded-xl shadow-subtle transition-all shrink-0 active:scale-95 flex items-center gap-1.5"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? "Copied!" : "Copy Link"}</span>
            </button>
          </div>
        )}

        {/* Mobile Action Button */}
        <div className="sm:hidden pt-2">
          {safePendingTotal > 0 ? (
            <button
              onClick={handleTriggerClaim}
              className="w-full py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-2xl shadow-elevated transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <Shield className="w-4 h-4 text-emerald-200" />
              <span>
                {pendingTips.length > 1
                  ? `⚡ Claim All ${pendingTips.length} Tips (${formatZecValue(safePendingTotal)} ZEC)`
                  : `Claim ${formatZecValue(safePendingTotal)} ZEC to Wallet`}
              </span>
            </button>
          ) : (
            <button
              onClick={onOpenTip}
              className="w-full py-3.5 px-4 bg-brown-900 hover:bg-brown-950 text-white font-bold text-sm rounded-2xl shadow-elevated transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <Send className="w-4 h-4 text-butter-200" />
              <span>Send a Shielded Tip</span>
            </button>
          )}
        </div>

        {/* Desktop 4 Action Tiles Grid */}
        <div className="hidden sm:grid grid-cols-4 gap-3 pt-2">
          {/* Tile 1: Tip */}
          <button
            onClick={onOpenTip}
            className="flex flex-col items-center justify-center p-3.5 bg-butter-50 hover:bg-butter-100 border border-butter-200 hover:border-butter-300 rounded-2xl transition-all active:scale-95 group shadow-subtle"
          >
            <div className="w-10 h-10 rounded-xl bg-brown-900 text-white flex items-center justify-center shadow-subtle group-hover:scale-105 transition-all mb-2">
              <Send className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-brown-900">Tip</span>
          </button>

          {/* Tile 2: Request */}
          <button
            onClick={onOpenRequest}
            className="flex flex-col items-center justify-center p-3.5 bg-butter-50 hover:bg-butter-100 border border-butter-200 hover:border-butter-300 rounded-2xl transition-all group shadow-subtle"
          >
            <div className="w-10 h-10 rounded-xl bg-white border border-butter-300 text-brown-900 flex items-center justify-center shadow-subtle group-hover:scale-105 transition-all mb-2">
              <Inbox className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-brown-900">Request</span>
          </button>

          {/* Tile 3: PayLink */}
          <button
            onClick={onOpenPayLink}
            className="flex flex-col items-center justify-center p-3.5 bg-butter-50 hover:bg-butter-100 border border-butter-200 hover:border-butter-300 rounded-2xl transition-all group shadow-subtle"
          >
            <div className="w-10 h-10 rounded-xl bg-white border border-butter-300 text-brown-900 flex items-center justify-center shadow-subtle group-hover:scale-105 transition-all mb-2">
              <Link2 className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-brown-900">PayLink</span>
          </button>

          {/* Tile 4: Claim */}
          <button
            onClick={handleTriggerClaim}
            disabled={safePendingTotal <= 0}
            className="flex flex-col items-center justify-center p-3.5 bg-butter-50 hover:bg-butter-100 border border-butter-200 hover:border-butter-300 rounded-2xl transition-all group disabled:opacity-50 disabled:pointer-events-none shadow-subtle relative"
          >
            {pendingTips.length > 1 && (
              <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-emerald-600 text-white text-[9px] font-bold rounded-full shadow-subtle">
                {pendingTips.length}
              </span>
            )}
            <div className="w-10 h-10 rounded-xl bg-brown-900 text-white flex items-center justify-center shadow-subtle group-hover:scale-105 transition-all mb-2">
              <Shield className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-brown-900">
              {pendingTips.length > 1 ? "Claim All" : "Claim"}
            </span>
          </button>
        </div>
      </div>

      {/* 2. Recent Activity Section */}
      <div className="space-y-3 text-left">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-brown-950">Recent Activity</h3>
          <div className="flex gap-1 bg-white border border-butter-300 p-0.5 rounded-full shadow-subtle">
            {(["all", "received", "sent"] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-3 py-1 text-xs font-semibold rounded-full capitalize transition-all ${
                  activeFilter === filter
                    ? "bg-brown-900 text-white shadow-sm"
                    : "text-brown-500 hover:text-brown-900"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {isLoadingActivity && activity.length === 0 ? (
          <div className="bg-white border border-butter-300 rounded-3xl p-8 text-center space-y-2">
            <RefreshCw className="w-5 h-5 text-brown-400 animate-spin mx-auto" />
            <p className="text-xs font-medium text-brown-500">Syncing live blockchain & database activity...</p>
          </div>
        ) : filteredActivity.length === 0 ? (
          <div className="bg-white border border-butter-300 rounded-3xl p-6 sm:p-7 text-center space-y-4">
            <div className="w-12 h-12 bg-butter-50 border border-butter-200 rounded-2xl mx-auto flex items-center justify-center text-brown-800 shadow-subtle">
              <Sparkles className="w-6 h-6 text-brown-800" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm sm:text-base font-bold text-brown-950">Welcome to VeilX!</h4>
              <p className="text-xs text-brown-500 max-w-sm mx-auto leading-relaxed">
                Your private activity will show up here. Choose an action below to get started:
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-left">
              <button
                type="button"
                onClick={onOpenTip}
                className="p-3 bg-butter-50 hover:bg-butter-100/80 border border-butter-200 rounded-2xl transition-all flex items-center gap-2.5 active:scale-95 shadow-subtle group"
              >
                <div className="w-8 h-8 rounded-xl bg-brown-900 text-white flex items-center justify-center shrink-0 shadow-subtle">
                  <Send className="w-4 h-4 text-butter-200" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-brown-950 truncate">Send a Tip</p>
                  <p className="text-[10px] text-brown-500">Private shielded ZEC</p>
                </div>
              </button>

              <button
                type="button"
                onClick={onOpenPayLink}
                className="p-3 bg-butter-50 hover:bg-butter-100/80 border border-butter-200 rounded-2xl transition-all flex items-center gap-2.5 active:scale-95 shadow-subtle group"
              >
                <div className="w-8 h-8 rounded-xl bg-brown-900 text-white flex items-center justify-center shrink-0 shadow-subtle">
                  <Link2 className="w-4 h-4 text-butter-200" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-brown-950 truncate">Create PayLink</p>
                  <p className="text-[10px] text-brown-500">Shareable invoice</p>
                </div>
              </button>

              <button
                type="button"
                onClick={onOpenRequest}
                className="p-3 bg-butter-50 hover:bg-butter-100/80 border border-butter-200 rounded-2xl transition-all flex items-center gap-2.5 active:scale-95 shadow-subtle group"
              >
                <div className="w-8 h-8 rounded-xl bg-brown-900 text-white flex items-center justify-center shrink-0 shadow-subtle">
                  <Inbox className="w-4 h-4 text-butter-200" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-brown-950 truncate">Request ZEC</p>
                  <p className="text-[10px] text-brown-500">From another 𝕏 user</p>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredActivity.map((item) => {
              const isReceivedTip = item.type === "received";
              const isIncomingRequest = item.type === "request" && item.isIncoming;
              const isOutgoingRequest = item.type === "request" && !item.isIncoming;
              const isPayLink = item.type === "paylink";

              return (
                <div
                  key={item.id}
                  className="p-4 bg-white border border-butter-300 rounded-2xl flex items-center justify-between gap-3 shadow-subtle hover:border-butter-400 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isReceivedTip
                          ? "bg-emerald-50 text-emerald-700"
                          : isIncomingRequest
                          ? "bg-amber-50 text-amber-800"
                          : isPayLink
                          ? "bg-amber-50 text-amber-800"
                          : isOutgoingRequest
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-butter-100 text-brown-800"
                      }`}
                    >
                      {isReceivedTip ? (
                        <ArrowDownLeft className="w-5 h-5" />
                      ) : isIncomingRequest ? (
                        <Inbox className="w-5 h-5" />
                      ) : isPayLink ? (
                        <Link2 className="w-5 h-5" />
                      ) : isOutgoingRequest ? (
                        <ArrowDownLeft className="w-5 h-5" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-xs font-bold text-brown-950 truncate">
                        {isReceivedTip
                          ? item.isAnonymous
                            ? "From 🛡️ Anonymous Supporter"
                            : `From @${item.senderHandle || "supporter"}`
                          : isPayLink
                          ? `PayLink: ${item.title}`
                          : item.type === "request"
                          ? item.status === "CANCELLED"
                            ? item.cancelledByRole === "target"
                              ? item.isIncoming
                                ? `You declined request from @${item.requesterHandle || "requester"}`
                                : `@${item.targetHandle || "recipient"} declined your request`
                              : item.cancelledByRole === "requester"
                              ? item.isIncoming
                                ? `@${item.requesterHandle || "requester"} cancelled their request`
                                : `You cancelled your request to @${item.targetHandle || "recipient"}`
                              : item.isIncoming
                              ? `Request from @${item.requesterHandle || "someone"}`
                              : `Request to @${item.targetHandle || "recipient"}`
                            : item.status === "SETTLING"
                            ? item.isIncoming
                              ? `Payment broadcasted to @${item.requesterHandle || "requester"} — Confirming...`
                              : `@${item.targetHandle || "recipient"} broadcasted payment — Confirming...`
                            : item.status === "FULFILLED" || item.status === "FORWARD_PENDING"
                            ? item.isIncoming
                              ? `You paid request from @${item.requesterHandle || "requester"}`
                              : `@${item.targetHandle || "recipient"} paid your request`
                            : item.isIncoming
                            ? `Request from @${item.requesterHandle || "someone"}`
                            : `Request to @${item.targetHandle || "recipient"}`
                          : `Tip to @${item.recipientHandle || "creator"}`}
                      </p>
                      {item.memo && (
                        <p className="text-[11px] text-brown-500 truncate italic">
                          &ldquo;{item.memo}&rdquo;
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-brown-400">{item.date}</span>
                        {isPayLink && item.slug && (
                          <div className="inline-flex items-center gap-1 font-mono text-[10px] bg-butter-100/80 border border-butter-200/80 px-1.5 py-0.5 rounded-md text-brown-700">
                            <span>/pay/{item.slug}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyPayLink(item.slug);
                              }}
                              className="p-0.5 hover:bg-butter-200 rounded text-brown-500 hover:text-brown-900 transition-colors"
                              title="Copy PayLink URL"
                            >
                              {copiedPayLinkMap[item.slug] ? (
                                <Check className="w-2.5 h-2.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                            </button>
                            <a
                              href={`/pay/${item.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-0.5 hover:bg-butter-200 rounded text-brown-500 hover:text-brown-900 transition-colors inline-flex items-center"
                              title="Open PayLink in New Tab"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        )}
                        {/* Clean Perspective-Aware Transaction Hash Link */}
                        {item.txid && (
                          <div className="inline-flex items-center gap-1 font-mono text-[10px] bg-butter-100/90 border border-butter-200 px-2 py-0.5 rounded-full text-brown-700 shadow-subtle shrink-0">
                            <span title={item.txid} className="whitespace-nowrap font-medium">
                              Tx: {truncateAddress(item.txid, 4, 4)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyTxid(item.id, item.txid);
                              }}
                              className="p-0.5 hover:bg-butter-200 rounded text-brown-500 hover:text-brown-900 transition-colors cursor-pointer"
                              title="Copy Transaction Hash"
                            >
                              {copiedTxidMap[item.id] ? (
                                <Check className="w-2.5 h-2.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                            </button>
                            <a
                              href={getZcashExplorerUrl(item.txid)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-0.5 hover:bg-butter-200 rounded text-brown-500 hover:text-brown-900 transition-colors inline-flex items-center"
                              title="View on Zcash Block Explorer"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        )}

                        {/* Payout Pending alert chip */}
                        {item.payoutError && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded-md"
                            title={item.payoutError}
                          >
                            <span>⚠️ Payout Pending</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="font-mono font-bold text-sm text-brown-950">
                      {isReceivedTip
                        ? `+${formatZecValue(item.amountZec)}`
                        : isPayLink
                        ? `+${formatZecValue(item.amountZec)}`
                        : isIncomingRequest
                        ? `-${formatZecValue(item.amountZec)}`
                        : isOutgoingRequest
                        ? `+${formatZecValue(item.amountZec)}`
                        : `-${formatZecValue(item.amountZec)}`} ZEC
                    </span>

                    {/* Action & Status Classification */}
                    {isPayLink ? (
                      (item.paidTxid && !item.forwardTxid) ||
                      item.status === "SETTLING" ||
                      item.status === "FORWARD_PENDING" ||
                      item.payoutError ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            onClick={() =>
                              onOpenClaim({
                                id: item.id,
                                slug: item.slug,
                                title: item.title,
                                type: item.type,
                                amountZec: item.amountZec,
                                memo: item.title,
                                isAnonymous: false,
                                recipientShieldedUa: item.recipientShieldedUa,
                                paidTxid: item.paidTxid,
                                forwardTxid: item.forwardTxid,
                                depositTxid: item.paidTxid,
                                payoutError: item.payoutError,
                              })
                            }
                            size="sm"
                            variant="primary"
                            className="h-7 px-3 text-[11px] font-bold shadow-subtle bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                          >
                            Claim
                          </Button>
                          <StatusBadge status="READY_TO_DISBURSE" />
                        </div>
                      ) : item.paidTxid && item.forwardTxid ? (
                        <StatusBadge status="SETTLED" customLabel="Disbursed" />
                      ) : (
                        <StatusBadge status={item.status} />
                      )
                    ) : isOutgoingRequest ? (
                      item.status === "PENDING" ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            onClick={() => handleCancelRequest(item.id)}
                            size="sm"
                            variant="ghost"
                            disabled={isActionLoadingMap[item.id]}
                            className="h-7 px-2.5 text-[11px] font-semibold text-brown-600 hover:text-rose-700 hover:bg-rose-50 border border-butter-300"
                          >
                            {isActionLoadingMap[item.id] ? "Cancelling..." : "Cancel"}
                          </Button>
                          <StatusBadge status={item.status} />
                        </div>
                      ) : item.status === "CANCELLED" ? (
                        <StatusBadge status="CANCELLED" />
                      ) : (item.paidTxid && !item.forwardTxid) ||
                        item.status === "SETTLING" ||
                        item.status === "FORWARD_PENDING" ||
                        item.payoutError ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            onClick={() =>
                              onOpenClaim({
                                id: item.id,
                                type: item.type,
                                amountZec: item.amountZec,
                                memo: item.memo,
                                isAnonymous: false,
                                recipientShieldedUa: item.recipientShieldedUa,
                                paidTxid: item.paidTxid,
                                forwardTxid: item.forwardTxid,
                                depositTxid: item.paidTxid,
                                payoutError: item.payoutError,
                              })
                            }
                            size="sm"
                            variant="primary"
                            className="h-7 px-3 text-[11px] font-bold shadow-subtle bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                          >
                            Claim
                          </Button>
                          <StatusBadge status="READY_TO_DISBURSE" />
                        </div>
                      ) : item.paidTxid && item.forwardTxid ? (
                        <StatusBadge status="SETTLED" customLabel="Disbursed" />
                      ) : (
                        <StatusBadge status={item.status} />
                      )
                    ) : isIncomingRequest ? (
                      item.status === "PENDING" ? (
                        <div className="flex items-center gap-1.5">
                          {confirmDeclineId === item.id ? (
                            <div className="flex items-center gap-1">
                              <Button
                                onClick={() => {
                                  handleDeclineRequest(item.id);
                                  setConfirmDeclineId(null);
                                }}
                                size="sm"
                                variant="ghost"
                                disabled={isActionLoadingMap[item.id]}
                                className="h-7 px-2 text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700"
                              >
                                {isActionLoadingMap[item.id] ? "..." : "Confirm"}
                              </Button>
                              <Button
                                onClick={() => setConfirmDeclineId(null)}
                                size="sm"
                                variant="ghost"
                                className="h-7 px-1.5 text-[10px] text-brown-500 hover:bg-butter-200"
                              >
                                No
                              </Button>
                            </div>
                          ) : (
                            <Button
                              onClick={() => setConfirmDeclineId(item.id)}
                              size="sm"
                              variant="ghost"
                              disabled={isActionLoadingMap[item.id]}
                              className="h-7 px-2.5 text-[11px] font-semibold text-rose-700 hover:text-rose-800 hover:bg-rose-50 border border-rose-200"
                            >
                              Decline
                            </Button>
                          )}
                          <Link href={`/request/${item.id}`}>
                            <Button
                              size="sm"
                              variant="primary"
                              className="h-7 px-3 text-[11px] font-bold shadow-subtle"
                            >
                              Pay
                            </Button>
                          </Link>
                        </div>
                      ) : item.status === "CANCELLED" ? (
                        <StatusBadge status="CANCELLED" />
                      ) : item.status === "SETTLING" ? (
                        <StatusBadge status="SETTLING" customLabel="Payment Confirming" />
                      ) : item.paidTxid ? (
                        <StatusBadge status="SETTLED" customLabel="Paid" />
                      ) : (
                        <StatusBadge status={item.status} />
                      )
                    ) : isReceivedTip ? (
                      item.status === "FUNDED" ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            onClick={() => onOpenClaim(item)}
                            size="sm"
                            variant="primary"
                            className="h-7 px-3 text-[11px] font-bold shadow-subtle cursor-pointer"
                          >
                            Claim
                          </Button>
                          <StatusBadge status="READY_TO_DISBURSE" />
                        </div>
                      ) : item.status === "PENDING_VERIFICATION" ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            onClick={() => onOpenClaim(item)}
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 text-[11px] font-semibold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200"
                          >
                            Retry Claim
                          </Button>
                          <StatusBadge status={item.status} />
                        </div>
                      ) : item.status === "CLAIMED" ? (
                        <StatusBadge status="CLAIMED" customLabel="Claimed" />
                      ) : item.status === "FUNDING_DETECTED" ? (
                        <StatusBadge status="FUNDING_DETECTED" customLabel="Incoming (Confirming)" />
                      ) : (
                        <StatusBadge status={item.status} />
                      )
                    ) : (
                      <StatusBadge
                        status={item.status}
                        customLabel={
                          item.type === "sent" && item.status === "FUNDED"
                            ? "Delivered to Escrow"
                            : item.type === "sent" && item.status === "CLAIMED"
                            ? "Claimed by Recipient"
                            : item.type === "sent" && item.status === "PENDING_VERIFICATION"
                            ? "Claim in Progress"
                            : item.type === "sent" && item.status === "FUNDING_DETECTED"
                            ? "Confirming on-chain"
                            : undefined
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
