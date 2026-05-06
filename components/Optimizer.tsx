"use client";

import { useState, useRef, useCallback } from "react";
import type { EnrichedBar } from "@/lib/types";
import type { BacktestParams } from "@/lib/backtest";
import {
  runOptimization,
  type OptimConfig,
  type OptimMetric,
  type OptimProgress,
  type OptimResult,
  type OptimCandidate,
  type PhaseInfo,
} from "@/lib/optimizer";

// ─── Config defaults ──────────────────────────────────────────────────────────

const TP_OPTIONS   = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
const SL_OPTIONS   = [0.5, 1.0, 1.5, 2.0];
const HOLD_OPTIONS = [5, 10, 15, 20, 30];

const METRIC_LABELS: Record<OptimMetric, string> = {
  profitFactor: "Profit Factor",
  expectancy:   "Expectancy",
  winRate:      "Win Rate",
  sharpe:       "Sharpe Ratio",
  totalReturn:  "Total Return %",
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) { return isFinite(n) ? n.toFixed(d) : "—"; }

function scoreColor(score: number, metric: OptimMetric): string {
  if (metric === "winRate")      return score >= 0.6 ? "#22c55e" : score >= 0.5 ? "#eab308" : "#ef4444";
  if (metric === "profitFactor") return score >= 1.5 ? "#22c55e" : score >= 1.0 ? "#eab308" : "#ef4444";
  if (metric === "sharpe")       return score >= 1.0 ? "#22c55e" : score >= 0.3 ? "#eab308" : "#ef4444";
  return score > 0 ? "#22c55e" : "#ef4444";
}

function pfColor(pf: number): string {
  if (!isFinite(pf) || pf === 0) return "#374151";
  if (pf >= 2.0) return "rgba(34,197,94,0.55)";
  if (pf >= 1.5) return "rgba(34,197,94,0.30)";
  if (pf >= 1.0) return "rgba(234,179,8,0.25)";
  return "rgba(239,68,68,0.30)";
}

// ─── Phase card ───────────────────────────────────────────────────────────────

function PhaseCard({ phase, idx }: { phase: PhaseInfo; idx: number }) {
  const pct = phase.total > 0 ? Math.min(100, (phase.done / phase.total) * 100) : 0;
  const isRunning = phase.status === "running";
  const isDone    = phase.status === "done";
  const isWaiting = phase.status === "waiting";

  return (
    <div className={`flex-1 min-w-[220px] rounded-xl border p-4 transition-all duration-500 ${
      isRunning ? "border-binance-yellow bg-[#1a1f2e] shadow-[0_0_16px_rgba(240,185,11,0.15)]"
      : isDone   ? "border-green-500/40 bg-[#0f1f12]"
      :            "border-binance-border bg-binance-dark opacity-50"
    }`}>
      {/* Phase label */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          isDone ? "bg-green-500/20 text-green-400" :
          isRunning ? "bg-binance-yellow/20 text-binance-yellow" :
          "bg-binance-border text-binance-muted"
        }`}>{idx + 1}</span>
        <div>
          <div className={`text-xs font-bold ${
            isDone ? "text-green-400" : isRunning ? "text-binance-yellow" : "text-binance-muted"
          }`}>
            {phase.name}&nbsp;
            {isDone && "✓"}
            {isRunning && <span className="inline-block animate-pulse">◉</span>}
            {isWaiting && "·"}
          </div>
          <div className="text-[10px] text-binance-muted mt-0.5 leading-tight">{phase.desc}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 bg-binance-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isDone ? "bg-green-500" : isRunning ? "bg-binance-yellow animate-pulse" : "bg-binance-border"
          }`}
          style={{ width: `${isDone ? 100 : pct}%` }}
        />
      </div>

      {/* Count */}
      <div className="mt-1.5 text-[10px] text-binance-muted text-right font-mono">
        {isDone ? `${phase.total.toLocaleString()} done` :
         isRunning ? `${phase.done.toLocaleString()} / ${phase.total.toLocaleString()}` :
         "waiting"}
      </div>
    </div>
  );
}

// ─── Leaderboard row ──────────────────────────────────────────────────────────

function LBRow({ cand, rank, metric, onLoad }: {
  cand:   OptimCandidate;
  rank:   number;
  metric: OptimMetric;
  onLoad: (cand: OptimCandidate) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = scoreColor(cand.score, metric);

  return (
    <>
      <tr
        className="border-b border-binance-border/25 hover:bg-binance-border/15 transition cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
      >
        <td className="px-3 py-2 text-center">
          <span className={`text-xs font-bold ${rank === 1 ? "text-binance-yellow" : rank <= 3 ? "text-white" : "text-binance-muted"}`}>
            {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-white max-w-[280px]">
          <span className="line-clamp-1 block">{cand.label}</span>
        </td>
        <td className="px-3 py-2 text-center font-mono text-xs font-bold" style={{ color }}>{fmt(cand.score, 3)}</td>
        <td className="px-3 py-2 text-center font-mono text-xs text-binance-muted">{cand.trades}</td>
        <td className="px-3 py-2 text-center font-mono text-xs text-binance-green">{fmt(cand.winRate * 100, 1)}%</td>
        <td className="px-3 py-2 text-center font-mono text-xs">
          <span style={{ color: pfColor(cand.profitFactor) !== "#374151" ? "#22c55e" : "#ef4444" }}>
            {isFinite(cand.profitFactor) ? fmt(cand.profitFactor) : "∞"}
          </span>
        </td>
        <td className="px-3 py-2 text-center font-mono text-xs text-binance-muted">{fmt(cand.expectancy, 4)}%</td>
        <td className="px-3 py-2 text-center">
          <button
            onClick={(e) => { e.stopPropagation(); onLoad(cand); }}
            className="px-2 py-0.5 text-[10px] font-medium bg-purple-900/40 text-purple-300 rounded hover:bg-purple-700/60 transition whitespace-nowrap"
          >
            Load →
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-binance-dark/50 border-b border-binance-border/25">
          <td colSpan={8} className="px-4 py-3">
            <div className="flex flex-wrap gap-4 text-[11px]">
              <span className="text-binance-muted">
                TP: <span className="text-white font-mono">{cand.tpAtr}×ATR</span>
              </span>
              <span className="text-binance-muted">
                SL: <span className="text-white font-mono">{cand.slAtr}×ATR</span>
              </span>
              <span className="text-binance-muted">
                Hold: <span className="text-white font-mono">{cand.maxHold}b</span>
              </span>
              <span className="text-binance-muted">
                Sharpe: <span className="text-white font-mono">{fmt(cand.sharpe)}</span>
              </span>
              <span className="text-binance-muted">
                Max DD: <span className="text-binance-red font-mono">{fmt(cand.maxDD)}%</span>
              </span>
              <span className="text-binance-muted">
                Total Return: <span className={`font-mono ${cand.totalReturn >= 0 ? "text-binance-green" : "text-binance-red"}`}>{cand.totalReturn >= 0 ? "+" : ""}{fmt(cand.totalReturn)}%</span>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cand.conditions.map((c, ci) => (
                <span key={ci} className="px-2 py-0.5 bg-binance-border text-white text-[10px] rounded font-mono">
                  {c.feature} [{c.buckets.map((b) => `Q${b}`).join("/")}]
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Per-pair heatmap ─────────────────────────────────────────────────────────

function PerPairHeatmap({ perPair, symbols, top5 }: {
  perPair: Record<string, OptimCandidate[]>;
  symbols: string[];
  top5:    OptimCandidate[];
}) {
  return (
    <div className="overflow-x-auto mt-4">
      <p className="text-xs text-binance-muted mb-2 px-1">
        Per-pair Profit Factor — top 5 strategies × each symbol. Green = edge, red = no edge.
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-binance-border text-binance-muted">
            <th className="px-3 py-2 text-left font-medium">Symbol</th>
            {top5.map((s, si) => (
              <th key={si} className="px-2 py-2 text-center font-medium max-w-[90px]">
                <span className="block truncate" title={s.label}>Strat {si + 1}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((sym) => {
            const row = perPair[sym] ?? [];
            return (
              <tr key={sym} className="border-b border-binance-border/20 hover:bg-binance-border/10 transition">
                <td className="px-3 py-1.5 font-mono text-white font-semibold">{sym}</td>
                {top5.map((_, si) => {
                  const cand = row[si];
                  const pf   = cand?.profitFactor ?? 0;
                  const bg   = pfColor(pf);
                  const text = cand && cand.trades >= 1
                    ? (isFinite(pf) ? fmt(pf) : "∞")
                    : "—";
                  const textColor = pf >= 1.0 ? "#22c55e" : pf > 0 ? "#ef4444" : "#6b7280";
                  return (
                    <td
                      key={si}
                      className="px-2 py-1.5 text-center font-mono font-bold"
                      style={{ background: bg, color: textColor }}
                      title={cand ? `Trades: ${cand.trades} | WR: ${fmt(cand.winRate*100,1)}% | DD: ${fmt(cand.maxDD)}%` : ""}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  bars:           EnrichedBar[];
  onLoadToBuilder?: (params: BacktestParams) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Optimizer({ bars, onLoadToBuilder }: Props) {
  // ── Config state ──────────────────────────────────────────────────────────
  const [metric,      setMetric]      = useState<OptimMetric>("profitFactor");
  const [direction,   setDirection]   = useState<"long" | "short" | "both">("long");
  const [minTrades,   setMinTrades]   = useState(10);
  const [topFeatures, setTopFeatures] = useState(3);
  const [cooldown,    setCooldown]    = useState(3);
  const [tpSel,       setTpSel]       = useState<number[]>([1.0, 1.5, 2.0]);
  const [slSel,       setSlSel]       = useState<number[]>([0.5, 1.0, 1.5]);
  const [holdSel,     setHoldSel]     = useState<number[]>([10, 15, 20]);

  // ── Run state ─────────────────────────────────────────────────────────────
  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState<OptimProgress | null>(null);
  const [result,   setResult]   = useState<OptimResult | null>(null);
  const cancelRef = useRef({ cancelled: false });

  // ── Checkbox helpers ──────────────────────────────────────────────────────
  const toggleVal = (val: number, sel: number[], setSel: (v: number[]) => void) => {
    setSel(sel.includes(val) ? sel.filter((x) => x !== val) : [...sel, val].sort((a, b) => a - b));
  };

  // ── Run / Stop ────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (bars.length < 50) return;
    setRunning(true);
    setResult(null);
    setProgress(null);
    cancelRef.current = { cancelled: false };

    const config: OptimConfig = {
      metric,
      side:          direction,
      minTrades,
      tpValues:      tpSel.length  > 0 ? tpSel  : [1.5],
      slValues:      slSel.length  > 0 ? slSel  : [1.0],
      maxHoldValues: holdSel.length > 0 ? holdSel : [20],
      cooldown,
      topFeatures,
    };

    const res = await runOptimization(bars, config, (p) => setProgress({ ...p }), cancelRef.current);
    setResult(res);
    setRunning(false);
  }, [bars, metric, direction, minTrades, tpSel, slSel, holdSel, cooldown, topFeatures]);

  const handleStop = () => { cancelRef.current.cancelled = true; };

  // ── Load best into builder ────────────────────────────────────────────────
  const handleLoad = useCallback((cand: OptimCandidate) => {
    if (!onLoadToBuilder) return;
    const params: BacktestParams = {
      conditions: cand.conditions,
      side:       cand.side as BacktestParams["side"],
      tpAtr:      cand.tpAtr,
      slAtr:      cand.slAtr,
      maxHold:    cand.maxHold,
      cooldown,
    };
    onLoadToBuilder(params);
  }, [onLoadToBuilder, cooldown]);

  const top5 = result ? result.candidates.slice(0, 5) : [];
  const topResults = progress?.topResults ?? [];

  // Total combos estimate
  const estCombos = (Math.pow(2, topFeatures) - 1) * tpSel.length * slSel.length * holdSel.length
    + 26 + 5 * (new Set(bars.map((b) => b.symbol)).size);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-5">

      {/* ══ CONFIG PANEL ══════════════════════════════════════════════════════ */}
      {!running && !result && (
        <div className="bg-binance-dark border border-binance-border rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            ⚙️ Optimization Config
          </h3>

          {/* Row 1: Metric + Direction */}
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-[11px] text-binance-muted uppercase tracking-wider">Optimize for</label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as OptimMetric)}
                className="bg-binance-card border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none"
              >
                {(Object.keys(METRIC_LABELS) as OptimMetric[]).map((k) => (
                  <option key={k} value={k}>{METRIC_LABELS[k]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-binance-muted uppercase tracking-wider">Direction</label>
              <div className="flex gap-1">
                {(["long", "short", "both"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDirection(d)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded transition capitalize ${
                      direction === d
                        ? d === "long"  ? "bg-binance-green/20 text-binance-green border border-binance-green/50"
                        : d === "short" ? "bg-binance-red/20   text-binance-red   border border-binance-red/50"
                        :                "bg-purple-900/30     text-purple-300    border border-purple-500/50"
                        : "bg-binance-border text-binance-muted hover:text-white border border-transparent"
                    }`}
                  >{d}</button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-binance-muted uppercase tracking-wider">Min Trades</label>
              <input
                type="number" min={1} max={500} value={minTrades}
                onChange={(e) => setMinTrades(Math.max(1, +e.target.value))}
                className="w-20 bg-binance-card border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-binance-muted uppercase tracking-wider">Top Features</label>
              <select
                value={topFeatures}
                onChange={(e) => setTopFeatures(+e.target.value)}
                className="bg-binance-card border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none"
              >
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} features</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-binance-muted uppercase tracking-wider">Cooldown</label>
              <input
                type="number" min={1} max={50} value={cooldown}
                onChange={(e) => setCooldown(Math.max(1, +e.target.value))}
                className="w-20 bg-binance-card border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none"
              />
            </div>
          </div>

          {/* TP / SL / Hold checkboxes */}
          <div className="flex flex-wrap gap-6">
            <div>
              <label className="block text-[11px] text-binance-muted uppercase tracking-wider mb-1.5">TP (×ATR)</label>
              <div className="flex gap-2 flex-wrap">
                {TP_OPTIONS.map((v) => (
                  <label key={v} className="flex items-center gap-1.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={tpSel.includes(v)}
                      onChange={() => toggleVal(v, tpSel, setTpSel)}
                      className="accent-binance-yellow"
                    />
                    <span className={`text-xs font-mono ${tpSel.includes(v) ? "text-binance-yellow" : "text-binance-muted group-hover:text-white"}`}>{v}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-binance-muted uppercase tracking-wider mb-1.5">SL (×ATR)</label>
              <div className="flex gap-2 flex-wrap">
                {SL_OPTIONS.map((v) => (
                  <label key={v} className="flex items-center gap-1.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={slSel.includes(v)}
                      onChange={() => toggleVal(v, slSel, setSlSel)}
                      className="accent-binance-yellow"
                    />
                    <span className={`text-xs font-mono ${slSel.includes(v) ? "text-binance-yellow" : "text-binance-muted group-hover:text-white"}`}>{v}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-binance-muted uppercase tracking-wider mb-1.5">Max Hold (bars)</label>
              <div className="flex gap-2 flex-wrap">
                {HOLD_OPTIONS.map((v) => (
                  <label key={v} className="flex items-center gap-1.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={holdSel.includes(v)}
                      onChange={() => toggleVal(v, holdSel, setHoldSel)}
                      className="accent-binance-yellow"
                    />
                    <span className={`text-xs font-mono ${holdSel.includes(v) ? "text-binance-yellow" : "text-binance-muted group-hover:text-white"}`}>{v}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Estimate + Start */}
          <div className="flex items-center gap-4 pt-1">
            <span className="text-[11px] text-binance-muted">
              ~{estCombos.toLocaleString()} backtests to run
            </span>
            <button
              onClick={handleStart}
              disabled={bars.length < 50}
              className="ml-auto px-6 py-2 text-sm font-bold bg-binance-yellow text-binance-dark rounded-lg hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⚡ Start Optimization
            </button>
          </div>
        </div>
      )}

      {/* ══ RUNNING / DONE UI ════════════════════════════════════════════════ */}
      {(running || result) && (
        <>
          {/* Header strip */}
          <div className="flex items-center gap-4">
            {running ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-binance-yellow animate-pulse" />
                <span className="text-sm font-bold text-binance-yellow">Optimizing…</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-bold text-green-400">Optimization Complete</span>
              </div>
            )}

            {/* Total progress */}
            {progress && (
              <span className="text-xs text-binance-muted font-mono ml-2">
                {progress.totalDone.toLocaleString()} / {progress.totalItems.toLocaleString()} backtests
              </span>
            )}

            <div className="flex gap-2 ml-auto">
              {running && (
                <button
                  onClick={handleStop}
                  className="px-4 py-1.5 text-xs font-bold bg-binance-red/20 text-binance-red border border-binance-red/40 rounded-lg hover:bg-binance-red/30 transition"
                >
                  ⏹ Stop
                </button>
              )}
              <button
                onClick={() => { setResult(null); setProgress(null); setRunning(false); }}
                className="px-4 py-1.5 text-xs font-bold bg-binance-border text-binance-muted rounded-lg hover:text-white transition"
              >
                ↩ Reconfigure
              </button>
            </div>
          </div>

          {/* 3 Phase cards */}
          {progress && (
            <div className="flex flex-wrap gap-3">
              {progress.phases.map((ph, i) => (
                <PhaseCard key={i} phase={ph} idx={i} />
              ))}
            </div>
          )}

          {/* Current test */}
          {running && progress && (
            <div className="bg-binance-dark border border-binance-border rounded-lg px-4 py-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-binance-yellow animate-ping flex-shrink-0" />
              <span className="text-[11px] text-binance-muted font-mono truncate">
                Testing: <span className="text-white">{progress.currentTest}</span>
              </span>
            </div>
          )}

          {/* ── Live leaderboard ─────────────────────────────────────────── */}
          {topResults.length > 0 && (
            <div className="bg-binance-dark border border-binance-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-binance-border flex items-center gap-2">
                <span className="text-xs font-bold text-white">🏆 Top Strategies</span>
                <span className="text-[10px] text-binance-muted">— ranked by {METRIC_LABELS[metric]} — click row to expand</span>
                <span className="ml-auto text-[10px] text-binance-muted font-mono">
                  {topResults.length} found
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-binance-border text-binance-muted uppercase tracking-wider">
                      <th className="px-3 py-2 text-center font-medium w-10">#</th>
                      <th className="px-3 py-2 text-left font-medium">Strategy</th>
                      <th className="px-3 py-2 text-center font-medium">{METRIC_LABELS[metric]}</th>
                      <th className="px-3 py-2 text-center font-medium">Trades</th>
                      <th className="px-3 py-2 text-center font-medium">WR</th>
                      <th className="px-3 py-2 text-center font-medium">PF</th>
                      <th className="px-3 py-2 text-center font-medium">Expectancy</th>
                      <th className="px-3 py-2 text-center font-medium w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topResults.map((cand, i) => (
                      <LBRow key={cand.id} cand={cand} rank={i + 1} metric={metric} onLoad={handleLoad} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Post-completion: best strategy card ────────────────────── */}
          {result && top5.length > 0 && (
            <>
              <div className="bg-gradient-to-br from-[#1a1f10] to-[#111] border border-green-500/30 rounded-xl p-4 shadow-[0_0_20px_rgba(34,197,94,0.08)]">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-[10px] text-binance-muted uppercase tracking-wider mb-1">🥇 Best Strategy Found</div>
                    <div className="text-sm font-bold text-white mb-2 leading-snug">{top5[0].label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {top5[0].conditions.map((c, ci) => (
                        <span key={ci} className="px-2 py-0.5 bg-binance-border text-white text-[10px] rounded font-mono">
                          {c.feature} [{c.buckets.map((b) => `Q${b}`).join("/")}]
                        </span>
                      ))}
                    </div>
                  </div>

                  {onLoadToBuilder && (
                    <button
                      onClick={() => handleLoad(top5[0])}
                      className="flex-shrink-0 px-5 py-2 text-sm font-bold bg-purple-700 text-white rounded-lg hover:bg-purple-600 transition shadow-lg"
                    >
                      🎯 Load into Builder
                    </button>
                  )}
                </div>

                {/* Stats grid */}
                <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { label: "Trades",     value: String(top5[0].trades) },
                    { label: "Win Rate",   value: `${fmt(top5[0].winRate * 100, 1)}%`, color: top5[0].winRate >= 0.5 ? "text-binance-green" : "text-binance-red" },
                    { label: "Prof. Factor", value: isFinite(top5[0].profitFactor) ? fmt(top5[0].profitFactor) : "∞", color: top5[0].profitFactor >= 1 ? "text-binance-green" : "text-binance-red" },
                    { label: "Expectancy", value: `${top5[0].expectancy >= 0 ? "+" : ""}${fmt(top5[0].expectancy, 4)}%`, color: top5[0].expectancy >= 0 ? "text-binance-green" : "text-binance-red" },
                    { label: "Sharpe",     value: fmt(top5[0].sharpe), color: top5[0].sharpe >= 1 ? "text-binance-green" : "text-white" },
                    { label: "Max DD",     value: `${fmt(top5[0].maxDD)}%`, color: "text-binance-red" },
                  ].map(({ label, value, color = "text-white" }) => (
                    <div key={label} className="bg-binance-dark border border-binance-border/50 rounded-lg p-2">
                      <div className="text-[10px] text-binance-muted uppercase tracking-wide">{label}</div>
                      <div className={`text-sm font-bold font-mono mt-0.5 ${color}`}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-binance-muted">
                  <span>TP: <span className="text-white font-mono">{top5[0].tpAtr}×ATR</span></span>
                  <span>SL: <span className="text-white font-mono">{top5[0].slAtr}×ATR</span></span>
                  <span>Max Hold: <span className="text-white font-mono">{top5[0].maxHold} bars</span></span>
                  <span>Direction: <span className={`font-mono font-semibold ${
                    top5[0].side === "long" ? "text-binance-green" :
                    top5[0].side === "short" ? "text-binance-red" : "text-purple-300"
                  }`}>{top5[0].side}</span></span>
                </div>
              </div>

              {/* Per-pair heatmap */}
              {result.symbols.length > 0 && (
                <div className="bg-binance-dark border border-binance-border rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-binance-border">
                    <span className="text-xs font-bold text-white">🗺 Per-pair Performance Heatmap</span>
                    <span className="ml-2 text-[10px] text-binance-muted">(Profit Factor)</span>
                  </div>
                  <div className="px-4 pb-4">
                    <PerPairHeatmap perPair={result.perPair} symbols={result.symbols} top5={top5} />
                  </div>
                  {/* Strategy legend */}
                  <div className="px-4 pb-3 flex flex-wrap gap-2">
                    {top5.map((s, si) => (
                      <div key={si} className="flex items-center gap-1.5 text-[10px] text-binance-muted">
                        <span className="font-semibold text-white">Strat {si + 1}:</span>
                        <span className="truncate max-w-[160px]" title={s.label}>{s.label}</span>
                        {onLoadToBuilder && (
                          <button
                            onClick={() => handleLoad(s)}
                            className="ml-1 px-1.5 py-0.5 bg-purple-900/40 text-purple-300 rounded text-[10px] hover:bg-purple-700/60 transition"
                          >
                            Load
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Empty state */}
      {bars.length < 50 && (
        <div className="text-center py-12 text-binance-muted text-sm">
          Analyze data first to enable optimization (need ≥50 bars)
        </div>
      )}
    </div>
  );
}
