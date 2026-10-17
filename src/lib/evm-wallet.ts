/**
 * Client-side EVM Wallet Helper for VeilX Multi-Currency Cross-Chain Tipping
 * Supports MetaMask, Rabby, Coinbase Wallet, Brave, and standard EIP-1193 providers.
 */

import { SupportedSwapToken } from "@/types/swap";

export interface EvmWalletState {
  isConnected: boolean;
  address: string | null;
  chainId: number | null;
  isSupportedChain: boolean;
  isConnecting: boolean;
  error: string | null;
}

export const NETWORK_CONFIGS: Record<
  number,
  {
    chainIdHex: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  }
> = {
  8453: {
    chainIdHex: "0x2105",
    chainName: "Base",
    rpcUrls: ["https://mainnet.base.org"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://basescan.org"],
  },
  42161: {
    chainIdHex: "0xa4b1",
    chainName: "Arbitrum One",
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://arbiscan.io"],
  },
  1: {
    chainIdHex: "0x1",
    chainName: "Ethereum Mainnet",
    rpcUrls: ["https://cloudflare-eth.com"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://etherscan.io"],
  },
};

/**
 * Check if an EVM provider (MetaMask, Rabby, etc.) is injected
 */
export function hasInjectedProvider(): boolean {
  return typeof window !== "undefined" && typeof (window as any).ethereum !== "undefined";
}

/**
 * Request account connection via EIP-1193
 * Uses wallet_requestPermissions where supported to force the physical wallet prompt modal
 */
export async function connectInjectedWallet(): Promise<{
  address: string;
  chainId: number;
}> {
  if (!hasInjectedProvider()) {
    throw new Error("No EVM wallet detected. Please install MetaMask, Rabby, or Coinbase Wallet.");
  }

  const ethereum = (window as any).ethereum;

  let accounts: string[] = [];

  // Try wallet_requestPermissions first to force the explicit popup prompt in MetaMask/Rabby
  try {
    const permissions = await ethereum.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
    const accountsPermission = permissions?.find?.(
      (p: any) => p.parentCapability === "eth_accounts"
    );
    if (accountsPermission && accountsPermission.caveats && accountsPermission.caveats[0]?.value) {
      accounts = accountsPermission.caveats[0].value;
    }
  } catch (permError: any) {
    // Fallback if wallet does not support wallet_requestPermissions or user rejected permission request
    console.debug("Permission request fallback:", permError);
  }

  if (!accounts || accounts.length === 0) {
    accounts = (await ethereum.request({
      method: "eth_requestAccounts",
    })) as string[];
  }

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found or connection was rejected.");
  }

  const chainIdHex = (await ethereum.request({
    method: "eth_chainId",
  })) as string;

  const chainId = parseInt(chainIdHex, 16);

  return {
    address: accounts[0],
    chainId,
  };
}

/**
 * Fetch real token or ETH balance for connected EVM address
 * Directly queries the target chain RPC to guarantee the real on-chain balance
 * is shown even if the user's wallet extension is currently set to another network.
 */
export async function fetchWalletBalance(params: {
  address: string;
  token: SupportedSwapToken;
}): Promise<string> {
  const { address, token } = params;

  if (!address) return "0.00";


  // 1. Direct JSON-RPC call to the specific chain's public RPC node
  const config = NETWORK_CONFIGS[token.chainId];
  if (config && config.rpcUrls && config.rpcUrls.length > 0) {
    try {
      const rpcUrl = config.rpcUrls[0];
      if (token.symbol === "ETH") {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getBalance",
            params: [address, "latest"],
          }),
        });
        const data = await res.json();
        if (data?.result) {
          const balanceWei = BigInt(data.result);
          const balanceEth = Number(balanceWei) / 1e18;
          return balanceEth.toFixed(4);
        }
      } else if (token.contractAddress) {
        const cleanAddr = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
        const callData = `0x70a08231${cleanAddr}`;
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ to: token.contractAddress, data: callData }, "latest"],
          }),
        });
        const data = await res.json();
        if (data?.result && data.result !== "0x") {
          const rawAmount = BigInt(data.result);
          const divisor = 10 ** token.decimals;
          const formatted = Number(rawAmount) / divisor;
          return formatted.toFixed(2);
        }
      }
    } catch (rpcErr) {
      console.debug("Direct RPC query fallback to injected provider:", rpcErr);
    }
  }

  // 2. Fallback to injected ethereum provider
  if (hasInjectedProvider()) {
    const ethereum = (window as any).ethereum;
    try {
      if (token.symbol === "ETH") {
        const balanceHex = await ethereum.request({
          method: "eth_getBalance",
          params: [address, "latest"],
        });
        const balanceWei = BigInt(balanceHex || "0x0");
        const balanceEth = Number(balanceWei) / 1e18;
        return balanceEth.toFixed(4);
      } else if (token.contractAddress) {
        const cleanAddr = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
        const data = `0x70a08231${cleanAddr}`;
        const rawHex = await ethereum.request({
          method: "eth_call",
          params: [{ to: token.contractAddress, data }, "latest"],
        });
        if (rawHex && rawHex !== "0x") {
          const rawAmount = BigInt(rawHex);
          const divisor = 10 ** token.decimals;
          const formatted = Number(rawAmount) / divisor;
          return formatted.toFixed(2);
        }
      }
    } catch (err) {
      console.warn("Provider balance query failed:", err);
    }
  }

  return "0.00";
}

/**
 * Switch or add the required network in the wallet
 */
export async function switchOrAddNetwork(targetChainId: number): Promise<void> {
  if (!hasInjectedProvider()) return;

  const ethereum = (window as any).ethereum;
  const config = NETWORK_CONFIGS[targetChainId];
  if (!config) throw new Error(`Unsupported network chain ID: ${targetChainId}`);

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.chainIdHex }],
    });
  } catch (switchError: any) {
    // 4902 indicates chain has not been added to MetaMask
    if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: config.chainIdHex,
            chainName: config.chainName,
            rpcUrls: config.rpcUrls,
            nativeCurrency: config.nativeCurrency,
            blockExplorerUrls: config.blockExplorerUrls,
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

/**
 * Encodes standard ERC20 transfer(address to, uint256 amount)
 */
function encodeErc20Transfer(toAddress: string, amountRaw: bigint): string {
  // Method ID for transfer(address,uint256) is 0xa9059cbb
  const methodId = "a9059cbb";
  const cleanTo = toAddress.toLowerCase().replace(/^0x/, "");
  const paddedAddress = cleanTo.padStart(64, "0");
  const paddedAmount = amountRaw.toString(16).padStart(64, "0");
  return `0x${methodId}${paddedAddress}${paddedAmount}`;
}

/**
 * Triggers a 1-click transaction in the user's connected EVM wallet
 */
export async function sendEvmPayment(params: {
  token: SupportedSwapToken;
  depositVaultAddress: string;
  depositAmount: number;
  fromAddress: string;
}): Promise<string> {
  const { token, depositVaultAddress, depositAmount, fromAddress } = params;

  if (!hasInjectedProvider()) {
    throw new Error("No EVM wallet detected. Please connect MetaMask, Coinbase Wallet, or a compatible Web3 extension.");
  }

  const ethereum = (window as any).ethereum;

  // Verify chain
  const currentChainHex = await ethereum.request({ method: "eth_chainId" });
  const currentChainId = parseInt(currentChainHex, 16);

  if (currentChainId !== token.chainId) {
    await switchOrAddNetwork(token.chainId);
  }

  let txHash = "";

  if (token.symbol === "ETH") {
    // Native ETH transfer
    const weiAmount = BigInt(Math.floor(depositAmount * 1e18));
    const txParams = {
      from: fromAddress,
      to: depositVaultAddress,
      value: `0x${weiAmount.toString(16)}`,
    };

    txHash = (await ethereum.request({
      method: "eth_sendTransaction",
      params: [txParams],
    })) as string;
  } else {
    // ERC-20 Transfer (USDC or USDT)
    if (!token.contractAddress) {
      throw new Error(`Token contract address missing for ${token.symbol} on ${token.network}`);
    }

    const multiplier = 10 ** token.decimals;
    const rawAmount = BigInt(Math.floor(depositAmount * multiplier));
    const data = encodeErc20Transfer(depositVaultAddress, rawAmount);

    const txParams = {
      from: fromAddress,
      to: token.contractAddress,
      value: "0x0",
      data,
    };

    txHash = (await ethereum.request({
      method: "eth_sendTransaction",
      params: [txParams],
    })) as string;
  }

  return txHash;
}
