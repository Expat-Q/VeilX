import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatZec(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0.00 ZEC";
  return `${num.toFixed(num % 1 === 0 ? 2 : 4)} ZEC`;
}

export function formatUsd(amount: number): string {
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
  if (network === "mainnet") {
    return `https://zcashblockexplorer.com/transactions/${clean}`;
  }
  return `https://testnet.zcashblockexplorer.com/transactions/${clean}`;
}

