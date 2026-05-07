"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import type { EnrichedBar, Kline } from "@/lib/types";
import { FEATURES } from "@/lib/analysis";
import {
  runBacktest,
  PRESETS,
  type BacktestParams,
  type BacktestResult,
  type Condition,
  type Trade,
  type ExitMode,
} from "@/lib/backtest";
import { downloadXlsx } from "@/lib/downloadXlsx";
import * as Strategies from "@/lib/strategies";
import TradesChart from "./TradesChart";

// ─── Constants ────────────────────────────────────────────────────────────────

const BUCKET_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Q1 Very Low",
  2: "Q2 Low",
  3: "Q3 Mid",
  4: "Q4 High",
  5: "Q5 Very High",
};

const FEATURE_OPTIONS = FEATURES.map((f) => ({ value: f.key as string, label: f.label }));

// ─── Equity Curve SVG ─────────────────────────────────────────────────────────

function EquityCurve({ curve }: { curve: { time: number; equity: number }[] }) {
  if (curve.length < 2) return (
    <div className="h-40 flex items-center justify-center text-binance-muted text-xs">
      Not enough trades for equity curve
    </div>
  );

  const W = 800, H = 160, PAD = { top: 12, right: 12, bottom: 24, left: 52 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top  - PAD.bottom;

  const equities = curve.map((p) => p.equity);
  const minE = Math.min(0, ...equities);
  const maxE = Math.max(0, ...equities);
  const range = maxE - minE || 1;

  const toX = (_: unknown, i: number) => PAD.left + (i / (curve.length - 1)) * iW;
  const toY = (e: number)            => PAD.top  + ((maxE - e) / range) * iH;
  const zeroY = toY(0);

  const pts = curve.map((p, i) => `${toX(null, i)},${toY(p.equity)}`).join(" ");

  let peak = 0;
  const ddPts: string[] = [];
  curve.forEach((p, i) => {
    if (p.equity > peak) peak = p.equity;
    ddPts.push(`${toX(null, i)},${toY(Math.min(p.equity, peak))}`);
  });
  const ddPath = `M ${toX(null, 0)},${toY(Math.max(0, curve[0].equity))} ` +
    ddPts.join(" L ") + ` L ${toX(null, curve.length - 1)},${zeroY} Z`;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => minE + (i / ticks) * range);

  const lastEq = curve[curve.length - 1].equity;
  const isPos  = lastEq >= 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)} stroke="#2d3748" strokeWidth="1" />
          <text x={PAD.left - 4} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#6b7280">
            {v >= 0 ? "+" : ""}{v.toFixed(1)}%
          </text>
        </g>
      ))}
      <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="#4b5563" strokeWidth="1.5" strokeDasharray="4,3" />
      <path d={ddPath} fill="rgba(239,68,68,0.12)" />
      <polyline points={pts} fill="none" stroke={isPos ? "#22c55e" : "#ef4444"} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={toX(null, curve.length - 1)} cy={toY(lastEq)} r="3.5" fill={isPos ? "#22c55e" : "#ef4444"} />
      <text x={toX(null, curve.length - 1) - 5} y={toY(lastEq) - 7} textAnchor="end" fontSize="10" fontWeight="bold" fill={isPos ? "#22c55e" : "#ef4444"}>
        {isPos ? "+" : ""}{lastEq.toFixed(2)}%
      </text>
    </svg>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function Stat({ label, value, color = "text-white", sub }:
  { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 bg-binance-dark border border-binance-border rounded-lg min-w-[80px]">
      <span className="text-[10px] text-binance-muted uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-bold font-mono ${color}`}>{value}</span>
      {sub && <span className="text-[10px] text-binance-muted">{sub}</span>}
    </div>
  );
}

// ─── Reusable condition builder for one of the three sets ─────────────────────

function ConditionEditor({ title, color, conditions, setConditions }: {
  title:         string;
  color:         "green" | "red" | "yellow";
  conditions:    Condition[];
  setConditions: (next: Condition[]) => void;
}) {
  const colorMap = {
    green:  { text: "text-binance-green", chip: "bg-binance-green text-white", border: "border-binance-green/40" },
    red:    { text: "text-binance-red",   chip: "bg-binance-red text-white",   border: "border-binance-red/40" },
    yellow: { text: "text-binance-yellow",chip: "bg-binance-yellow text-binance-dark", border: "border-binance-yellow/40" },
  } as const;
  const c = colorMap[color];

  const addCondition = () => {
    const used = new Set(conditions.map((cond) => cond.feature));
    const next = FEATURE_OPTIONS.find((f) => !used.has(f.value));
    if (next) setConditions([...conditions, { feature: next.value, buckets: [color === "red" ? 5 : 1] }]);
  };

  const removeCondition = (i: number) =>
    setConditions(conditions.filter((_, idx) => idx !== i));

  const updateFeature = (i: number, feature: string) =>
    setConditions(conditions.map((cond, idx) => idx === i ? { ...cond, feature } : cond));

  const toggleBucket = (i: number, b: 1 | 2 | 3 | 4 | 5) =>
    setConditions(conditions.map((cond, idx) => {
      if (idx !== i) return cond;
      const has = cond.buckets.includes(b);
      const next = has ? cond.buckets.filter((x) => x !== b) : [...cond.buckets, b].sort() as typeof cond.buckets;
      return { ...cond, buckets: next.length > 0 ? next : [b] };
    }));

  return (
    <div className={`border ${c.border} bg-binance-dark/60 rounded-lg p-2.5`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold uppercase tracking-wider ${c.text}`}>{title}</span>
        <button
          onClick={addCondition}
          disabled={conditions.length >= FEATURE_OPTIONS.length}
          className="text-[10px] px-2 py-0.5 rounded bg-binance-border text-binance-text hover:bg-binance-yellow hover:text-binance-dark disabled:opacity-40 transition"
        >+ Add</button>
      </div>

      {conditions.length === 0 ? (
        <p className="text-[11px] text-binance-muted italic px-1 py-1.5">No conditions — this signal will never fire.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {conditions.map((cond, i) => (
            <div key={i} className="bg-binance-card border border-binance-border rounded p-2 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <select
                  value={cond.feature}
                  onChange={(e) => updateFeature(i, e.target.value)}
                  className="flex-1 text-[11px] bg-binance-border text-white rounded px-1.5 py-1 outline-none"
                >
                  {FEATURE_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeCondition(i)}
                  className="text-binance-muted hover:text-binance-red text-sm transition"
                  title="Remove"
                >✕</button>
              </div>
              <div className="flex gap-1 flex-wrap">
                {([1, 2, 3, 4, 5] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => toggleBucket(i, b)}
                    title={BUCKET_LABELS[b]}
                    className={`px-1.5 py-0.5 text-[10px] rounded font-semibold transition ${
                      cond.buckets.includes(b) ? c.chip : "bg-binance-border text-binance-muted hover:text-white"
                    }`}
                  >Q{b}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Save modal ───────────────────────────────────────────────────────────────

function SaveStrategyModal({ defaultName, defaultDesc, onClose, onConfirm }: {
  defaultName: string;
  defaultDesc: string;
  onClose:     () => void;
  onConfirm:   (name: string, desc: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [desc, setDesc] = useState(defaultDesc);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-binance-card border border-binance-border rounded-xl p-5 w-[440px] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">💾 Save Strategy</h3>

        <label className="text-[11px] text-binance-muted uppercase tracking-wider">Name</label>
        <input
          value={name} onChange={(e) => setName(e.target.value)} autoFocus
          className="w-full mt-1 mb-3 bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-white outline-none focus:border-binance-yellow"
        />

        <label className="text-[11px] text-binance-muted uppercase tracking-wider">Description</label>
        <textarea
          value={desc} onChange={(e) => setDesc(e.target.value)} rows={4}
          className="w-full mt-1 mb-4 bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-white outline-none focus:border-binance-yellow resize-y"
        />

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition">Cancel</button>
          <button onClick={() => onConfirm(name.trim() || defaultName, desc.trim())} disabled={!name.trim()}
            className="px-4 py-1.5 text-xs font-bold rounded bg-binance-yellow text-binance-dark hover:brightness-110 disabled:opacity-40 transition">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  bars:           EnrichedBar[];
  /** Raw klines for chart drawing — optional but enables Trades-chart tab. */
  klines?:        Kline[];
  /** Map of symbol → klines, for per-pair chart support. */
  symbolKlines?:  Record<string, Kline[]>;
  initialParams?: BacktestParams;
  symbol?:        string;
  interval?:      string;
  onSaved?:       (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StrategyBuilder({ bars, klines = [], symbolKlines = {}, initialParams, symbol = "", interval = "", onSaved }: Props) {
  // ── Conditions (3 sets) ───────────────────────────────────────────────────
  const [bullConditions, setBullConditions] = useState<Condition[]>([
    { feature: "rsi14",        buckets: [1] },
    { feature: "distEma20Atr", buckets: [1] },
  ]);
  const [bearConditions, setBearConditions] = useState<Condition[]>([
    { feature: "rsi14",        buckets: [5] },
    { feature: "distEma20Atr", buckets: [5] },
  ]);
  const [exitConditions, setExitConditions] = useState<Condition[]>([]);

  // ── Mode + side ───────────────────────────────────────────────────────────
  const [exitMode,     setExitMode]     = useState<ExitMode>("signal-flip");
  const [side,         setSide]         = useState<BacktestParams["side"]>("long");
  const [flipOnSignal, setFlipOnSignal] = useState(false);
  const [cooldown,     setCooldown]     = useState(3);

  // ── Apply initialParams when loaded from Optimizer / Strategies ──────────
  useEffect(() => {
    if (!initialParams) return;
    setBullConditions(initialParams.bullConditions);
    setBearConditions(initialParams.bearConditions);
    setExitConditions(initialParams.exitConditions);
    setExitMode(initialParams.exitMode);
    setSide(initialParams.side);
    setFlipOnSignal(initialParams.flipOnSignal);
    setCooldown(initialParams.cooldown);
    setResult(null);
  }, [initialParams]);

  // ── Results ───────────────────────────────────────────────────────────────
  const [result,    setResult]    = useState<BacktestResult | null>(null);
  const [running,   setRunning]   = useState(false);
  const [tradeTab,  setTradeTab]  = useState<"stats" | "log" | "chart">("stats");
  const [tradePage, setTradePage] = useState(1);
  const TRADE_PAGE_SIZE = 50;

  // Save modal & toast
  const [showSave,   setShowSave]   = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // ── Scope: pair-mode + symbol-picker + date range ────────────────────────
  const allSymbols = useMemo(() => {
    const set = new Set(bars.map((b) => b.symbol));
    return [...set];
  }, [bars]);

  const [pairMode,    setPairMode]    = useState<"single" | "all">(allSymbols.length > 1 ? "all" : "single");
  const [chosenSym,   setChosenSym]   = useState<string>("");

  // Default chosen symbol when symbols change
  useEffect(() => {
    if (allSymbols.length === 0) { setChosenSym(""); return; }
    if (!chosenSym || !allSymbols.includes(chosenSym)) setChosenSym(allSymbols[0]);
  }, [allSymbols, chosenSym]);

  // Reset to single mode automatically when only 1 symbol exists
  useEffect(() => {
    if (allSymbols.length <= 1 && pairMode === "all") setPairMode("single");
  }, [allSymbols, pairMode]);

  const dataRange = useMemo(() => {
    if (bars.length === 0) return { min: "", max: "" };
    let lo = bars[0].openTime, hi = bars[0].openTime;
    for (const b of bars) { if (b.openTime < lo) lo = b.openTime; if (b.openTime > hi) hi = b.openTime; }
    return { min: new Date(lo).toISOString().slice(0, 10), max: new Date(hi).toISOString().slice(0, 10) };
  }, [bars]);

  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");

  // Bars actually used by the backtest — apply pair + date filters
  const scopedBars = useMemo(() => {
    const startMs = startDate ? new Date(startDate).getTime() : -Infinity;
    const endMs   = endDate   ? new Date(endDate + "T23:59:59").getTime() : Infinity;
    return bars.filter((b) => {
      if (b.openTime < startMs || b.openTime > endMs) return false;
      if (pairMode === "single" && chosenSym && b.symbol !== chosenSym) return false;
      return true;
    });
  }, [bars, pairMode, chosenSym, startDate, endDate]);

  // ── Load preset ───────────────────────────────────────────────────────────
  const loadPreset = (idx: number) => {
    const p = PRESETS[idx].params;
    setBullConditions(p.bullConditions.map((c) => ({ ...c, buckets: [...c.buckets] })));
    setBearConditions(p.bearConditions.map((c) => ({ ...c, buckets: [...c.buckets] })));
    setExitConditions(p.exitConditions.map((c) => ({ ...c, buckets: [...c.buckets] })));
    setExitMode(p.exitMode);
    setSide(p.side);
    setFlipOnSignal(p.flipOnSignal);
    setCooldown(p.cooldown);
    setResult(null);
  };

  // ── Run backtest ──────────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (scopedBars.length === 0) return;
    setRunning(true);
    setResult(null);
    setTimeout(() => {
      try {
        const r = runBacktest(scopedBars, {
          bullConditions, bearConditions, exitMode, exitConditions,
          side, flipOnSignal, cooldown,
        });
        setResult(r);
        setTradePage(1);
      } finally {
        setRunning(false);
      }
    }, 16);
  }, [scopedBars, bullConditions, bearConditions, exitMode, exitConditions, side, flipOnSignal, cooldown]);

  // ── Save current strategy ─────────────────────────────────────────────────
  const handleSaveStrategy = useCallback((name: string, description: string) => {
    const params: BacktestParams = {
      bullConditions, bearConditions, exitMode, exitConditions,
      side, flipOnSignal, cooldown,
    };
    const s = Strategies.saveNew({
      name,
      description,
      params,
      source:    "builder",
      lastStats: result?.stats ?? null,
      tunedOn:   symbol || undefined,
      interval:  interval || undefined,
    });
    setShowSave(false);
    setSavedToast(`Saved "${s.name}" ✓`);
    setTimeout(() => setSavedToast(null), 2500);
    onSaved?.(s.id);
  }, [bullConditions, bearConditions, exitMode, exitConditions, side, flipOnSignal, cooldown, result, symbol, interval, onSaved]);

  // ── Export trades ─────────────────────────────────────────────────────────
  const handleExport = () => {
    if (!result) return;
    const rows = result.trades.map((t, i) => ({
      "#":            i + 1,
      Symbol:         t.symbol,
      Side:           t.side,
      "Entry Time":   new Date(t.entryTime).toLocaleString(),
      "Entry Price":  t.entryPrice.toFixed(6),
      "Exit Time":    new Date(t.exitTime).toLocaleString(),
      "Exit Price":   t.exitPrice.toFixed(6),
      "P&L %":        t.pnlPct.toFixed(4),
      "Exit Reason":  t.exitReason,
      "Hold (bars)":  t.durationBars,
    }));
    downloadXlsx(rows, "backtest_trades");
  };

  // ── Trades page slice ─────────────────────────────────────────────────────
  const trades     = result?.trades ?? [];
  const totalPages = Math.max(1, Math.ceil(trades.length / TRADE_PAGE_SIZE));
  const tradeSlice = trades.slice((tradePage - 1) * TRADE_PAGE_SIZE, tradePage * TRADE_PAGE_SIZE);
  const s          = result?.stats;

  // For the chart tab — pick a focus symbol
  const symbolsInTrades = useMemo(() => {
    const set = new Set(trades.map((t) => t.symbol));
    return [...set];
  }, [trades]);
  const [chartSymbol, setChartSymbol] = useState<string>("");
  useEffect(() => {
    if (symbolsInTrades.length === 0) { setChartSymbol(""); return; }
    if (!symbolsInTrades.includes(chartSymbol)) {
      // Default to most-traded symbol
      const counts = new Map<string, number>();
      for (const t of trades) counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      setChartSymbol(best);
    }
  }, [symbolsInTrades, trades, chartSymbol]);

  // Filter trades + klines for the chart by chosen symbol
  const chartTrades = useMemo(() => trades.filter((t) => !chartSymbol || t.symbol === chartSymbol), [trades, chartSymbol]);
  const chartKlines = useMemo(() => {
    // 1) Prefer the symbolKlines map (covers multi mode + arbitrary symbols).
    if (chartSymbol && symbolKlines[chartSymbol]?.length) return symbolKlines[chartSymbol];
    // 2) Fall back to the explicit `klines` prop if the focal symbol matches.
    if (klines.length > 0 && (!chartSymbol || !symbol || chartSymbol === symbol)) return klines;
    return [];
  }, [klines, symbolKlines, chartSymbol, symbol]);

  const showFlipToggle = side === "both" && exitMode === "signal-flip";

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-0">

      {/* Preset bar */}
      <div className="px-4 py-3 border-b border-binance-border bg-binance-dark/40">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-binance-muted font-medium uppercase tracking-wider mr-1">Presets:</span>
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => loadPreset(i)}
              title={p.description}
              className="px-2.5 py-1 text-xs rounded font-medium bg-binance-border text-binance-text hover:bg-purple-600 hover:text-white transition"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Scope toolbar — pair mode + symbol picker + date range */}
      <div className="px-4 py-3 border-b border-binance-border bg-binance-card flex flex-wrap items-end gap-4">
        {/* Pair mode */}
        {allSymbols.length > 1 && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-binance-muted uppercase tracking-wider">Backtest scope</label>
            <div className="flex rounded overflow-hidden border border-binance-border">
              {(["single", "all"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPairMode(m)}
                  className={`px-3 py-1.5 text-xs font-medium transition ${
                    pairMode === m
                      ? "bg-binance-yellow text-binance-dark"
                      : "bg-binance-dark text-binance-text hover:bg-binance-border"
                  }`}
                >
                  {m === "single" ? "Single pair" : `All pairs (${allSymbols.length})`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Symbol picker */}
        {pairMode === "single" && allSymbols.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-binance-muted uppercase tracking-wider">Pair</label>
            <select
              value={chosenSym}
              onChange={(e) => setChosenSym(e.target.value)}
              className="bg-binance-dark border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none focus:border-binance-yellow min-w-[120px]"
            >
              {allSymbols.map((sm) => (
                <option key={sm} value={sm}>{sm}</option>
              ))}
            </select>
          </div>
        )}

        {/* Date range */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-binance-muted uppercase tracking-wider">Date range (optional)</label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              min={dataRange.min || undefined}
              max={endDate || dataRange.max || undefined}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-binance-dark border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none [color-scheme:dark]"
            />
            <span className="text-binance-muted text-xs">→</span>
            <input
              type="date"
              min={startDate || dataRange.min || undefined}
              max={dataRange.max || undefined}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-binance-dark border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none [color-scheme:dark]"
            />
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(""); setEndDate(""); }}
                className="text-binance-muted hover:text-binance-red transition text-xs px-1"
              >✕</button>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="ml-auto text-[11px] text-binance-muted">
          <span className="text-white font-mono font-semibold">{scopedBars.length.toLocaleString()}</span> bars in scope
          {pairMode === "single" && chosenSym && (
            <span className="ml-1 text-white">· {chosenSym}</span>
          )}
          {(startDate || endDate) && (
            <span className="ml-1 text-binance-yellow">📅 {startDate || dataRange.min} → {endDate || dataRange.max}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-0 divide-y lg:divide-y-0 lg:divide-x divide-binance-border">

        {/* ═══ LEFT — Builder ═════════════════════════════════════════════ */}
        <div className="lg:w-[360px] flex-shrink-0 px-4 py-4 flex flex-col gap-3">

          {/* Side toggle */}
          <div>
            <span className="text-xs font-semibold text-white uppercase tracking-wider block mb-1.5">Side</span>
            <div className="flex gap-1">
              {(["long", "short", "both"] as const).map((sd) => (
                <button
                  key={sd}
                  onClick={() => setSide(sd)}
                  className={`flex-1 py-1.5 text-xs rounded font-semibold capitalize transition ${
                    side === sd
                      ? sd === "long"  ? "bg-binance-green text-white"
                      : sd === "short" ? "bg-binance-red   text-white"
                      :                  "bg-binance-yellow text-binance-dark"
                      : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                  }`}
                >{sd}</button>
              ))}
            </div>
          </div>

          {/* Exit mode */}
          <div>
            <span className="text-xs font-semibold text-white uppercase tracking-wider block mb-1.5">Exit Mode</span>
            <div className="flex gap-1">
              {(["signal-flip", "explicit"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setExitMode(m)}
                  className={`flex-1 py-1.5 text-xs rounded font-medium transition ${
                    exitMode === m
                      ? "bg-purple-600 text-white"
                      : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                  }`}
                  title={m === "signal-flip"
                    ? "Exit when opposite-side signal fires"
                    : "Exit when explicit exit-conditions match"
                  }
                >
                  {m === "signal-flip" ? "Signal Flip" : "Explicit Exit"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-binance-muted mt-1 leading-tight">
              {exitMode === "signal-flip"
                ? "Long exits on a bear signal; short exits on a bull signal."
                : "Long & short both close when the explicit exit set matches."}
            </p>
          </div>

          {/* Position-flip toggle (only side=both + signal-flip) */}
          {showFlipToggle && (
            <label className="flex items-center gap-2 px-2.5 py-1.5 bg-binance-dark border border-binance-border rounded cursor-pointer">
              <input
                type="checkbox"
                checked={flipOnSignal}
                onChange={(e) => setFlipOnSignal(e.target.checked)}
                className="accent-binance-yellow"
              />
              <span className="text-[11px] text-white">Flip position on counter-signal</span>
              <span className="text-[10px] text-binance-muted ml-auto">always-in-market</span>
            </label>
          )}

          {/* Bull conditions */}
          <ConditionEditor
            title="🟢 Bull Conditions"
            color="green"
            conditions={bullConditions}
            setConditions={setBullConditions}
          />

          {/* Bear conditions */}
          <ConditionEditor
            title="🔴 Bear Conditions"
            color="red"
            conditions={bearConditions}
            setConditions={setBearConditions}
          />

          {/* Exit conditions (only in explicit mode) */}
          {exitMode === "explicit" && (
            <ConditionEditor
              title="⏸ Exit Conditions"
              color="yellow"
              conditions={exitConditions}
              setConditions={setExitConditions}
            />
          )}

          {/* Cooldown */}
          <div>
            <span className="text-xs font-semibold text-white uppercase tracking-wider block mb-1.5">Cooldown (bars between trades)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={cooldown}
              onChange={(e) => setCooldown(Math.max(0, +e.target.value))}
              className="w-full bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-white outline-none focus:border-binance-yellow transition"
            />
          </div>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={running || scopedBars.length === 0}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition flex items-center justify-center gap-2"
          >
            {running ? (
              <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
              </svg>Running…</>
            ) : "▶ Run Backtest"}
          </button>

          {/* Save Strategy */}
          <button
            onClick={() => setShowSave(true)}
            disabled={bullConditions.length === 0 && bearConditions.length === 0}
            className="w-full py-2 bg-binance-yellow/20 hover:bg-binance-yellow text-binance-yellow hover:text-binance-dark border border-binance-yellow/50 disabled:opacity-40 text-xs font-bold rounded-lg transition flex items-center justify-center gap-2"
          >
            💾 Save as Strategy
          </button>

          {bars.length === 0 ? (
            <p className="text-xs text-binance-red text-center">Fetch and Analyze data first</p>
          ) : scopedBars.length === 0 ? (
            <p className="text-xs text-binance-red text-center">No bars in current scope — adjust pair / date filters</p>
          ) : null}
        </div>

        {/* ═══ RIGHT — Results ════════════════════════════════════════════ */}
        <div className="flex-1 min-w-0 px-4 py-4 flex flex-col gap-4">

          {!result && !running && (
            <div className="flex flex-col items-center justify-center flex-1 py-16 text-binance-muted gap-3">
              <span className="text-4xl">🎯</span>
              <p className="text-sm">Configure bull / bear (and optional exit) conditions and click <strong className="text-white">▶ Run Backtest</strong></p>
              <p className="text-xs">Or load a preset strategy to get started instantly.</p>
            </div>
          )}

          {result && (
            <>
              {/* Signal info */}
              <div className="text-xs text-binance-muted">
                Signal rate: <span className="text-white font-semibold">
                  {result.signalBars.toLocaleString()} / {result.totalBars.toLocaleString()} bars
                </span>
                {" "}({(result.stats.signalRate * 100).toFixed(2)}%) →{" "}
                <span className="text-white font-semibold">{result.stats.totalTrades}</span> trades
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-binance-border pb-0">
                {(["stats", "log", "chart"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTradeTab(t)}
                    className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition -mb-px ${
                      tradeTab === t
                        ? "border-purple-400 text-purple-400"
                        : "border-transparent text-binance-muted hover:text-white"
                    }`}
                  >
                    {t === "stats" ? "📊 Statistics" : t === "log" ? "📋 Trade Log" : "📈 Trades Chart"}
                  </button>
                ))}
                {tradeTab === "log" && result.trades.length > 0 && (
                  <button
                    onClick={handleExport}
                    className="ml-auto px-3 py-1 text-xs rounded bg-binance-border text-binance-text hover:bg-binance-yellow hover:text-binance-dark transition"
                  >📥 Export</button>
                )}
              </div>

              {/* Stats view */}
              {tradeTab === "stats" && s && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Stat label="Total Return"
                      value={`${s.totalReturnPct >= 0 ? "+" : ""}${s.totalReturnPct.toFixed(2)}%`}
                      color={s.totalReturnPct >= 0 ? "text-binance-green" : "text-binance-red"} />
                    <Stat label="Win Rate"
                      value={`${(s.winRate * 100).toFixed(1)}%`}
                      color={s.winRate >= 0.5 ? "text-binance-green" : "text-binance-red"}
                      sub={`${s.wins}W / ${s.losses}L`} />
                    <Stat label="Profit Factor"
                      value={isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}
                      color={s.profitFactor >= 1.5 ? "text-binance-green" : s.profitFactor >= 1 ? "text-binance-yellow" : "text-binance-red"} />
                    <Stat label="Expectancy"
                      value={`${s.expectancy >= 0 ? "+" : ""}${s.expectancy.toFixed(3)}%`}
                      color={s.expectancy >= 0 ? "text-binance-green" : "text-binance-red"}
                      sub="per trade" />
                    <Stat label="Max Drawdown"
                      value={`-${s.maxDrawdownPct.toFixed(2)}%`} color="text-binance-red" />
                    <Stat label="Sharpe"
                      value={s.sharpe.toFixed(2)}
                      color={s.sharpe >= 1.5 ? "text-binance-green" : s.sharpe >= 0.5 ? "text-binance-yellow" : "text-binance-red"} />
                    <Stat label="Avg Win" value={`+${s.avgWinPct.toFixed(3)}%`} color="text-binance-green" />
                    <Stat label="Avg Loss" value={`${s.avgLossPct.toFixed(3)}%`} color="text-binance-red" />
                    <Stat label="Avg Hold" value={`${s.avgHoldBars.toFixed(1)}b`} />
                    <Stat label="Max Consec L" value={String(s.maxConsecLosses)}
                      color={s.maxConsecLosses >= 5 ? "text-binance-red" : "text-white"} />
                    <Stat label="Best Trade" value={`+${s.bestTradePct.toFixed(3)}%`} color="text-binance-green" />
                    <Stat label="Worst Trade" value={`${s.worstTradePct.toFixed(3)}%`} color="text-binance-red" />
                  </div>

                  <div className="bg-binance-dark border border-binance-border rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-white">Equity Curve (cumulative %)</span>
                      <span className="text-xs text-binance-muted">{result.trades.length} trades</span>
                    </div>
                    <EquityCurve curve={result.equityCurve} />
                  </div>

                  {/* Exit-reason breakdown */}
                  {result.trades.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      {(["signal", "explicit", "open-end"] as const).map((reason) => {
                        const cnt = result.trades.filter((t) => t.exitReason === reason).length;
                        if (cnt === 0 && reason === "explicit" && exitMode !== "explicit") return null;
                        const pct = (cnt / result.trades.length * 100).toFixed(1);
                        const color = reason === "signal" ? "text-purple-400" : reason === "explicit" ? "text-binance-yellow" : "text-binance-muted";
                        const label = reason === "signal" ? "🔄 Signal flip"
                                    : reason === "explicit" ? "⏸ Explicit exit"
                                    : "⏹ Open-end";
                        return (
                          <div key={reason} className="bg-binance-dark border border-binance-border rounded-lg py-2">
                            <div className={`text-sm font-bold ${color}`}>{cnt}</div>
                            <div className="text-binance-muted text-[10px]">{label}</div>
                            <div className="text-[10px] text-binance-muted">{pct}%</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Trade log */}
              {tradeTab === "log" && (
                <div>
                  {trades.length === 0 ? (
                    <div className="text-center py-8 text-binance-muted text-sm">No trades generated</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-binance-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-binance-border text-binance-muted uppercase tracking-wider bg-binance-dark">
                              <th className="px-3 py-2 text-left">#</th>
                              <th className="px-3 py-2 text-left">Symbol</th>
                              <th className="px-3 py-2 text-left">Side</th>
                              <th className="px-3 py-2 text-left">Entry Time</th>
                              <th className="px-3 py-2 text-right">Entry</th>
                              <th className="px-3 py-2 text-right">Exit</th>
                              <th className="px-3 py-2 text-right">P&L %</th>
                              <th className="px-3 py-2 text-center">Exit</th>
                              <th className="px-3 py-2 text-right">Hold</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tradeSlice.map((t: Trade, i: number) => {
                              const idx = (tradePage - 1) * TRADE_PAGE_SIZE + i + 1;
                              const isWin = t.pnlPct > 0;
                              const reasonLabel = t.exitReason === "signal" ? "🔄 Signal"
                                                : t.exitReason === "explicit" ? "⏸ Explicit"
                                                : "⏹ End";
                              return (
                                <tr key={i} className="border-b border-binance-border/30 hover:bg-binance-border/20 transition">
                                  <td className="px-3 py-1.5 text-binance-muted">{idx}</td>
                                  <td className="px-3 py-1.5 font-mono font-semibold text-white text-[10px]">{t.symbol}</td>
                                  <td className={`px-3 py-1.5 font-semibold capitalize ${t.side === "long" ? "text-binance-green" : "text-binance-red"}`}>
                                    {t.side}
                                  </td>
                                  <td className="px-3 py-1.5 text-binance-muted whitespace-nowrap">
                                    {new Date(t.entryTime).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono">{t.entryPrice.toFixed(4)}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{t.exitPrice.toFixed(4)}</td>
                                  <td className={`px-3 py-1.5 text-right font-mono font-bold ${isWin ? "text-binance-green" : "text-binance-red"}`}>
                                    {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(3)}%
                                  </td>
                                  <td className={`px-3 py-1.5 text-center text-[10px] font-semibold ${
                                    t.exitReason === "signal" ? "text-purple-400" : t.exitReason === "explicit" ? "text-binance-yellow" : "text-binance-muted"
                                  }`}>{reasonLabel}</td>
                                  <td className="px-3 py-1.5 text-right text-binance-muted">{t.durationBars}b</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-3">
                          <button onClick={() => setTradePage((p) => Math.max(1, p - 1))} disabled={tradePage === 1}
                            className="px-3 py-1 text-xs rounded bg-binance-border text-binance-text disabled:opacity-40 hover:bg-[#414d5c] transition">
                            ←
                          </button>
                          <span className="text-xs text-binance-muted">{tradePage} / {totalPages}</span>
                          <button onClick={() => setTradePage((p) => Math.min(totalPages, p + 1))} disabled={tradePage === totalPages}
                            className="px-3 py-1 text-xs rounded bg-binance-border text-binance-text disabled:opacity-40 hover:bg-[#414d5c] transition">
                            →
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Trades chart */}
              {tradeTab === "chart" && (
                <div className="flex flex-col gap-3">
                  {/* Symbol picker (multi mode) */}
                  {symbolsInTrades.length > 1 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-binance-muted">Symbol:</span>
                      {symbolsInTrades.map((sym) => {
                        const cnt = trades.filter((t) => t.symbol === sym).length;
                        return (
                          <button
                            key={sym}
                            onClick={() => setChartSymbol(sym)}
                            className={`px-2.5 py-1 text-xs rounded font-mono font-medium transition ${
                              chartSymbol === sym
                                ? "bg-binance-yellow text-binance-dark"
                                : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                            }`}
                          >
                            {sym} <span className="opacity-60">({cnt})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {chartKlines.length === 0 ? (
                    <div className="text-center py-12 text-binance-muted text-sm">
                      Chart only available for the symbol whose klines are loaded.
                      {chartSymbol && symbol && chartSymbol !== symbol && (
                        <span className="block mt-2 text-[11px]">
                          Showing trades for <span className="font-mono text-white">{chartSymbol}</span>{" "}
                          but loaded klines are for <span className="font-mono text-white">{symbol}</span>.
                        </span>
                      )}
                    </div>
                  ) : (
                    <TradesChart
                      klines={chartKlines}
                      trades={chartTrades}
                      symbol={chartSymbol || symbol}
                      interval={interval}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Save modal */}
      {showSave && (
        <SaveStrategyModal
          defaultName={
            bullConditions.length > 0 || bearConditions.length > 0
              ? `${side === "long" ? "Long" : side === "short" ? "Short" : "Both"} · ${(bullConditions[0]?.feature ?? bearConditions[0]?.feature) ?? "custom"}`
              : "My Strategy"
          }
          defaultDesc={
            result
              ? `Backtested on ${symbol || "loaded data"}${interval ? ` · ${interval}` : ""}. ` +
                `Trades=${result.stats.totalTrades}, WR=${(result.stats.winRate*100).toFixed(1)}%, ` +
                `PF=${isFinite(result.stats.profitFactor) ? result.stats.profitFactor.toFixed(2) : "∞"}, ` +
                `Total=${result.stats.totalReturnPct.toFixed(2)}%.`
              : `Built in Strategy Builder${symbol ? ` for ${symbol}` : ""}${interval ? ` · ${interval}` : ""}.`
          }
          onClose={() => setShowSave(false)}
          onConfirm={handleSaveStrategy}
        />
      )}

      {/* Toast */}
      {savedToast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 bg-green-500/90 text-white text-sm font-semibold rounded-lg shadow-xl">
          {savedToast}
        </div>
      )}
    </div>
  );
}
