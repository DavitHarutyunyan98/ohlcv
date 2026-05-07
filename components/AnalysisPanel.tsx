"use client";

import { useState, useMemo, useCallback } from "react";
import type { AnalysisResult, FreqRow, CorrRow, FwdHorizon, EnrichedBar, Kline } from "@/lib/types";
import { FWD_HORIZONS } from "@/lib/types";
import { downloadXlsx } from "@/lib/downloadXlsx";
import type { BacktestParams } from "@/lib/backtest";
import StrategyBuilder from "./StrategyBuilder";
import Optimizer from "./Optimizer";
import StrategiesPanel from "./StrategiesPanel";

// ─── Colour helpers ────────────────────────────────────────────────────────────

/** Map a lift value (0.5 → 2.0) to a green/red background */
function liftBg(lift: number, direction: "up" | "down"): string {
  const clamped = Math.max(0.5, Math.min(2.5, lift));
  const t       = (clamped - 0.5) / 2.0; // 0 → 1
  if (direction === "up") {
    // low lift → red, high lift → green
    const g = Math.round(100 + t * 155);
    const r = Math.round(255 - t * 155);
    return `rgba(${r},${g},60,0.25)`;
  } else {
    const r = Math.round(100 + t * 155);
    const g = Math.round(255 - t * 155);
    return `rgba(${r},${g},60,0.25)`;
  }
}

/** Map a Pearson correlation (-1..1) to a diverging colour */
function corrBg(corr: number | null): string {
  if (corr === null) return "transparent";
  const t = Math.max(-1, Math.min(1, corr));
  if (t >= 0) {
    const g = Math.round(100 + t * 120);
    return `rgba(40,${g},60,0.30)`;
  } else {
    const r = Math.round(100 + (-t) * 120);
    return `rgba(${r},40,60,0.30)`;
  }
}

function corrColor(corr: number | null): string {
  if (corr === null) return "#6b7280";
  return corr >= 0 ? "#22c55e" : "#ef4444";
}

function fmt2(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(2);
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  result:    AnalysisResult;
  bars:      EnrichedBar[];
  /** Raw klines for the focal symbol — enables the Trades-Chart tab. Optional. */
  klines?:   Kline[];
  /** Map of symbol → klines, for per-pair chart support in Builder/Optimizer. */
  symbolKlines?: Record<string, Kline[]>;
  symbol?:   string;
  interval?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AnalysisPanel({ result, bars, klines = [], symbolKlines = {}, symbol = "", interval = "" }: Props) {
  const [activeTab,       setActiveTab]       = useState<"freq" | "corr" | "strategy" | "optimize" | "strategies">("freq");
  const [builderParams,   setBuilderParams]   = useState<BacktestParams | undefined>(undefined);
  const [horizon,         setHorizon]         = useState<FwdHorizon>(1);
  // Bumped whenever a strategy is saved anywhere — forces StrategiesPanel to refresh
  const [strategiesTick,  setStrategiesTick]  = useState(0);

  // Called by Optimizer → switches to Strategy Builder tab with winning params pre-loaded
  const handleLoadToBuilder = useCallback((params: BacktestParams) => {
    setBuilderParams(params);
    setActiveTab("strategy");
  }, []);

  // Called by Optimizer / Builder when a strategy is saved → bump tick
  const handleStrategySaved = useCallback(() => {
    setStrategiesTick((t) => t + 1);
  }, []);

  // Called from StrategiesPanel when user clicks "Open in Builder"
  const handleOpenInBuilder = useCallback((params: BacktestParams) => {
    setBuilderParams(params);
    setActiveTab("strategy");
  }, []);
  const [sortFreqBy, setSortFreqBy] = useState<"liftUp" | "liftDown" | "count">("liftUp");
  const [filterFeat, setFilterFeat] = useState<string>("");

  // ── Derived data ─────────────────────────────────────────────────────────
  const freqRows: FreqRow[] = useMemo(() =>
    result.freqTable
      .filter((r) => r.horizon === horizon)
      .filter((r) => filterFeat === "" || r.featureLabel.toLowerCase().includes(filterFeat.toLowerCase()))
      .sort((a, b) => {
        if (sortFreqBy === "count")    return b.count   - a.count;
        if (sortFreqBy === "liftDown") return b.liftDown - a.liftDown;
        return b.liftUp - a.liftUp;
      }),
  [result.freqTable, horizon, sortFreqBy, filterFeat]);

  const corrRows: CorrRow[] = useMemo(() =>
    [...result.corrTable].sort((a, b) => {
      const maxAbsA = Math.max(
        ...([a.corr1, a.corr3, a.corr5, a.corr10, a.corr20]
          .filter((v): v is number => v !== null)
          .map(Math.abs))
      );
      const maxAbsB = Math.max(
        ...([b.corr1, b.corr3, b.corr5, b.corr10, b.corr20]
          .filter((v): v is number => v !== null)
          .map(Math.abs))
      );
      return maxAbsB - maxAbsA;
    }),
  [result.corrTable]);

  const baseUp   = result.baselineUp[horizon];
  const baseDown = result.baselineDown[horizon];

  // ── XLSX export ───────────────────────────────────────────────────────────
  const handleExport = () => {
    const freqSheet = result.freqTable.map((r) => ({
      Feature:    r.featureLabel,
      Bucket:     r.bucketLabel,
      Horizon:    `${r.horizon}`,
      Count:      r.count,
      "% Up":     r.pctUp.toFixed(2),
      "% Down":   r.pctDown.toFixed(2),
      "% Neutral":r.pctNeutral.toFixed(2),
      "Lift Up":  r.liftUp.toFixed(2),
      "Lift Down":r.liftDown.toFixed(2),
    }));

    const corrSheet = result.corrTable.map((r) => ({
      Feature:  r.featureLabel,
      "Corr@1":  r.corr1?.toFixed(4)  ?? "",
      "Corr@3":  r.corr3?.toFixed(4)  ?? "",
      "Corr@5":  r.corr5?.toFixed(4)  ?? "",
      "Corr@10": r.corr10?.toFixed(4) ?? "",
      "Corr@20": r.corr20?.toFixed(4) ?? "",
    }));

    // We do two separate downloads (one sheet each) since downloadXlsx supports one sheet
    downloadXlsx(freqSheet, `analysis_${symbol}_${interval}_frequency`);
    setTimeout(() => downloadXlsx(corrSheet, `analysis_${symbol}_${interval}_correlation`), 400);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="mt-4 bg-binance-card border border-binance-border rounded-xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-binance-border flex flex-wrap items-center gap-3">
        <div>
          <span className="text-sm font-semibold text-white">🔬 Strategy Analysis</span>
          <span className="ml-2 text-xs text-binance-muted">
            {result.totalBars.toLocaleString()} bars
            {symbol && <span className="ml-1 text-white font-mono">{symbol}</span>}
            {interval && <span className="ml-1 text-binance-muted">· {interval}</span>}
          </span>
        </div>

        {/* Baseline */}
        <div className="text-xs text-binance-muted">
          Baseline @ {horizon}:&nbsp;
          <span className="text-binance-green font-semibold">{baseUp.toFixed(1)}% ↑</span>
          &nbsp;/&nbsp;
          <span className="text-binance-red font-semibold">{baseDown.toFixed(1)}% ↓</span>
        </div>

        {/* Export */}
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-binance-border text-binance-text rounded hover:bg-binance-yellow hover:text-binance-dark transition"
        >
          📥 Export XLSX
        </button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex border-b border-binance-border overflow-x-auto">
        {(["freq", "corr", "strategy", "optimize", "strategies"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-5 py-2.5 text-xs font-semibold uppercase tracking-wider transition border-b-2 whitespace-nowrap ${
              activeTab === t
                ? t === "strategy"   ? "border-purple-400   text-purple-400"
                : t === "optimize"   ? "border-orange-400   text-orange-400"
                : t === "strategies" ? "border-binance-yellow text-binance-yellow"
                :                      "border-binance-yellow text-binance-yellow"
                : "border-transparent text-binance-muted hover:text-white"
            }`}
          >
            {t === "freq"       ? "📊 Frequency Table"
           : t === "corr"       ? "🌡 Correlation Matrix"
           : t === "strategy"   ? "🎯 Strategy Builder"
           : t === "optimize"   ? "⚡ Optimize"
           :                      "💼 My Strategies"}
          </button>
        ))}
      </div>

      {/* ══ FREQUENCY TABLE ════════════════════════════════════════════════ */}
      {activeTab === "freq" && (
        <div>
          {/* Controls */}
          <div className="px-4 py-3 border-b border-binance-border flex flex-wrap items-center gap-3">
            {/* Horizon */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-binance-muted">Horizon:</span>
              <div className="flex gap-1">
                {FWD_HORIZONS.map((h) => (
                  <button
                    key={h}
                    onClick={() => setHorizon(h)}
                    className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                      horizon === h
                        ? "bg-binance-yellow text-binance-dark"
                        : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                    }`}
                  >{h}b</button>
                ))}
              </div>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-binance-muted">Sort by:</span>
              {(["liftUp", "liftDown", "count"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setSortFreqBy(k)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                    sortFreqBy === k
                      ? "bg-binance-yellow text-binance-dark"
                      : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                  }`}
                >
                  {k === "liftUp" ? "Lift ↑" : k === "liftDown" ? "Lift ↓" : "Count"}
                </button>
              ))}
            </div>

            {/* Feature filter */}
            <div className="flex items-center gap-1.5 bg-binance-dark border border-binance-border rounded px-2.5 py-1 ml-auto">
              <input
                className="bg-transparent text-xs text-white outline-none w-28 placeholder:text-binance-muted"
                placeholder="Filter feature…"
                value={filterFeat}
                onChange={(e) => setFilterFeat(e.target.value)}
              />
              {filterFeat && (
                <button onClick={() => setFilterFeat("")} className="text-binance-muted hover:text-binance-red text-sm">✕</button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-binance-border text-binance-muted uppercase tracking-wider">
                  <th className="px-3 py-3 text-left font-medium">Feature</th>
                  <th className="px-3 py-3 text-left font-medium">Bucket</th>
                  <th className="px-3 py-3 text-right font-medium">N</th>
                  <th className="px-3 py-3 text-right font-medium text-binance-green">% Up</th>
                  <th className="px-3 py-3 text-right font-medium text-binance-red">% Down</th>
                  <th className="px-3 py-3 text-right font-medium">% Neutral</th>
                  <th className="px-3 py-3 text-right font-medium text-binance-green">Lift ↑</th>
                  <th className="px-3 py-3 text-right font-medium text-binance-red">Lift ↓</th>
                </tr>
              </thead>
              <tbody>
                {freqRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-binance-muted">
                      No data for this horizon
                    </td>
                  </tr>
                ) : (
                  freqRows.map((r, i) => (
                    <tr
                      key={`${r.feature}-${r.bucket}-${i}`}
                      className="border-b border-binance-border/25 hover:bg-binance-border/20 transition"
                    >
                      <td className="px-3 py-2 font-semibold text-white whitespace-nowrap">
                        {r.featureLabel}
                      </td>
                      <td className="px-3 py-2 text-binance-muted whitespace-nowrap">
                        {r.bucketLabel}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-binance-muted">
                        {r.count}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-binance-green font-semibold">
                        {r.pctUp.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-binance-red font-semibold">
                        {r.pctDown.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-binance-muted">
                        {r.pctNeutral.toFixed(1)}%
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono font-bold"
                        style={{ background: liftBg(r.liftUp, "up"), color: r.liftUp >= 1 ? "#22c55e" : "#ef4444" }}
                      >
                        {r.liftUp.toFixed(2)}×
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono font-bold"
                        style={{ background: liftBg(r.liftDown, "down"), color: r.liftDown >= 1 ? "#ef4444" : "#22c55e" }}
                      >
                        {r.liftDown.toFixed(2)}×
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-binance-border flex flex-wrap gap-4 text-[11px] text-binance-muted">
            <span>Lift = (bucket rate) / (baseline rate). &gt;1.5 = strong signal, &lt;0.7 = inverse signal.</span>
            <span className="text-binance-green">Baseline ↑ {baseUp.toFixed(1)}%</span>
            <span className="text-binance-red">Baseline ↓ {baseDown.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* ══ CORRELATION MATRIX ═════════════════════════════════════════════ */}
      {activeTab === "corr" && (
        <div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-binance-border text-binance-muted uppercase tracking-wider">
                  <th className="px-4 py-3 text-left font-medium">Feature</th>
                  {FWD_HORIZONS.map((h) => (
                    <th key={h} className="px-3 py-3 text-center font-medium">
                      Corr<br/>@{h}b
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrRows.map((r) => (
                  <tr
                    key={r.feature}
                    className="border-b border-binance-border/25 hover:bg-binance-border/20 transition"
                  >
                    <td className="px-4 py-2.5 font-semibold text-white whitespace-nowrap">
                      {r.featureLabel}
                    </td>
                    {([r.corr1, r.corr3, r.corr5, r.corr10, r.corr20] as (number | null)[]).map((corr, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2.5 text-center font-mono font-semibold"
                        style={{
                          background: corrBg(corr),
                          color:      corrColor(corr),
                        }}
                      >
                        {corr !== null ? (corr >= 0 ? "+" : "") + corr.toFixed(3) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Colour scale legend */}
          <div className="px-4 py-3 border-t border-binance-border flex items-center gap-6 text-[11px] text-binance-muted">
            <span>Pearson r of feature vs. % forward return.</span>
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-2 rounded" style={{ background: "linear-gradient(to right, rgba(220,40,60,0.4), transparent, rgba(40,160,60,0.4))" }} />
              <span className="text-binance-red">−1</span>
              <span className="mx-1">→</span>
              <span className="text-binance-green">+1</span>
            </div>
            <span>Sorted by highest |r| across all horizons.</span>
          </div>
        </div>
      )}

      {/* ══ STRATEGY BUILDER ═══════════════════════════════════════════════ */}
      {activeTab === "strategy" && (
        <StrategyBuilder
          bars={bars}
          klines={klines}
          symbolKlines={symbolKlines}
          initialParams={builderParams}
          symbol={symbol}
          interval={interval}
          onSaved={handleStrategySaved}
        />
      )}

      {/* ══ OPTIMIZER ══════════════════════════════════════════════════════ */}
      {activeTab === "optimize" && (
        <Optimizer
          bars={bars}
          symbolKlines={symbolKlines}
          symbol={symbol}
          interval={interval}
          onLoadToBuilder={handleLoadToBuilder}
          onSaved={handleStrategySaved}
        />
      )}

      {/* ══ MY STRATEGIES ══════════════════════════════════════════════════ */}
      {activeTab === "strategies" && (
        <StrategiesPanel
          bars={bars}
          onOpenInBuilder={handleOpenInBuilder}
          refreshKey={strategiesTick}
        />
      )}
    </div>
  );
}
