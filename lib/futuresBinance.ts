/**
 * Binance USDT-M Futures API client.
 * Base URL: https://fapi.binance.com
 *
 * Public endpoints used (no signature required):
 *   GET /fapi/v1/klines           — OHLCV candles
 *   GET /fapi/v1/fundingRate      — funding rate history
 *   GET /fapi/data/openInterestHist — aggregated OI history
 */

import type { Kline, FundingRate, OIRecord } from "./types";

const FAPI_BASE = process.env.BINANCE_FAPI_BASE ?? "https://fapi.binance.com";
const API_KEY   = process.env.BINANCE_API_KEY   ?? "";

async function fapiFetch(
  path: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  const url = `${FAPI_BASE}${path}${query ? `?${query}` : ""}`;

  const res = await fetch(url, {
    headers: { "X-MBX-APIKEY": API_KEY },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Futures API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── Klines ───────────────────────────────────────────────────────────────────

export async function getFuturesKlines(
  symbol: string,
  interval: string,
  limit = 500,
  startTime?: number,
  endTime?: number
): Promise<Kline[]> {
  const params: Record<string, string | number> = { symbol, interval, limit };
  if (startTime) params.startTime = startTime;
  if (endTime)   params.endTime   = endTime;

  const raw = (await fapiFetch("/fapi/v1/klines", params)) as Array<unknown[]>;

  return raw.map((k) => ({
    openTime:  k[0] as number,
    open:      k[1] as string,
    high:      k[2] as string,
    low:       k[3] as string,
    close:     k[4] as string,
    volume:    k[5] as string,
    closeTime: k[6] as number,
    quoteVolume: k[7] as string,
    trades:    k[8] as number,
    takerBuyVolume:      k[9]  as string,
    takerBuyQuoteVolume: k[10] as string,
  }));
}

// ─── Funding rates ────────────────────────────────────────────────────────────

export async function getFundingRates(
  symbol: string,
  startTime?: number,
  endTime?: number,
  limit = 1000
): Promise<FundingRate[]> {
  const params: Record<string, string | number> = { symbol, limit };
  if (startTime) params.startTime = startTime;
  if (endTime)   params.endTime   = endTime;

  const raw = (await fapiFetch("/fapi/v1/fundingRate", params)) as Array<{
    symbol: string;
    fundingRate: string;
    fundingTime: number;
  }>;

  return raw.map((r) => ({
    symbol:      r.symbol,
    fundingRate: r.fundingRate,
    fundingTime: r.fundingTime,
  }));
}

// ─── Open Interest history ────────────────────────────────────────────────────

// Binance supports these OI periods only:
const OI_PERIODS = ["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"];

/** Map a kline interval to the nearest available OI aggregation period */
export function toOIPeriod(interval: string): string {
  if (OI_PERIODS.includes(interval)) return interval;
  const intervalMs: Record<string, number> = {
    "1m": 60e3, "3m": 180e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3,
    "1h": 3600e3, "2h": 7200e3, "4h": 14400e3, "6h": 21600e3,
    "8h": 28800e3, "12h": 43200e3, "1d": 86400e3,
    "3d": 259200e3, "1w": 604800e3,
  };
  const targetMs = intervalMs[interval] ?? 3600e3;
  const oiMs = OI_PERIODS.map((p) => ({ p, ms: intervalMs[p] ?? Infinity }));
  // Pick the largest OI period that is <= targetMs, else "5m"
  const best = oiMs.filter((x) => x.ms <= targetMs).pop();
  return best?.p ?? "5m";
}

export async function getOpenInterestHistory(
  symbol: string,
  period: string,
  startTime?: number,
  endTime?: number,
  limit = 500
): Promise<OIRecord[]> {
  const params: Record<string, string | number> = {
    symbol,
    period: toOIPeriod(period),
    limit,
  };
  if (startTime) params.startTime = startTime;
  if (endTime)   params.endTime   = endTime;

  const raw = (await fapiFetch("/fapi/data/openInterestHist", params)) as Array<{
    symbol: string;
    sumOpenInterest: string;
    sumOpenInterestValue: string;
    timestamp: number;
  }>;

  return raw.map((r) => ({
    symbol:               r.symbol,
    sumOpenInterest:      r.sumOpenInterest,
    sumOpenInterestValue: r.sumOpenInterestValue,
    timestamp:            r.timestamp,
  }));
}

// ─── Top futures pairs by volume ──────────────────────────────────────────────

export interface FuturesTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
  count: number;
}

export async function getTopFuturesPairs(
  quoteAsset = "USDT",
  topN = 50
): Promise<FuturesTicker[]> {
  const raw = (await fapiFetch("/fapi/v1/ticker/24hr")) as Array<FuturesTicker>;
  return raw
    .filter((t) => t.symbol.endsWith(quoteAsset))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, topN);
}
