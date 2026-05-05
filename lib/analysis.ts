/**
 * Analysis engine: frequency table + correlation matrix.
 *
 * Given an array of EnrichedBar (with forward-return labels already set),
 * produces:
 *   1. FreqRow[]  — for each feature × quintile bucket × horizon:
 *                   how often the forward move was up/down/neutral,
 *                   and a "lift" ratio vs the baseline rate.
 *   2. CorrRow[]  — Pearson correlation of each feature vs forward return
 *                   at each horizon.
 */

import type {
  EnrichedBar,
  FreqRow,
  CorrRow,
  AnalysisResult,
  FwdHorizon,
} from "./types";
import { FWD_HORIZONS } from "./types";

// ─── Feature definitions ──────────────────────────────────────────────────────

interface FeatureDef {
  key:   keyof EnrichedBar;
  label: string;
}

export const FEATURES: FeatureDef[] = [
  { key: "rsi14",       label: "RSI(14)"          },
  { key: "atrPct",      label: "ATR %"             },
  { key: "bbWidth",     label: "BB Width"          },
  { key: "volRatio",    label: "Volume Ratio"      },
  { key: "takerBuyRatio", label: "Taker Buy %"     },
  { key: "bodyRatio",   label: "Body Ratio"        },
  { key: "lowerWick",   label: "Lower Wick"        },
  { key: "upperWick",   label: "Upper Wick"        },
  { key: "distEma20Atr", label: "Dist EMA20 (ATR)" },
  { key: "distEma50Atr", label: "Dist EMA50 (ATR)" },
  { key: "cvdRatio",    label: "CVD Ratio"         },
  { key: "fundingRate", label: "Funding Rate"      },
  { key: "oiChangePct", label: "OI Change %"       },
];

const BUCKET_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Q1 (Very Low)",
  2: "Q2 (Low)",
  3: "Q3 (Mid)",
  4: "Q4 (High)",
  5: "Q5 (Very High)",
};

// ─── Utility functions ────────────────────────────────────────────────────────

/** Compute quintile boundaries [p20, p40, p60, p80] from a sorted list */
function boundaries(sorted: number[]): [number, number, number, number] {
  const n = sorted.length;
  if (n === 0) return [0, 0, 0, 0];
  return [
    sorted[Math.floor(n * 0.2)],
    sorted[Math.floor(n * 0.4)],
    sorted[Math.floor(n * 0.6)],
    sorted[Math.floor(n * 0.8)],
  ];
}

function getBucket(v: number, b: [number, number, number, number]): 1 | 2 | 3 | 4 | 5 {
  if (v < b[0]) return 1;
  if (v < b[1]) return 2;
  if (v < b[2]) return 3;
  if (v < b[3]) return 4;
  return 5;
}

/** Pearson correlation between two numeric arrays (same length, no nulls) */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;

  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx  += xs[i];
    sy  += ys[i];
    sxx += xs[i] * xs[i];
    syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const mx = sx / n, my = sy / n;
  const num = sxy - n * mx * my;
  const den = Math.sqrt((sxx - n * mx * mx) * (syy - n * my * my));
  if (den === 0) return null;
  return Math.round((num / den) * 10000) / 10000; // 4 decimal places
}

// ─── Forward return accessors ────────────────────────────────────────────────

const FWD_PCT_KEY: Record<FwdHorizon, keyof EnrichedBar> = {
  1: "fwd1", 3: "fwd3", 5: "fwd5", 10: "fwd10", 20: "fwd20",
};
const FWD_LABEL_KEY: Record<FwdHorizon, keyof EnrichedBar> = {
  1: "fwd1Label", 3: "fwd3Label", 5: "fwd5Label", 10: "fwd10Label", 20: "fwd20Label",
};

// ─── Main export ──────────────────────────────────────────────────────────────

export function analyzeEnrichedBars(bars: EnrichedBar[]): AnalysisResult {
  // ── 1. Compute baselines (overall up/down rate per horizon) ────────────────
  const baselineUp:   Record<FwdHorizon, number> = { 1: 0, 3: 0, 5: 0, 10: 0, 20: 0 };
  const baselineDown: Record<FwdHorizon, number> = { 1: 0, 3: 0, 5: 0, 10: 0, 20: 0 };

  for (const h of FWD_HORIZONS) {
    const labelKey = FWD_LABEL_KEY[h];
    const labeled  = bars.filter((b) => b[labelKey] !== null);
    if (labeled.length === 0) continue;
    baselineUp[h]   = (labeled.filter((b) => b[labelKey] === "up").length   / labeled.length) * 100;
    baselineDown[h] = (labeled.filter((b) => b[labelKey] === "down").length / labeled.length) * 100;
  }

  // ── 2. Frequency table ─────────────────────────────────────────────────────
  const freqTable: FreqRow[] = [];

  for (const { key, label } of FEATURES) {
    // Collect non-null feature values and compute quintile boundaries
    const allVals = bars
      .map((b) => b[key] as number | null)
      .filter((v): v is number => v !== null && isFinite(v));

    if (allVals.length < 20) continue; // skip features with too little data

    const sorted = [...allVals].sort((a, b) => a - b);
    const bounds = boundaries(sorted);

    for (const h of FWD_HORIZONS) {
      const labelKey = FWD_LABEL_KEY[h];

      // Count per bucket
      const counts:   Record<1|2|3|4|5, number> = { 1:0,2:0,3:0,4:0,5:0 };
      const upCounts: Record<1|2|3|4|5, number> = { 1:0,2:0,3:0,4:0,5:0 };
      const dnCounts: Record<1|2|3|4|5, number> = { 1:0,2:0,3:0,4:0,5:0 };

      for (const bar of bars) {
        const fVal = bar[key] as number | null;
        const lVal = bar[labelKey];
        if (fVal === null || !isFinite(fVal) || lVal === null) continue;
        const bucket = getBucket(fVal, bounds);
        counts[bucket]++;
        if (lVal === "up")   upCounts[bucket]++;
        if (lVal === "down") dnCounts[bucket]++;
      }

      for (const bucketNum of [1, 2, 3, 4, 5] as const) {
        const cnt = counts[bucketNum];
        if (cnt < 5) continue;
        const pUp   = (upCounts[bucketNum] / cnt) * 100;
        const pDown = (dnCounts[bucketNum] / cnt) * 100;
        const pNeu  = 100 - pUp - pDown;
        const bUp   = baselineUp[h]   || 1;
        const bDown = baselineDown[h] || 1;

        freqTable.push({
          feature:      key as string,
          featureLabel: label,
          bucket:       bucketNum,
          bucketLabel:  BUCKET_LABELS[bucketNum],
          horizon:      h,
          count:        cnt,
          pctUp:        Math.round(pUp   * 100) / 100,
          pctDown:      Math.round(pDown * 100) / 100,
          pctNeutral:   Math.round(pNeu  * 100) / 100,
          liftUp:       Math.round((pUp   / bUp)   * 100) / 100,
          liftDown:     Math.round((pDown / bDown)  * 100) / 100,
        });
      }
    }
  }

  // ── 3. Correlation matrix ─────────────────────────────────────────────────
  const corrTable: CorrRow[] = [];

  for (const { key, label } of FEATURES) {
    const corrByHorizon: Record<FwdHorizon, number | null> = {
      1: null, 3: null, 5: null, 10: null, 20: null,
    };

    for (const h of FWD_HORIZONS) {
      const pctKey = FWD_PCT_KEY[h];
      const pairs: [number, number][] = [];

      for (const bar of bars) {
        const fVal = bar[key]    as number | null;
        const rVal = bar[pctKey] as number | null;
        if (fVal !== null && isFinite(fVal) && rVal !== null && isFinite(rVal)) {
          pairs.push([fVal, rVal]);
        }
      }

      if (pairs.length >= 10) {
        corrByHorizon[h] = pearson(
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1])
        );
      }
    }

    corrTable.push({
      feature:      key as string,
      featureLabel: label,
      corr1:  corrByHorizon[1],
      corr3:  corrByHorizon[3],
      corr5:  corrByHorizon[5],
      corr10: corrByHorizon[10],
      corr20: corrByHorizon[20],
    });
  }

  return {
    freqTable,
    corrTable,
    baselineUp,
    baselineDown,
    totalBars: bars.length,
  };
}
