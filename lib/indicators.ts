/**
 * Client-side indicator computation engine.
 * All functions are pure (no side-effects) and operate on arrays of numbers.
 *
 * Exported:
 *   computeIndicators(klines, funding?, oi?) → EnrichedBar[]
 */

import type { Kline, FundingRate, OIRecord, EnrichedBar } from "./types";

// ─── Primitive helpers ────────────────────────────────────────────────────────

/** Exponential Moving Average — seeds with SMA of first `period` values */
function ema(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length < period) return result;

  const k = 2 / (period + 1);
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = prev;

  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

/** Simple Moving Average */
function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result[i] = sum / period;
  }
  return result;
}

/** Population standard deviation over a rolling window */
function rollingStdDev(values: number[], period: number, means: (number | null)[]): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = means[i];
    if (m === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - m) ** 2;
    result[i] = Math.sqrt(variance / period);
  }
  return result;
}

/** Wilder's RSI (14-period default) */
function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const d    = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  }
  return result;
}

/** Wilder's ATR (RMA smoothing) */
function atr(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(highs.length).fill(null);
  if (highs.length <= period) return result;

  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1])
    ));
  }

  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period] = prev;
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    result[i + 1] = prev;
  }
  return result;
}

// ─── Lookup helpers for funding & OI ─────────────────────────────────────────

/** Find most recent funding rate at or before `ts` */
function lookupFunding(rates: FundingRate[], ts: number): number | null {
  let result: number | null = null;
  for (const r of rates) {
    if (r.fundingTime <= ts) result = parseFloat(r.fundingRate);
    else break;
  }
  return result;
}

/** Find most recent OI record at or before `ts`, and the one before it */
function lookupOIWithPrev(records: OIRecord[], ts: number): { cur: OIRecord | null; prev: OIRecord | null } {
  let cur:  OIRecord | null = null;
  let prev: OIRecord | null = null;
  for (const r of records) {
    if (r.timestamp <= ts) { prev = cur; cur = r; }
    else break;
  }
  return { cur, prev };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute all indicators and forward-return labels for a sorted kline array.
 *
 * @param klines   Must be sorted ascending by openTime (earliest first)
 * @param funding  Optional funding rate history (sorted ascending by fundingTime)
 * @param oi       Optional OI history (sorted ascending by timestamp)
 * @param fwdAtrMultiplier  ATR multiple used to label a move as "significant"
 */
export function computeIndicators(
  klines: Kline[],
  funding: FundingRate[] = [],
  oi: OIRecord[] = [],
  fwdAtrMultiplier = 1.0
): EnrichedBar[] {
  const n = klines.length;
  if (n === 0) return [];

  // Parse raw strings once
  const opens  = klines.map((k) => parseFloat(k.open));
  const highs  = klines.map((k) => parseFloat(k.high));
  const lows   = klines.map((k) => parseFloat(k.low));
  const closes = klines.map((k) => parseFloat(k.close));
  const vols   = klines.map((k) => parseFloat(k.volume));
  const tbvs   = klines.map((k) => parseFloat(k.takerBuyVolume || "0"));

  // Compute indicators
  const ema9Arr   = ema(closes, 9);
  const ema20Arr  = ema(closes, 20);
  const ema50Arr  = ema(closes, 50);
  const ema200Arr = ema(closes, 200);
  const rsi14Arr  = rsi(closes, 14);
  const atr14Arr  = atr(highs, lows, closes, 14);

  // Bollinger Bands (20, 2)
  const bbMidArr = sma(closes, 20);
  const bbStdArr = rollingStdDev(closes, 20, bbMidArr);

  // Volume SMA(20)
  const volSma20 = sma(vols, 20);

  // CVD (cumulative volume delta)
  const cvdArr: number[] = new Array(n).fill(0);
  let runningCvd = 0;
  for (let i = 0; i < n; i++) {
    const sellVol = vols[i] - tbvs[i];
    runningCvd += tbvs[i] - sellVol;
    cvdArr[i] = runningCvd;
  }

  // Sort funding + OI ascending for lookup
  const sortedFunding = [...funding].sort((a, b) => a.fundingTime - b.fundingTime);
  const sortedOI      = [...oi].sort((a, b) => a.timestamp - b.timestamp);

  const bars: EnrichedBar[] = [];

  for (let i = 0; i < n; i++) {
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
    const v = vols[i];
    const tbv  = tbvs[i];
    const tsell = Math.max(0, v - tbv);
    const range = h - l;

    // Bar structure
    const bodyRatio  = range > 0 ? (c - o) / range : 0;
    const upperWick  = range > 0 ? (h - Math.max(o, c)) / range : 0;
    const lowerWick  = range > 0 ? (Math.min(o, c) - l) / range : 0;

    // Distances in ATR units
    const atrVal = atr14Arr[i];
    const distEma20Atr = (atrVal && ema20Arr[i] !== null)
      ? (c - ema20Arr[i]!) / atrVal
      : null;
    const distEma50Atr = (atrVal && ema50Arr[i] !== null)
      ? (c - ema50Arr[i]!) / atrVal
      : null;

    // Bollinger Band width
    let bbWidth: number | null = null;
    const bbMid = bbMidArr[i], bbStd = bbStdArr[i];
    if (bbMid !== null && bbStd !== null && bbMid > 0) {
      bbWidth = (4 * bbStd) / bbMid; // (upper - lower) / mid = 4σ / mid
    }

    // Volume ratio
    const vs20  = volSma20[i];
    const volRatio = vs20 !== null && vs20 > 0 ? v / vs20 : null;

    // CVD metrics
    const cvdDelta = i === 0 ? 0 : cvdArr[i] - cvdArr[i - 1];
    const cvdRatio = vs20 !== null && vs20 > 0 ? cvdDelta / vs20 : null;

    // Funding rate lookup
    const ts = klines[i].openTime;
    const fundingRate = sortedFunding.length > 0 ? lookupFunding(sortedFunding, ts) : null;

    // OI lookup
    let oiValue:     number | null = null;
    let oiChangePct: number | null = null;
    if (sortedOI.length > 0) {
      const { cur, prev } = lookupOIWithPrev(sortedOI, ts);
      if (cur) {
        oiValue = parseFloat(cur.sumOpenInterestValue);
        if (prev) {
          const prevVal = parseFloat(prev.sumOpenInterestValue);
          oiChangePct = prevVal > 0 ? ((oiValue - prevVal) / prevVal) * 100 : null;
        }
      }
    }

    bars.push({
      symbol:  klines[i].openTime.toString(), // placeholder, overwritten below
      openTime: ts,
      open: o, high: h, low: l, close: c, volume: v,
      takerBuyVolume:  tbv,
      takerSellVolume: tsell,
      takerBuyRatio:   v > 0 ? tbv / v : 0.5,
      ema9:   ema9Arr[i],
      ema20:  ema20Arr[i],
      ema50:  ema50Arr[i],
      ema200: ema200Arr[i],
      rsi14:  rsi14Arr[i],
      atr14:  atrVal,
      atrPct: atrVal && c > 0 ? (atrVal / c) * 100 : null,
      bbWidth,
      volRatio,
      bodyRatio,
      upperWick,
      lowerWick,
      distEma20Atr,
      distEma50Atr,
      cvd:      cvdArr[i],
      cvdDelta,
      cvdRatio,
      fundingRate,
      oiValue,
      oiChangePct,
      // forward returns — filled in a second pass below
      fwd1: null, fwd3: null, fwd5: null, fwd10: null, fwd20: null,
      fwd1Label: null, fwd3Label: null, fwd5Label: null, fwd10Label: null, fwd20Label: null,
    });
  }

  // Second pass: forward returns + labels
  const horizons: [number, keyof EnrichedBar, keyof EnrichedBar][] = [
    [1,  "fwd1",  "fwd1Label"],
    [3,  "fwd3",  "fwd3Label"],
    [5,  "fwd5",  "fwd5Label"],
    [10, "fwd10", "fwd10Label"],
    [20, "fwd20", "fwd20Label"],
  ];

  for (let i = 0; i < n; i++) {
    const atrVal = bars[i].atr14;
    const c0     = bars[i].close;
    for (const [h, fwdKey, labelKey] of horizons) {
      const futIdx = i + h;
      if (futIdx >= n) continue;
      const cf  = bars[futIdx].close;
      const pct = ((cf - c0) / c0) * 100;
      (bars[i] as Record<string, unknown>)[fwdKey as string] = pct;

      if (atrVal && c0 > 0) {
        const atrPctVal = (atrVal / c0) * 100;
        const threshold = fwdAtrMultiplier * atrPctVal;
        (bars[i] as Record<string, unknown>)[labelKey as string] =
          pct >=  threshold ? "up"   :
          pct <= -threshold ? "down" : "neutral";
      }
    }
  }

  return bars;
}

/**
 * Attach symbol name to all bars in the array (mutates and returns the array).
 * Call this after computeIndicators() when you have the symbol string.
 */
export function tagSymbol(bars: EnrichedBar[], symbol: string): EnrichedBar[] {
  for (const b of bars) b.symbol = symbol;
  return bars;
}
