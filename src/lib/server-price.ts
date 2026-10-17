/**
 * Server-Side ZEC Price Oracle Service
 * Multi-provider fallback (CoinGecko -> Binance -> CryptoCompare) with memory caching.
 * Protects server-side financial conversions from client manipulation.
 */

export interface CachedPriceData {
  priceUsd: number;
  change24h: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  updatedAt: number;
  source: string;
}

let priceCache: CachedPriceData | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

async function fetchFromCoinGecko(): Promise<CachedPriceData | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true",
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.zcash?.usd) {
      return {
        priceUsd: Number(data.zcash.usd),
        change24h: Number(data.zcash.usd_24h_change || 0),
        volume24h: Number(data.zcash.usd_24h_vol || 0),
        updatedAt: Date.now(),
        source: "coingecko",
      };
    }
  } catch (err) {
    console.warn("[PriceOracle] CoinGecko fetch failed:", err);
  }
  return null;
}

async function fetchFromBinance(): Promise<CachedPriceData | null> {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=ZECUSDT", {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.lastPrice) {
      return {
        priceUsd: parseFloat(data.lastPrice),
        change24h: parseFloat(data.priceChangePercent || "0"),
        high24h: parseFloat(data.highPrice || "0"),
        low24h: parseFloat(data.lowPrice || "0"),
        volume24h: parseFloat(data.quoteVolume || "0"),
        updatedAt: Date.now(),
        source: "binance",
      };
    }
  } catch (err) {
    console.warn("[PriceOracle] Binance fetch failed:", err);
  }
  return null;
}

async function fetchFromCryptoCompare(): Promise<CachedPriceData | null> {
  try {
    const res = await fetch(
      "https://min-api.cryptocompare.com/data/pricemultifull?fsyms=ZEC&tsyms=USD",
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.RAW?.ZEC?.USD;
    if (raw?.PRICE) {
      return {
        priceUsd: Number(raw.PRICE),
        change24h: Number(raw.CHANGEPCT24HOUR || 0),
        high24h: Number(raw.HIGH24HOUR || 0),
        low24h: Number(raw.LOW24HOUR || 0),
        volume24h: Number(raw.VOLUME24HOURTO || 0),
        updatedAt: Date.now(),
        source: "cryptocompare",
      };
    }
  } catch (err) {
    console.warn("[PriceOracle] CryptoCompare fetch failed:", err);
  }
  return null;
}

export async function getServerZecPrice(): Promise<CachedPriceData> {
  const now = Date.now();

  // Return cached price if still fresh
  if (priceCache && now - priceCache.updatedAt < CACHE_TTL_MS) {
    return priceCache;
  }

  // Try providers in priority order
  let result = await fetchFromCoinGecko();
  if (!result) result = await fetchFromBinance();
  if (!result) result = await fetchFromCryptoCompare();

  if (result) {
    priceCache = result;
    return priceCache;
  }

  // Fallback to previous cache if available
  if (priceCache) {
    return priceCache;
  }

  // Conservative fallback baseline only if completely offline
  return {
    priceUsd: 38.5,
    change24h: 0,
    updatedAt: now,
    source: "fallback",
  };
}

export async function getLiveZecPriceUsd(): Promise<number> {
  const data = await getServerZecPrice();
  return data.priceUsd;
}
