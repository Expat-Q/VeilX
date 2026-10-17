import React from "react";
import { cn } from "@/lib/utils";

export type TipBadgeStatus = "PENDING" | "FUNDING_DETECTED" | "FUNDED" | "CLAIMING" | "CLAIMED" | "CANCELLED";

export interface StatusBadgeProps {
  status: TipBadgeStatus | string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = (status ? String(status) : "PENDING").toUpperCase();

  const config: Record<string, { label: string; styles: string; dot: string }> = {
    PENDING: {
      label: "Pending",
      styles: "bg-amber-50 text-amber-900 border-amber-200/80",
      dot: "bg-amber-500",
    },
    FUNDING_DETECTED: {
      label: "Confirming...",
      styles: "bg-amber-50 text-amber-900 border-amber-200/80 animate-pulse",
      dot: "bg-amber-500",
    },
    FUNDED: {
      label: "Ready to claim",
      styles: "bg-emerald-50 text-emerald-900 border-emerald-200/80",
      dot: "bg-emerald-500",
    },
    CLAIMING: {
      label: "Claiming...",
      styles: "bg-gold-50 text-gold-900 border-gold-200/80 animate-pulse",
      dot: "bg-gold-500",
    },
    CLAIMED: {
      label: "Claimed",
      styles: "bg-stone-100 text-stone-700 border-stone-200",
      dot: "bg-stone-400",
    },
    CANCELLED: {
      label: "Cancelled",
      styles: "bg-rose-50 text-rose-800 border-rose-200/80",
      dot: "bg-rose-500",
    },
    UNPAID: {
      label: "Unpaid",
      styles: "bg-amber-50 text-amber-900 border-amber-200/80",
      dot: "bg-amber-500",
    },
    PAID: {
      label: "Paid",
      styles: "bg-emerald-50 text-emerald-900 border-emerald-200/80",
      dot: "bg-emerald-500",
    },
    FULFILLED: {
      label: "Paid",
      styles: "bg-emerald-50 text-emerald-900 border-emerald-200/80",
      dot: "bg-emerald-500",
    },
    FORWARD_PENDING: {
      label: "Payout Pending",
      styles: "bg-amber-50 text-amber-900 border-amber-200/80 animate-pulse",
      dot: "bg-amber-500",
    },
    SETTLING: {
      label: "Settling...",
      styles: "bg-gold-50 text-gold-900 border-gold-200/80 animate-pulse",
      dot: "bg-gold-500",
    },
  };

  const current = config[normalized] || {
    label: status,
    styles: "bg-butter-100 text-brown-800 border-butter-300",
    dot: "bg-brown-400",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border tracking-tight",
        current.styles,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", current.dot)} />
      <span>{current.label}</span>
    </span>
  );
}
