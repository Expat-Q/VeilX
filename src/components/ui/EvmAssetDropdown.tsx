"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { SupportedSwapToken, SUPPORTED_SWAP_TOKENS } from "@/types/swap";
import {
  UsdcLogo,
  UsdtLogo,
  EthLogo,
  BaseLogo,
  ArbitrumLogo,
} from "@/components/ui/CryptoLogos";

interface EvmAssetDropdownProps {
  selectedTokenId: string;
  onSelectToken: (token: SupportedSwapToken) => void;
  disabled?: boolean;
}

export function EvmAssetDropdown({
  selectedTokenId,
  onSelectToken,
  disabled = false,
}: EvmAssetDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedToken =
    SUPPORTED_SWAP_TOKENS.find((t) => t.id === selectedTokenId) || SUPPORTED_SWAP_TOKENS[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const renderTokenLogo = (symbol: string, className = "w-7 h-7") => {
    switch (symbol) {
      case "USDC":
        return <UsdcLogo className={className} />;
      case "USDT":
        return <UsdtLogo className={className} />;
      case "ETH":
        return <EthLogo className={className} />;
      default:
        return <UsdcLogo className={className} />;
    }
  };

  const renderNetworkBadge = (network: string) => {
    switch (network) {
      case "base":
        return <BaseLogo className="w-3.5 h-3.5" />;
      case "arbitrum":
        return <ArbitrumLogo className="w-3.5 h-3.5" />;
      case "ethereum":
        return <EthLogo className="w-3.5 h-3.5" />;
      default:
        return null;
    }
  };

  return (
    <div className="relative w-full text-left" ref={dropdownRef}>
      <label className="text-xs font-semibold text-brown-900 block mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          Select Token & Chain
        </span>
        <span className="text-[10px] font-mono text-brown-500">
          Cross-Chain Settlement
        </span>
      </label>

      {/* Main Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full p-3 bg-white border rounded-2xl flex items-center justify-between gap-3 transition-all text-left shadow-subtle ${
          isOpen
            ? "border-brown-900 ring-1 ring-brown-900"
            : "border-butter-300 hover:border-butter-400 hover:bg-butter-50/50"
        } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 drop-shadow-sm">
            {renderTokenLogo(selectedToken.symbol, "w-8 h-8")}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-brown-950">
                {selectedToken.symbol}
              </span>
              <span className="text-xs text-brown-500 font-medium truncate">
                · {selectedToken.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-brown-600 font-medium">
              {renderNetworkBadge(selectedToken.network)}
              <span>{selectedToken.networkName}</span>
              <span className="text-[10px] font-mono text-brown-400">
                (Chain ID: {selectedToken.chainId})
              </span>
            </div>
          </div>
        </div>

        <ChevronDown
          className={`w-4 h-4 text-brown-500 shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-brown-950" : ""
          }`}
        />
      </button>

      {/* Dropdown Popover Menu */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-butter-300 rounded-2xl shadow-dropdown overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-1.5 space-y-1 max-h-64 overflow-y-auto">
            {SUPPORTED_SWAP_TOKENS.map((token) => {
              const isSelected = token.id === selectedToken.id;
              return (
                <button
                  key={token.id}
                  type="button"
                  onClick={() => {
                    onSelectToken(token);
                    setIsOpen(false);
                  }}
                  className={`w-full p-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition-all ${
                    isSelected
                      ? "bg-brown-900 text-white"
                      : "hover:bg-butter-50 text-brown-950"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0 drop-shadow-sm">
                      {renderTokenLogo(token.symbol, "w-7 h-7")}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold">{token.symbol}</span>
                        <span
                          className={`text-[11px] font-medium truncate ${
                            isSelected ? "text-butter-200" : "text-brown-500"
                          }`}
                        >
                          {token.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {renderNetworkBadge(token.network)}
                        <p
                          className={`text-[10px] font-mono ${
                            isSelected ? "text-butter-300" : "text-brown-400"
                          }`}
                        >
                          {token.networkName}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded font-bold ${
                        isSelected
                          ? "bg-white/20 text-butter-100"
                          : "bg-butter-100 text-brown-600"
                      }`}
                    >
                      {token.network}
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-butter-200 shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
