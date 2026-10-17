"use client";

import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Copy,
  Wallet,
  Smartphone,
  CheckCircle2,
  Loader2,
  ArrowRight,
  AlertCircle,
  Download,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { Button } from "./Button";
import { truncateAddress } from "@/lib/utils";
import {
  detectAvailableWallets,
  detectNoirAsync,
  connectBrowserWallet,
  sendBrowserTransaction,
  getMobileWalletDeepLinks,
  buildZip321Uri,
  WalletDetectionResult,
} from "@/lib/wallet";

export interface QRDisplayProps {
  value: string; // The ZIP-321 URI or Shielded Address
  address: string;
  amountZec?: number | string;
  memo?: string;
  onPaymentConfirmed?: (txid: string) => void;
  onOpenWallet?: () => void;
}

export function QRDisplay({
  value,
  address,
  amountZec,
  memo,
  onPaymentConfirmed,
  onOpenWallet,
}: QRDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [walletInfo, setWalletInfo] = useState<WalletDetectionResult>({
    hasNoir: false,
    hasKeystop: false,
    hasZcashWeb3: false,
    hasMetaMaskSnap: false,
    hasAnyDesktopWallet: false,
    isMobile: false,
  });

  const [paymentMode, setPaymentMode] = useState<"wallet" | "qr">("wallet");

  // Extension wallet signing states
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [connectedWalletName, setConnectedWalletName] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    const updateDetection = () => {
      const detected = detectAvailableWallets();
      setWalletInfo(detected);

      if (detected.isMobile) {
        setPaymentMode("wallet");
      }
    };

    updateDetection();

    // Async probe for Noir extension provider injection
    detectNoirAsync(2500).then((hasNoir) => {
      if (hasNoir) {
        updateDetection();
      }
    });

    // Listen to Noir extension initialization event
    const handleNoirInit = () => {
      updateDetection();
    };

    window.addEventListener("noirwallet#initialized", handleNoirInit);
    window.addEventListener("focus", updateDetection);

    const timer1 = setTimeout(updateDetection, 300);
    const timer2 = setTimeout(updateDetection, 1000);
    const timer3 = setTimeout(updateDetection, 2500);

    return () => {
      window.removeEventListener("noirwallet#initialized", handleNoirInit);
      window.removeEventListener("focus", updateDetection);
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 1. Desktop Browser Wallet Connect & Sign
  const handlePayWithBrowserWallet = async () => {
    setWalletError(null);
    setIsConnecting(true);

    try {
      // Connect to real injected Noir or Zcash extension
      const connection = await connectBrowserWallet();
      setConnectedAddress(connection.address);
      setConnectedWalletName(connection.walletName);
      setIsConnecting(false);
      setIsSigning(true);

      // Trigger transaction approval popup in Noir
      const result = await sendBrowserTransaction({
        to: address,
        amountZec: amountZec || "0.25",
        memo: memo,
      });

      setTxSuccess(result.txid);
      setIsSigning(false);
      if (onPaymentConfirmed) {
        onPaymentConfirmed(result.txid);
      }
    } catch (err: any) {
      setIsConnecting(false);
      setIsSigning(false);
      if (err.message === "NO_WALLET_DETECTED") {
        setWalletError("Noir wallet extension is not detected. Please verify Noir is enabled in your browser or scan the QR code.");
      } else {
        setWalletError(err.message || "Transaction was rejected or failed");
      }
    }
  };


  // 2. Mobile Deep Link URLs
  const { standardUri, zodlScheme } = getMobileWalletDeepLinks({
    address,
    amountZec: amountZec || "0.25",
    memo,
  });

  const effectiveQrValue = buildZip321Uri({
    address,
    amountZec,
    memo,
  }) || value;

  return (
    <div className="flex flex-col items-center text-center space-y-4">
      {/* Mode Switcher Tabs */}
      <div className="flex items-center gap-1 p-1 bg-butter-50 border border-butter-300 rounded-full text-xs font-semibold shadow-subtle">
        <button
          type="button"
          onClick={() => setPaymentMode("wallet")}
          className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
            paymentMode === "wallet"
              ? "bg-brown-900 text-white shadow-sm font-bold"
              : "text-brown-600 hover:text-brown-950"
          }`}
        >
          {walletInfo.isMobile ? (
            <Smartphone className="w-3.5 h-3.5" />
          ) : (
            <Wallet className="w-3.5 h-3.5" />
          )}
          <span>{walletInfo.isMobile ? "Pay with ZODL" : "Pay with Browser Wallet"}</span>
        </button>

        <button
          type="button"
          onClick={() => setPaymentMode("qr")}
          className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
            paymentMode === "qr"
              ? "bg-brown-900 text-white shadow-sm font-bold"
              : "text-brown-600 hover:text-brown-950"
          }`}
        >
          <QRCodeSVG value={effectiveQrValue} size={14} className="w-3.5 h-3.5" />
          <span>Scan QR Code</span>
        </button>
      </div>

      {amountZec && (
        <div className="text-center">
          <p className="text-xs font-semibold text-brown-500 uppercase tracking-wider">
            Amount to Pay
          </p>
          <p className="text-3xl font-mono font-extrabold text-brown-950">
            {amountZec} <span className="text-xl font-bold text-brown-700">ZEC</span>
          </p>
        </div>
      )}

      {/* MODE 1: 1-Click Wallet (Noir Extension on Desktop or ZODL Mobile App) */}
      {paymentMode === "wallet" && (
        <div className="w-full space-y-3.5">
          {!txSuccess ? (
            <div className="p-5 bg-white border border-butter-300 rounded-3xl space-y-4 text-left shadow-subtle">
              {/* Mobile View: ZODL Deep Link Button */}
              {walletInfo.isMobile ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-butter-50 border border-butter-200 rounded-2xl">
                    <div className="w-10 h-10 rounded-xl bg-brown-900 text-white flex items-center justify-center font-bold text-sm shadow-subtle">
                      Z
                    </div>
                    <div>
                      <p className="text-xs font-bold text-brown-950">Zcash Mobile App</p>
                      <p className="text-[11px] text-brown-500">
                        Launches your installed wallet with pre-filled shielded payment
                      </p>
                    </div>
                  </div>

                  <a
                    href={standardUri}
                    className="w-full h-12 inline-flex items-center justify-center gap-2 bg-brown-900 text-white hover:bg-brown-950 rounded-2xl text-sm font-bold transition-all shadow-elevated active:scale-95"
                  >
                    <Smartphone className="w-4 h-4 text-butter-200" />
                    <span>Open in Mobile Wallet</span>
                    <ArrowRight className="w-4 h-4 text-butter-200 ml-auto" />
                  </a>
                </div>
              ) : (
                /* Desktop View: Browser Extension Signing */
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-butter-50 border border-butter-200 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-brown-900 text-white flex items-center justify-center font-bold text-sm shadow-subtle">
                        🛡️
                      </div>
                      <div>
                        <p className="text-xs font-bold text-brown-950">
                          {walletInfo.detectedWalletName || "Zcash Browser Wallet"}
                        </p>
                        <p className="text-[11px] text-brown-500">
                          {walletInfo.hasAnyDesktopWallet
                            ? `${walletInfo.detectedWalletName || "Browser Extension"} detected · Ready to connect`
                            : "Supports Noir, Keystop & Web3 extensions"}
                        </p>
                      </div>
                    </div>
                    {walletInfo.hasAnyDesktopWallet ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Detected
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-brown-500 bg-butter-100 px-2 py-0.5 rounded-full border border-butter-300">
                        Checking...
                      </span>
                    )}
                  </div>

                  {walletError && (
                    <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
                      <div className="flex items-center gap-1.5 font-bold">
                        <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>Wallet Notice</span>
                      </div>
                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        {walletError}
                      </p>
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => setPaymentMode("qr")}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-brown-950 underline"
                        >
                          <span>Scan QR with Mobile (Zashi, Ywallet, ZODL)</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={handlePayWithBrowserWallet}
                    variant="primary"
                    className="w-full h-12 text-sm font-bold gap-2 shadow-elevated"
                    disabled={isConnecting || isSigning}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Connecting to Wallet...</span>
                      </>
                    ) : isSigning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Approve Transaction in Wallet...</span>
                      </>
                    ) : (
                      <>
                        <Wallet className="w-4 h-4 text-butter-200" />
                        <span>{walletInfo.hasAnyDesktopWallet ? `Pay with ${walletInfo.detectedWalletName || "Extension"}` : "Pay with Browser Extension"}</span>
                        <ArrowRight className="w-4 h-4 text-butter-200 ml-auto" />
                      </>
                    )}
                  </Button>

                  {/* Fallback actions */}
                  <div className="pt-2 border-t border-butter-200 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => setPaymentMode("qr")}
                      className="text-[11px] text-brown-600 hover:text-brown-950 font-semibold underline transition-colors"
                    >
                      Prefer mobile app? Scan ZIP-321 QR code
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-3xl text-center space-y-2 animate-in fade-in zoom-in-95">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-emerald-950">Payment Signed & Broadcasted!</p>
              <p className="text-[11px] font-mono text-emerald-800 break-all truncate max-w-xs mx-auto">
                Txid: {truncateAddress(txSuccess, 10, 8)}
              </p>
              <div className="pt-2 flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-700">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>NU6.3 Shielded Zcash Escrow</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE 2: QR Code Scanning */}
      {paymentMode === "qr" && (
        <div className="w-full space-y-3">
          <div className="p-4 bg-white border border-butter-300 rounded-3xl shadow-subtle mx-auto inline-block">
            <div className="p-2 bg-butter-50 rounded-2xl border border-butter-200">
              <QRCodeSVG
                value={effectiveQrValue}
                size={190}
                bgColor="transparent"
                fgColor="#1E1315"
                level="M"
                className="w-full h-auto max-w-[190px]"
              />
            </div>
          </div>
          <p className="text-[11px] text-brown-500">
            Scan with ZODL, Zashi, or Ywallet on your phone to settle shielded escrow
          </p>
        </div>
      )}

      {/* Copy Address Bar */}
      <div className="w-full p-2.5 bg-butter-50 border border-butter-200 rounded-2xl flex items-center justify-between gap-2 text-left">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase font-bold text-brown-400 tracking-wider">
            Shielded Escrow Address
          </p>
          <p className="text-xs font-mono font-medium text-brown-800 truncate">
            {truncateAddress(address, 12, 10)}
          </p>
        </div>
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-lg text-brown-700 hover:bg-white hover:shadow-subtle transition-all shrink-0 border border-transparent hover:border-butter-200"
          title="Copy full address"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
