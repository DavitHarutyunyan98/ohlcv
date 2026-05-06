/**
 * Strategy Optimization Engine — bull/bear search with signal-flip exits.
 *
 * The optimizer always runs in Mode A (signal-flip). It searches separately
 * for bullish and bearish edges, then combines the strongest of each into
 * a single strategy that fires longs on bull combos and shorts on bear combos
 * (or just one side, depending on the user's `side` setting).
 *
 *   Phase 1 — Edge scan:
 *     For each feature × {Q1, Q5}, run two micro-backtests:
 *        • Long-only with that single bullish condition.
 *        • Short-only with that single bearish condition.
 *     Each test uses signal-invalidation as its exit (i.e. exit when the
 *     condition no longer holds). This identifies which buckets carry
 *     directional edge.
 *
 *   Phase 2 — Combo:
 *     Take the top-N bullish features and top-N bearish features, build the
 *     full combined strategy and run it. The user's `side` filter applies.
 *
 *   Phase 3 — Per-pair:
 *     Replay the top 5 strategies on each individual symbol (heat-map).
 *
 *   Phase 4 — Trade capture:
 *     Re-run the top 10 with the full backtester so each candidate carries
 *     a real Trade list for the UI.
 */

import type { EnrichedBar } from "./types";
import { FEATURES } from "./analysis";
import {
  runBacktest,
  type BacktestParams,
  type Condition,
  type Trade,
  type BacktestStats,
} from "./backtest";

// ─── Public types ─────────────────────────────────────────────────────────────

export type OptimMetric =
  | "profitFactor"
  | "expectancy"
  | "winRate"
  | "sharpe"
  | "totalReturn";

export interface OptimConfig {
  metric:      OptimMetric;
  /** Direction filter applied to entries. The optimizer always finds both bull AND bear conditions; this just decides which entries to take. */
  side:        "long" | "short" | "both";
  minTrades:   number;
  topFeatures: number;       // 1..4 features per direction
  cooldown:    number;
  /** Auto-flip on counter signal when side="both"? */
  flipOnSignal: boolean;
  /** Optional date filter (epoch-ms). */
  startTime?:  number;
  endTime?:    number;
}

export interface OptimCandidate {
  id:           string;
  label:        string;
  params:       BacktestParams;
  score:        number;
  trades:       number;
  winRate:      number;
  profitFactor: number;
  expectancy:   number;
  sharpe:       number;
  maxDD:        number;
  totalReturn:  number;
  /** Only populated for the top N after a final full-backtest pass. */
  fullTrades?:  Trade[];
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
  candidates:   OptimCandidate[];
  perPair:      Record<string, OptimCandidate[]>;
  symbols:      string[];
  filteredBars: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreOf(c: { profitFactor: number; expectancy: number; winRate: number; sharpe: number; totalReturn: number }, metric: OptimMetric): number {
  switch (metric) {
    case "profitFactor": return isFinite(c.profitFactor) ? c.profitFactor : 0;
    case "expectancy":   return c.expectancy;
    case "winRate":      return c.winRate;
    case "sharpe":       return c.sharpe;
    case "totalReturn":  return c.totalReturn;
  }
}

function condLabel(conds: Condition[]): string {
  if (conds.length === 0) return "—";
  return conds.map((c) => {
    const feat = FEATURES.find((f) => f.key === c.feature)?.label ?? c.feature;
    return `${feat} [${c.buckets.map((b) => `Q${b}`).join("/")}]`;
  }).join(" + ");
}

function strategyLabel(p: BacktestParams): string {
  const bull = condLabel(p.bullConditions);
  const bear = condLabel(p.bearConditions);
  if (p.side === "long")  return `LONG · ${bull}`;
  if (p.side === "short") return `SHORT · ${bear}`;
  return `BOTH · ↑ ${bull} | ↓ ${bear}`;
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

function makeCandidate(
  id:     string,
  label:  string,
  params: BacktestParams,
  stats:  BacktestStats,
  metric: OptimMetric,
): OptimCandidate {
  const score = scoreOf({
    profitFactor: stats.profitFactor,
    expectancy:   stats.expectancy,
    winRate:      stats.winRate,
    sharpe:       stats.sharpe,
    totalReturn:  stats.totalReturnPct,
  }, metric);

  return {
    id,
    label,
    params,
    score:        Math.round(score * 1000) / 1000,
    trades:       stats.totalTrades,
    winRate:      stats.winRate,
    profitFactor: stats.profitFactor,
    expectancy:   Math.round(stats.expectancy * 10000) / 10000,
    sharpe:       stats.sharpe,
    maxDD:        Math.round(stats.maxDrawdownPct * 100) / 100,
    totalReturn:  Math.round(stats.totalReturnPct  * 100) / 100,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

const YIELD_EVERY = 8;

export async function runOptimization(
  bars:       EnrichedBar[],
  config:     OptimConfig,
  onProgress: (p: OptimProgress) => void,
  cancelRef:  { cancelled: boolean }
): Promise<OptimResult> {
  const { metric, side, minTrades, topFeatures, cooldown, flipOnSignal, startTime, endTime } = config;

  // ── Date filter ───────────────────────────────────────────────────────────
  const filtered = bars.filter((b) => {
    if (startTime !== undefined && b.openTime < startTime) return false;
    if (endTime   !== undefined && b.openTime > endTime)   return false;
    return true;
  });

  if (filtered.length < 50) {
    return { candidates: [], perPair: {}, symbols: [], filteredBars: filtered.length };
  }

  // Symbols
  const symbolSet = new Set(filtered.map((b) => b.symbol));
  const symbols   = [...symbolSet];
  const symbolBars = new Map<string, EnrichedBar[]>();
  for (const sym of symbols) symbolBars.set(sym, filtered.filter((b) => b.symbol === sym));

  const numCombos = Math.min(topFeatures, FEATURES.length);

  const phases: PhaseInfo[] = [
    { name: "Phase 1", desc: "Edge scan — long/short edge for each feature × bucket", total: FEATURES.length * 4, done: 0, status: "running" },
    { name: "Phase 2", desc: "Combo — best bull/bear subsets combined",                total: 0,                  done: 0, status: "waiting" },
    { name: "Phase 3", desc: "Per-pair — replay top strategies on each symbol",        total: 0,                  done: 0, status: "waiting" },
    { name: "Phase 4", desc: "Trade capture — full backtest on top 10",                total: 10,                 done: 0, status: "waiting" },
  ];

  let totalDone  = 0;
  let allResults: OptimCandidate[] = [];
  let batchCount = 0;

  const emit = (current: string) => onProgress({
    phases, currentTest: current,
    topResults: [...allResults].sort((a, b) => b.score - a.score).slice(0, 10),
    done: false,
    totalDone,
    totalItems: phases.reduce((s, p) => s + p.total, 0),
  });

  const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

  // ══ PHASE 1 — feature × bucket edge scan ══════════════════════════════════
  // For each feature × {Q1, Q5}, test as a SINGLE-condition long strategy and
  // as a SINGLE-condition short strategy (with empty opposite, signal-flip
  // mode means signal-invalidation effectively because the only way to fire
  // a counter is the opposite filter — empty here means trades close on
  // open-end. So we use explicit-mode self-invalidation: exit when the same
  // condition no longer holds.)

  const bullScores: Array<{ feature: string; bucket: 1 | 5; score: number }> = [];
  const bearScores: Array<{ feature: string; bucket: 1 | 5; score: number }> = [];

  for (const feat of FEATURES) {
    for (const bucket of [1, 5] as const) {
      if (cancelRef.cancelled) return finalize(allResults, {}, symbols, filtered.length);

      const cond: Condition = { feature: feat.key as string, buckets: [bucket] };

      // Long test: bullCond=that one, exit on signal-invalidation
      const longParams: BacktestParams = {
        bullConditions: [cond],
        bearConditions: [],
        exitMode:       "explicit",
        exitConditions: [
          { feature: feat.key as string, buckets: [1, 2, 3, 4, 5].filter((b) => b !== bucket) as (1 | 2 | 3 | 4 | 5)[] },
        ],
        side:           "long",
        flipOnSignal:   false,
        cooldown,
      };
      const longRes = runBacktest(filtered, longParams);
      if (longRes.stats.totalTrades >= minTrades) {
        const cand = makeCandidate(
          `p1L-${feat.key}-q${bucket}`,
          `${feat.label} Q${bucket} · LONG (single)`,
          longParams,
          longRes.stats,
          metric,
        );
        allResults.push(cand);
        bullScores.push({ feature: feat.key as string, bucket, score: cand.score });
      }
      phases[0].done++;
      totalDone++;
      batchCount++;
      if (batchCount % YIELD_EVERY === 0) { emit(`${feat.label} Q${bucket} long`); await yieldToUI(); }

      // Short test
      const shortParams: BacktestParams = {
        bullConditions: [],
        bearConditions: [cond],
        exitMode:       "explicit",
        exitConditions: [
          { feature: feat.key as string, buckets: [1, 2, 3, 4, 5].filter((b) => b !== bucket) as (1 | 2 | 3 | 4 | 5)[] },
        ],
        side:           "short",
        flipOnSignal:   false,
        cooldown,
      };
      const shortRes = runBacktest(filtered, shortParams);
      if (shortRes.stats.totalTrades >= minTrades) {
        const cand = makeCandidate(
          `p1S-${feat.key}-q${bucket}`,
          `${feat.label} Q${bucket} · SHORT (single)`,
          shortParams,
          shortRes.stats,
          metric,
        );
        allResults.push(cand);
        bearScores.push({ feature: feat.key as string, bucket, score: cand.score });
      }
      phases[0].done++;
      totalDone++;
      batchCount++;
      if (batchCount % YIELD_EVERY === 0) { emit(`${feat.label} Q${bucket} short`); await yieldToUI(); }
    }
  }
  phases[0].status = "done";
  phases[1].status = "running";
  emit("Phase 1 complete");
  await yieldToUI();

  // ── Pick top features ────────────────────────────────────────────────────
  const topByBull = new Map<string, { bucket: 1 | 5; score: number }>();
  for (const ps of bullScores) {
    const ex = topByBull.get(ps.feature);
    if (!ex || ps.score > ex.score) topByBull.set(ps.feature, { bucket: ps.bucket, score: ps.score });
  }
  const topBull: Condition[] = [...topByBull.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, numCombos)
    .map(([feat, { bucket }]) => ({ feature: feat, buckets: [bucket] }));

  const topByBear = new Map<string, { bucket: 1 | 5; score: number }>();
  for (const ps of bearScores) {
    const ex = topByBear.get(ps.feature);
    if (!ex || ps.score > ex.score) topByBear.set(ps.feature, { bucket: ps.bucket, score: ps.score });
  }
  const topBear: Condition[] = [...topByBear.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, numCombos)
    .map(([feat, { bucket }]) => ({ feature: feat, buckets: [bucket] }));

  // ══ PHASE 2 — combo of top bull + top bear ════════════════════════════════
  // Iterate every non-empty subset of bull and (independently) bear,
  // build a combined strategy and run it.
  const bullSubs = topBull.length > 0 ? subsets(topBull, numCombos) : [[]];
  const bearSubs = topBear.length > 0 ? subsets(topBear, numCombos) : [[]];

  // Filter out the (empty,empty) pair that would mean "no signals"
  const combos: Array<{ bull: Condition[]; bear: Condition[] }> = [];
  for (const bull of bullSubs) {
    for (const bear of bearSubs) {
      if (bull.length === 0 && bear.length === 0) continue;
      // Direction-aware:
      if (side === "long"  && bull.length === 0) continue;
      if (side === "short" && bear.length === 0) continue;
      combos.push({ bull, bear });
    }
  }
  phases[1].total = combos.length;

  for (let ci = 0; ci < combos.length; ci++) {
    if (cancelRef.cancelled) return finalize(allResults, {}, symbols, filtered.length);

    const { bull, bear } = combos[ci];
    const params: BacktestParams = {
      bullConditions: bull,
      bearConditions: bear,
      exitMode:       "signal-flip",
      exitConditions: [],
      side,
      flipOnSignal:   side === "both" ? flipOnSignal : false,
      cooldown,
    };
    const r = runBacktest(filtered, params);
    if (r.stats.totalTrades >= minTrades) {
      const cand = makeCandidate(`p2-${ci}`, strategyLabel(params), params, r.stats, metric);
      allResults.push(cand);
    }
    phases[1].done++;
    totalDone++;
    batchCount++;
    if (batchCount % YIELD_EVERY === 0) { emit(strategyLabel(params)); await yieldToUI(); }
  }
  phases[1].status = "done";
  phases[2].status = "running";
  emit("Phase 2 complete");
  await yieldToUI();

  // ══ PHASE 3 — per-pair replay of top 5 ════════════════════════════════════
  const top5 = [...allResults].sort((a, b) => b.score - a.score).slice(0, 5);
  phases[2].total = top5.length * symbols.length;
  const perPair: Record<string, OptimCandidate[]> = {};

  for (const sym of symbols) {
    const symBars = symbolBars.get(sym)!;
    perPair[sym]  = [];
    for (const strat of top5) {
      if (cancelRef.cancelled) return finalize(allResults, perPair, symbols, filtered.length);
      const r = runBacktest(symBars, strat.params);
      const cand = makeCandidate(`pp-${sym}-${strat.id}`, `${sym}: ${strat.label}`, strat.params, r.stats, metric);
      perPair[sym].push(cand);
      phases[2].done++;
      totalDone++;
      batchCount++;
      if (batchCount % YIELD_EVERY === 0) { emit(`${sym} · ${strat.label}`); await yieldToUI(); }
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
    try {
      const r = runBacktest(filtered, cand.params);
      cand.fullTrades = r.trades;
      cand.fullStats  = r.stats;
    } catch { /* ignore */ }
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
    candidates:   sortedAll,
    perPair,
    symbols,
    filteredBars: filtered.length,
  };
}

function finalize(
  candidates:   OptimCandidate[],
  perPair:      Record<string, OptimCandidate[]>,
  symbols:      string[],
  filteredBars: number,
): OptimResult {
  return {
    candidates: [...candidates].sort((a, b) => b.score - a.score),
    perPair,
    symbols,
    filteredBars,
  };
}
