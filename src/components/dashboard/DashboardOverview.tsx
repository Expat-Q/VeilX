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
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { XLogo } from "@/components/ui/XLogo";
import { formatUsd, truncateAddress, getZcashExplorerUrl } from "@/lib/utils";
import { useZecPrice } from "@/lib/price-service";

export interface DashboardOverviewProps {
  user: {
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
  onOpenBatchClaim?: (tips: any[]) => void;
  onLogout?: () => void;
}

export function DashboardOverview({
  user,
  onOpenTip,
  onOpenRequest,
  onOpenPayLink,
  onOpenClaim,
  onOpenBatchClaim,
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
            const isUserSender = safeUsername ? senderSnapshot === safeUsername : false;
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

            const txid = r.paidTxid || undefined;
            const numericAmount = typeof r.amountZec === "number" ? r.amountZec : parseFloat(r.amountZec) || 0;
            const targetSnapshot = (r.targetUsernameSnapshot || "").toLowerCase();
            const isIncoming = safeUsername ? targetSnapshot === safeUsername : false;

            newActivity.push({
              id: r._id || r.id,
              type: "request",
              isIncoming,
              requesterHandle: r.requesterUsernameSnapshot,
              targetHandle: r.targetUsernameSnapshot,
              amountZec: numericAmount,
              memo: r.memo,
              status: r.status,
              cancelledByRole: r.cancelledByRole,
              cancelledByUsername: r.cancelledByUsername,
              txid,
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

            const txid = p.paidTxid || undefined;
            const numericAmount = typeof p.amountZec === "number" ? p.amountZec : parseFloat(p.amountZec) || 0;

            newActivity.push({
              id: p._id || p.id || p.slug,
              type: "paylink",
              slug: p.slug,
              title: p.title,
              amountZec: numericAmount,
              status: p.status || "UNPAID",
              txid,
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
    const interval = setInterval(fetchLiveActivity, 8000);
    return () => clearInterval(interval);
  }, [fetchLiveActivity]);

  const pendingTips = activity.filter((a) => a.type === "received" && a.status === "FUNDED");
  const pendingIncomingTotal = pendingTips.reduce(
    (acc, curr) => acc + (typeof curr.amountZec === "number" ? curr.amountZec : parseFloat(curr.amountZec) || 0),
    0
  );
  const safePendingTotal = typeof pendingIncomingTotal === "number" && !isNaN(pendingIncomingTotal) ? pendingIncomingTotal : 0;

  const handleTriggerClaim = () => {
    if (pendingTips.length > 1 && onOpenBatchClaim) {
      onOpenBatchClaim(pendingTips);
    } else if (pendingTips.length > 0) {
      onOpenClaim(pendingTips[0]);
    }
  };

  const filteredActivity = activity.filter((item) => {
    if (activeFilter === "received") {
      return item.type === "received" || (item.type === "request" && item.isIncoming);
    }
    if (activeFilter === "sent") {
      return item.type === "sent" || (item.type === "request" && !item.isIncoming) || item.type === "paylink";
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

        <div className="text-center space-y-1.5 py-2">
          <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-brown-400">
            Pending Shielded Tips to Claim
          </p>
          <p className="text-3xl sm:text-5xl font-mono font-extrabold text-brown-950 tracking-tight">
            {safePendingTotal.toFixed(2)} <span className="text-xl sm:text-2xl font-bold text-brown-700">ZEC</span>
          </p>
          <p className="text-xs font-medium text-brown-500">
            ≈ {formatZecToUsd(safePendingTotal)} USD
          </p>
        </div>

        {/* Claim All Banner Pill if user has pending tips */}
        {pendingTips.length > 0 && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 shadow-subtle animate-in fade-in">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-subtle">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-emerald-950 truncate">
                  {pendingTips.length === 1 ? "1 Tip Waiting in Escrow" : `${pendingTips.length} Tips Waiting in Escrow`}
                </p>
                <p className="text-[11px] text-emerald-700 font-mono">
                  {safePendingTotal.toFixed(4)} ZEC ready to claim
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleTriggerClaim}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-subtle transition-all shrink-0 active:scale-95 flex items-center gap-1.5"
            >
              <span>{pendingTips.length > 1 ? "⚡ Claim All" : "Claim"}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
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
                  ? `⚡ Claim All ${pendingTips.length} Tips (${safePendingTotal.toFixed(2)} ZEC)`
                  : `Claim ${safePendingTotal.toFixed(2)} ZEC to Wallet`}
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

      {/* 2. Public Tipping & Referral Rewards Link Card */}
      <div className="p-4 sm:p-5 bg-butter-50 border border-butter-300 rounded-3xl text-left space-y-3 shadow-subtle">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-brown-900 text-white flex items-center justify-center shadow-subtle shrink-0">
            <XLogo className="w-3.5 h-3.5 fill-current text-white" />
          </div>
          <h4 className="text-xs sm:text-sm font-bold text-brown-950">
            Your Public X Tipping & Referral Link
          </h4>
        </div>

        <p className="text-[11px] sm:text-xs text-brown-600 leading-relaxed">
          Share your personal link to receive direct zero-knowledge shielded tips and earn rewards whenever new creators join VeilX using your link.
        </p>

        {/* Live Referral Stats Bar */}
        <div className="grid grid-cols-2 gap-2 p-2.5 bg-white/80 border border-butter-200 rounded-2xl text-center">
          <div className="border-r border-butter-200 pr-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-brown-500">Users Referred</p>
            <p className="text-sm sm:text-base font-bold text-brown-950 font-mono">
              {user?.referralCount ?? 0} <span className="text-[11px] font-medium text-brown-600">creators</span>
            </p>
          </div>
          <div className="pl-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-brown-500">Rewards Earned</p>
            <p className="text-sm sm:text-base font-bold text-emerald-700 font-mono">
              {typeof user?.referralRewardsZec === "number" ? user.referralRewardsZec.toFixed(2) : "0.00"} <span className="text-[11px] font-bold text-emerald-600">ZEC</span>
              <span className="text-[10px] font-medium text-brown-500 ml-1">({user?.referralPoints ?? 0} pts)</span>
            </p>
          </div>
        </div>

        <div className="p-2.5 bg-white rounded-2xl border border-butter-200 flex items-center justify-between gap-2">
          <p className="text-xs font-mono text-brown-800 truncate select-all">{tipUrl}</p>
          <button
            onClick={handleCopyTipLink}
            className="py-1.5 px-3 rounded-xl bg-brown-900 hover:bg-brown-950 text-white font-bold transition-all shrink-0 flex items-center gap-1.5 text-xs shadow-subtle active:scale-95"
            title="Copy Referral Link"
          >
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-butter-200" />
                <span className="text-butter-100">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-butter-200" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 3. Recent Activity Section */}
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
          <div className="bg-white border border-butter-300 rounded-3xl p-6">
            <EmptyState
              title="No transactions yet"
              description="Tips you send or receive will appear here in real time."
              actionLabel="Send a Tip"
              onAction={onOpenTip}
            />
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
                        {item.txid && (
                          <div className="inline-flex items-center gap-1 font-mono text-[10px] bg-butter-100/80 border border-butter-200/80 px-1.5 py-0.5 rounded-md text-brown-700">
                            <span title={item.txid}>{truncateAddress(item.txid, 6, 6)}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyTxid(item.id, item.txid);
                              }}
                              className="p-0.5 hover:bg-butter-200 rounded text-brown-500 hover:text-brown-900 transition-colors"
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
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="font-mono font-bold text-sm text-brown-950">
                      {isReceivedTip
                        ? `+${item.amountZec}`
                        : isPayLink
                        ? `+${item.amountZec}`
                        : isIncomingRequest
                        ? `-${item.amountZec}`
                        : isOutgoingRequest
                        ? `+${item.amountZec}`
                        : `-${item.amountZec}`} ZEC
                    </span>
                    {isReceivedTip && item.status === "FUNDED" ? (
                      <Button
                        onClick={() => onOpenClaim(item)}
                        size="sm"
                        variant="primary"
                        className="h-7 px-3 text-[11px] font-bold shadow-subtle"
                      >
                        Claim
                      </Button>
                    ) : item.type === "request" && item.status === "PENDING" ? (
                      item.isIncoming ? (
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
                      ) : (
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
                      )
                    ) : item.status === "FORWARD_PENDING" ? (
                      <div className="flex items-center gap-1.5">
                        {isPayLink ? (
                          <Button
                            onClick={() => handleRetryPayLinkForward(item.slug)}
                            size="sm"
                            variant="primary"
                            disabled={isActionLoadingMap[item.slug]}
                            className="h-7 px-2.5 text-[11px] font-bold shadow-subtle bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            {isActionLoadingMap[item.slug] ? "Retrying..." : "Retry Payout"}
                          </Button>
                        ) : item.type === "request" && !item.isIncoming ? (
                          <Button
                            onClick={() => handleRetryRequestForward(item.id)}
                            size="sm"
                            variant="primary"
                            disabled={isActionLoadingMap[item.id]}
                            className="h-7 px-2.5 text-[11px] font-bold shadow-subtle bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            {isActionLoadingMap[item.id] ? "Retrying..." : "Retry Payout"}
                          </Button>
                        ) : null}
                        <StatusBadge status={item.status} />
                      </div>
                    ) : (
                      <StatusBadge status={item.status} />
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
