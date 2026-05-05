/**
 * Intrabar backtesting engine.
 *
 * Entry: close of signal bar.
 * Exit priority per subsequent bar:
 *   1. If high >= TP and low <= SL in same bar → assume SL (worst case)
 *   2. If high >= TP (long) / low <= TP (short) → WIN
 *   3. If low <= SL (long) / high >= SL (short) → LOSS
 *   4. After maxHold bars → exit at close (MAXHOLD)
 *
 * All conditions are AND'd. Buckets within one condition are OR'd.
 */

import type { EnrichedBar } from "./types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Condition {
  feature: string;           // keyof EnrichedBar
  buckets: (1 | 2 | 3 | 4 | 5)[]; // match if bar's bucket is in this set
}

export interface BacktestParams {
  conditions: Condition[];
  side:       "long" | "short" | "both";
  tpAtr:      number;  // TP distance = tpAtr × ATR14
  slAtr:      number;  // SL distance = slAtr × ATR14
  maxHold:    number;  // exit at close after this many bars
  cooldown:   number;  // min bars between entries (skip overlapping signals)
}

export interface Trade {
  entryBar:    number;
  symbol:      string;
  entryTime:   number;
  entryPrice:  number;
  exitTime:    number;
  exitPrice:   number;
  side:        "long" | "short";
  pnlPct:      number;        // % return (signed)
  atrAtEntry:  number;
  exitReason:  "tp" | "sl" | "maxhold";
  durationBars: number;
}

export interface BacktestStats {
  totalTrades:       number;
  wins:              number;
  losses:            number;
  winRate:           number;   // 0..1
  profitFactor:      number;
  avgWinPct:         number;
  avgLossPct:        number;   // negative
  expectancy:        number;   // avg pnlPct per trade
  maxDrawdownPct:    number;   // largest peak-to-trough in equity %
  totalReturnPct:    number;   // sum of all pnlPct
  signalRate:        number;   // signalBars / totalBars
  avgHoldBars:       number;
  bestTradePct:      number;
  worstTradePct:     number;
  maxConsecLosses:   number;
  sharpe:            number;   // mean/std of trade returns * sqrt(252)
}

export interface BacktestResult {
  trades:        Trade[];
  equityCurve:   { time: number; equity: number }[];   // one point per trade
  stats:         BacktestStats;
  signalBars:    number;
  totalBars:     number;
}

// ─── Preset strategies (exported for UI) ─────────────────────────────────────

export interface Preset {
  name:        string;
  description: string;
  params:      BacktestParams;
}

export const PRESETS: Preset[] = [
  {
    name:        "Mean Reversion Long",
    description: "Enter when RSI, price vs EMA20, and CVD are all at their lowest — exploits oversold exhaustion",
    params: {
      conditions: [
        { feature: "rsi14",        buckets: [1] },
        { feature: "distEma20Atr", buckets: [1] },
        { feature: "cvdRatio",     buckets: [1] },
      ],
      side:     "long",
      tpAtr:    1.5,
      slAtr:    1.0,
      maxHold:  20,
      cooldown: 5,
    },
  },
  {
    name:        "Volatility Breakout",
    description: "Trade expansions when volume spikes, ATR is high and BBands are wide — momentum in either direction",
    params: {
      conditions: [
        { feature: "volRatio",    buckets: [5] },
        { feature: "atrPct",      buckets: [5] },
        { feature: "bbWidth",     buckets: [4, 5] },
      ],
      side:     "both",
      tpAtr:    2.0,
      slAtr:    1.0,
      maxHold:  10,
      cooldown: 3,
    },
  },
  {
    name:        "Momentum Long",
    description: "Ride overbought high-taker-buy setups — strong buying flow with price above EMAs",
    params: {
      conditions: [
        { feature: "takerBuyRatio", buckets: [5] },
        { feature: "rsi14",         buckets: [4, 5] },
        { feature: "distEma20Atr",  buckets: [4, 5] },
      ],
      side:     "long",
      tpAtr:    1.5,
      slAtr:    1.0,
      maxHold:  10,
      cooldown: 3,
    },
  },
  {
    name:        "Funding Rate Fade",
    description: "Fade extreme funding — when longs are paying heavily (funding Q5), price tends to dip; short it",
    params: {
      conditions: [
        { feature: "fundingRate",  buckets: [5] },
        { feature: "rsi14",        buckets: [4, 5] },
      ],
      side:     "short",
      tpAtr:    1.5,
      slAtr:    1.0,
      maxHold:  20,
      cooldown: 10,
    },
  },
  {
    name:        "OI Squeeze Long",
    description: "When OI drops sharply (short squeeze incoming) with price near EMA support",
    params: {
      conditions: [
        { feature: "oiChangePct",  buckets: [1] },
        { feature: "distEma20Atr", buckets: [1, 2] },
      ],
      side:     "long",
      tpAtr:    2.0,
      slAtr:    1.0,
      maxHold:  15,
      cooldown: 5,
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  // Max drawdown from equity curve
  let peak = 0, equity = 0, maxDD = 0;
  for (const t of trades) {
    equity += t.pnlPct;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Max consecutive losses
  let curLoss = 0, maxConsec = 0;
  for (const t of trades) {
    if (t.pnlPct <= 0) { curLoss++; maxConsec = Math.max(maxConsec, curLoss); }
    else curLoss = 0;
  }

  // Simplified Sharpe: mean return / std dev of returns
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

// ─── Main export ──────────────────────────────────────────────────────────────

export function runBacktest(
  bars: EnrichedBar[],
  params: BacktestParams
): BacktestResult {
  const { conditions, side, tpAtr, slAtr, maxHold, cooldown } = params;
  const n = bars.length;
  if (n === 0 || conditions.length === 0) {
    return { trades: [], equityCurve: [], stats: calcStats([], 0, 0), signalBars: 0, totalBars: n };
  }

  // Precompute quintile boundaries for each feature in conditions
  const bounds = new Map<string, [number, number, number, number]>();
  for (const cond of conditions) {
    if (!bounds.has(cond.feature)) {
      bounds.set(cond.feature, quintileBounds(bars, cond.feature));
    }
  }

  const trades:     Trade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];
  let   equity      = 0;
  let   signalBars  = 0;
  const lastEntry   = new Map<string, number>(); // symbol → last entry bar index

  for (let i = 0; i < n - 1; i++) {
    const bar = bars[i];

    // Cooldown check per symbol
    const lastBar = lastEntry.get(bar.symbol) ?? -Infinity;
    if (i - lastBar < cooldown) continue;

    // Check all conditions (AND logic)
    let allMet = true;
    for (const cond of conditions) {
      const raw = (bar as unknown as Record<string, unknown>)[cond.feature];
      if (raw === null || raw === undefined || !isFinite(raw as number)) {
        allMet = false; break;
      }
      const q = getQuintile(raw as number, bounds.get(cond.feature)!);
      if (!cond.buckets.includes(q)) { allMet = false; break; }
    }
    if (!allMet) continue;

    signalBars++;
    const atr = bar.atr14 ?? bar.close * 0.01; // fallback: 1% of price

    const sides: ("long" | "short")[] =
      side === "both" ? ["long", "short"] : [side];

    for (const s of sides) {
      const entry = bar.close;
      const tp    = s === "long" ? entry + atr * tpAtr : entry - atr * tpAtr;
      const sl    = s === "long" ? entry - atr * slAtr : entry + atr * slAtr;

      let exitBar    = Math.min(i + maxHold, n - 1);
      let exitPrice  = bars[exitBar].close;
      let exitReason: "tp" | "sl" | "maxhold" = "maxhold";

      for (let j = i + 1; j <= Math.min(i + maxHold, n - 1); j++) {
        const { high, low, close } = bars[j];
        const tpHit = s === "long" ? high >= tp : low  <= tp;
        const slHit = s === "long" ? low  <= sl : high >= sl;

        if (tpHit && slHit) {
          // Both in same bar — assume SL hit (conservative)
          exitBar = j; exitPrice = sl; exitReason = "sl"; break;
        }
        if (tpHit) {
          exitBar = j; exitPrice = tp; exitReason = "tp"; break;
        }
        if (slHit) {
          exitBar = j; exitPrice = sl; exitReason = "sl"; break;
        }
        if (j === i + maxHold) {
          exitBar = j; exitPrice = close; exitReason = "maxhold"; break;
        }
      }

      const pnlPct = s === "long"
        ? ((exitPrice - entry) / entry) * 100
        : ((entry - exitPrice) / entry) * 100;

      trades.push({
        entryBar:    i,
        symbol:      bar.symbol,
        entryTime:   bar.openTime,
        entryPrice:  entry,
        exitTime:    bars[exitBar].openTime,
        exitPrice,
        side:        s,
        pnlPct:      Math.round(pnlPct * 10000) / 10000,
        atrAtEntry:  atr,
        exitReason,
        durationBars: exitBar - i,
      });

      equity += pnlPct;
      equityCurve.push({ time: bar.openTime, equity: Math.round(equity * 100) / 100 });
      lastEntry.set(bar.symbol, i);
    }
  }

  // Sort trades chronologically
  trades.sort((a, b) => a.entryTime - b.entryTime);

  // Rebuild equity curve chronologically
  let cum = 0;
  const sortedCurve = trades.map((t) => {
    cum += t.pnlPct;
    return { time: t.entryTime, equity: Math.round(cum * 100) / 100 };
  });

  return {
    trades,
    equityCurve: sortedCurve,
    stats: calcStats(trades, signalBars, n),
    signalBars,
    totalBars: n,
  };
}
