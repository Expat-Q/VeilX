"use client";

import React, { useState, useEffect } from "react";
import {
  Wallet,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  LogOut,
} from "lucide-react";
import {
  connectInjectedWallet,
  hasInjectedProvider,
  switchOrAddNetwork,
  fetchWalletBalance,
} from "@/lib/evm-wallet";
import { truncateAddress } from "@/lib/utils";
import { SupportedSwapToken } from "@/types/swap";

interface EvmWalletCardProps {
  walletAddress: string | null;
  chainId: number | null;
  selectedToken: SupportedSwapToken;
  onConnect: (address: string, chainId: number) => void;
  onDisconnect: () => void;
  onChainChange?: (newChainId: number) => void;
  onUseBalance?: (balance: string) => void;
}

export function EvmWalletCard({
  walletAddress,
  chainId,
  selectedToken,
  onConnect,
  onDisconnect,
  onChainChange,
  onUseBalance,
}: EvmWalletCardProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  useEffect(() => {
    setHasProvider(hasInjectedProvider());
  }, []);

  // Fetch balance whenever connected address or token changes
  useEffect(() => {
    if (!walletAddress) {
      setTokenBalance(null);
      return;
    }

    let isMounted = true;
    setIsLoadingBalance(true);

    fetchWalletBalance({ address: walletAddress, token: selectedToken })
      .then((bal) => {
        if (isMounted) {
          setTokenBalance(bal);
          setIsLoadingBalance(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoadingBalance(false);
      });

    return () => {
      isMounted = false;
    };
  }, [walletAddress, selectedToken]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setWalletError(null);
    try {
      // Explicitly triggers wallet popup modal
      const res = await connectInjectedWallet();
      onConnect(res.address, res.chainId);
    } catch (err: any) {
      console.warn("Wallet connect:", err);
      setWalletError(err.message || "Connection was cancelled or rejected in wallet.");
    } finally {
      setIsConnecting(false);
    }
  };


  const handleSwitchNetwork = async () => {
    setIsSwitchingChain(true);
    setWalletError(null);
    try {
      await switchOrAddNetwork(selectedToken.chainId);
      if (onChainChange) onChainChange(selectedToken.chainId);
    } catch (err: any) {
      setWalletError(err.message || "Network switch failed.");
    } finally {
      setIsSwitchingChain(false);
    }
  };

  const isWrongNetwork = Boolean(
    walletAddress && chainId && chainId !== selectedToken.chainId
  );

  return (
    <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl space-y-2.5 text-left transition-all">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-brown-950 flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5 text-brown-700" />
          EVM Wallet
        </span>
        {walletAddress ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100/70 border border-emerald-300 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Connected
          </span>
        ) : (
          <span className="text-[10px] text-brown-500 font-medium">
            Connect to pay in {selectedToken.symbol}
          </span>
        )}
      </div>

      {walletError && (
        <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-700 font-medium flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
          <span className="truncate">{walletError}</span>
        </div>
      )}

      {walletAddress ? (
        <div className="space-y-2">
          {/* Connected Address & Live Balance Row */}
          <div className="p-2.5 bg-white border border-butter-200 rounded-xl flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase font-bold text-brown-400">
                Connected Payer
              </p>
              <p className="text-xs font-mono font-bold text-brown-950 truncate">
                {truncateAddress(walletAddress, 8, 6)}
              </p>
            </div>

            {/* Balance Pill */}
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase font-bold text-brown-400">
                Wallet Balance
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-bold text-brown-900">
                  {isLoadingBalance ? "..." : tokenBalance ?? "0.00"} {selectedToken.symbol}
                </span>
                {tokenBalance && parseFloat(tokenBalance) > 0 && onUseBalance && (
                  <button
                    type="button"
                    onClick={() => onUseBalance(tokenBalance)}
                    className="text-[10px] font-bold bg-butter-100 hover:bg-brown-900 hover:text-white text-brown-800 px-1.5 py-0.5 rounded transition-all"
                  >
                    MAX
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onDisconnect}
              className="p-1.5 rounded-lg text-brown-500 hover:text-rose-600 hover:bg-rose-50 transition-all shrink-0 ml-1"
              title="Disconnect Wallet"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Network Check & Switcher */}
          {isWrongNetwork ? (
            <div className="p-2 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between text-xs">
              <span className="text-amber-900 font-medium text-[11px]">
                Wallet on Chain ID {chainId}
              </span>
              <button
                type="button"
                onClick={handleSwitchNetwork}
                disabled={isSwitchingChain}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold transition-all shadow-subtle flex items-center gap-1"
              >
                {isSwitchingChain && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span>Switch to {selectedToken.networkName}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-brown-600 px-1 font-medium">
              <span>Active Network:</span>
              <span className="font-bold text-brown-950 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                {selectedToken.networkName}
              </span>
            </div>
          )}
        </div>
      ) : (
        /* Not Connected State */
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full py-2.5 px-3 bg-brown-900 hover:bg-brown-950 text-white rounded-xl text-xs font-bold transition-all shadow-subtle flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            {isConnecting ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wallet className="w-4 h-4 text-butter-200" />
            )}
            <span>
              {isConnecting ? "Waiting for Approval..." : "Connect EVM"}
            </span>
          </button>

          {!hasProvider && (
            <div className="text-[10px] text-brown-500 pt-1 text-center">
              <span>Install MetaMask or Coinbase Wallet extension to connect.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
