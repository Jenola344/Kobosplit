/**
 * Lightweight cached exchange-rate fetcher with safe static fallbacks.
 * Converts between SATS, NGN, and XOF without blocking page render.
 */

interface RateCache {
  btcToNgn: number;
  btcToXof: number;
  fetchedAt: number;
  /** True when these numbers are the built-in estimates, not the live market rate. */
  isFallback: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Safe static fallback rates (approximate market rates)
const FALLBACK_RATES = {
  btcToNgn: 120_000_000, // ~₦120M per BTC
  btcToXof: 45_000_000, // ~45M XOF per BTC
};

let rateCache: RateCache = {
  ...FALLBACK_RATES,
  fetchedAt: 0,
  isFallback: true,
};

const SATS_PER_BTC = 100_000_000;

async function fetchRates(): Promise<RateCache> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=ngn,xof",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      btcToNgn: data.bitcoin.ngn ?? FALLBACK_RATES.btcToNgn,
      btcToXof: data.bitcoin.xof ?? FALLBACK_RATES.btcToXof,
      fetchedAt: Date.now(),
      isFallback: false,
    };
  } catch {
    // Return fallback silently — never block UI, but never pretend it is live either
    return { ...FALLBACK_RATES, fetchedAt: Date.now(), isFallback: true };
  }
}

async function getCachedRates(): Promise<RateCache> {
  if (Date.now() - rateCache.fetchedAt > CACHE_TTL_MS) {
    rateCache = await fetchRates();
  }
  return rateCache;
}

/**
 * Convert sats to fiat (NGN or XOF).
 */
export async function satsToFiat(
  sats: number,
  currency: "NGN" | "XOF"
): Promise<number> {
  const rates = await getCachedRates();
  const btcAmount = sats / SATS_PER_BTC;
  const rate = currency === "NGN" ? rates.btcToNgn : rates.btcToXof;
  return Math.round(btcAmount * rate * 100) / 100;
}

/**
 * Convert fiat (NGN or XOF) to sats.
 */
export async function fiatToSats(
  amount: number,
  currency: "NGN" | "XOF"
): Promise<number> {
  const rates = await getCachedRates();
  const rate = currency === "NGN" ? rates.btcToNgn : rates.btcToXof;
  const btcAmount = amount / rate;
  return Math.round(btcAmount * SATS_PER_BTC);
}

/**
 * Get current rate info for display, including whether the live rate was
 * actually reachable (so the UI can label fiat amounts as estimates).
 */
export async function getRateInfo(currency: "NGN" | "XOF") {
  const rates = await getCachedRates();
  const rate = currency === "NGN" ? rates.btcToNgn : rates.btcToXof;
  const symbol = currency === "NGN" ? "₦" : "CFA ";
  const oneSatFiat = rate / SATS_PER_BTC;
  return {
    currency,
    symbol,
    oneSatFiat: Math.round(oneSatFiat * 10000) / 10000,
    ratePerBtc: rate,
    isFallback: rates.isFallback,
    fetchedAt: rates.fetchedAt > 0 ? new Date(rates.fetchedAt).toISOString() : null,
  };
}

/**
 * Format sats amount with fiat equivalent.
 */
export async function formatSatsWithFiat(
  sats: number,
  currency: "NGN" | "XOF"
): Promise<string> {
  const fiat = await satsToFiat(sats, currency);
  const symbol = currency === "NGN" ? "₦" : "CFA ";
  return `${sats.toLocaleString()} sats (~${symbol}${fiat.toLocaleString()})`;
}
