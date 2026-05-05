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
  takerBuyVolume: string;      // index 9 — taker buy base asset volume
  takerBuyQuoteVolume: string; // index 10 — taker buy quote asset volume
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
  klines?: Kline[];
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

// ─── Futures-specific data ─────────────────────────────────────────────────────

export interface FundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}

export interface OIRecord {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}

// ─── Enriched bar (OHLCV + indicators + forward returns) ──────────────────────

export interface EnrichedBar {
  // Identity
  symbol: string;
  openTime: number;
  // Raw OHLCV
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Taker flow
  takerBuyVolume: number;
  takerSellVolume: number;
  takerBuyRatio: number;       // takerBuyVolume / volume (0..1)
  // Trend indicators
  ema9:   number | null;
  ema20:  number | null;
  ema50:  number | null;
  ema200: number | null;
  // Momentum
  rsi14:  number | null;       // 0..100
  // Volatility
  atr14:  number | null;
  atrPct: number | null;       // atr14 / close * 100
  bbWidth: number | null;      // (upper - lower) / middle  (Bollinger Bands 20,2)
  // Volume
  volRatio: number | null;     // volume / 20-bar vol SMA
  // Bar structure
  bodyRatio:  number;          // signed: (close-open)/(high-low), range -1..1
  upperWick:  number;          // (high - max(open,close)) / (high-low), 0..1
  lowerWick:  number;          // (min(open,close) - low)  / (high-low), 0..1
  // Distance from EMAs in ATR units
  distEma20Atr: number | null;
  distEma50Atr: number | null;
  // CVD (Cumulative Volume Delta)
  cvd:      number;            // running cumulative (buyVol - sellVol)
  cvdDelta: number;            // 1-bar change in CVD
  cvdRatio: number | null;     // cvd / 20-bar vol SMA (normalised)
  // Futures extras
  fundingRate: number | null;
  oiValue:     number | null;  // open interest in USD
  oiChangePct: number | null;  // % change vs previous OI record
  // Forward returns (% change close-to-close)
  fwd1:  number | null;
  fwd3:  number | null;
  fwd5:  number | null;
  fwd10: number | null;
  fwd20: number | null;
  // Forward labels (ATR-relative threshold)
  fwd1Label:  "up" | "down" | "neutral" | null;
  fwd3Label:  "up" | "down" | "neutral" | null;
  fwd5Label:  "up" | "down" | "neutral" | null;
  fwd10Label: "up" | "down" | "neutral" | null;
  fwd20Label: "up" | "down" | "neutral" | null;
}

// ─── Analysis output ──────────────────────────────────────────────────────────

export type FwdHorizon = 1 | 3 | 5 | 10 | 20;
export const FWD_HORIZONS: FwdHorizon[] = [1, 3, 5, 10, 20];

export interface FreqRow {
  feature:   string;
  featureLabel: string;
  bucket:    1 | 2 | 3 | 4 | 5;
  bucketLabel: string;
  horizon:   FwdHorizon;
  count:     number;
  pctUp:     number;   // 0..100
  pctDown:   number;   // 0..100
  pctNeutral: number;  // 0..100
  liftUp:    number;   // pctUp / baselineUp
  liftDown:  number;   // pctDown / baselineDown
}

export interface CorrRow {
  feature:      string;
  featureLabel: string;
  corr1:  number | null;
  corr3:  number | null;
  corr5:  number | null;
  corr10: number | null;
  corr20: number | null;
}

export interface AnalysisResult {
  freqTable:  FreqRow[];
  corrTable:  CorrRow[];
  baselineUp:   Record<FwdHorizon, number>;   // overall % up for each horizon
  baselineDown: Record<FwdHorizon, number>;
  totalBars:  number;
}
