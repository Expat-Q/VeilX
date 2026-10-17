"use client";

import { useState, useEffect } from "react";
import { formatUsd } from "@/lib/utils";

export interface ZecPriceData {
  priceUsd: number;
  change24h: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  updatedAt: number;
  source: string;
}

let globalPriceState: ZecPriceData = {
  priceUsd: 38.5,
  change24h: 0,
  updatedAt: Date.now(),
  source: "initial",
};

let isFetching = false;
const listeners = new Set<(data: ZecPriceData) => void>();

async function fetchLatestPrice(): Promise<ZecPriceData> {
  if (isFetching) return globalPriceState;
  isFetching = true;
  try {
    const res = await fetch("/api/prices");
    const json = await res.json();
    if (json.success && json.data) {
      globalPriceState = json.data;
      listeners.forEach((fn) => fn(globalPriceState));
    }
  } catch (err) {
    console.warn("Failed to fetch live ZEC price:", err);
  } finally {
    isFetching = false;
  }
  return globalPriceState;
}

export function useZecPrice() {
  const [priceData, setPriceData] = useState<ZecPriceData>(globalPriceState);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    listeners.add(setPriceData);
    fetchLatestPrice();

    // Poll live price every 45 seconds
    const interval = setInterval(fetchLatestPrice, 45000);
    return () => {
      listeners.delete(setPriceData);
      clearInterval(interval);
    };
  }, []);

  const formatZecToUsd = (zecAmount: number | string): string => {
    const num = typeof zecAmount === "string" ? parseFloat(zecAmount) || 0 : zecAmount;
    return formatUsd(num * priceData.priceUsd);
  };

  const formatUsdToZec = (usdAmount: number | string): number => {
    const num = typeof usdAmount === "string" ? parseFloat(usdAmount) || 0 : usdAmount;
    if (priceData.priceUsd <= 0) return 0;
    return parseFloat((num / priceData.priceUsd).toFixed(4));
  };

  return {
    priceUsd: priceData.priceUsd,
    change24h: priceData.change24h,
    source: priceData.source,
    updatedAt: priceData.updatedAt,
    isLoading,
    formatZecToUsd,
    formatUsdToZec,
    refetchPrice: fetchLatestPrice,
  };
}
