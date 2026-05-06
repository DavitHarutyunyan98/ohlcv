/**
 * Strategy Optimization Engine — entry-condition focus.
 *
 * The user explicitly does NOT want TP / SL grid-searched (those are
 * exit-side parameters and tuning them blindly produces overfit nonsense).
 * Instead the optimizer:
 *
 *   Phase 1 — Feature Scan:  each feature × {Q1, Q5} with the user's fixed
 *                            TP / SL / Hold / Cooldown values.
 *   Phase 2 — Combo Search:  every non-empty subset of the top-N features
 *                            (max 4) using the same fixed exits.
 *   Phase 3 — Per-pair scan: top 5 strategies replayed on each symbol
 *                            individually for the heatmap.
 *
 * After scoring is done, the top 10 candidates are re-run through the
 * full `runBacktest` so we have real Trade lists to display / export.
 *
 * Speed trick: quintile bucket table is precomputed once (O(n) lookup per
 * bar), so condition-checking inside the inner loop is just an array read.
 */

import type { EnrichedBar } from "./types";
import { FEATURES } from "./analysis";
import { runBacktest, type BacktestParams, type Condition, type Trade, type BacktestStats } from "./backtest";

// ─── Public types ─────────────────────────────────────────────────────────────

export type OptimMetric =
  | "profitFactor"
  | "expectancy"
  | "winRate"
  | "sharpe"
  | "totalReturn";

/**
 * Optimization config.
 *
 * NOTE: tpAtr / slAtr / maxHold / cooldown are FIXED for the whole run.
 * The optimizer searches only over entry conditions.
 */
export interface OptimConfig {
  metric:      OptimMetric;
  side:        "long" | "short" | "both";
  minTrades:   number;
  topFeatures: number;       // 1..4
  tpAtr:       number;       // fixed exit
  slAtr:       number;       // fixed exit
  maxHold:     number;       // fixed exit
  cooldown:    number;       // fixed entry gating
  /** Optional date-range filter (epoch-ms). Bars outside are dropped before scoring. */
  startTime?:  number;
  endTime?:    number;
}

export interface OptimCandidate {
  id:           string;
  label:        string;
  conditions:   Condition[];
  tpAtr:        number;
  slAtr:        number;
  maxHold:      number;
  cooldown:     number;
  side:         "long" | "short" | "both";
  score:        number;
  trades:       number;
  winRate:      number;
  profitFactor: number;
  expectancy:   number;
  sharpe:       number;
  maxDD:        number;
  totalReturn:  number;
  /** Only populated for the top N after a final full backtest pass. */
  fullTrades?:  Trade[];
  /** Full stats from the final pass (richer than the fast scan stats). */
  fullStats?:   BacktestStats;
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
  /** Number of bars that survived the date filter, for UI display. */
  filteredBars: number;
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

/** All non-empty subsets of arr (length 1..maxLen) */
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

// ─── Fast intrabar backtest (no trade list, just stats) ───────────────────────

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
  conditions: Condition[], tpAtr: number, slAtr: number, maxHold: number, cooldown: number,
  side: "long" | "short" | "both",
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
    id, label, conditions, tpAtr, slAtr, maxHold, cooldown, side,
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
  bars:       EnrichedBar[],
  config:     OptimConfig,
  onProgress: (p: OptimProgress) => void,
  cancelRef:  { cancelled: boolean }
): Promise<OptimResult> {
  const { metric, side, minTrades, topFeatures, tpAtr, slAtr, maxHold, cooldown, startTime, endTime } = config;

  // ── Date-range filter ─────────────────────────────────────────────────────
  const filtered = bars.filter((b) => {
    if (startTime !== undefined && b.openTime < startTime) return false;
    if (endTime   !== undefined && b.openTime > endTime)   return false;
    return true;
  });

  if (filtered.length < 50) {
    return {
      candidates: [],
      perPair: {},
      symbols: [],
      filteredBars: filtered.length,
    };
  }

  // Precompute bucket table ONCE for all backtests
  const bucketTable = buildBucketTable(filtered);

  // Unique symbols
  const symbolSet = new Set(filtered.map((b) => b.symbol));
  const symbols   = [...symbolSet];
  const symbolBars = new Map<string, EnrichedBar[]>();
  for (const sym of symbols) symbolBars.set(sym, filtered.filter((b) => b.symbol === sym));
  const symBucketTables = new Map<string, Map<string, Uint8Array>>();
  for (const sym of symbols) symBucketTables.set(sym, buildBucketTable(symbolBars.get(sym)!));

  // ── Phase sizes ───────────────────────────────────────────────────────────
  const p1Total   = FEATURES.length * 2; // each feature × {Q1, Q5}
  const numCombos = Math.min(topFeatures, FEATURES.length);
  const p2Est     = (Math.pow(2, numCombos) - 1);
  const p3Est     = 5 * symbols.length;
  const p4Est     = 10; // final full backtest on top 10

  const phases: PhaseInfo[] = [
    { name: "Phase 1", desc: "Feature scan — which features & buckets show edge",      total: p1Total, done: 0, status: "running" },
    { name: "Phase 2", desc: "Combo search — best subsets of top features",            total: p2Est,   done: 0, status: "waiting" },
    { name: "Phase 3", desc: "Per-pair — replay top strategies on each symbol",        total: p3Est,   done: 0, status: "waiting" },
    { name: "Phase 4", desc: "Trade capture — full backtest on top 10 for trade log",  total: p4Est,   done: 0, status: "waiting" },
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
      if (cancelRef.cancelled) return finalize(allResults, {}, symbols, filtered.length);

      const label = `${feat.label} Q${bucket}`;
      const fs    = fastBacktest(filtered, bucketTable, [{ feature: feat.key as string, buckets: [bucket] }],
        side, tpAtr, slAtr, maxHold, cooldown);

      if (fs.trades >= minTrades) {
        const cand = makeCandidate(`p1-${feat.key}-q${bucket}`, label,
          [{ feature: feat.key as string, buckets: [bucket] }], tpAtr, slAtr, maxHold, cooldown, side, fs, metric);
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

  // ══ PHASE 2 — combo search (fixed exits) ══════════════════════════════════
  phases[1].total = conditionSets.length;

  let p2Idx = 0;
  for (const conds of conditionSets) {
    if (cancelRef.cancelled) return finalize(allResults, {}, symbols, filtered.length);

    const label = condLabel(conds);
    const fs    = fastBacktest(filtered, bucketTable, conds, side, tpAtr, slAtr, maxHold, cooldown);

    if (fs.trades >= minTrades) {
      const id   = `p2-${p2Idx++}`;
      const cand = makeCandidate(id, label, conds, tpAtr, slAtr, maxHold, cooldown, side, fs, metric);
      allResults.push(cand);
    }

    phases[1].done++;
    totalDone++;
    batchCount++;

    if (batchCount % YIELD_EVERY === 0) { emit(label); await yieldToUI(); }
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
      if (cancelRef.cancelled) return finalize(allResults, perPair, symbols, filtered.length);

      const label = `${sym}: ${strat.label}`;
      const fs    = fastBacktest(symBars, symTable, strat.conditions, side,
        strat.tpAtr, strat.slAtr, strat.maxHold, cooldown);

      const cand = makeCandidate(`pp-${sym}-${strat.id}`, label,
        strat.conditions, strat.tpAtr, strat.slAtr, strat.maxHold, cooldown, side, fs, metric);
      perPair[sym].push(cand);

      phases[2].done++;
      totalDone++;
      batchCount++;
      if (batchCount % YIELD_EVERY === 0) { emit(label); await yieldToUI(); }
    }
  }
  phases[2].status = "done";
  phases[3].status = "running";
  emit("Phase 3 complete");
  await yieldToUI();

  // ══ PHASE 4 — full trade capture on top 10 ════════════════════════════════
  const sortedAll = [...allResults].sort((a, b) => b.score - a.score);
  const top10     = sortedAll.slice(0, 10);
  phases[3].total = top10.length;

  for (const cand of top10) {
    if (cancelRef.cancelled) break;

    const params: BacktestParams = {
      conditions: cand.conditions,
      side:       cand.side,
      tpAtr:      cand.tpAtr,
      slAtr:      cand.slAtr,
      maxHold:    cand.maxHold,
      cooldown:   cand.cooldown,
    };

    try {
      const r = runBacktest(filtered, params);
      cand.fullTrades = r.trades;
      cand.fullStats  = r.stats;
    } catch {
      // ignore — fast scan stats remain
    }

    phases[3].done++;
    totalDone++;
    batchCount++;
    if (batchCount % 3 === 0) { emit(`Capturing trades · ${cand.label}`); await yieldToUI(); }
  }
  phases[3].status = "done";

  onProgress({
    phases, currentTest: "Done", done: true,
    topResults: sortedAll.slice(0, 10),
    totalDone, totalItems: totalDone,
  });

  return {
    candidates:  sortedAll,
    perPair,
    symbols,
    filteredBars: filtered.length,
  };
}

function finalize(
  candidates: OptimCandidate[],
  perPair:    Record<string, OptimCandidate[]>,
  symbols:    string[],
  filteredBars: number,
): OptimResult {
  return {
    candidates: [...candidates].sort((a, b) => b.score - a.score),
    perPair,
    symbols,
    filteredBars,
  };
}
