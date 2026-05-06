/**
 * Backtest engine — signal-driven exits, no TP/SL/maxHold.
 *
 * Model:
 *   Bull conditions match → bullish bar.
 *   Bear conditions match → bearish bar.
 *   Side filter:
 *     - "long":  open longs on bull bars only.
 *     - "short": open shorts on bear bars only.
 *     - "both":  open whichever side fires when no position is open.
 *   Exit mode:
 *     - "signal-flip": opposite-side signal closes the position.
 *                      If side="both" AND flipOnSignal, the same bar opens
 *                      the opposite-side position.
 *     - "explicit":    a separate exitConditions set closes any open position
 *                      regardless of which side it is.
 *   No TP/SL targets, no maxHold. If neither an opposite signal nor an exit
 *   signal ever fires, the position is force-closed at the last bar with
 *   exitReason="open-end".
 *
 * Trade exit price is the close of the bar on which the exit signal fires.
 * (Signals are evaluated at bar close, so this is the earliest tradeable price.)
 *
 * All conditions are AND'd. Buckets within one condition are OR'd.
 */

import type { EnrichedBar } from "./types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Condition {
  feature: string;                 // keyof EnrichedBar
  buckets: (1 | 2 | 3 | 4 | 5)[];  // match if bar's bucket is in this set
}

export type ExitMode = "signal-flip" | "explicit";

export interface BacktestParams {
  bullConditions: Condition[];
  bearConditions: Condition[];
  exitMode:       ExitMode;
  /** Used only when exitMode === "explicit". */
  exitConditions: Condition[];
  side:           "long" | "short" | "both";
  /** Only relevant when side="both" AND exitMode="signal-flip". */
  flipOnSignal:   boolean;
  /** Min bars between an exit and the next entry, per symbol. */
  cooldown:       number;
}

export type ExitReason = "signal" | "explicit" | "open-end";

export interface Trade {
  entryBar:     number;
  symbol:       string;
  entryTime:    number;
  entryPrice:   number;
  exitBar:      number;
  exitTime:     number;
  exitPrice:    number;
  side:         "long" | "short";
  pnlPct:       number;
  atrAtEntry:   number;
  exitReason:   ExitReason;
  durationBars: number;
}

export interface BacktestStats {
  totalTrades:     number;
  wins:            number;
  losses:          number;
  winRate:         number;
  profitFactor:    number;
  avgWinPct:       number;
  avgLossPct:      number;
  expectancy:      number;
  maxDrawdownPct:  number;
  totalReturnPct:  number;
  signalRate:      number;
  avgHoldBars:     number;
  bestTradePct:    number;
  worstTradePct:   number;
  maxConsecLosses: number;
  sharpe:          number;
}

export interface BacktestResult {
  trades:      Trade[];
  equityCurve: { time: number; equity: number }[];
  stats:       BacktestStats;
  signalBars:  number;
  totalBars:   number;
}

// ─── Preset strategies ────────────────────────────────────────────────────────

export interface Preset {
  name:        string;
  description: string;
  params:      BacktestParams;
}

export const PRESETS: Preset[] = [
  {
    name:        "Mean Reversion (Long)",
    description: "Long when RSI / EMA-distance / CVD are all at the lowest quintile; exit when they swing to the highest.",
    params: {
      bullConditions: [
        { feature: "rsi14",        buckets: [1] },
        { feature: "distEma20Atr", buckets: [1] },
        { feature: "cvdRatio",     buckets: [1] },
      ],
      bearConditions: [
        { feature: "rsi14",        buckets: [5] },
        { feature: "distEma20Atr", buckets: [5] },
      ],
      exitMode:       "signal-flip",
      exitConditions: [],
      side:           "long",
      flipOnSignal:   false,
      cooldown:       3,
    },
  },
  {
    name:        "Volatility Breakout (Both)",
    description: "Trade expansions when volume + ATR + BB-width all spike. Position flips on opposing signal.",
    params: {
      bullConditions: [
        { feature: "volRatio",  buckets: [5] },
        { feature: "atrPct",    buckets: [5] },
        { feature: "bodyRatio", buckets: [5] },
      ],
      bearConditions: [
        { feature: "volRatio",  buckets: [5] },
        { feature: "atrPct",    buckets: [5] },
        { feature: "bodyRatio", buckets: [1] },
      ],
      exitMode:       "signal-flip",
      exitConditions: [],
      side:           "both",
      flipOnSignal:   true,
      cooldown:       3,
    },
  },
  {
    name:        "Momentum Long",
    description: "Ride strong taker-buy / RSI / EMA-distance setups; exit on contrarian flow weakening.",
    params: {
      bullConditions: [
        { feature: "takerBuyRatio", buckets: [5] },
        { feature: "rsi14",         buckets: [4, 5] },
        { feature: "distEma20Atr",  buckets: [4, 5] },
      ],
      bearConditions: [
        { feature: "takerBuyRatio", buckets: [1, 2] },
        { feature: "rsi14",         buckets: [1, 2] },
      ],
      exitMode:       "signal-flip",
      exitConditions: [],
      side:           "long",
      flipOnSignal:   false,
      cooldown:       3,
    },
  },
  {
    name:        "Funding-Rate Fade (Short)",
    description: "Fade extreme funding — when longs are paying heavily, the price often retraces. Exit when funding normalises.",
    params: {
      bullConditions: [
        { feature: "fundingRate", buckets: [1] },
        { feature: "rsi14",       buckets: [1, 2] },
      ],
      bearConditions: [
        { feature: "fundingRate", buckets: [5] },
        { feature: "rsi14",       buckets: [4, 5] },
      ],
      exitMode:       "signal-flip",
      exitConditions: [],
      side:           "short",
      flipOnSignal:   false,
      cooldown:       5,
    },
  },
  {
    name:        "Explicit-Exit Demo",
    description: "Same RSI mean-reversion entry, but exit fires on an explicit RSI Q3+ rather than a bear signal — useful when entry & exit logic differ.",
    params: {
      bullConditions: [
        { feature: "rsi14",        buckets: [1] },
        { feature: "distEma20Atr", buckets: [1] },
      ],
      bearConditions: [],
      exitMode:       "explicit",
      exitConditions: [
        { feature: "rsi14", buckets: [3, 4, 5] },
      ],
      side:           "long",
      flipOnSignal:   false,
      cooldown:       3,
    },
  },
];

// ─── Helpers: quintile boundaries ─────────────────────────────────────────────

function quintileBounds(bars: EnrichedBar[], feature: string): [number, number, number, number] {
  const vals = bars
    .map((b) => (b as unknown as Record<string, unknown>)[feature] as number | null | undefined)
    .filter((v): v is number => v !== null && v !== undefined && isFinite(v));
  if (vals.length < 5) return [-Infinity, -Infinity, Infinity, Infinity];
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  return [
    sorted[Math.floor(n * 0.2)],
    sorted[Math.floor(n * 0.4)],
    sorted[Math.floor(n * 0.6)],
    sorted[Math.floor(n * 0.8)],
  ];
}

function getQuintile(v: number, b: [number, number, number, number]): 1 | 2 | 3 | 4 | 5 {
  if (v < b[0]) return 1;
  if (v < b[1]) return 2;
  if (v < b[2]) return 3;
  if (v < b[3]) return 4;
  return 5;
}

function allConditionsMet(
  bar:     EnrichedBar,
  conds:   Condition[],
  bounds:  Map<string, [number, number, number, number]>,
): boolean {
  if (conds.length === 0) return false;
  for (const c of conds) {
    const raw = (bar as unknown as Record<string, unknown>)[c.feature];
    if (raw === null || raw === undefined || !isFinite(raw as number)) return false;
    const q = getQuintile(raw as number, bounds.get(c.feature)!);
    if (!c.buckets.includes(q)) return false;
  }
  return true;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function calcStats(trades: Trade[], signalBars: number, totalBars: number): BacktestStats {
  if (trades.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      profitFactor: 0, avgWinPct: 0, avgLossPct: 0,
      expectancy: 0, maxDrawdownPct: 0, totalReturnPct: 0,
      signalRate: signalBars / Math.max(1, totalBars),
      avgHoldBars: 0, bestTradePct: 0, worstTradePct: 0,
      maxConsecLosses: 0, sharpe: 0,
    };
  }

  const wins   = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));

  let peak = 0, equity = 0, maxDD = 0;
  for (const t of trades) {
    equity += t.pnlPct;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  let curLoss = 0, maxConsec = 0;
  for (const t of trades) {
    if (t.pnlPct <= 0) { curLoss++; maxConsec = Math.max(maxConsec, curLoss); }
    else curLoss = 0;
  }

  const returns = trades.map((t) => t.pnlPct);
  const mean    = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const stdDev  = Math.sqrt(variance);
  const sharpe  = stdDev > 0 ? (mean / stdDev) * Math.sqrt(Math.max(1, trades.length)) : 0;

  return {
    totalTrades:     trades.length,
    wins:            wins.length,
    losses:          losses.length,
    winRate:         wins.length / trades.length,
    profitFactor:    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWinPct:       wins.length   > 0 ? grossProfit / wins.length   :  0,
    avgLossPct:      losses.length > 0 ? -(grossLoss / losses.length) : 0,
    expectancy:      mean,
    maxDrawdownPct:  maxDD,
    totalReturnPct:  equity,
    signalRate:      signalBars / Math.max(1, totalBars),
    avgHoldBars:     trades.reduce((s, t) => s + t.durationBars, 0) / trades.length,
    bestTradePct:    Math.max(...returns),
    worstTradePct:   Math.min(...returns),
    maxConsecLosses: maxConsec,
    sharpe:          Math.round(sharpe * 100) / 100,
  };
}

// ─── Position state during the run ────────────────────────────────────────────

interface OpenPosition {
  side:       "long" | "short";
  entryBar:   number;
  entryTime:  number;
  entryPrice: number;
  atrAtEntry: number;
  symbol:     string;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function runBacktest(
  bars:   EnrichedBar[],
  params: BacktestParams,
): BacktestResult {
  const {
    bullConditions, bearConditions, exitMode, exitConditions,
    side, flipOnSignal, cooldown,
  } = params;

  const n = bars.length;
  if (n === 0 || (bullConditions.length === 0 && bearConditions.length === 0)) {
    return { trades: [], equityCurve: [], stats: calcStats([], 0, 0), signalBars: 0, totalBars: n };
  }

  // Precompute quintile boundaries for all features in any condition set
  const allFeats = new Set<string>();
  for (const c of [...bullConditions, ...bearConditions, ...exitConditions]) allFeats.add(c.feature);
  const bounds = new Map<string, [number, number, number, number]>();
  for (const f of allFeats) bounds.set(f, quintileBounds(bars, f));

  const trades:    Trade[] = [];
  let   signalBars = 0;

  // Per-symbol mutable state
  const open:      Map<string, OpenPosition> = new Map();
  const lastExit:  Map<string, number>       = new Map();

  // Helper to close a position
  const closePos = (
    sym: string,
    barIdx: number,
    reason: ExitReason,
  ): Trade | null => {
    const pos = open.get(sym);
    if (!pos) return null;
    const exitBar  = barIdx;
    const b        = bars[exitBar];
    const exitPrice = b.close;
    const pnlPct = pos.side === "long"
      ? ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100
      : ((pos.entryPrice - exitPrice) / pos.entryPrice) * 100;
    const t: Trade = {
      entryBar:    pos.entryBar,
      symbol:      pos.symbol,
      entryTime:   pos.entryTime,
      entryPrice:  pos.entryPrice,
      exitBar,
      exitTime:    b.openTime,
      exitPrice,
      side:        pos.side,
      pnlPct:      Math.round(pnlPct * 10000) / 10000,
      atrAtEntry:  pos.atrAtEntry,
      exitReason:  reason,
      durationBars: exitBar - pos.entryBar,
    };
    open.delete(sym);
    lastExit.set(sym, exitBar);
    trades.push(t);
    return t;
  };

  // Helper to open a position
  const openPos = (sym: string, barIdx: number, dir: "long" | "short") => {
    const b = bars[barIdx];
    open.set(sym, {
      side:       dir,
      entryBar:   barIdx,
      entryTime:  b.openTime,
      entryPrice: b.close,
      atrAtEntry: b.atr14 ?? b.close * 0.01,
      symbol:     sym,
    });
  };

  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const sym = bar.symbol;

    const bullSig = allConditionsMet(bar, bullConditions, bounds);
    const bearSig = allConditionsMet(bar, bearConditions, bounds);
    const exitSig = exitMode === "explicit" && allConditionsMet(bar, exitConditions, bounds);

    if (bullSig || bearSig) signalBars++;

    const pos = open.get(sym);

    // ── Exit logic ──
    if (pos) {
      if (exitMode === "explicit") {
        if (exitSig) {
          closePos(sym, i, "explicit");
          // Don't re-enter on the same bar
          continue;
        }
      } else {
        // signal-flip
        const counter = pos.side === "long" ? bearSig : bullSig;
        if (counter) {
          closePos(sym, i, "signal");
          // Optional flip when side=both
          if (side === "both" && flipOnSignal) {
            const dir: "long" | "short" = pos.side === "long" ? "short" : "long";
            openPos(sym, i, dir);
          }
          continue;
        }
      }
    }

    // ── Entry logic ──
    if (!open.has(sym)) {
      // Cooldown check
      const last = lastExit.get(sym);
      if (last !== undefined && i - last < cooldown) continue;

      if (side !== "short" && bullSig) {
        openPos(sym, i, "long");
      } else if (side !== "long" && bearSig) {
        openPos(sym, i, "short");
      }
    }
  }

  // Force-close any positions still open at end of data
  // (use the last bar of each symbol)
  if (open.size > 0) {
    // Find last bar index per symbol
    const lastBarIdx = new Map<string, number>();
    for (let i = n - 1; i >= 0; i--) {
      const sym = bars[i].symbol;
      if (!lastBarIdx.has(sym)) lastBarIdx.set(sym, i);
    }
    for (const sym of [...open.keys()]) {
      const idx = lastBarIdx.get(sym);
      if (idx !== undefined) closePos(sym, idx, "open-end");
    }
  }

  // Sort chronologically and rebuild equity curve
  trades.sort((a, b) => a.entryTime - b.entryTime);
  let cum = 0;
  const equityCurve = trades.map((t) => {
    cum += t.pnlPct;
    return { time: t.entryTime, equity: Math.round(cum * 100) / 100 };
  });

  return {
    trades,
    equityCurve,
    stats: calcStats(trades, signalBars, n),
    signalBars,
    totalBars: n,
  };
}

// ─── Migration helper for legacy params (conditions+tpAtr+slAtr+maxHold) ───────

interface LegacyParams {
  conditions: Condition[];
  side:       "long" | "short" | "both";
  tpAtr?:     number;
  slAtr?:     number;
  maxHold?:   number;
  cooldown?:  number;
}

/**
 * Convert legacy single-`conditions` params to the new bull/bear/exit shape.
 * The old `conditions` are interpreted as bullish (long) or bearish (short) based on `side`.
 * Bear-side fallback: empty (user can fill in later).
 * Returns the new params, or the input unchanged if it already looks new.
 */
export function migrateLegacyParams(p: unknown): BacktestParams {
  const obj = p as Record<string, unknown>;
  // Already new shape
  if ("bullConditions" in obj || "bearConditions" in obj || "exitMode" in obj) {
    const cur = p as Partial<BacktestParams>;
    return {
      bullConditions: cur.bullConditions ?? [],
      bearConditions: cur.bearConditions ?? [],
      exitMode:       cur.exitMode       ?? "signal-flip",
      exitConditions: cur.exitConditions ?? [],
      side:           cur.side           ?? "long",
      flipOnSignal:   cur.flipOnSignal   ?? false,
      cooldown:       cur.cooldown       ?? 3,
    };
  }
  // Legacy
  const lg = p as LegacyParams;
  const conds = (lg.conditions ?? []).map((c) => ({ feature: c.feature, buckets: [...c.buckets] }));
  return {
    bullConditions: lg.side === "short" ? [] : conds,
    bearConditions: lg.side === "long"  ? [] : conds,
    exitMode:       "signal-flip",
    exitConditions: [],
    side:           lg.side ?? "long",
    flipOnSignal:   lg.side === "both",
    cooldown:       lg.cooldown ?? 3,
  };
}
