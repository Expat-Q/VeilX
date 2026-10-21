import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatZecValue(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num) || num === 0) return "0.00";
  if (num < 0.0001) {
    return num.toFixed(6).replace(/\.?0+$/, "");
  }
  if (num < 0.01) {
    return num.toFixed(5).replace(/\.?0+$/, "");
  }
  if (num < 1) {
    return num.toFixed(4).replace(/\.?0+$/, "");
  }
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function formatZec(amount: number | string): string {
  return `${formatZecValue(amount)} ZEC`;
}

export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) {
    return "< $0.01";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function truncateAddress(address: string, start = 10, end = 6): string {
  if (!address || address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

export function getZcashExplorerUrl(txid?: string | null, network = process.env.NEXT_PUBLIC_ZCASH_NETWORK || "mainnet"): string {
  if (!txid || !txid.trim()) return "#";
  const clean = txid.trim();
  return `https://blockchair.com/zcash/transaction/${clean}`;
}
