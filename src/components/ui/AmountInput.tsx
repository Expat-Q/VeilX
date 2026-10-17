"use client";

import React from "react";
import { cn, formatUsd } from "@/lib/utils";
import { useZecPrice } from "@/lib/price-service";

export interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  zecPriceUsd?: number;
  presets?: number[];
  label?: string;
  currencySymbol?: string;
  customSubtext?: string;
  step?: string;
  error?: string;
}

export function AmountInput({
  value,
  onChange,
  zecPriceUsd,
  presets = [0.05, 0.1, 0.25, 0.5],
  label = "Amount (ZEC)",
  currencySymbol = "ZEC",
  customSubtext,
  step = "0.0001",
  error,
}: AmountInputProps) {
  const { priceUsd: livePrice } = useZecPrice();
  const effectivePrice = zecPriceUsd !== undefined ? zecPriceUsd : livePrice;
  const numericValue = parseFloat(value) || 0;

  // If customSubtext is provided, use it; otherwise compute USD for ZEC
  const subtext =
    customSubtext ||
    (currencySymbol === "ZEC"
      ? `≈ ${formatUsd(numericValue * effectivePrice)} USD`
      : undefined);

  return (
    <div className="w-full space-y-3 text-left">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-brown-900 tracking-wide">
          {label}
        </label>
        {subtext && (
          <span className="text-xs font-semibold text-emerald-800 font-mono">
            {subtext}
          </span>
        )}
      </div>

      <div className="relative flex items-center bg-white border border-butter-300 rounded-2xl p-4 focus-within:border-brown-900 focus-within:ring-1 focus-within:ring-brown-900 transition-all shadow-subtle">
        <input
          type="number"
          step={step}
          min="0.000001"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className="w-full text-3xl font-mono font-bold text-brown-950 placeholder:text-brown-300 bg-transparent focus:outline-none tracking-tight"
        />
        <div className="flex items-center gap-1.5 pl-3 border-l border-butter-200">
          <span className="text-sm font-bold text-brown-900 font-mono">
            {currencySymbol}
          </span>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

      {/* Preset Buttons */}
      <div className="grid grid-cols-4 gap-2">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset.toString())}
            className={cn(
              "h-9 rounded-xl border text-xs font-semibold font-mono transition-all duration-150",
              parseFloat(value) === preset
                ? "bg-brown-900 text-white border-brown-900 shadow-sm"
                : "bg-white text-brown-800 border-butter-300 hover:border-brown-400 hover:bg-butter-50 shadow-subtle"
            )}
          >
            {currencySymbol === "USDC" || currencySymbol === "USDT"
              ? `$${preset}`
              : `${preset} ${currencySymbol}`}
          </button>
        ))}
      </div>
    </div>
  );
}
