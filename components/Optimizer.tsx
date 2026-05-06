"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import type { EnrichedBar } from "@/lib/types";
import type { BacktestParams, Trade } from "@/lib/backtest";
import { downloadXlsx } from "@/lib/downloadXlsx";
import * as Strategies from "@/lib/strategies";
import {
  runOptimization,
  type OptimConfig,
  type OptimMetric,
  type OptimProgress,
  type OptimResult,
  type OptimCandidate,
  type PhaseInfo,
} from "@/lib/optimizer";

// ─── Metric labels ────────────────────────────────────────────────────────────

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

function paramsFromCandidate(c: OptimCandidate): BacktestParams {
  return {
    conditions: c.conditions,
    side:       c.side,
    tpAtr:      c.tpAtr,
    slAtr:      c.slAtr,
    maxHold:    c.maxHold,
    cooldown:   c.cooldown,
  };
}

function exportTrades(cand: OptimCandidate) {
  const trades = cand.fullTrades ?? [];
  if (trades.length === 0) return;
  const rows = trades.map((t, i) => ({
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
    "ATR @ entry":  t.atrAtEntry.toFixed(6),
  }));
  const safe = cand.label.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 60) || "candidate";
  downloadXlsx(rows, `optimizer_trades_${safe}`);
}

// ─── Phase card ───────────────────────────────────────────────────────────────

function PhaseCard({ phase, idx }: { phase: PhaseInfo; idx: number }) {
  const pct = phase.total > 0 ? Math.min(100, (phase.done / phase.total) * 100) : 0;
  const isRunning = phase.status === "running";
  const isDone    = phase.status === "done";
  const isWaiting = phase.status === "waiting";

  return (
    <div className={`flex-1 min-w-[200px] rounded-xl border p-4 transition-all duration-500 ${
      isRunning ? "border-binance-yellow bg-[#1a1f2e] shadow-[0_0_16px_rgba(240,185,11,0.15)]"
      : isDone   ? "border-green-500/40 bg-[#0f1f12]"
      :            "border-binance-border bg-binance-dark opacity-50"
    }`}>
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

      <div className="mt-2 h-1.5 bg-binance-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isDone ? "bg-green-500" : isRunning ? "bg-binance-yellow animate-pulse" : "bg-binance-border"
          }`}
          style={{ width: `${isDone ? 100 : pct}%` }}
        />
      </div>

      <div className="mt-1.5 text-[10px] text-binance-muted text-right font-mono">
        {isDone ? `${phase.total.toLocaleString()} done` :
         isRunning ? `${phase.done.toLocaleString()} / ${phase.total.toLocaleString()}` :
         "waiting"}
      </div>
    </div>
  );
}

// ─── Trade log inside expanded row ────────────────────────────────────────────

function TradeLog({ trades }: { trades: Trade[] }) {
  const [page, setPage] = useState(1);
  const PAGE = 25;
  const total = Math.max(1, Math.ceil(trades.length / PAGE));
  const slice = trades.slice((page - 1) * PAGE, page * PAGE);

  if (trades.length === 0) {
    return <p className="text-[11px] text-binance-muted px-2 py-3">No trades captured.</p>;
  }

  return (
    <div className="mt-2">
      <div className="overflow-x-auto rounded border border-binance-border/50">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-binance-border text-binance-muted uppercase tracking-wider bg-binance-dark/60">
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Symbol</th>
              <th className="px-2 py-1.5 text-left">Side</th>
              <th className="px-2 py-1.5 text-left">Entry</th>
              <th className="px-2 py-1.5 text-right">@</th>
              <th className="px-2 py-1.5 text-left">Exit</th>
              <th className="px-2 py-1.5 text-right">@</th>
              <th className="px-2 py-1.5 text-right">P&L %</th>
              <th className="px-2 py-1.5 text-center">Reason</th>
              <th className="px-2 py-1.5 text-right">Hold</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((t, i) => {
              const idx = (page - 1) * PAGE + i + 1;
              const isWin = t.pnlPct > 0;
              const reason = t.exitReason === "tp" ? "✓ TP" : t.exitReason === "sl" ? "✗ SL" : "⏱";
              return (
                <tr key={i} className="border-b border-binance-border/30 hover:bg-binance-border/10 transition">
                  <td className="px-2 py-1 text-binance-muted">{idx}</td>
                  <td className="px-2 py-1 font-mono font-semibold text-white">{t.symbol}</td>
                  <td className={`px-2 py-1 font-semibold capitalize ${t.side === "long" ? "text-binance-green" : "text-binance-red"}`}>{t.side}</td>
                  <td className="px-2 py-1 text-binance-muted whitespace-nowrap">
                    {new Date(t.entryTime).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{t.entryPrice.toFixed(4)}</td>
                  <td className="px-2 py-1 text-binance-muted whitespace-nowrap">
                    {new Date(t.exitTime).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{t.exitPrice.toFixed(4)}</td>
                  <td className={`px-2 py-1 text-right font-mono font-bold ${isWin ? "text-binance-green" : "text-binance-red"}`}>
                    {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(3)}%
                  </td>
                  <td className={`px-2 py-1 text-center font-semibold ${
                    t.exitReason === "tp" ? "text-binance-green" : t.exitReason === "sl" ? "text-binance-red" : "text-binance-muted"
                  }`}>{reason}</td>
                  <td className="px-2 py-1 text-right text-binance-muted">{t.durationBars}b</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 1 && (
        <div className="flex items-center justify-center gap-2 mt-2 text-[10px]">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-2 py-0.5 rounded bg-binance-border text-binance-text disabled:opacity-40 hover:bg-[#414d5c] transition">←</button>
          <span className="text-binance-muted">{page} / {total}</span>
          <button onClick={() => setPage((p) => Math.min(total, p + 1))} disabled={page === total}
            className="px-2 py-0.5 rounded bg-binance-border text-binance-text disabled:opacity-40 hover:bg-[#414d5c] transition">→</button>
        </div>
      )}
    </div>
  );
}

// ─── Leaderboard row ──────────────────────────────────────────────────────────

function LBRow({ cand, rank, metric, onLoad, onSave }: {
  cand:   OptimCandidate;
  rank:   number;
  metric: OptimMetric;
  onLoad: (cand: OptimCandidate) => void;
  onSave: (cand: OptimCandidate) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = scoreColor(cand.score, metric);
  const trades = cand.fullTrades ?? [];

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
          <span style={{ color: cand.profitFactor >= 1 ? "#22c55e" : "#ef4444" }}>
            {isFinite(cand.profitFactor) ? fmt(cand.profitFactor) : "∞"}
          </span>
        </td>
        <td className="px-3 py-2 text-center font-mono text-xs text-binance-muted">{fmt(cand.expectancy, 4)}%</td>
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-1 justify-center">
            <button
              onClick={() => onLoad(cand)}
              className="px-2 py-0.5 text-[10px] font-medium bg-purple-900/40 text-purple-300 rounded hover:bg-purple-700/60 transition whitespace-nowrap"
            >
              Load →
            </button>
            <button
              onClick={() => onSave(cand)}
              className="px-2 py-0.5 text-[10px] font-medium bg-binance-yellow/20 text-binance-yellow rounded hover:bg-binance-yellow hover:text-binance-dark transition whitespace-nowrap"
            >
              💾 Save
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-binance-dark/50 border-b border-binance-border/25">
          <td colSpan={8} className="px-4 py-3">
            <div className="flex flex-wrap gap-4 text-[11px]">
              <span className="text-binance-muted">TP: <span className="text-white font-mono">{cand.tpAtr}×ATR</span></span>
              <span className="text-binance-muted">SL: <span className="text-white font-mono">{cand.slAtr}×ATR</span></span>
              <span className="text-binance-muted">Hold: <span className="text-white font-mono">{cand.maxHold}b</span></span>
              <span className="text-binance-muted">Cooldown: <span className="text-white font-mono">{cand.cooldown}b</span></span>
              <span className="text-binance-muted">Side: <span className="text-white font-mono capitalize">{cand.side}</span></span>
              <span className="text-binance-muted">Sharpe: <span className="text-white font-mono">{fmt(cand.sharpe)}</span></span>
              <span className="text-binance-muted">Max DD: <span className="text-binance-red font-mono">{fmt(cand.maxDD)}%</span></span>
              <span className="text-binance-muted">
                Total Return:{" "}
                <span className={`font-mono ${cand.totalReturn >= 0 ? "text-binance-green" : "text-binance-red"}`}>
                  {cand.totalReturn >= 0 ? "+" : ""}{fmt(cand.totalReturn)}%
                </span>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cand.conditions.map((c, ci) => (
                <span key={ci} className="px-2 py-0.5 bg-binance-border text-white text-[10px] rounded font-mono">
                  {c.feature} [{c.buckets.map((b) => `Q${b}`).join("/")}]
                </span>
              ))}
            </div>

            {/* Trade log */}
            <div className="mt-3">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-[11px] font-semibold text-white uppercase tracking-wider">📋 Trades</span>
                <span className="text-[10px] text-binance-muted">
                  {trades.length > 0 ? `${trades.length} captured` : "Not captured (rank > 10)"}
                </span>
                {trades.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); exportTrades(cand); }}
                    className="ml-auto px-2 py-0.5 text-[10px] rounded bg-binance-border text-binance-text hover:bg-binance-yellow hover:text-binance-dark transition"
                  >
                    📥 Export
                  </button>
                )}
              </div>
              <TradeLog trades={trades} />
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

// ─── Save modal ───────────────────────────────────────────────────────────────

function SaveModal({ cand, defaultInterval, defaultSymbol, onClose, onSaved }: {
  cand:            OptimCandidate;
  defaultInterval: string;
  defaultSymbol:   string;
  onClose:         () => void;
  onSaved:         (id: string) => void;
}) {
  const [name, setName] = useState(`Optim · ${cand.label}`.slice(0, 80));
  const [desc, setDesc] = useState(
    `Found by Optimizer (${defaultSymbol}${defaultInterval ? ` · ${defaultInterval}` : ""}). ` +
    `Score=${cand.score}, Trades=${cand.trades}, WR=${(cand.winRate*100).toFixed(1)}%, PF=${isFinite(cand.profitFactor) ? cand.profitFactor.toFixed(2) : "∞"}.`
  );

  const handleSave = () => {
    const s = Strategies.saveNew({
      name,
      description: desc,
      params:      paramsFromCandidate(cand),
      source:      "optimizer",
      lastStats:   cand.fullStats ?? {
        totalTrades: cand.trades, winRate: cand.winRate, profitFactor: cand.profitFactor,
        expectancy: cand.expectancy, sharpe: cand.sharpe, maxDrawdownPct: cand.maxDD,
        totalReturnPct: cand.totalReturn,
      },
      tunedOn:  defaultSymbol || undefined,
      interval: defaultInterval || undefined,
    });
    onSaved(s.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-binance-card border border-binance-border rounded-xl p-5 w-[440px] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">💾 Save Strategy</h3>

        <label className="text-[11px] text-binance-muted uppercase tracking-wider">Name</label>
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full mt-1 mb-3 bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-white outline-none focus:border-binance-yellow"
          autoFocus
        />

        <label className="text-[11px] text-binance-muted uppercase tracking-wider">Description</label>
        <textarea
          value={desc} onChange={(e) => setDesc(e.target.value)} rows={3}
          className="w-full mt-1 mb-3 bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-white outline-none focus:border-binance-yellow resize-y"
        />

        <div className="text-[11px] text-binance-muted bg-binance-dark border border-binance-border rounded p-2 space-y-0.5 mb-4">
          <p>Conditions: <span className="text-white">{cand.conditions.length}</span></p>
          <p>TP/SL/Hold: <span className="text-white">{cand.tpAtr}/{cand.slAtr}×ATR · {cand.maxHold}b</span></p>
          <p>Side: <span className="text-white capitalize">{cand.side}</span> · Cooldown: <span className="text-white">{cand.cooldown}b</span></p>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim()}
            className="px-4 py-1.5 text-xs font-bold rounded bg-binance-yellow text-binance-dark hover:brightness-110 disabled:opacity-40 transition">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  bars:           EnrichedBar[];
  symbol?:        string;
  interval?:      string;
  onLoadToBuilder?: (params: BacktestParams) => void;
  onSaved?:       (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Optimizer({ bars, symbol = "", interval = "", onLoadToBuilder, onSaved }: Props) {
  // ── Config state (entry-condition optimizer; exits are FIXED) ────────────
  const [metric,      setMetric]      = useState<OptimMetric>("profitFactor");
  const [direction,   setDirection]   = useState<"long" | "short" | "both">("long");
  const [minTrades,   setMinTrades]   = useState(10);
  const [topFeatures, setTopFeatures] = useState(3);
  const [tpAtr,       setTpAtr]       = useState(1.5);
  const [slAtr,       setSlAtr]       = useState(1.0);
  const [maxHold,     setMaxHold]     = useState(20);
  const [cooldown,    setCooldown]    = useState(3);

  // Date range (dropdowns) - default to whole data range
  const dataRange = useMemo(() => {
    if (bars.length === 0) return { min: "", max: "" };
    let lo = bars[0].openTime, hi = bars[0].openTime;
    for (const b of bars) { if (b.openTime < lo) lo = b.openTime; if (b.openTime > hi) hi = b.openTime; }
    return { min: new Date(lo).toISOString().slice(0, 10), max: new Date(hi).toISOString().slice(0, 10) };
  }, [bars]);

  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");

  // ── Run state ────────────────────────────────────────────────────────────
  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState<OptimProgress | null>(null);
  const [result,   setResult]   = useState<OptimResult | null>(null);
  const [saveCand, setSaveCand] = useState<OptimCandidate | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const cancelRef = useRef({ cancelled: false });

  // ── Run / Stop ────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (bars.length < 50) return;
    setRunning(true);
    setResult(null);
    setProgress(null);
    cancelRef.current = { cancelled: false };

    const config: OptimConfig = {
      metric,
      side:        direction,
      minTrades,
      topFeatures,
      tpAtr,
      slAtr,
      maxHold,
      cooldown,
      startTime: startDate ? new Date(startDate).getTime() : undefined,
      endTime:   endDate   ? new Date(endDate + "T23:59:59").getTime() : undefined,
    };

    const res = await runOptimization(bars, config, (p) => setProgress({ ...p }), cancelRef.current);
    setResult(res);
    setRunning(false);
  }, [bars, metric, direction, minTrades, topFeatures, tpAtr, slAtr, maxHold, cooldown, startDate, endDate]);

  const handleStop = () => { cancelRef.current.cancelled = true; };

  // ── Load best into builder ────────────────────────────────────────────────
  const handleLoad = useCallback((cand: OptimCandidate) => {
    if (!onLoadToBuilder) return;
    onLoadToBuilder(paramsFromCandidate(cand));
  }, [onLoadToBuilder]);

  const handleSavedFromModal = (id: string) => {
    setSaveCand(null);
    setSavedToast("Strategy saved ✓");
    setTimeout(() => setSavedToast(null), 2500);
    onSaved?.(id);
  };

  const top5       = result ? result.candidates.slice(0, 5) : [];
  const topResults = progress?.topResults ?? [];

  const symbolCount = useMemo(() => new Set(bars.map((b) => b.symbol)).size, [bars]);
  const estCombos   = 26 + (Math.pow(2, topFeatures) - 1) + 5 * symbolCount + 10;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-5 relative">

      {/* ══ CONFIG PANEL ══════════════════════════════════════════════════════ */}
      {!running && !result && (
        <div className="bg-binance-dark border border-binance-border rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            ⚙️ Optimization Config
            <span className="text-[10px] font-normal text-binance-muted bg-binance-border px-1.5 py-0.5 rounded">
              entry-conditions only
            </span>
          </h3>
          <p className="text-[11px] text-binance-muted -mt-2">
            The optimizer searches features × buckets. Exit parameters (TP/SL/Hold/Cooldown) stay fixed at the values you set
            below — tune those in the Strategy Builder once you&apos;ve found a winning entry combo.
          </p>

          {/* Row 1: Metric + Direction + Min trades + Top features */}
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
          </div>

          {/* Row 2: Date range */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-binance-muted uppercase tracking-wider">Date range (optional)</label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  min={dataRange.min || undefined}
                  max={endDate || dataRange.max || undefined}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-binance-card border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none [color-scheme:dark]"
                />
                <span className="text-binance-muted text-xs">→</span>
                <input
                  type="date"
                  min={startDate || dataRange.min || undefined}
                  max={dataRange.max || undefined}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-binance-card border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none [color-scheme:dark]"
                />
                {(startDate || endDate) && (
                  <button
                    onClick={() => { setStartDate(""); setEndDate(""); }}
                    className="text-binance-muted hover:text-binance-red transition text-xs px-1"
                  >✕</button>
                )}
              </div>
              <p className="text-[10px] text-binance-muted">
                {bars.length > 0
                  ? `Available: ${dataRange.min} → ${dataRange.max} (${bars.length.toLocaleString()} bars)`
                  : "No data loaded"}
                {(startDate || endDate) && " — slicing"}
              </p>
            </div>
          </div>

          {/* Row 3: Fixed exit params */}
          <div>
            <label className="block text-[11px] text-binance-muted uppercase tracking-wider mb-1.5">Fixed Exit Parameters</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-[640px]">
              {[
                { label: "TP (×ATR)", value: tpAtr,    set: setTpAtr,    min: 0.1, step: 0.1 },
                { label: "SL (×ATR)", value: slAtr,    set: setSlAtr,    min: 0.1, step: 0.1 },
                { label: "Max Hold (bars)", value: maxHold, set: setMaxHold, min: 1, step: 1 },
                { label: "Cooldown (bars)", value: cooldown, set: setCooldown, min: 1, step: 1 },
              ].map(({ label, value, set, min, step }) => (
                <div key={label} className="flex flex-col gap-1">
                  <span className="text-[10px] text-binance-muted">{label}</span>
                  <input
                    type="number" min={min} step={step} value={value}
                    onChange={(e) => set(parseFloat(e.target.value) || min)}
                    className="bg-binance-card border border-binance-border text-white text-xs rounded px-2 py-1.5 outline-none focus:border-binance-yellow"
                  />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-binance-muted mt-1.5">
              R:R = <span className="text-white font-semibold">{(tpAtr / slAtr).toFixed(2)}</span> ·
              {" "}Min win rate to break even: <span className="text-white font-semibold">{(slAtr / (tpAtr + slAtr) * 100).toFixed(1)}%</span>
            </p>
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
          <div className="flex items-center gap-4 flex-wrap">
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

            {progress && (
              <span className="text-xs text-binance-muted font-mono ml-2">
                {progress.totalDone.toLocaleString()} / {progress.totalItems.toLocaleString()} backtests
              </span>
            )}

            {result && (
              <span className="text-xs text-binance-muted font-mono">
                · {result.filteredBars.toLocaleString()} bars in range
                {(startDate || endDate) && (
                  <span className="ml-1 text-binance-yellow">
                    📅 {startDate || dataRange.min} → {endDate || dataRange.max}
                  </span>
                )}
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

          {/* Phase cards */}
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

          {/* Live leaderboard */}
          {topResults.length > 0 && (
            <div className="bg-binance-dark border border-binance-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-binance-border flex items-center gap-2">
                <span className="text-xs font-bold text-white">🏆 Top Strategies</span>
                <span className="text-[10px] text-binance-muted">— ranked by {METRIC_LABELS[metric]} — click row to expand & see trades</span>
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
                      <th className="px-3 py-2 text-center font-medium w-32">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topResults.map((cand, i) => (
                      <LBRow
                        key={cand.id}
                        cand={cand}
                        rank={i + 1}
                        metric={metric}
                        onLoad={handleLoad}
                        onSave={(c) => setSaveCand(c)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Best-strategy summary card (final) */}
          {result && top5.length > 0 && (
            <>
              <div className="bg-gradient-to-br from-[#1a1f10] to-[#111] border border-green-500/30 rounded-xl p-4 shadow-[0_0_20px_rgba(34,197,94,0.08)]">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-[10px] text-binance-muted uppercase tracking-wider mb-1">🥇 Best Strategy Found · Best Params</div>
                    <div className="text-sm font-bold text-white mb-2 leading-snug">{top5[0].label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {top5[0].conditions.map((c, ci) => (
                        <span key={ci} className="px-2 py-0.5 bg-binance-border text-white text-[10px] rounded font-mono">
                          {c.feature} [{c.buckets.map((b) => `Q${b}`).join("/")}]
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {onLoadToBuilder && (
                      <button
                        onClick={() => handleLoad(top5[0])}
                        className="px-5 py-2 text-sm font-bold bg-purple-700 text-white rounded-lg hover:bg-purple-600 transition shadow-lg"
                      >
                        🎯 Load into Builder
                      </button>
                    )}
                    <button
                      onClick={() => setSaveCand(top5[0])}
                      className="px-5 py-2 text-sm font-bold bg-binance-yellow text-binance-dark rounded-lg hover:brightness-110 transition shadow-lg"
                    >
                      💾 Save as Strategy
                    </button>
                  </div>
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
                  <span>Cooldown: <span className="text-white font-mono">{top5[0].cooldown} bars</span></span>
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

      {/* Save modal */}
      {saveCand && (
        <SaveModal
          cand={saveCand}
          defaultInterval={interval}
          defaultSymbol={symbol}
          onClose={() => setSaveCand(null)}
          onSaved={handleSavedFromModal}
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
