import crypto from "crypto";

const BASE_URL =
  process.env.BINANCE_BASE_URL ?? "https://api.binance.com";

const API_KEY = process.env.BINANCE_API_KEY ?? "";
const API_SECRET = process.env.BINANCE_API_SECRET ?? "";

/** Build a signed query string for authenticated endpoints */
function sign(params: Record<string, string | number>): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const signature = crypto
    .createHmac("sha256", API_SECRET)
    .update(query)
    .digest("hex");
  return `${query}&signature=${signature}`;
}

/** Generic fetch wrapper with Binance API key header */
async function binanceFetch(
  path: string,
  params: Record<string, string | number> = {},
  signed = false
): Promise<unknown> {
  const query = signed
    ? sign({ ...params, timestamp: Date.now() })
    : new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString();

  const url = `${BASE_URL}${path}${query ? `?${query}` : ""}`;

  const res = await fetch(url, {
    headers: {
      "X-MBX-APIKEY": API_KEY,
    },
    next: { revalidate: 0 }, // always fresh
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
}

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

// ─── Public endpoints ─────────────────────────────────────────────────────────

/**
 * Fetch OHLCV (kline) data for a symbol.
 * Docs: GET /api/v3/klines
 */
export async function getKlines(
  symbol: string,
  interval: string,
  limit = 200,
  startTime?: number,
  endTime?: number
): Promise<Kline[]> {
  const params: Record<string, string | number> = { symbol, interval, limit };
  if (startTime) params.startTime = startTime;
  if (endTime)   params.endTime   = endTime;

  const raw = (await binanceFetch("/api/v3/klines", params)) as Array<unknown[]>;

  return raw.map((k) => ({
    openTime: k[0] as number,
    open: k[1] as string,
    high: k[2] as string,
    low: k[3] as string,
    close: k[4] as string,
    volume: k[5] as string,
    closeTime: k[6] as number,
    quoteVolume: k[7] as string,
    trades: k[8] as number,
  }));
}

/**
 * Fetch all trading symbols (SPOT, TRADING status).
 * Docs: GET /api/v3/exchangeInfo
 */
export async function getSymbols(): Promise<SymbolInfo[]> {
  const data = (await binanceFetch("/api/v3/exchangeInfo")) as {
    symbols: Array<{
      symbol: string;
      baseAsset: string;
      quoteAsset: string;
      status: string;
    }>;
  };

  return data.symbols
    .filter((s) => s.status === "TRADING")
    .map(({ symbol, baseAsset, quoteAsset, status }) => ({
      symbol,
      baseAsset,
      quoteAsset,
      status,
    }));
}

export interface Ticker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  count: number;
}

/**
 * Fetch top N pairs by 24h quote volume.
 * Docs: GET /api/v3/ticker/24hr
 */
export async function getTopPairs(
  quoteAsset = "USDT",
  topN = 50
): Promise<Ticker24hr[]> {
  const data = (await binanceFetch("/api/v3/ticker/24hr")) as Array<{
    symbol: string;
    priceChange: string;
    priceChangePercent: string;
    lastPrice: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
    quoteVolume: string;
    count: number;
  }>;

  return data
    .filter((t) => t.symbol.endsWith(quoteAsset))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, topN);
}

/**
 * Fetch current prices for all symbols (or one).
 * Docs: GET /api/v3/ticker/price
 */
export async function getTicker(
  symbol?: string
): Promise<{ symbol: string; price: string }[]> {
  const params: Record<string, string | number> = symbol ? { symbol } : {};
  const data = await binanceFetch("/api/v3/ticker/price", params);
  return Array.isArray(data) ? data : [data as { symbol: string; price: string }];
}
