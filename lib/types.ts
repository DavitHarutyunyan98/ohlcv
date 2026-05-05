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

export interface FilledPair {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

export interface PairResult {
  symbol: string;
  candles: number;
  periodOpen: number;
  periodHigh: number;
  periodLow: number;
  periodClose: number;
  totalVolume: number;
  change: number;
  status: "ok" | "error";
  error?: string;
  klines?: Kline[]; // kept so chart can render this pair without re-fetching
}

export interface DbSession {
  id: string;
  mode: string;
  symbols: string[];
  interval: string;
  start_date: string | null;
  end_date: string | null;
  total_pairs: number;
  total_candles: number;
  created_at: string;
}

// ms per bar — used to estimate total candle count before fetching
export const INTERVAL_MS: Record<string, number> = {
  "1m":  60_000,
  "3m":  3   * 60_000,
  "5m":  5   * 60_000,
  "15m": 15  * 60_000,
  "30m": 30  * 60_000,
  "1h":  60  * 60_000,
  "2h":  2   * 60 * 60_000,
  "4h":  4   * 60 * 60_000,
  "6h":  6   * 60 * 60_000,
  "8h":  8   * 60 * 60_000,
  "12h": 12  * 60 * 60_000,
  "1d":  24  * 60 * 60_000,
  "3d":  3   * 24 * 60 * 60_000,
  "1w":  7   * 24 * 60 * 60_000,
};
