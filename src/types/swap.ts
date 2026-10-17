export interface SupportedSwapToken {
  id: string;
  symbol: "USDC" | "USDT" | "ETH";
  name: string;
  network: "base" | "arbitrum" | "ethereum";
  networkName: string;
  chainId: number;
  decimals: number;
  contractAddress?: string;
  icon?: string;
}

export const SUPPORTED_SWAP_TOKENS: SupportedSwapToken[] = [
  {
    id: "usdc-base",
    symbol: "USDC",
    name: "USD Coin",
    network: "base",
    networkName: "Base",
    chainId: 8453,
    decimals: 6,
    contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    id: "usdc-arbitrum",
    symbol: "USDC",
    name: "USD Coin",
    network: "arbitrum",
    networkName: "Arbitrum One",
    chainId: 42161,
    decimals: 6,
    contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  {
    id: "usdt-arbitrum",
    symbol: "USDT",
    name: "Tether USD",
    network: "arbitrum",
    networkName: "Arbitrum One",
    chainId: 42161,
    decimals: 6,
    contractAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  {
    id: "eth-base",
    symbol: "ETH",
    name: "Ethereum",
    network: "base",
    networkName: "Base",
    chainId: 8453,
    decimals: 18,
  },
  {
    id: "eth-ethereum",
    symbol: "ETH",
    name: "Ethereum",
    network: "ethereum",
    networkName: "Ethereum Mainnet",
    chainId: 1,
    decimals: 18,
  },
];

export interface SwapOrder {
  orderId: string;
  tipId?: string;
  fromToken: SupportedSwapToken;
  zecAmount: number;
  depositAmount: number;
  depositAddress: string;
  targetZecAddress: string;
  estimatedMinutes: number;
  status: "WAITING_DEPOSIT" | "DETECTED" | "CONVERTING" | "SETTLED" | "EXPIRED";
  settlementZecTxid?: string;
  depositTxHash?: string;
  createdAt: number;
  expiresAt: number;
}
