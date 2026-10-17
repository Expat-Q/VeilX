/**
 * Zcash Browser Extension & Mobile Wallet Integration
 * Uses official @noir-wallet/sdk for Noir Wallet extension interaction,
 * with fallbacks for Keystop, generic Zcash Web3 providers, and mobile deep links (ZODL).
 */

import {
  getNoirWallet,
  isNoirWalletInstalled,
  detectProvider,
  ZcashAPI,
} from "@noir-wallet/sdk";

declare global {
  interface Window {
    noirwallet?: {
      isNoirWallet?: boolean;
      version?: string;
      zcash?: any;
    };
    noir?: {
      isNoir?: boolean;
      connect?: () => Promise<{ address: string }>;
      enable?: () => Promise<string[]>;
      sendTransaction?: (tx: {
        to: string;
        amount: string | number;
        memo?: string;
      }) => Promise<{ txid: string }>;
      request?: (args: { method: string; params?: any }) => Promise<any>;
    };
    keystop?: {
      isKeystop?: boolean;
      request: (args: { method: string; params?: any }) => Promise<any>;
    };
    zcash?: {
      isZcash?: boolean;
      request: (args: { method: string; params?: any }) => Promise<any>;
    };
    ethereum?: {
      isMetaMask?: boolean;
      isOkxWallet?: boolean;
      isRabby?: boolean;
      isCoinbaseWallet?: boolean;
      isTrust?: boolean;
      isPhantom?: boolean;
      isBraveWallet?: boolean;
      request: (args: { method: string; params?: any }) => Promise<any>;
    };
  }
}

export interface WalletDetectionResult {
  hasNoir: boolean;
  hasKeystop: boolean;
  hasZcashWeb3: boolean;
  hasMetaMaskSnap: boolean;
  hasAnyDesktopWallet: boolean;
  isMobile: boolean;
  detectedWalletName?: string;
}

export const isMobileDevice = (): boolean => {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
};

export const detectAvailableWallets = (): WalletDetectionResult => {
  if (typeof window === "undefined") {
    return {
      hasNoir: false,
      hasKeystop: false,
      hasZcashWeb3: false,
      hasMetaMaskSnap: false,
      hasAnyDesktopWallet: false,
      isMobile: false,
    };
  }

  // 1. Official Noir Wallet (window.noirwallet or window.noir)
  const hasNoir =
    isNoirWalletInstalled() ||
    !!(
      (window as any).noirwallet?.isNoirWallet ||
      (window as any).noirwallet?.zcash ||
      window.noir?.isNoir ||
      typeof window.noir?.connect === "function" ||
      typeof window.noir?.request === "function"
    );

  // 2. Keystop Extension
  const hasKeystop = !!(window.keystop && window.keystop.isKeystop);

  // 3. VeilX NU7 Extension or Generic Zcash Web3 Provider
  const hasVeilXExt = !!(
    (window as any).veilx?.isVeilX || (window.zcash as any)?.isVeilX
  );
  const hasZcashWeb3 =
    hasVeilXExt ||
    !!(
      window.zcash &&
      (window.zcash.isZcash || typeof window.zcash.request === "function")
    );

  // 4. MetaMask with Snap support (Avoid generic EVM extensions like OKX/Rabby)
  const isPureMetaMask = !!(
    window.ethereum &&
    window.ethereum.isMetaMask &&
    !window.ethereum.isOkxWallet &&
    !window.ethereum.isRabby &&
    !window.ethereum.isCoinbaseWallet &&
    !window.ethereum.isTrust &&
    !window.ethereum.isPhantom &&
    !window.ethereum.isBraveWallet
  );

  const isMobile = isMobileDevice();

  let detectedWalletName: string | undefined;
  if (hasVeilXExt) detectedWalletName = "VeilX NU7 Wallet";
  else if (hasNoir) detectedWalletName = "Noir Wallet";
  else if (hasKeystop) detectedWalletName = "Keystop Wallet";
  else if (hasZcashWeb3) detectedWalletName = "Zcash Web3";
  else if (isPureMetaMask) detectedWalletName = "MetaMask Snap";

  return {
    hasNoir,
    hasKeystop,
    hasZcashWeb3,
    hasMetaMaskSnap: isPureMetaMask,
    hasAnyDesktopWallet: hasNoir || hasKeystop || hasZcashWeb3,
    isMobile,
    detectedWalletName,
  };
};

/**
 * Async detection with retry / event listener for Noir injection
 */
export async function detectNoirAsync(timeoutMs = 2000): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isNoirWalletInstalled() || (window as any).noirwallet) return true;

  try {
    const provider = await detectProvider(timeoutMs);
    return !!provider;
  } catch {
    return detectAvailableWallets().hasNoir;
  }
}

/**
 * Connect to Noir or standard Zcash browser extension
 */
export async function connectBrowserWallet(): Promise<{
  address: string;
  walletName: string;
}> {
  if (typeof window === "undefined") {
    throw new Error("Browser window is not available");
  }

  // 1. Official Noir Wallet via SDK
  try {
    const noirWallet = getNoirWallet();
    if (noirWallet && noirWallet.zcash) {
      const res = await noirWallet.zcash.connect();
      const addr =
        res.shielded ||
        res.transparent ||
        res.accounts?.[0]?.addresses?.shielded ||
        res.accounts?.[0]?.addresses?.transparent ||
        "shielded_connected";
      return {
        address: addr,
        walletName: (window as any).veilx?.isVeilX ? "VeilX Shielded Wallet" : "Noir Wallet",
      };
    }
  } catch (e: any) {
    if (e.message && !e.message.includes("not installed")) {
      throw new Error(e.message || "User rejected Noir connection");
    }
  }

  // 1b. Direct window.noirwallet check
  if ((window as any).noirwallet?.zcash) {
    try {
      const zcashApi = new ZcashAPI((window as any).noirwallet.zcash);
      const res = await zcashApi.connect();
      const addr =
        res.shielded ||
        res.transparent ||
        res.accounts?.[0]?.addresses?.shielded ||
        res.accounts?.[0]?.addresses?.transparent ||
        "shielded_connected";
      return {
        address: addr,
        walletName: (window as any).veilx?.isVeilX ? "VeilX Shielded Wallet" : "Noir Wallet",
      };
    } catch (e: any) {
      throw new Error(e.message || "User rejected Noir connection");
    }
  }

  // 1c. Legacy / alternate window.noir injection
  if (window.noir) {
    try {
      if (typeof window.noir.connect === "function") {
        const res = await window.noir.connect();
        return {
          address: res?.address || "shielded_connected",
          walletName: "Noir Extension",
        };
      } else if (typeof window.noir.request === "function") {
        const accounts = await window.noir.request({ method: "zcash_requestAccounts" });
        return {
          address: Array.isArray(accounts) ? accounts[0] : accounts?.address || "shielded_connected",
          walletName: "Noir Extension",
        };
      }
    } catch (e: any) {
      throw new Error(e.message || "User rejected Noir connection");
    }
  }

  // 2. Keystop Zcash Wallet Extension
  if (window.keystop && typeof window.keystop.request === "function") {
    try {
      const accounts = await window.keystop.request({ method: "zcash_requestAccounts" });
      return {
        address: Array.isArray(accounts) ? accounts[0] : accounts?.address || "shielded_connected",
        walletName: "Keystop Wallet",
      };
    } catch (e: any) {
      throw new Error(e.message || "User rejected Keystop connection");
    }
  }

  // 3. Generic Zcash Web3 Provider
  if (window.zcash && typeof window.zcash.request === "function") {
    try {
      const accounts = await window.zcash.request({ method: "zcash_requestAccounts" });
      return {
        address: Array.isArray(accounts) ? accounts[0] : accounts?.address || "shielded_connected",
        walletName: "Zcash Web3 Wallet",
      };
    } catch (e: any) {
      throw new Error(e.message || "User rejected wallet connection");
    }
  }

  throw new Error("NO_WALLET_DETECTED");
}

/**
 * Send and sign transaction using Noir or standard Zcash browser extension
 */
export async function sendBrowserTransaction(params: {
  to: string;
  amountZec: number | string;
  memo?: string;
}): Promise<{ txid: string }> {
  if (typeof window === "undefined") {
    throw new Error("Browser window is not available");
  }

  // Zcash protocol constraint: memos are strictly supported only for shielded recipients (u1/utest1/zs/ztestsapling).
  // Transparent addresses (t1/tm) will cause Noir wallet extension to reject with "Invalid params: memo is only supported for shielded recipients".
  const isShielded = params.to.startsWith("u") || params.to.startsWith("z");
  const effectiveMemo = isShielded && params.memo?.trim() ? params.memo.trim() : undefined;

  // 1. Official Noir Wallet via SDK
  try {
    const noirWallet = getNoirWallet();
    if (noirWallet && noirWallet.zcash) {
      const txPayload: any = {
        to: params.to,
        amount: String(params.amountZec),
      };
      if (effectiveMemo) {
        txPayload.memo = effectiveMemo;
      }
      const txid = await noirWallet.zcash.sendTransaction(txPayload);
      return {
        txid: typeof txid === "string" ? txid : (txid as any)?.txid || (txid as any)?.hash || String(txid),
      };
    }
  } catch (e: any) {
    if (e.message && !e.message.includes("not installed")) {
      throw new Error(e.message || "Transaction rejected in Noir wallet");
    }
  }

  // 1b. Direct window.noirwallet zcash API
  if ((window as any).noirwallet?.zcash) {
    try {
      const zcashApi = new ZcashAPI((window as any).noirwallet.zcash);
      const txPayload: any = {
        to: params.to,
        amount: String(params.amountZec),
      };
      if (effectiveMemo) {
        txPayload.memo = effectiveMemo;
      }
      const txid = await zcashApi.sendTransaction(txPayload);
      return {
        txid: typeof txid === "string" ? txid : (txid as any)?.txid || (txid as any)?.hash || String(txid),
      };
    } catch (e: any) {
      throw new Error(e.message || "Transaction rejected in Noir wallet");
    }
  }

  // 1c. Alternate window.noir object
  if (window.noir) {
    try {
      if (typeof window.noir.sendTransaction === "function") {
        const txPayload: any = {
          to: params.to,
          amount: params.amountZec,
        };
        if (effectiveMemo) {
          txPayload.memo = effectiveMemo;
        }
        const res = await window.noir.sendTransaction(txPayload);
        return { txid: res.txid || `tx_${Math.random().toString(36).substring(2, 15)}` };
      } else if (typeof window.noir.request === "function") {
        const txPayload: any = {
          to: params.to,
          amount: String(params.amountZec),
        };
        if (effectiveMemo) {
          txPayload.memo = effectiveMemo;
        }
        const txid = await window.noir.request({
          method: "zcash_sendTransaction",
          params: [txPayload],
        });
        return { txid: typeof txid === "string" ? txid : txid?.txid || txid?.hash };
      }
    } catch (e: any) {
      throw new Error(e.message || "Transaction rejected in Noir wallet");
    }
  }

  // 2. Keystop Extension
  if (window.keystop && typeof window.keystop.request === "function") {
    try {
      const txid = await window.keystop.request({
        method: "zcash_sendTransaction",
        params: [
          {
            to: params.to,
            amount: String(params.amountZec),
            memo: params.memo,
          },
        ],
      });
      return { txid: typeof txid === "string" ? txid : txid?.txid || txid?.hash };
    } catch (e: any) {
      throw new Error(e.message || "Transaction rejected in Keystop wallet");
    }
  }

  // 3. Generic Zcash Provider
  if (window.zcash && typeof window.zcash.request === "function") {
    try {
      const txid = await window.zcash.request({
        method: "zcash_sendTransaction",
        params: [
          {
            to: params.to,
            amount: String(params.amountZec),
            memo: params.memo,
          },
        ],
      });
      return { txid: typeof txid === "string" ? txid : txid?.txid || txid?.hash };
    } catch (e: any) {
      throw new Error(e.message || "Transaction rejected in wallet");
    }
  }

  throw new Error("NO_WALLET_DETECTED");
}

/**
 * Encodes a string into ZIP-321 compliant base64url format without padding (RFC 4648 §5).
 * Required by standard Zcash wallets (Zashi, Ywallet, Zecwallet) to prevent memo parsing errors.
 */
export function encodeZip321Memo(memo: string): string {
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    const bytes = new TextEncoder().encode(memo);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window
      .btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  return Buffer.from(memo, "utf8").toString("base64url");
}

/**
 * Builds a strict ZIP-321 compliant Zcash payment URI.
 */
export function buildZip321Uri(params: {
  address: string;
  amountZec?: number | string;
  memo?: string;
}): string {
  const isShielded = params.address.startsWith("u") || params.address.startsWith("z");
  const parts: string[] = [];
  if (params.amountZec !== undefined && params.amountZec !== "") {
    parts.push(`amount=${params.amountZec}`);
  }
  if (isShielded && params.memo && params.memo.trim()) {
    parts.push(`memo=${encodeZip321Memo(params.memo.trim())}`);
  }
  const query = parts.length > 0 ? `?${parts.join("&")}` : "";
  return `zcash:${params.address}${query}`;
}

/**
 * Generate ZODL & ZIP-321 Mobile Deep Links
 */
export function getMobileWalletDeepLinks(params: {
  address: string;
  amountZec: number | string;
  memo?: string;
}) {
  const isShielded = params.address.startsWith("u") || params.address.startsWith("z");
  const base64urlMemo = isShielded && params.memo ? encodeZip321Memo(params.memo.trim()) : "";
  const memoParam = base64urlMemo ? `&memo=${base64urlMemo}` : "";
  const standardUri = buildZip321Uri(params);
  const zodlScheme = `zodl://pay?address=${params.address}&amount=${params.amountZec}${memoParam}`;

  return {
    standardUri,
    zodlScheme,
  };
}
