"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ShieldCheck,
  ExternalLink,
  Lock,
  CheckCircle2,
  Coins,
  ArrowRightLeft,
  Copy,
  Check,
  Loader2,
  ArrowRight,
  RefreshCw,
  Clock,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { QRDisplay } from "@/components/ui/QRDisplay";
import { AmountInput } from "@/components/ui/AmountInput";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useZecPrice } from "@/lib/price-service";
import { buildZip321Uri } from "@/lib/wallet";
import {
  SUPPORTED_SWAP_TOKENS,
  SupportedSwapToken,
  SwapOrder,
} from "@/types/swap";
import { truncateAddress } from "@/lib/utils";
import { EvmAssetDropdown } from "@/components/ui/EvmAssetDropdown";
import { EvmWalletCard } from "@/components/ui/EvmWalletCard";
import { ZcashLogo } from "@/components/ui/CryptoLogos";
import {
  sendEvmPayment,
  connectInjectedWallet,
  hasInjectedProvider,
} from "@/lib/evm-wallet";

export default function DirectTipPage() {
  const params = useParams();
  const rawUsername = params.username as string;
  const username = rawUsername ? rawUsername.replace("@", "") : "";

  const [step, setStep] = useState<1 | 2>(1);
  const [amountZec, setAmountZec] = useState("0.25");
  const [tokenDepositAmount, setTokenDepositAmount] = useState<string>("10");
  const [memo, setMemo] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null);
  const [createdTipId, setCreatedTipId] = useState<string | null>(null);

  // Multi-Currency Cross-Chain & EVM Wallet State
  const [payMethod, setPayMethod] = useState<"zec" | "cross_chain">("zec");
  const [selectedTokenId, setSelectedTokenId] = useState<string>("usdc-base");
  const [swapOrder, setSwapOrder] = useState<SwapOrder | null>(null);
  const [swapStep, setSwapStep] = useState<"READY" | "PROMPTING" | "REVERTED" | "CONVERTING" | "SETTLED">("READY");
  const [isSettlingSwap, setIsSettlingSwap] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [isSendingWalletTx, setIsSendingWalletTx] = useState(false);
  const [walletTxHash, setWalletTxHash] = useState<string | null>(null);
  const [showMobileQr, setShowMobileQr] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { priceUsd: zecPriceUsd } = useZecPrice();

  const selectedToken =
    SUPPORTED_SWAP_TOKENS.find((t) => t.id === selectedTokenId) || SUPPORTED_SWAP_TOKENS[0];

  // Calculate ZEC delivered into shielded escrow from native paying token
  const calculateZecFromToken = (tokenAmount: string, token: SupportedSwapToken): string => {
    const deposit = parseFloat(tokenAmount) || 0;
    if (deposit <= 0) return "0.00";
    const effectiveZecPrice = zecPriceUsd > 0 ? zecPriceUsd : 52.5;
    const buffer = 1.012;
    let zec = 0;
    if (token.symbol === "USDC" || token.symbol === "USDT") {
      zec = deposit / (effectiveZecPrice * buffer);
    } else if (token.symbol === "ETH") {
      const ethPrice = 2800;
      zec = (deposit * ethPrice) / (effectiveZecPrice * buffer);
    }
    return Math.max(0.0001, Math.round(zec * 10000) / 10000).toFixed(4);
  };

  const getEffectiveZecAmount = (): string => {
    return payMethod === "cross_chain"
      ? calculateZecFromToken(tokenDepositAmount, selectedToken)
      : amountZec;
  };

  const [userProfile, setUserProfile] = useState<{
    name: string;
    username: string;
    bio?: string;
    profileImageUrl?: string;
    isVerified?: boolean;
    xUserId: string;
  }>({
    name: username.charAt(0).toUpperCase() + username.slice(1),
    username,
    bio: undefined,
    isVerified: false,
    xUserId: `x_${username}`,
  });

  useEffect(() => {
    if (!username) return;

    // Set referral cookie for 30 days
    document.cookie = `xtip_ref=${username}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;

    fetch(`/api/users/lookup?username=${username}`)
      .then((res) => res.json())
      .then((data) => {
        const user = data.profile || data.user;
        if (data.success && user) {
          setUserProfile({
            name: user.name || username,
            username: user.username || username,
            bio: user.bio || undefined,
            profileImageUrl: user.profileImageUrl || `https://unavatar.io/x/${username}`,
            isVerified: user.isVerified ?? false,
            xUserId: user.xUserId || `x_${username}`,
          });
        }
      })
      .catch((e) => console.warn("User profile fetch:", e));
  }, [username]);

  const handleGenerateEscrow = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const effectiveZec = getEffectiveZecAmount();

      const res = await fetch("/api/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientXUserId: userProfile.xUserId,
          recipientUsername: userProfile.username,
          amountZec: effectiveZec,
          isAnonymous,
          memo,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.tip?.escrowAddress) {
        setErrorMessage(data?.error || "Failed to generate escrow address. Please try again.");
        setIsLoading(false);
        return;
      }

      const generatedAddr = data.tip.escrowAddress;
      const tipId = data.tip._id || data.tip.id;
      setEscrowAddress(generatedAddr);
      setCreatedTipId(tipId);

      if (payMethod === "cross_chain") {
        const swapRes = await fetch("/api/swaps/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromTokenId: selectedTokenId,
            zecAmount: parseFloat(effectiveZec),
            targetZecAddress: generatedAddr,
            tipId: tipId,
          }),
        });
        const swapData = await swapRes.json();
        if (swapRes.ok && swapData.success && swapData.order) {
          setSwapOrder(swapData.order);
          setSwapStep("READY");
          setStep(2);
          setIsLoading(false);

          if (walletAddress) {
            handleTriggerWalletPayment(swapData.order);
          }
          return;
        } else {
          setErrorMessage(swapData?.error || "Failed to generate cross-chain quote.");
          setIsLoading(false);
          return;
        }
      }
      setStep(2);
    } catch (e: any) {
      setErrorMessage(e.message || "Failed to create escrow tip.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTriggerWalletPayment = async (customOrder?: SwapOrder) => {
    const orderToPay = customOrder || swapOrder;
    if (!orderToPay) return;

    setIsSendingWalletTx(true);
    setErrorMessage(null);
    setSwapStep("PROMPTING");

    try {
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

      const txHash = await sendEvmPayment({
        token: orderToPay.fromToken,
        depositVaultAddress: orderToPay.depositAddress,
        depositAmount: orderToPay.depositAmount,
        fromAddress: payerAddress,
      });

      setWalletTxHash(txHash);
      setSwapStep("CONVERTING");

      // Auto settle with cross-chain solver
      const res = await fetch(`/api/swaps/${orderToPay.orderId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evmTxHash: txHash }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSwapStep("SETTLED");
      }
    } catch (err: any) {
      console.warn("Wallet payment execution:", err);
      const isUserReject =
        err?.code === 4001 ||
        err?.message?.toLowerCase().includes("rejected") ||
        err?.message?.toLowerCase().includes("denied") ||
        err?.message?.toLowerCase().includes("cancelled");
      setErrorMessage(
        isUserReject
          ? "Transaction request was cancelled in wallet."
          : err.message || "Transaction reverted or failed in wallet."
      );
      setSwapStep("REVERTED");
    } finally {
      setIsSendingWalletTx(false);
    }
  };

  // Auto-detect tip funding when on Native Zcash path
  useEffect(() => {
    if (step !== 2 || payMethod !== "zec" || !createdTipId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tips/${createdTipId}`);
        const data = await res.json();
        if (res.ok && data.success && data.tip) {
          if (data.tip.status === "FUNDED") {
            setSwapStep("SETTLED");
          }
        }
      } catch (e) {
        // Silent polling catch
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [step, payMethod, createdTipId]);

  const handleRefreshCrossChain = async () => {
    if (!swapOrder) return;
    setIsSettlingSwap(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/swaps/${swapOrder.orderId}`);
      const data = await res.json();
      if (res.ok && data.success && data.order) {
        if (data.order.status === "SETTLED") {
          setSwapStep("SETTLED");
        } else if (data.order.status === "PENDING") {
          if (!walletTxHash) {
            setSwapStep("REVERTED");
            setErrorMessage("No wallet transaction detected. Please confirm the payment in your EVM wallet.");
          } else {
            setSwapStep("CONVERTING");
          }
        } else if (data.order.status === "REVERTED") {
          setSwapStep("REVERTED");
          setErrorMessage("The cross-chain swap was cancelled or reverted.");
        }
      }
    } catch (err) {
      // Keep current state
    } finally {
      setIsSettlingSwap(false);
    }
  };

  return (
    <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-4 sm:p-6 text-left">
      <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-6 sm:p-7 shadow-modal space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-butter-200">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brown-600 hover:text-brown-950 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to VeilX</span>
          </Link>
          <span className="text-[11px] font-mono font-bold text-brown-900 bg-butter-50 px-2.5 py-0.5 rounded-full border border-butter-300">
            Shielded Escrow
          </span>
        </div>

        {/* User Badge */}
        <div className="flex items-center gap-3 p-3.5 bg-butter-50 border border-butter-200 rounded-2xl shadow-subtle">
          {userProfile.profileImageUrl ? (
            <img
              src={userProfile.profileImageUrl}
              alt={userProfile.name}
              className="w-12 h-12 rounded-full border border-butter-300 object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-brown-900 text-white flex items-center justify-center font-bold text-base shadow-subtle">
              {userProfile.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-brown-950 truncate">{userProfile.name}</h3>
            <p className="text-xs text-brown-500 truncate">@{userProfile.username}</p>
          </div>
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            {/* Payment Method Switcher */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-brown-900 block">
                Payment Asset
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
                  onClick={() => setPayMethod("cross_chain")}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    payMethod === "cross_chain"
                      ? "bg-brown-900 text-white shadow-subtle"
                      : "text-brown-700 hover:bg-butter-100"
                  }`}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Cross-Chain</span>
                </button>
              </div>
            </div>

            {/* If Multi-Currency: EVM Wallet & Standard Dropdown */}
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

                {/* Standard Dropdown Asset Selector */}
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

                <div className="flex items-center gap-1.5 text-[10px] font-bold text-brown-800 bg-white/80 p-2 rounded-xl border border-amber-200">
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

            <Input
              label="Encrypted Memo (Optional)"
              placeholder="Private note delivered with your tip..."
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />

            {/* Privacy Mode Toggle */}
            <div
              onClick={() => setIsAnonymous(!isAnonymous)}
              className="p-3.5 rounded-2xl border border-butter-300 bg-butter-50 cursor-pointer flex items-center justify-between transition-all hover:bg-butter-100"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-brown-900 text-white flex items-center justify-center">
                  <Lock className="w-4 h-4 text-butter-200" />
                </div>
                <div>
                  <p className="text-xs font-bold text-brown-950">
                    {isAnonymous ? "Anonymous Tip (Recommended)" : "Public Supporter"}
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

            {/* 30-Day Escrow Notice */}
            <div className="p-3 bg-amber-50/80 rounded-2xl border border-amber-200/80 flex items-center gap-2.5 text-xs text-amber-950 shadow-subtle">
              <Clock className="w-4 h-4 text-amber-700 shrink-0" />
              <div className="text-[11px] leading-tight">
                <span className="font-bold block text-amber-950">
                  30-Day Escrow Window
                </span>
                <span className="text-amber-800">
                  Tips are held safely in shielded escrow for 30 days for @{userProfile.username} to claim.
                </span>
              </div>
            </div>

            {errorMessage && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                {errorMessage}
              </div>
            )}

            <Button
              onClick={handleGenerateEscrow}
              variant="primary"
              className="w-full mt-2"
              isLoading={isLoading}
              disabled={
                payMethod === "cross_chain"
                  ? !tokenDepositAmount || parseFloat(tokenDepositAmount) <= 0
                  : !amountZec || parseFloat(amountZec) <= 0
              }
            >
              {payMethod === "cross_chain"
                ? walletAddress
                  ? `Pay ${tokenDepositAmount} ${selectedToken.symbol} with Wallet`
                  : "Connect EVM & Tip"
                : "Complete payment"}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {payMethod === "cross_chain" && swapOrder ? (
              <div className="space-y-4 animate-in fade-in">
                {/* Order Amount Banner */}
                <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl text-center space-y-1">
                  <span className="text-[11px] uppercase font-bold text-brown-500">
                    Amount to Send via Wallet
                  </span>
                  <p className="text-3xl font-mono font-extrabold text-brown-950">
                    {swapOrder.depositAmount}{" "}
                    <span className="text-xl font-bold text-brown-700">{swapOrder.fromToken.symbol}</span>
                  </p>
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-brown-600 bg-butter-100 px-3 py-0.5 rounded-full">
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
                          Please approve the {swapOrder.depositAmount} {swapOrder.fromToken.symbol} transfer in your MetaMask or browser extension.
                        </p>
                      </div>
                    </div>
                  ) : walletTxHash ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <span className="font-bold text-emerald-950 block">Transaction Sent</span>
                          <span className="text-[10px] font-mono text-emerald-700">
                            {truncateAddress(walletTxHash, 10, 8)}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                        Converting
                      </span>
                    </div>
                  ) : swapStep !== "SETTLED" ? (
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
                        Zero address copying required. Populates automatically in your wallet.
                      </p>
                    </div>
                  ) : null}

                  {/* Mobile QR Toggle */}
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

                {/* Solver Status tracker */}
                <div className="p-3 bg-butter-50 border border-butter-200 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-brown-900">
                    <span>Cross-Chain Settlement</span>
                    <span className="text-emerald-700 font-mono">
                      {swapStep === "SETTLED" ? "✓ Settled into Escrow" : "Solver Active"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-brown-800 bg-white p-2 rounded-xl border border-butter-200">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Private tip powered by Zcash + cross-chain settlement</span>
                  </div>
                </div>

                {swapStep === "SETTLED" ? (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                    <p className="text-sm font-bold text-emerald-950">Tip Funded in Shielded Escrow!</p>
                    <p className="text-xs text-emerald-800">
                      @{userProfile.username} can now claim {swapOrder.zecAmount} ZEC into their private wallet.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {swapStep === "REVERTED" && (
                      <Button
                        onClick={() => handleTriggerWalletPayment()}
                        variant="primary"
                        className="w-full h-10 text-xs font-bold gap-2"
                        isLoading={isSendingWalletTx}
                        disabled={isSendingWalletTx}
                      >
                        <ArrowRight className="w-4 h-4" />
                        <span>Retry Payment in Wallet</span>
                      </Button>
                    )}
                    <Button
                      onClick={handleRefreshCrossChain}
                      variant="outline"
                      className="w-full h-10 text-xs font-bold gap-2"
                      isLoading={isSettlingSwap}
                      disabled={isSettlingSwap}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Refresh Settlement Status</span>
                    </Button>
                  </div>
                )}
              </div>
            ) : swapStep === "SETTLED" ? (
              /* Native Zcash Settled Confirmation */
              <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-3xl text-center space-y-4 animate-in fade-in zoom-in-95">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center border border-emerald-200">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-bold text-emerald-950">Tip Funded in Shielded Escrow!</h3>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    <strong>{amountZec} ZEC</strong> was received and is safely held in privacy-shielded escrow for <strong>@{userProfile.username}</strong>.
                  </p>
                </div>
                <div className="pt-2">
                  <Link
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                      `I just sent a privacy-shielded tip of ${amountZec} ZEC to @${userProfile.username} via VeilX! Claim it here: https://veilx.cash/tip/${userProfile.username}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center w-full py-2.5 px-4 rounded-full bg-brown-900 text-white font-bold text-xs hover:bg-brown-950 transition-all gap-1.5 shadow-subtle"
                  >
                    <span>Tweet to @{userProfile.username}</span>
                  </Link>
                </div>
              </div>
            ) : (
              /* Native Zcash View */
              <div className="space-y-5">
                <div className="text-center space-y-1">
                  <p className="text-xs font-semibold text-brown-500">Send Payment</p>
                  <p className="text-2xl font-mono font-bold text-brown-950">{amountZec} ZEC</p>
                </div>

                {escrowAddress && (
                  <QRDisplay
                    value={buildZip321Uri({
                      address: escrowAddress,
                      amountZec: parseFloat(amountZec),
                      memo: memo || "VeilX Private Tip",
                    })}
                    address={escrowAddress}
                    amountZec={parseFloat(amountZec)}
                    memo={memo || "VeilX Private Tip"}
                    onPaymentConfirmed={() => setSwapStep("SETTLED")}
                  />
                )}
              </div>
            )}

            <div className="text-center pt-2">
              <p className="text-[11px] text-brown-400 mb-2">
                Funds are held in shielded escrow until claimed by @{userProfile.username}.
              </p>
              <Button
                onClick={() => setStep(1)}
                variant="outline"
                size="sm"
                className="w-full text-xs"
              >
                Send Another Tip
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
