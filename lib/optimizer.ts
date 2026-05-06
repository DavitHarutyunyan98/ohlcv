/**
 * Strategy Optimization Engine
 *
 * Three-phase grid search:
 *   Phase 1 — Feature Scan:    Each feature × [Q1,Q5] with default exit params.
 *                               Identifies which features and directions have predictive power.
 *   Phase 2 — Parameter Grid:  Top N features combined (all non-empty subsets)
 *                               × full TP/SL/maxHold grid.
 *   Phase 3 — Per-pair:        Top 5 strategies run on each symbol individually.
 *
 * Speed trick: quintile bucket table is precomputed once (O(n) lookup per bar),
 * so condition-checking inside the inner loop is just an array read.
 */

import type { EnrichedBar } from "./types";
import { FEATURES } from "./analysis";
import type { Condition } from "./backtest";

// ─── Public types ─────────────────────────────────────────────────────────────

export type OptimMetric =
  | "profitFactor"
  | "expectancy"
  | "winRate"
  | "sharpe"
  | "totalReturn";

export interface OptimConfig {
  metric:        OptimMetric;
  side:          "long" | "short" | "both";
  minTrades:     number;
  tpValues:      number[];
  slValues:      number[];
  maxHoldValues: number[];
  cooldown:      number;
  topFeatures:   number; // top N features to combine (max 4)
}

export interface OptimCandidate {
  id:           string;
  label:        string;
  conditions:   Condition[];
  tpAtr:        number;
  slAtr:        number;
  maxHold:      number;
  side:         string;
  score:        number;
  trades:       number;
  winRate:      number;
  profitFactor: number;
  expectancy:   number;
  sharpe:       number;
  maxDD:        number;
  totalReturn:  number;
}

export interface PhaseInfo {
  name:   string;
  desc:   string;
  total:  number;
  done:   number;
  status: "waiting" | "running" | "done";
}

export interface OptimProgress {
  phases:      PhaseInfo[];
  currentTest: string;
  topResults:  OptimCandidate[];
  done:        boolean;
  totalDone:   number;
  totalItems:  number;
}

export interface OptimResult {
  candidates:  OptimCandidate[];
  perPair:     Record<string, OptimCandidate[]>;
  symbols:     string[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function quintileBounds(vals: number[]): [number, number, number, number] {
  if (vals.length < 5) return [-Infinity, -Infinity, Infinity, Infinity];
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  return [s[Math.floor(n * 0.2)], s[Math.floor(n * 0.4)], s[Math.floor(n * 0.6)], s[Math.floor(n * 0.8)]];
}

function getQ(v: number, b: [number, number, number, number]): 1 | 2 | 3 | 4 | 5 {
  if (v < b[0]) return 1; if (v < b[1]) return 2;
  if (v < b[2]) return 3; if (v < b[3]) return 4; return 5;
}

/** Precompute bucket (1-5) for every bar × feature. 0 = null/invalid. */
function buildBucketTable(bars: EnrichedBar[]): Map<string, Uint8Array> {
  const table = new Map<string, Uint8Array>();
  for (const { key } of FEATURES) {
    const vals = bars.map((b) => (b as unknown as Record<string, unknown>)[key as string] as number | null | undefined);
    const nonNull = vals.filter((v): v is number => v !== null && v !== undefined && isFinite(v));
    const bounds  = quintileBounds(nonNull);
    const arr     = new Uint8Array(bars.length);
    for (let i = 0; i < bars.length; i++) {
      const v = vals[i];
      arr[i]  = v !== null && v !== undefined && isFinite(v) ? getQ(v, bounds) : 0;
    }
    table.set(key as string, arr);
  }
  return table;
}

/** All non-empty subsets of arr (length 1 to maxLen) */
function subsets<T>(arr: T[], maxLen: number): T[][] {
  const result: T[][] = [];
  const n = arr.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const sub: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sub.push(arr[i]);
    if (sub.length <= maxLen) result.push(sub);
  }
  return result;
}

function scoreOf(c: OptimCandidate, metric: OptimMetric): number {
  switch (metric) {
    case "profitFactor": return isFinite(c.profitFactor) ? c.profitFactor : 0;
    case "expectancy":   return c.expectancy;
    case "winRate":      return c.winRate;
    case "sharpe":       return c.sharpe;
    case "totalReturn":  return c.totalReturn;
  }
}

function condLabel(conds: Condition[]): string {
  return conds.map((c) => {
    const feat = FEATURES.find((f) => f.key === c.feature)?.label ?? c.feature;
    return `${feat} [${c.buckets.map((b) => `Q${b}`).join("/")}]`;
  }).join(" + ");
}

// ─── Fast intrabar backtest ───────────────────────────────────────────────────

interface FastStats {
  trades: number; wins: number; losses: number;
  grossProfit: number; grossLoss: number;
  returns: number[]; maxDD: number;
}

function fastBacktest(
  bars:        EnrichedBar[],
  bucketTable: Map<string, Uint8Array>,
  conditions:  Condition[],
  side:        "long" | "short" | "both",
  tpAtr:       number,
  slAtr:       number,
  maxHold:     number,
  cooldown:    number
): FastStats {
  const n = bars.length;
  const sides: ("long" | "short")[] = side === "both" ? ["long", "short"] : [side];
  const stats: FastStats = { trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, returns: [], maxDD: 0 };
  const lastEntry = new Map<string, number>();

  for (let i = 0; i < n - maxHold; i++) {
    const bar = bars[i];
    const last = lastEntry.get(bar.symbol) ?? -Infinity;
    if (i - last < cooldown) continue;

    // Check conditions using pre-computed bucket table
    let allMet = true;
    for (const cond of conditions) {
      const arr = bucketTable.get(cond.feature);
      if (!arr) { allMet = false; break; }
      const q = arr[i];
      if (q === 0 || !cond.buckets.includes(q as 1 | 2 | 3 | 4 | 5)) { allMet = false; break; }
    }
    if (!allMet) continue;

    const atr = bar.atr14 ?? bar.close * 0.01;
    lastEntry.set(bar.symbol, i);

    for (const s of sides) {
      const entry = bar.close;
      const tp    = s === "long" ? entry + atr * tpAtr : entry - atr * tpAtr;
      const sl    = s === "long" ? entry - atr * slAtr : entry + atr * slAtr;
      let pnl     = 0;

      for (let j = i + 1; j <= i + maxHold && j < n; j++) {
        const { high, low, close } = bars[j];
        const tpHit = s === "long" ? high >= tp : low  <= tp;
        const slHit = s === "long" ? low  <= sl : high >= sl;

        if ((tpHit && slHit) || slHit) {
          pnl = s === "long" ? ((sl - entry) / entry) * 100 : ((entry - sl) / entry) * 100;
          break;
        }
        if (tpHit) {
          pnl = s === "long" ? ((tp - entry) / entry) * 100 : ((entry - tp) / entry) * 100;
          break;
        }
        if (j === i + maxHold) {
          pnl = s === "long" ? ((close - entry) / entry) * 100 : ((entry - close) / entry) * 100;
        }
      }

      stats.trades++;
      stats.returns.push(pnl);
      if (pnl > 0) { stats.wins++; stats.grossProfit += pnl; }
      else         { stats.losses++; stats.grossLoss  += Math.abs(pnl); }
    }
  }

  // Max drawdown
  let peak = 0, equity = 0;
  for (const r of stats.returns) {
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > stats.maxDD) stats.maxDD = dd;
  }

  return stats;
}

function makeCandidate(
  id: string, label: string,
  conditions: Condition[], tpAtr: number, slAtr: number, maxHold: number, side: string,
  fs: FastStats, metric: OptimMetric
): OptimCandidate {
  const winRate      = fs.trades > 0 ? fs.wins / fs.trades : 0;
  const profitFactor = fs.grossLoss > 0 ? fs.grossProfit / fs.grossLoss : fs.grossProfit > 0 ? 99 : 0;
  const totalReturn  = fs.returns.reduce((a, b) => a + b, 0);
  const expectancy   = fs.trades > 0 ? totalReturn / fs.trades : 0;
  const mean         = expectancy;
  const variance     = fs.returns.length > 1
    ? fs.returns.reduce((a, b) => a + (b - mean) ** 2, 0) / fs.returns.length : 0;
  const sharpe       = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(Math.max(1, fs.trades)) : 0;

  const c: OptimCandidate = {
    id, label, conditions, tpAtr, slAtr, maxHold, side,
    trades: fs.trades, winRate, profitFactor,
    expectancy: Math.round(expectancy * 10000) / 10000,
    sharpe:     Math.round(sharpe    * 100)   / 100,
    maxDD:      Math.round(fs.maxDD  * 100)   / 100,
    totalReturn:Math.round(totalReturn * 100) / 100,
    score: 0,
  };
  c.score = Math.round(scoreOf(c, metric) * 1000) / 1000;
  return c;
}

// ─── Main export ──────────────────────────────────────────────────────────────

const YIELD_EVERY = 15; // yield to UI every N backtests

export async function runOptimization(
  bars:      EnrichedBar[],
  config:    OptimConfig,
  onProgress: (p: OptimProgress) => void,
  cancelRef: { cancelled: boolean }
): Promise<OptimResult> {
  const { metric, side, minTrades, tpValues, slValues, maxHoldValues, cooldown, topFeatures } = config;

  // Precompute bucket table ONCE for all backtests
  const bucketTable = buildBucketTable(bars);

  // Unique symbols
  const symbolSet = new Set(bars.map((b) => b.symbol));
  const symbols   = [...symbolSet];
  const symbolBars = new Map<string, EnrichedBar[]>();
  for (const sym of symbols) symbolBars.set(sym, bars.filter((b) => b.symbol === sym));
  const symBucketTables = new Map<string, Map<string, Uint8Array>>();
  for (const sym of symbols) symBucketTables.set(sym, buildBucketTable(symbolBars.get(sym)!));

  // ── Phase sizes ───────────────────────────────────────────────────────────
  const p1Total   = FEATURES.length * 2; // each feature × [Q1, Q5]
  const numCombos = Math.min(topFeatures, FEATURES.length);
  // We'll know exact p2 count after phase 1; estimate conservatively
  const p2Est     = (Math.pow(2, numCombos) - 1) * tpValues.length * slValues.length * maxHoldValues.length;
  const p3Est     = 5 * symbols.length;

  const phases: PhaseInfo[] = [
    { name: "Phase 1", desc: "Feature Scan — which features & buckets have edge", total: p1Total,  done: 0, status: "running" },
    { name: "Phase 2", desc: "Parameter Grid — best condition combos × TP/SL/Hold", total: p2Est,   done: 0, status: "waiting" },
    { name: "Phase 3", desc: "Per-pair — top strategies on each symbol separately",  total: p3Est,   done: 0, status: "waiting" },
  ];

  let totalDone  = 0;
  let allResults: OptimCandidate[] = [];
  let batchCount = 0;

  const emit = (current: string) => onProgress({
    phases, currentTest: current, topResults: [...allResults].sort((a, b) => b.score - a.score).slice(0, 10),
    done: false,
    totalDone,
    totalItems: phases.reduce((s, p) => s + p.total, 0),
  });

  const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

  // ══ PHASE 1 — feature scan ════════════════════════════════════════════════
  const phase1Scores: Array<{ feature: string; bucket: 1 | 5; label: string; score: number }> = [];

  for (const feat of FEATURES) {
    for (const bucket of [1, 5] as const) {
      if (cancelRef.cancelled) return { candidates: allResults, perPair: {}, symbols };

      const label = `${feat.label} Q${bucket}`;
      const fs    = fastBacktest(bars, bucketTable, [{ feature: feat.key as string, buckets: [bucket] }],
        side, 1.5, 1.0, 20, cooldown);

      if (fs.trades >= minTrades) {
        const cand = makeCandidate(`p1-${feat.key}-q${bucket}`, label,
          [{ feature: feat.key as string, buckets: [bucket] }], 1.5, 1.0, 20, side, fs, metric);
        allResults.push(cand);
        phase1Scores.push({ feature: feat.key as string, bucket, label, score: cand.score });
      }

      phases[0].done++;
      totalDone++;
      batchCount++;

      if (batchCount % YIELD_EVERY === 0) { emit(label); await yieldToUI(); }
    }
  }
  phases[0].status = "done";
  phases[1].status = "running";
  emit("Phase 1 complete");
  await yieldToUI();

  // ── Pick top features from phase 1 ───────────────────────────────────────
  const topByFeature = new Map<string, { bucket: 1 | 5; score: number }>();
  for (const ps of phase1Scores) {
    const existing = topByFeature.get(ps.feature);
    if (!existing || ps.score > existing.score) topByFeature.set(ps.feature, { bucket: ps.bucket, score: ps.score });
  }
  const sortedFeatures = [...topByFeature.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, numCombos);

  const topConditions: Condition[] = sortedFeatures.map(([feat, { bucket }]) => ({
    feature: feat, buckets: [bucket],
  }));

  // Build condition subsets (all non-empty combinations up to topFeatures)
  const conditionSets = subsets(topConditions, numCombos);

  // ══ PHASE 2 — param grid ══════════════════════════════════════════════════
  const p2Total = conditionSets.length * tpValues.length * slValues.length * maxHoldValues.length;
  phases[1].total = p2Total;

  let p2Idx = 0;
  for (const conds of conditionSets) {
    for (const tp of tpValues) {
      for (const sl of slValues) {
        for (const hold of maxHoldValues) {
          if (cancelRef.cancelled) return { candidates: allResults, perPair: {}, symbols };

          const label = `${condLabel(conds)} | TP:${tp} SL:${sl} Hold:${hold}`;
          const fs    = fastBacktest(bars, bucketTable, conds, side, tp, sl, hold, cooldown);

          if (fs.trades >= minTrades) {
            const id   = `p2-${p2Idx++}`;
            const cand = makeCandidate(id, label, conds, tp, sl, hold, side, fs, metric);
            allResults.push(cand);
          }

          phases[1].done++;
          totalDone++;
          batchCount++;

          if (batchCount % YIELD_EVERY === 0) { emit(label); await yieldToUI(); }
        }
      }
    }
  }
  phases[1].status = "done";
  phases[2].status = "running";
  emit("Phase 2 complete");
  await yieldToUI();

  // ══ PHASE 3 — per-pair breakdown ══════════════════════════════════════════
  const top5 = [...allResults].sort((a, b) => b.score - a.score).slice(0, 5);
  phases[2].total = top5.length * symbols.length;

  const perPair: Record<string, OptimCandidate[]> = {};

  for (const sym of symbols) {
    const symBars  = symbolBars.get(sym)!;
    const symTable = symBucketTables.get(sym)!;
    perPair[sym]   = [];

    for (const strat of top5) {
      if (cancelRef.cancelled) return { candidates: allResults, perPair, symbols };

      const label = `${sym}: ${strat.label}`;
      const fs    = fastBacktest(symBars, symTable, strat.conditions, side,
        strat.tpAtr, strat.slAtr, strat.maxHold, cooldown);

      const cand = makeCandidate(`pp-${sym}-${strat.id}`, label,
        strat.conditions, strat.tpAtr, strat.slAtr, strat.maxHold, sym, fs, metric);
      perPair[sym].push(cand);

      phases[2].done++;
      totalDone++;
      batchCount++;
      if (batchCount % YIELD_EVERY === 0) { emit(label); await yieldToUI(); }
    }
  }
  phases[2].status = "done";

  onProgress({
    phases, currentTest: "Done", done: true,
    topResults: [...allResults].sort((a, b) => b.score - a.score).slice(0, 10),
    totalDone, totalItems: totalDone,
  });

  return {
    candidates: [...allResults].sort((a, b) => b.score - a.score),
    perPair,
    symbols,
  };
}
