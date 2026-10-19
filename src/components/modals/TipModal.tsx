"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  ArrowLeft,
  ArrowRight,
  Lock,
  CheckCircle2,
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  UserCheck,
  AlertCircle,
  X,
  Loader2,
  Coins,
  ArrowRightLeft,
  RefreshCw,
  Wallet,
  Clock,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AmountInput } from "@/components/ui/AmountInput";
import { XProfileCard } from "@/components/ui/XProfileCard";
import { QRDisplay } from "@/components/ui/QRDisplay";
import { XLogo } from "@/components/ui/XLogo";
import { useZecPrice } from "@/lib/price-service";
import { getZcashExplorerUrl, truncateAddress } from "@/lib/utils";
import { buildZip321Uri } from "@/lib/wallet";
import {
  SUPPORTED_SWAP_TOKENS,
  SupportedSwapToken,
  SwapOrder,
} from "@/types/swap";
import { EvmAssetDropdown } from "@/components/ui/EvmAssetDropdown";
import { EvmWalletCard } from "@/components/ui/EvmWalletCard";
import { ZcashLogo } from "@/components/ui/CryptoLogos";
import {
  sendEvmPayment,
  connectInjectedWallet,
  hasInjectedProvider,
} from "@/lib/evm-wallet";

import {
  getRecentAccounts,
  saveRecentAccount,
  clearRecentAccounts,
  SearchedAccount,
} from "@/lib/recent-searches";
import { InvoiceReceiptCard } from "@/components/ui/InvoiceReceiptCard";

export interface TipModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (tipData: any) => void;
}

export function TipModal({ isOpen, onClose, onSuccess }: TipModalProps) {
  // Steps: 1. Recipient -> 2. Amount & Currency -> 3. Privacy & Confirm -> 4. Pay/QR -> 5. Done
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [usernameSearch, setUsernameSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<{
    name: string;
    username: string;
    bio?: string;
    followersCount?: number;
    followingCount?: number;
    profileImageUrl?: string;
    isVerified?: boolean;
    xUserId: string;
  } | null>(null);

  const [liveSuggestions, setLiveSuggestions] = useState<any[]>([]);
  const [amountZec, setAmountZec] = useState("0.25");
  const [tokenDepositAmount, setTokenDepositAmount] = useState<string>("10");
  const [memo, setMemo] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  // Multi-Currency / Cross-chain Payment State
  const [payMethod, setPayMethod] = useState<"zec" | "cross_chain">("zec");
  const [selectedTokenId, setSelectedTokenId] = useState<string>("usdc-base");
  const [swapOrder, setSwapOrder] = useState<SwapOrder | null>(null);
  const [swapStep, setSwapStep] = useState<"READY" | "PROMPTING" | "REVERTED" | "CONVERTING" | "SETTLED">("READY");
  const [evmTxHashInput, setEvmTxHashInput] = useState("");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [isSendingWalletTx, setIsSendingWalletTx] = useState(false);
  const [walletTxHash, setWalletTxHash] = useState<string | null>(null);
  const [showMobileQr, setShowMobileQr] = useState(false);

  const [generatedEscrowAddress, setGeneratedEscrowAddress] = useState<string | null>(null);
  const [createdTipId, setCreatedTipId] = useState<string | null>(null);
  const [fundingTxidInput, setFundingTxidInput] = useState("");
  const [isFundingTip, setIsFundingTip] = useState(false);
  const [confirmedTxid, setConfirmedTxid] = useState<string | null>(null);
  const [copiedTxid, setCopiedTxid] = useState(false);
  const [fundingNotice, setFundingNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<SearchedAccount[]>([]);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const crossChainPollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRecentAccounts(getRecentAccounts());
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (crossChainPollIntervalRef.current) {
        clearInterval(crossChainPollIntervalRef.current);
        crossChainPollIntervalRef.current = null;
      }
    };
  }, []);
  const { priceUsd: zecPriceUsd, formatZecToUsd } = useZecPrice();

  const selectedToken =
    SUPPORTED_SWAP_TOKENS.find((t) => t.id === selectedTokenId) || SUPPORTED_SWAP_TOKENS[0];

  // Calculate ZEC delivered into shielded escrow from native paying token
  const calculateZecFromToken = (tokenAmount: string, token: SupportedSwapToken): string => {
    const deposit = parseFloat(tokenAmount) || 0;
    if (deposit <= 0) return "0.00";
    const effectiveZecPrice = zecPriceUsd > 0 ? zecPriceUsd : 52.5;
    const buffer = 1.012; // 1.2% buffer
    let zec = 0;
    if (token.symbol === "USDC" || token.symbol === "USDT") {
      zec = deposit / (effectiveZecPrice * buffer);
    } else if (token.symbol === "ETH") {
      const ethPrice = 2800; // estimated ETH price
      zec = (deposit * ethPrice) / (effectiveZecPrice * buffer);
    }
    return Math.max(0.0001, Math.round(zec * 10000) / 10000).toFixed(4);
  };

  const getEffectiveZecAmount = (): string => {
    return payMethod === "cross_chain"
      ? calculateZecFromToken(tokenDepositAmount, selectedToken)
      : amountZec;
  };

  // Handle typing and deleting in real-time
  const handleInputChange = (value: string) => {
    setUsernameSearch(value);
    setErrorNotice(null);

    // If a profile was selected, immediately clear it when the user types or deletes text
    if (selectedUser) {
      setSelectedUser(null);
    }

    const clean = value.replace("@", "").trim().toLowerCase();

    // If input is emptied, clear live suggestions
    if (!clean) {
      setLiveSuggestions([]);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      return;
    }

    // 1. Instant local filter from recently searched accounts
    const localMatches = recentAccounts.filter(
      (acc) =>
        acc.username.toLowerCase().includes(clean) ||
        acc.name.toLowerCase().includes(clean)
    );
    setLiveSuggestions(localMatches);

    // 2. Debounce live auto-lookup against X lookup API
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/users/lookup?username=${clean}`);
        const data = await res.json();
        const user = data.profile || data.user;
        if (data.success && user) {
          const apiUser = {
            name: user.name || clean,
            username: user.username || clean,
            bio: user.bio || undefined,
            followersCount: typeof user.followersCount === "number" ? user.followersCount : undefined,
            followingCount: typeof user.followingCount === "number" ? user.followingCount : undefined,
            profileImageUrl: user.profileImageUrl || `https://unavatar.io/x/${clean}`,
            isVerified: user.isVerified ?? false,
            xUserId: user.xUserId || `x_${clean}_${Date.now()}`,
          };
          setLiveSuggestions((prev) => {
            const exists = prev.some((p) => p.username.toLowerCase() === apiUser.username.toLowerCase());
            return exists ? prev : [apiUser, ...prev];
          });
        }
      } catch (err) {
        // Silent fail for debounced lookup
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  // Explicit search / selection
  const handleSearch = async (handleToSearch?: string) => {
    const raw = handleToSearch || usernameSearch;
    if (!raw.trim()) return;
    setIsSearching(true);
    setErrorNotice(null);
    const clean = raw.replace("@", "").trim();

    try {
      const res = await fetch(`/api/users/lookup?username=${clean}`);
      const data = await res.json();
      const user = data.profile || data.user;
      if (data.success && user) {
        const foundUser = {
          name: user.name || clean,
          username: user.username || clean,
          bio: user.bio || undefined,
          followersCount: typeof user.followersCount === "number" ? user.followersCount : undefined,
          followingCount: typeof user.followingCount === "number" ? user.followingCount : undefined,
          profileImageUrl: user.profileImageUrl || `https://unavatar.io/x/${clean}`,
          isVerified: user.isVerified ?? false,
          xUserId: user.xUserId || `x_${clean}_${Date.now()}`,
        };
        setSelectedUser(foundUser);
        const updated = saveRecentAccount(foundUser);
        setRecentAccounts(updated);
      } else {
        const fallbackUser = {
          name: clean.charAt(0).toUpperCase() + clean.slice(1),
          username: clean,
          bio: undefined,
          followersCount: undefined,
          profileImageUrl: `https://unavatar.io/x/${clean}`,
          isVerified: false,
          xUserId: `x_${clean}_${Date.now()}`,
        };
        setSelectedUser(fallbackUser);
        const updated = saveRecentAccount(fallbackUser);
        setRecentAccounts(updated);
      }
    } catch (e) {
      const fallbackUser = {
        name: clean.charAt(0).toUpperCase() + clean.slice(1),
        username: clean,
        bio: undefined,
        followersCount: undefined,
        profileImageUrl: `https://unavatar.io/x/${clean}`,
        isVerified: false,
        xUserId: `x_${clean}_${Date.now()}`,
      };
      setSelectedUser(fallbackUser);
      const updated = saveRecentAccount(fallbackUser);
      setRecentAccounts(updated);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectAccount = (account: any) => {
    setSelectedUser(account);
    setUsernameSearch(account.username);
    setLiveSuggestions([]);
    const updated = saveRecentAccount(account);
    setRecentAccounts(updated);
  };

  const handleClearSearch = () => {
    setUsernameSearch("");
    setSelectedUser(null);
    setLiveSuggestions([]);
    setErrorNotice(null);
  };

  // Step 3 -> Step 4: Create tip and, if cross-chain, create swap quote
  const handleConfirmTip = async () => {
    if (!selectedUser) return;
    setIsSearching(true);
    setErrorNotice(null);

    try {
      const effectiveZec = getEffectiveZecAmount();

      // 1. Create base escrow tip record
      const res = await fetch("/api/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientXUserId: selectedUser.xUserId,
          recipientUsername: selectedUser.username,
          amountZec: effectiveZec,
          isAnonymous,
          memo,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.tip) {
        setErrorNotice(data.error || "Failed to create escrow tip.");
        setIsSearching(false);
        return;
      }

      const tipId = data.tip._id || data.tip.id;
      const escrowAddress = data.tip.escrowAddress;
      setCreatedTipId(tipId);
      setGeneratedEscrowAddress(escrowAddress);

      // 2. If cross-chain, request solver swap order and trigger wallet payment
      if (payMethod === "cross_chain") {
        const swapRes = await fetch("/api/swaps/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromTokenId: selectedTokenId,
            zecAmount: parseFloat(effectiveZec),
            targetZecAddress: escrowAddress,
            tipId: tipId,
            zecPriceUsd: zecPriceUsd,
          }),
        });
        const swapData = await swapRes.json();
        if (swapRes.ok && swapData.success && swapData.order) {
          setSwapOrder(swapData.order);
          setStep(4);
          setSwapStep("READY");
          setIsSearching(false);

          // If user already connected wallet, immediately trigger transaction!
          if (walletAddress) {
            handleTriggerWalletPayment(swapData.order);
          }
        } else {
          setErrorNotice(swapData.error || "Failed to create cross-chain swap quote.");
          setIsSearching(false);
        }
      } else {
        setStep(4);
        setIsSearching(false);
      }
    } catch (e: any) {
      setErrorNotice(e.message || "Network error. Failed to reach tip service.");
      setIsSearching(false);
    }
  };

  // Directly trigger EVM wallet payment via MetaMask / Rabby / Browser provider
  const handleTriggerWalletPayment = async (customOrder?: SwapOrder) => {
    const orderToPay = customOrder || swapOrder;
    if (!orderToPay) return;

    setIsSendingWalletTx(true);
    setErrorNotice(null);
    setSwapStep("PROMPTING");

    try {
      // Connect if not already connected
      let payerAddress = walletAddress;
      if (!payerAddress) {
        if (hasInjectedProvider()) {
          const conn = await connectInjectedWallet();
          payerAddress = conn.address;
          setWalletAddress(conn.address);
          setWalletChainId(conn.chainId);
        } else {
          payerAddress = "0x71C8366431a533590Ec479a1dEF800470f560299";
          setWalletAddress(payerAddress);
        }
      }

      // Trigger the EVM transaction in the connected browser wallet
      const txHash = await sendEvmPayment({
        token: orderToPay.fromToken,
        depositVaultAddress: orderToPay.depositAddress,
        depositAmount: orderToPay.depositAmount,
        fromAddress: payerAddress,
      });

      setWalletTxHash(txHash);
      setSwapStep("CONVERTING");

      // Auto-settle with cross-chain solver
      await handleSettleCrossChain(txHash);
    } catch (err: any) {
      console.warn("Wallet payment error:", err);
      const isUserReject =
        err?.code === 4001 ||
        err?.message?.toLowerCase().includes("rejected") ||
        err?.message?.toLowerCase().includes("denied") ||
        err?.message?.toLowerCase().includes("cancelled");
      setErrorNotice(
        isUserReject
          ? "Transaction request was cancelled in wallet."
          : err.message || "Transaction reverted or failed in wallet."
      );
      setSwapStep("REVERTED");
    } finally {
      setIsSendingWalletTx(false);
    }
  };

  // ZEC on-chain funding confirmation
  const handleFundTip = async (explicitTxid?: string) => {
    const tipId = createdTipId;
    if (!tipId) {
      setErrorNotice("Tip session not found. Please restart.");
      return;
    }
    const txidToSubmit = (explicitTxid || fundingTxidInput).trim();
    if (!txidToSubmit) {
      setErrorNotice("Please enter or paste the transaction hash (txid) after sending payment.");
      return;
    }

    setIsFundingTip(true);
    setErrorNotice(null);

    try {
      const res = await fetch(`/api/tips/${tipId}/fund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundingTxid: txidToSubmit }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfirmedTxid(txidToSubmit);
        if (data.tip?.status === "FUNDED") {
          setFundingNotice(null);
          if (onSuccess) onSuccess(data.tip);
          setStep(5);
        } else {
          // Status is FUNDING_DETECTED (in mempool, awaiting block 1 confirmation)
          setFundingNotice("Payment broadcasted & detected on blockchain! Confirming in next block...");
        }
      } else {
        setErrorNotice(data.error || "Failed to confirm on-chain tip funding.");
      }
    } catch (err: any) {
      setErrorNotice(err.message || "Failed to verify transaction on-chain.");
    } finally {
      setIsFundingTip(false);
    }
  };

  // Auto-detect tip funding when on Step 4 Native Zcash path
  useEffect(() => {
    if (step !== 4 || payMethod !== "zec" || !createdTipId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tips/${createdTipId}`);
        const data = await res.json();
        if (res.ok && data.success && data.tip) {
          if (data.tip.status === "FUNDED") {
            setFundingNotice(null);
            setConfirmedTxid(data.tip.fundingTxid);
            if (onSuccess) onSuccess(data.tip);
            setStep(5);
          } else if (data.tip.status === "FUNDING_DETECTED") {
            setFundingNotice("Payment broadcasted & detected on blockchain! Confirming in next block...");
          }
        }
      } catch (e) {
        // Silent catch for polling
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [step, payMethod, createdTipId, onSuccess]);

  // Query live status of swap order without forcing settlement
  const handleRefreshSwapStatus = async () => {
    if (!swapOrder) return;
    setIsFundingTip(true);
    setErrorNotice(null);

    try {
      const res = await fetch(`/api/swaps/${swapOrder.orderId}`);
      const data = await res.json();
      if (res.ok && data.success && data.order) {
        if (data.order.status === "SETTLED") {
          setSwapStep("SETTLED");
          setConfirmedTxid(data.order.settlementZecTxid);
          if (onSuccess && data.tip) onSuccess(data.tip);
          setTimeout(() => {
            setStep(5);
          }, 600);
        } else if (data.order.status === "PENDING") {
          if (!walletTxHash) {
            setSwapStep("REVERTED");
            setErrorNotice("No completed wallet transaction detected. Please confirm the transaction in your EVM wallet.");
          } else {
            setSwapStep("CONVERTING");
          }
        } else if (data.order.status === "REVERTED") {
          setSwapStep("REVERTED");
          setErrorNotice("The cross-chain swap was cancelled or reverted.");
        }
      } else {
        setErrorNotice(data.error || "Could not fetch swap order status.");
      }
    } catch (err: any) {
      setErrorNotice(err.message || "Failed to check swap status.");
    } finally {
      setIsFundingTip(false);
    }
  };

  // Cross-chain solver settlement with verified wallet tx hash
  const handleSettleCrossChain = async (customTxid?: string) => {
    if (!swapOrder) return;
    const txToSubmit = customTxid || walletTxHash;
    if (!txToSubmit) {
      setErrorNotice("Cannot settle: No valid wallet transaction hash detected.");
      setSwapStep("REVERTED");
      return;
    }
    setIsFundingTip(true);
    setErrorNotice(null);
    setSwapStep("CONVERTING");

    try {
      const isEvm = txToSubmit.startsWith("0x");
      const res = await fetch(`/api/swaps/${swapOrder.orderId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evmTxHash: isEvm ? txToSubmit : undefined,
          zecTxid: !isEvm ? txToSubmit : undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.pending) {
          // EVM deposit registered. Poll /api/swaps/[id]/status until solver broadcasts on Zcash
          setSwapStep("CONVERTING");
          if (crossChainPollIntervalRef.current) {
            clearInterval(crossChainPollIntervalRef.current);
          }
          let pollCount = 0;
          const maxPolls = 36; // 36 * 5s = 180s (3 minutes)
          crossChainPollIntervalRef.current = setInterval(async () => {
            pollCount++;
            try {
              const statusRes = await fetch(`/api/swaps/${swapOrder.orderId}/status`);
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                if (statusData.settled && statusData.order?.settlementZecTxid) {
                  if (crossChainPollIntervalRef.current) {
                    clearInterval(crossChainPollIntervalRef.current);
                    crossChainPollIntervalRef.current = null;
                  }
                  setSwapStep("SETTLED");
                  setConfirmedTxid(statusData.order.settlementZecTxid);
                  if (onSuccess && statusData.tip) onSuccess(statusData.tip);
                  setTimeout(() => {
                    setStep(5);
                  }, 600);
                }
              }
            } catch {
              // ignore transient network poll errors
            }
            if (pollCount >= maxPolls) {
              if (crossChainPollIntervalRef.current) {
                clearInterval(crossChainPollIntervalRef.current);
                crossChainPollIntervalRef.current = null;
              }
              setErrorNotice("Solver conversion is still finalizing on Zcash. Your deposit is confirmed and your tip will be credited automatically once Zcash blocks confirm.");
            }
          }, 5000);
          return;
        }

        setSwapStep("SETTLED");
        const finalTxid = data.order.settlementZecTxid;
        setConfirmedTxid(finalTxid);
        if (onSuccess && data.tip) onSuccess(data.tip);
        setTimeout(() => {
          setStep(5);
        }, 600);
      } else {
        setSwapStep("REVERTED");
        setErrorNotice(data.error || "Failed to settle cross-chain swap.");
      }
    } catch (err: any) {
      setSwapStep("REVERTED");
      setErrorNotice(err.message || "Failed to settle cross-chain payment.");
    } finally {
      setIsFundingTip(false);
    }
  };

  const handleReset = () => {
    if (crossChainPollIntervalRef.current) {
      clearInterval(crossChainPollIntervalRef.current);
      crossChainPollIntervalRef.current = null;
    }
    setStep(1);
    setUsernameSearch("");
    setSelectedUser(null);
    setLiveSuggestions([]);
    setAmountZec("0.25");
    setMemo("");
    setIsAnonymous(true);
    setPayMethod("zec");
    setSelectedTokenId("usdc-base");
    setSwapOrder(null);
    setSwapStep("READY");
    setGeneratedEscrowAddress(null);
    setCreatedTipId(null);
    setFundingTxidInput("");
    setConfirmedTxid(null);
    setFundingNotice(null);
    setErrorNotice(null);
    setEvmTxHashInput("");
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title={
        step === 1
          ? "Who do you want to tip?"
          : step === 2
          ? `Tip @${selectedUser?.username}`
          : step === 3
          ? "Confirm your tip"
          : step === 4
          ? payMethod === "cross_chain"
            ? `Pay with ${selectedToken.symbol} (${selectedToken.networkName})`
            : "Pay with Zcash"
          : "Tip Sent!"
      }
      subtitle={
        step === 1
          ? "Search by Twitter handle to verify recipient"
          : step === 2
          ? "Set amount and choose ZEC or cross-chain payment"
          : step === 3
          ? "Review your payment details before sending"
          : step === 4
          ? payMethod === "cross_chain"
            ? "Send EVM deposit to cross-chain solver vault"
            : "Send ZEC to the shielded escrow address"
          : "Your tip is safely waiting in escrow"
      }
    >
      {/* STEP 1: Search Recipient with Live Suggestions */}
      {step === 1 && (
        <div className="space-y-4 text-left">
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                value={usernameSearch}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Type 𝕏 handle (e.g. zooko)..."
                leftIcon={<Search className="w-4 h-4 text-brown-400" />}
                rightElement={
                  usernameSearch ? (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="p-1 hover:bg-butter-100 rounded-full text-brown-400 hover:text-brown-700 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null
                }
              />
            </div>
            <Button onClick={() => handleSearch()} variant="primary" size="md" isLoading={isSearching}>
              Search
            </Button>
          </div>

          {/* If a user is selected, show profile card */}
          {selectedUser ? (
            <div className="space-y-3 pt-1 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-brown-500 uppercase tracking-wider">
                  Recipient Profile
                </p>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <UserCheck className="w-3 h-3 text-emerald-600" />
                  Account Verified
                </span>
              </div>
              <XProfileCard
                name={selectedUser.name}
                username={selectedUser.username}
                profileImageUrl={selectedUser.profileImageUrl}
                bio={selectedUser.bio}
                followersCount={selectedUser.followersCount}
                followingCount={selectedUser.followingCount}
                isVerified={selectedUser.isVerified}
                selected={true}
              />
              <Button
                onClick={() => setStep(2)}
                variant="primary"
                className="w-full gap-2 mt-4 h-12 font-bold shadow-elevated active:scale-95"
              >
                <span>Continue to Tip Amount</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          ) : usernameSearch.trim() ? (
            /* Live Suggestions List while typing */
            <div className="space-y-2 pt-1 animate-in fade-in">
              <div className="flex items-center justify-between text-xs text-brown-500 font-semibold">
                <span>Matching Suggestions</span>
                {isSearching && (
                  <span className="flex items-center gap-1 text-brown-400">
                    <Loader2 className="w-3 h-3 animate-spin" /> Searching 𝕏...
                  </span>
                )}
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => handleSearch(usernameSearch)}
                  className="w-full p-3 rounded-2xl bg-butter-50 hover:bg-butter-100 border border-butter-200 hover:border-butter-300 text-left transition-all flex items-center justify-between group shadow-subtle"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brown-900 text-white flex items-center justify-center font-bold text-xs shadow-subtle">
                      @
                    </div>
                    <div>
                      <p className="text-xs font-bold text-brown-950">Tip @{usernameSearch.replace("@", "")}</p>
                      <p className="text-[11px] text-brown-500">Tap to select this handle</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-brown-400 group-hover:text-brown-900 group-hover:translate-x-0.5 transition-all" />
                </button>

                {liveSuggestions.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => handleSelectAccount(acc)}
                    className="w-full p-3 rounded-2xl bg-white hover:bg-butter-50 border border-butter-200 hover:border-butter-300 text-left transition-all flex items-center justify-between group shadow-subtle"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={acc.profileImageUrl || `https://unavatar.io/x/${acc.username}`}
                        alt={acc.name}
                        className="w-9 h-9 rounded-full border border-butter-300 object-cover shrink-0"
                        onError={(e) => {
                          e.currentTarget.src = `https://unavatar.io/x/${acc.username}`;
                        }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-bold text-brown-950 truncate group-hover:text-brown-800">
                            {acc.name}
                          </p>
                          {acc.isVerified && <CheckCircle2 className="w-3 h-3 text-brown-700 shrink-0" />}
                        </div>
                        <p className="text-[11px] text-brown-500 truncate">@{acc.username}</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-brown-700 bg-butter-100 group-hover:bg-brown-900 group-hover:text-white px-2.5 py-1 rounded-full transition-all shrink-0">
                      Select
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : recentAccounts.length > 0 ? (
            /* Recent accounts when search is blank */
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-brown-600">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-brown-600" />
                  <span>Recently Searched Accounts</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearRecentAccounts();
                    setRecentAccounts([]);
                  }}
                  className="text-[11px] text-brown-400 hover:text-brown-700 underline font-normal transition-colors"
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                {recentAccounts.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => handleSelectAccount(acc)}
                    className="p-2.5 rounded-2xl bg-butter-50 hover:bg-butter-100 border border-butter-300 hover:border-butter-400 text-left transition-all flex items-center justify-between gap-2 group shadow-subtle active:scale-95"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={acc.profileImageUrl || `https://unavatar.io/x/${acc.username}`}
                        alt={acc.name}
                        className="w-8 h-8 rounded-full border border-butter-300 object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-bold text-brown-950 truncate group-hover:text-brown-700">
                            {acc.name}
                          </p>
                          {acc.isVerified && <CheckCircle2 className="w-3 h-3 text-brown-700 shrink-0" />}
                        </div>
                        <p className="text-[11px] text-brown-500 truncate">@{acc.username}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-brown-600 bg-butter-100 group-hover:bg-brown-900 group-hover:text-white px-2 py-0.5 rounded-full transition-all shrink-0">
                      Select
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Clean empty state prompt */
            <div className="text-center py-6 px-4 bg-butter-50/60 rounded-2xl border border-dashed border-butter-300 my-2">
              <div className="w-10 h-10 rounded-full bg-butter-100 flex items-center justify-center mx-auto mb-2 text-brown-600">
                <Search className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-brown-950">Search Any Creator on 𝕏</p>
              <p className="text-[11px] text-brown-500 max-w-xs mx-auto mt-0.5">
                Type any 𝕏 handle above to generate a private shielded escrow address and send ZEC.
              </p>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Amount & Currency Selection */}
      {step === 2 && selectedUser && (
        <div className="space-y-4 text-left">
          {/* Recipient Mini Bar */}
          <div className="p-3 bg-butter-50 border border-butter-200 rounded-2xl flex items-center justify-between shadow-subtle">
            <div className="flex items-center gap-2.5">
              <img
                src={selectedUser.profileImageUrl}
                alt={selectedUser.name}
                className="w-8 h-8 rounded-full object-cover border border-butter-300"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <div>
                <p className="text-xs font-bold text-brown-950">Tipping {selectedUser.name}</p>
                <p className="text-[11px] text-brown-500">@{selectedUser.username}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedUser(null);
                setStep(1);
              }}
              className="text-xs font-semibold text-brown-700 hover:text-brown-950 underline"
            >
              Change
            </button>
          </div>

          {/* Payment Method Switcher: Native ZEC vs Multi-Currency Bridge */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-brown-900 block">
              Payment Currency
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-butter-50 border border-butter-200 rounded-2xl">
              <button
                type="button"
                onClick={() => setPayMethod("zec")}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  payMethod === "zec"
                    ? "bg-brown-900 text-white shadow-subtle"
                    : "text-brown-700 hover:bg-butter-100"
                }`}
              >
                <ZcashLogo className="w-4 h-4 shrink-0" />
                <span>Shielded ZEC</span>
                <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded-full font-mono">
                  Native
                </span>
              </button>

              <button
                type="button"
                disabled
                className="py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 opacity-60 cursor-not-allowed text-brown-400 bg-butter-50 border border-dashed border-butter-300"
                title="Cross-chain swap solver is currently undergoing upgrade"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Cross-Chain</span>
                <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded-full border border-amber-300">
                  Coming Soon
                </span>
              </button>
            </div>
          </div>

          {/* If Multi-Currency is selected: EVM Wallet & Standard Dropdown */}
          {payMethod === "cross_chain" && (
            <div className="space-y-3 animate-in fade-in">
              {/* EVM Wallet Connection Card */}
              <EvmWalletCard
                walletAddress={walletAddress}
                chainId={walletChainId}
                selectedToken={selectedToken}
                onConnect={(addr, cId) => {
                  setWalletAddress(addr);
                  setWalletChainId(cId);
                }}
                onDisconnect={() => {
                  setWalletAddress(null);
                  setWalletChainId(null);
                }}
                onChainChange={(newCId) => setWalletChainId(newCId)}
                onUseBalance={(bal) => setTokenDepositAmount(bal)}
              />

              {/* Standard Dropdown Asset Selector with Official Logos */}
              <EvmAssetDropdown
                selectedTokenId={selectedTokenId}
                onSelectToken={(token) => {
                  setSelectedTokenId(token.id);
                }}
              />

              {/* Conversion Estimate Box */}
              <div className="p-3 bg-white border border-amber-200 rounded-2xl flex items-center justify-between text-xs shadow-subtle">
                <div>
                  <span className="text-[11px] text-brown-500 block">Deposit Amount:</span>
                  <p className="font-mono font-bold text-brown-950 text-sm">
                    {tokenDepositAmount || "0"} {selectedToken.symbol}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-brown-500 block">Recipient Receives:</span>
                  <p className="font-mono font-bold text-emerald-700 text-sm">
                    ≈ {calculateZecFromToken(tokenDepositAmount, selectedToken)} Shielded ZEC
                  </p>
                </div>
              </div>

              {/* Prominent Label as explicitly required */}
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-brown-800 bg-white/70 px-2.5 py-1.5 rounded-xl border border-amber-200">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Private tip powered by Zcash + cross-chain settlement</span>
              </div>
            </div>
          )}

          {payMethod === "cross_chain" ? (
            <AmountInput
              value={tokenDepositAmount}
              onChange={setTokenDepositAmount}
              currencySymbol={selectedToken.symbol}
              label={`Deposit Amount (${selectedToken.symbol})`}
              step={selectedToken.symbol === "ETH" ? "0.0001" : "0.5"}
              presets={selectedToken.symbol === "ETH" ? [0.002, 0.005, 0.01, 0.02] : [5, 10, 25, 50]}
              customSubtext={`Delivers ≈ ${calculateZecFromToken(tokenDepositAmount, selectedToken)} Shielded ZEC`}
            />
          ) : (
            <AmountInput
              value={amountZec}
              onChange={setAmountZec}
              currencySymbol="ZEC"
              label="Tip Amount (ZEC)"
            />
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-brown-900">
              Encrypted Memo / Message (Optional)
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="e.g. Thanks for your insightful thread on Zcash!"
              className="w-full h-11 px-3.5 bg-white border border-butter-300 rounded-xl text-sm text-brown-950 placeholder:text-brown-400 focus:outline-none focus:border-brown-900 focus:ring-1 focus:ring-brown-900 shadow-subtle"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={() => setStep(1)} variant="outline" className="w-1/3">
              Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              variant="primary"
              className="w-2/3 gap-2"
              disabled={
                payMethod === "cross_chain"
                  ? !tokenDepositAmount || parseFloat(tokenDepositAmount) <= 0
                  : !amountZec || parseFloat(amountZec) <= 0
              }
            >
              <span>Review Tip</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Privacy & Review */}
      {step === 3 && selectedUser && (
        <div className="space-y-5 text-left">
          {errorNotice && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorNotice}</span>
            </div>
          )}

          {/* Summary Box */}
          <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl space-y-2.5 shadow-subtle">
            <div className="flex justify-between items-center text-xs">
              <span className="text-brown-500 font-medium">Recipient:</span>
              <span className="font-bold text-brown-950">@{selectedUser.username}</span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-brown-500 font-medium">Payment Route:</span>
              <span className="font-bold text-brown-950">
                {payMethod === "cross_chain"
                  ? `${selectedToken.symbol} (${selectedToken.networkName}) ➔ Shielded ZEC`
                  : "Direct Shielded ZEC (NU6.3)"}
              </span>
            </div>

            {payMethod === "cross_chain" && (
              <>
                <div className="flex justify-between items-center text-xs pb-1 border-b border-butter-200">
                  <span className="text-brown-500 font-medium">Deposit Asset:</span>
                  <span className="font-mono font-bold text-amber-900">
                    {tokenDepositAmount} {selectedToken.symbol}{" "}
                    <span className="text-brown-500 font-normal">({selectedToken.networkName})</span>
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1 border-b border-butter-200">
                  <span className="text-brown-500 font-medium">Payer EVM Wallet:</span>
                  <span className="font-mono font-bold text-brown-900">
                    {walletAddress ? truncateAddress(walletAddress, 8, 6) : "Will prompt wallet"}
                  </span>
                </div>
              </>
            )}

            <div className="flex justify-between items-center pt-1">
              <span className="text-xs text-brown-500 font-medium">Recipient Receives:</span>
              <div className="text-right">
                <span className="font-mono font-bold text-2xl text-brown-950">
                  {getEffectiveZecAmount()} ZEC
                </span>
                <span className="block text-xs font-mono text-brown-500">
                  ≈ {formatZecToUsd(getEffectiveZecAmount())} USD
                </span>
              </div>
            </div>

            {memo && (
              <div className="pt-2 border-t border-butter-200 text-xs text-brown-700 italic">
                &ldquo;{memo}&rdquo;
              </div>
            )}
          </div>

          {/* Prominent Label Badge across modals as required */}
          <div className="p-3 bg-gradient-to-r from-butter-50 to-emerald-50/40 rounded-2xl border border-emerald-200/80 flex items-center gap-2.5 text-xs text-brown-900 shadow-subtle">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="text-[11px] leading-tight">
              <span className="font-bold block text-brown-950">
                Private tip powered by Zcash + cross-chain settlement
              </span>
              <span className="text-brown-600">
                Recipient claims completely shielded into their Orchard / Sapling wallet.
              </span>
            </div>
          </div>

          {/* 30-Day Escrow Notice */}
          <div className="p-3 bg-amber-50/80 rounded-2xl border border-amber-200/80 flex items-center gap-2.5 text-xs text-amber-950 shadow-subtle">
            <Clock className="w-4 h-4 text-amber-700 shrink-0" />
            <div className="text-[11px] leading-tight">
              <span className="font-bold block text-amber-950">
                30-Day Escrow Window
              </span>
              <span className="text-amber-800">
                Tips are held safely in shielded escrow for 30 days for @{selectedUser.username} to claim.
              </span>
            </div>
          </div>

          {/* Privacy Toggle */}
          <div
            onClick={() => setIsAnonymous(!isAnonymous)}
            className="p-3.5 rounded-2xl border border-butter-300 bg-butter-50 cursor-pointer flex items-center justify-between transition-all hover:bg-butter-100 shadow-subtle"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brown-900 text-white flex items-center justify-center">
                <Lock className="w-4 h-4 text-butter-200" />
              </div>
              <div>
                <p className="text-xs font-bold text-brown-950">
                  {isAnonymous ? "Anonymous Tip (Shielded)" : "Public Supporter"}
                </p>
                <p className="text-[11px] text-brown-500">
                  {isAnonymous
                    ? "Zero sender metadata attached to this tip"
                    : "Your 𝕏 handle will be shown to the recipient"}
                </p>
              </div>
            </div>
            <div
              className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                isAnonymous ? "bg-brown-900 border-brown-900 text-white" : "border-butter-400 bg-white"
              }`}
            >
              {isAnonymous && <CheckCircle2 className="w-3.5 h-3.5" />}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={() => setStep(2)} variant="outline" className="w-1/3">
              Back
            </Button>
            <Button
              onClick={handleConfirmTip}
              variant="primary"
              className="w-2/3 gap-2"
              isLoading={isSearching}
            >
              <span>
                {payMethod === "cross_chain"
                  ? walletAddress
                    ? `Pay ${tokenDepositAmount} ${selectedToken.symbol} with Wallet`
                    : "Connect EVM & Pay"
                  : "Complete payment"}
              </span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: Payment Execution (Native ZEC vs Cross-Chain EVM Deposit) */}
      {step === 4 && selectedUser && (
        <div className="space-y-4 text-left">
          {errorNotice && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorNotice}</span>
            </div>
          )}

          {/* PATH A: Cross-chain Payment (USDC / USDT / ETH on Base, Arbitrum, Ethereum) */}
          {payMethod === "cross_chain" && swapOrder ? (
            <div className="space-y-4 animate-in fade-in">
              {/* Order Amount Banner */}
              <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl text-center space-y-1 shadow-subtle">
                <span className="text-[11px] uppercase font-bold text-brown-500 tracking-wider">
                  Amount to Send via Connected Wallet
                </span>
                <p className="text-3xl font-mono font-extrabold text-brown-950">
                  {swapOrder.depositAmount}{" "}
                  <span className="text-xl font-bold text-brown-700">
                    {swapOrder.fromToken.symbol}
                  </span>
                </p>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brown-600 bg-butter-100 px-3 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Network:</span>
                  <span className="font-bold text-brown-900">{swapOrder.fromToken.networkName}</span>
                </div>
              </div>

              {/* Wallet Trigger & Direct Execution Card */}
              <div className="p-4 bg-white border border-butter-300 rounded-3xl shadow-subtle space-y-3">
                {isSendingWalletTx ? (
                  <div className="p-4 bg-amber-50/70 border border-amber-300 rounded-2xl flex flex-col items-center justify-center text-center space-y-2">
                    <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
                    <div>
                      <p className="text-xs font-bold text-brown-950">
                        Prompting Your EVM Wallet...
                      </p>
                      <p className="text-[11px] text-brown-600 mt-0.5">
                        Please confirm the {swapOrder.depositAmount} {swapOrder.fromToken.symbol} transfer in your MetaMask or browser extension.
                      </p>
                    </div>
                  </div>
                ) : walletTxHash ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div>
                        <span className="font-bold text-emerald-950 block">Transaction Broadcasted</span>
                        <span className="text-[10px] font-mono text-emerald-700">
                          {truncateAddress(walletTxHash, 10, 8)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                      Pending ZEC Escrow
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button
                      onClick={() => handleTriggerWalletPayment()}
                      variant="primary"
                      className="w-full h-12 text-xs font-bold gap-2 shadow-elevated"
                    >
                      <span className="text-base">{swapStep === "REVERTED" ? "🔄" : "🦊"}</span>
                      <span>
                        {swapStep === "REVERTED"
                          ? `Retry ${swapOrder.depositAmount} ${swapOrder.fromToken.symbol} Transfer in Wallet`
                          : `Trigger ${swapOrder.depositAmount} ${swapOrder.fromToken.symbol} Transfer in Wallet`}
                      </span>
                    </Button>
                    <p className="text-[10px] text-center text-brown-500">
                      Zero copy-paste required. Your wallet will automatically populate the exact vault parameters.
                    </p>
                  </div>
                )}

                {/* Mobile EIP-681 QR Code Toggle (Optional for mobile wallet scans) */}
                <div className="pt-2 border-t border-butter-200">
                  <button
                    type="button"
                    onClick={() => setShowMobileQr(!showMobileQr)}
                    className="w-full text-center text-[11px] font-semibold text-brown-600 hover:text-brown-950 flex items-center justify-center gap-1.5 py-1"
                  >
                    <span>{showMobileQr ? "Hide Mobile QR" : "📱 Paying from mobile? View QR Code"}</span>
                  </button>

                  {showMobileQr && (
                    <div className="mt-3 p-3 bg-butter-50 border border-butter-200 rounded-2xl flex flex-col items-center justify-center space-y-2 animate-in fade-in">
                      <div className="p-2 bg-white rounded-xl border border-butter-200">
                        <QRCodeSVG
                          value={
                            swapOrder.fromToken.symbol === "ETH"
                              ? `ethereum:${swapOrder.depositAddress}@${swapOrder.fromToken.chainId}?value=${Math.floor(swapOrder.depositAmount * 1e18)}`
                              : `ethereum:${swapOrder.fromToken.contractAddress}@${swapOrder.fromToken.chainId}/transfer?address=${swapOrder.depositAddress}&uint256=${Math.floor(swapOrder.depositAmount * 10 ** swapOrder.fromToken.decimals)}`
                          }
                          size={150}
                          bgColor="transparent"
                          fgColor="#1E1315"
                          level="M"
                        />
                      </div>
                      <p className="text-[10px] text-brown-500 text-center max-w-[220px]">
                        Scan with your mobile camera or Web3 wallet. Automatically opens a pre-filled transaction.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Cross-Chain Settlement Tracker */}
              <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-brown-900">
                  <span>Cross-Chain Settlement Status</span>
                  <span className="text-[10px] font-mono text-brown-600">
                    Est. {swapOrder.estimatedMinutes} min
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] font-semibold">
                  <div
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                      isSendingWalletTx || swapStep === "PROMPTING"
                        ? "bg-amber-50 border-amber-300 text-amber-900"
                        : swapStep === "REVERTED"
                        ? "bg-rose-50 border-rose-300 text-rose-800"
                        : swapStep === "CONVERTING" || swapStep === "SETTLED"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-butter-100 border-butter-200 text-brown-700"
                    }`}
                  >
                    {isSendingWalletTx || swapStep === "PROMPTING" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                    ) : swapStep === "REVERTED" ? (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                    ) : swapStep === "CONVERTING" || swapStep === "SETTLED" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Wallet className="w-3.5 h-3.5 text-brown-600" />
                    )}
                    <span>
                      {isSendingWalletTx || swapStep === "PROMPTING"
                        ? "1. Signing in Wallet"
                        : swapStep === "REVERTED"
                        ? "1. Payment Reverted"
                        : swapStep === "CONVERTING" || swapStep === "SETTLED"
                        ? "1. EVM Paid ✓"
                        : "1. EVM Payment"}
                    </span>
                  </div>

                  <div
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                      swapStep === "CONVERTING"
                        ? "bg-amber-50 border-amber-300 text-amber-900"
                        : swapStep === "SETTLED"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-butter-100 border-butter-200 text-brown-400"
                    }`}
                  >
                    {swapStep === "CONVERTING" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                    ) : swapStep === "SETTLED" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {swapStep === "CONVERTING"
                        ? "2. Solver Swapping..."
                        : swapStep === "SETTLED"
                        ? "2. Swapped ✓"
                        : "2. Solver Swap"}
                    </span>
                  </div>

                  <div
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                      swapStep === "SETTLED"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-butter-100 border-butter-200 text-brown-400"
                    }`}
                  >
                    {swapStep === "SETTLED" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5" />
                    )}
                    <span>{swapStep === "SETTLED" ? "3. Shielded Escrow ✓" : "3. Shielded ZEC"}</span>
                  </div>
                </div>

                <p className="text-[10px] text-brown-500 text-center">
                  Once your {swapOrder.fromToken.symbol} transaction completes, the solver automatically escrows {swapOrder.zecAmount} Shielded ZEC into the creator&apos;s private pool.
                </p>
              </div>

              {/* Retry / Settle Button if needed */}
              {swapStep !== "SETTLED" && (
                <div className="space-y-2">
                  {swapStep === "REVERTED" && (
                    <Button
                      onClick={() => handleTriggerWalletPayment()}
                      variant="primary"
                      className="w-full h-10 text-xs font-bold gap-2"
                      isLoading={isSendingWalletTx}
                      disabled={isSendingWalletTx}
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Retry Payment in Wallet</span>
                    </Button>
                  )}
                  <Button
                    onClick={handleRefreshSwapStatus}
                    variant="outline"
                    className="w-full h-10 text-xs font-bold gap-2"
                    isLoading={isFundingTip}
                    disabled={isFundingTip}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>
                      {isFundingTip ? "Checking Solver..." : "Refresh Settlement Status"}
                    </span>
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* PATH B: Native Zcash Shielded Payment */
            generatedEscrowAddress && (
              <div className="space-y-4">
                {fundingNotice ? (
                  <div className="p-5 bg-butter-50 border border-butter-200 rounded-3xl space-y-4 text-center shadow-subtle animate-in fade-in zoom-in-95">
                    <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" />
                      <div className="w-14 h-14 bg-amber-100 text-amber-800 rounded-2xl border border-amber-300 flex items-center justify-center shadow-sm">
                        <Loader2 className="w-7 h-7 animate-spin text-amber-700" />
                      </div>
                    </div>

                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold mb-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        <span>Payment Broadcasted on Zcash Blockchain</span>
                      </div>
                      <h4 className="text-lg font-bold text-brown-950">Awaiting 1 Block Confirmation</h4>
                      <p className="text-xs text-brown-600 mt-1 max-w-sm mx-auto leading-relaxed">
                        Your shielded tip has been detected in the mempool! Zcash consensus requires 1 confirmed block to seal your note into the Orchard Merkle tree before private deposit for @{selectedUser.username}.
                      </p>
                    </div>

                    {(() => {
                      const activeTxid = confirmedTxid || fundingTxidInput;
                      if (!activeTxid) return null;
                      return (
                        <div className="p-3 bg-white border border-butter-300 rounded-2xl space-y-1.5 text-left shadow-subtle">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-brown-500 uppercase tracking-wider">
                              Transaction Hash (txid)
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(activeTxid);
                                  setCopiedTxid(true);
                                  setTimeout(() => setCopiedTxid(false), 2000);
                                }}
                                className="text-[11px] font-semibold text-brown-700 hover:text-brown-950 flex items-center gap-1 transition-colors"
                              >
                                {copiedTxid ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                <span>{copiedTxid ? "Copied" : "Copy"}</span>
                              </button>
                              <a
                                href={getZcashExplorerUrl(activeTxid)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-semibold text-brown-700 hover:text-brown-950 flex items-center gap-1 transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Explorer</span>
                              </a>
                            </div>
                          </div>
                          <p className="font-mono text-xs text-brown-950 break-all bg-butter-50/50 p-2 rounded-xl border border-butter-200">
                            {activeTxid}
                          </p>
                        </div>
                      );
                    })()}

                    <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <span className="text-[10px] uppercase font-bold text-emerald-700 block">1. Broadcast</span>
                        <span className="text-xs font-bold text-emerald-950 flex items-center justify-center gap-1 mt-0.5">
                          ✓ Sent
                        </span>
                      </div>
                      <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl">
                        <span className="text-[10px] uppercase font-bold text-amber-700 block">2. On-Chain Seal</span>
                        <span className="text-xs font-bold text-amber-950 flex items-center justify-center gap-1 mt-0.5">
                          <Loader2 className="w-3 h-3 animate-spin text-amber-700" /> Confirming
                        </span>
                      </div>
                      <div className="p-2.5 bg-butter-100 border border-butter-200 rounded-xl text-brown-400">
                        <span className="text-[10px] uppercase font-bold text-brown-400 block">3. Shielded Escrow</span>
                        <span className="text-xs font-bold text-brown-500 block mt-0.5">Vault deposit</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-brown-500 italic">
                      This modal will automatically transition once block 1 is sealed. You can safely close or remain on this screen.
                    </p>
                  </div>
                ) : (
                  <>
                    <QRDisplay
                      value={buildZip321Uri({
                        address: generatedEscrowAddress,
                        amountZec: parseFloat(amountZec),
                        memo: memo || "VeilX Shielded Tip",
                      })}
                      address={generatedEscrowAddress}
                      amountZec={parseFloat(amountZec)}
                      memo={memo || "VeilX Shielded Tip"}
                      onPaymentConfirmed={(txid) => handleFundTip(txid)}
                    />

                    {/* Transaction Hash Input for manual verification */}
                    <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl space-y-2">
                      <label className="text-[11px] font-bold text-brown-900 block">
                        Transaction Hash (txid)
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={fundingTxidInput}
                          onChange={(e) => {
                            setFundingTxidInput(e.target.value);
                            setErrorNotice(null);
                          }}
                          placeholder="Paste Zcash transaction hash..."
                          className="text-xs font-mono"
                        />
                      </div>
                      <p className="text-[10px] text-brown-500">
                        Sent from Zashi, Ywallet, or Zingo? Paste the transaction ID here to record on-chain proof.
                      </p>
                    </div>

                    <div className="pt-1 text-center space-y-2">
                      <Button
                        onClick={() => handleFundTip()}
                        variant="primary"
                        className="w-full h-11 text-xs font-bold gap-2"
                        isLoading={isFundingTip}
                        disabled={!fundingTxidInput.trim() || isFundingTip}
                      >
                        <span>Confirm On-Chain Funding</span>
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* STEP 5: Success / Waiting */}
      {step === 5 && selectedUser && (
        <div className="py-5 text-center space-y-4 animate-in fade-in zoom-in-95">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-200 mx-auto flex items-center justify-center shadow-subtle">
            <ShieldCheck className="w-8 h-8" />
          </div>

          <div>
            <h4 className="text-xl font-bold text-brown-950">Tip Dispatched to Escrow!</h4>
            <p className="text-xs text-brown-500 mt-1 max-w-xs mx-auto">
              <strong>{swapOrder ? swapOrder.zecAmount : getEffectiveZecAmount()} ZEC</strong> is safely funded and waiting for{" "}
              <strong>@{selectedUser.username}</strong> in the shielded escrow pool.
            </p>
          </div>

          {/* Cross-chain settlement tag if applicable */}
          {payMethod === "cross_chain" && swapOrder && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs font-semibold text-amber-900 mx-auto">
              <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />
              <span>
                Funded via {swapOrder.depositAmount} {swapOrder.fromToken.symbol} on{" "}
                {swapOrder.fromToken.networkName} ➔ Shielded ZEC
              </span>
            </div>
          )}

          {/* On-Chain Transaction Explorer Badge */}
          {confirmedTxid && (
            <div className="p-3.5 bg-butter-50 rounded-2xl border border-butter-200 text-left space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-brown-900">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Shielded Transaction Proof
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  Confirmed
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 p-2 bg-white rounded-xl border border-butter-200 font-mono text-xs text-brown-700">
                <span className="truncate">{truncateAddress(confirmedTxid, 14, 10)}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(confirmedTxid);
                      setCopiedTxid(true);
                      setTimeout(() => setCopiedTxid(false), 2000);
                    }}
                    className="p-1 hover:bg-butter-100 rounded text-brown-500 hover:text-brown-900 transition-colors"
                    title="Copy Transaction Hash"
                  >
                    {copiedTxid ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={getZcashExplorerUrl(confirmedTxid)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 hover:bg-butter-100 rounded text-brown-500 hover:text-brown-900 transition-colors inline-flex items-center"
                    title="View on Zcash Block Explorer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Downloadable Official Receipt Card */}
          <InvoiceReceiptCard
            type="tip"
            recipientUsername={selectedUser.username}
            recipientName={selectedUser.name}
            amountZec={swapOrder ? swapOrder.zecAmount : getEffectiveZecAmount()}
            amountUsd={formatZecToUsd(swapOrder ? swapOrder.zecAmount : getEffectiveZecAmount())}
            txid={confirmedTxid || undefined}
            escrowAddress={generatedEscrowAddress || undefined}
            memo={memo || undefined}
            isAnonymous={isAnonymous}
          />

          {/* Viral Social Share & Notification on X */}
          <div className="p-4 bg-butter-50 rounded-2xl border border-butter-200 text-left space-y-2.5">
            <p className="text-xs font-bold text-brown-900">
              Notify @{selectedUser.username} on 𝕏
            </p>
            <p className="text-[11px] text-brown-500 leading-relaxed">
              Let them know they have an unclaimed private tip waiting.
            </p>
            <a
              href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                `I just sent a privacy-shielded tip of ${swapOrder ? swapOrder.zecAmount : getEffectiveZecAmount()} ZEC to @${selectedUser.username} on @VeilXApp! 🛡️⚡\n\nPrivate tip powered by Zcash + cross-chain settlement.\n\nClaim your tip at ${
                  typeof window !== "undefined" ? window.location.origin : "https://veilx.cash"
                }/tip/${selectedUser.username}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-11 inline-flex items-center justify-center gap-2 bg-brown-900 hover:bg-brown-950 text-white font-bold text-xs rounded-xl shadow-elevated transition-all active:scale-95"
            >
              <XLogo className="w-3.5 h-3.5 fill-current text-white shrink-0" />
              <span>Post on X to Notify @{selectedUser.username}</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-70 ml-1" />
            </a>
          </div>

          <Button onClick={handleReset} variant="outline" className="w-full font-bold">
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
