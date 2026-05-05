"use client";

import { useState, useMemo, useCallback } from "react";
import type { EnrichedBar } from "@/lib/types";
import { FEATURES } from "@/lib/analysis";
import {
  runBacktest,
  PRESETS,
  type BacktestParams,
  type BacktestResult,
  type Condition,
  type Trade,
} from "@/lib/backtest";
import { downloadXlsx } from "@/lib/downloadXlsx";

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

  // Build path
  const pts = curve.map((p, i) => `${toX(null, i)},${toY(p.equity)}`).join(" ");

  // Drawdown fill (running max vs current)
  let peak = 0;
  const ddPts: string[] = [];
  curve.forEach((p, i) => {
    if (p.equity > peak) peak = p.equity;
    ddPts.push(`${toX(null, i)},${toY(Math.min(p.equity, peak))}`);
  });
  const ddPath = `M ${toX(null, 0)},${toY(Math.max(0, curve[0].equity))} ` +
    ddPts.join(" L ") + ` L ${toX(null, curve.length - 1)},${zeroY} Z`;

  // Y-axis ticks
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) =>
    minE + (i / ticks) * range
  );

  const lastEq = curve[curve.length - 1].equity;
  const isPos  = lastEq >= 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
      {/* Grid */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)}
            stroke="#2d3748" strokeWidth="1" />
          <text x={PAD.left - 4} y={toY(v) + 4}
            textAnchor="end" fontSize="9" fill="#6b7280">
            {v >= 0 ? "+" : ""}{v.toFixed(1)}%
          </text>
        </g>
      ))}

      {/* Zero line */}
      <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY}
        stroke="#4b5563" strokeWidth="1.5" strokeDasharray="4,3" />

      {/* Drawdown fill */}
      <path d={ddPath} fill="rgba(239,68,68,0.12)" />

      {/* Equity line */}
      <polyline
        points={pts}
        fill="none"
        stroke={isPos ? "#22c55e" : "#ef4444"}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      {/* Final value dot */}
      <circle
        cx={toX(null, curve.length - 1)}
        cy={toY(lastEq)}
        r="3.5"
        fill={isPos ? "#22c55e" : "#ef4444"}
      />
      <text
        x={toX(null, curve.length - 1) - 5}
        y={toY(lastEq) - 7}
        textAnchor="end"
        fontSize="10"
        fontWeight="bold"
        fill={isPos ? "#22c55e" : "#ef4444"}
      >
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

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  bars: EnrichedBar[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StrategyBuilder({ bars }: Props) {
  // ── Conditions ────────────────────────────────────────────────────────────
  const [conditions, setConditions] = useState<Condition[]>([
    { feature: "rsi14",        buckets: [1] },
    { feature: "distEma20Atr", buckets: [1] },
    { feature: "cvdRatio",     buckets: [1] },
  ]);

  // ── Exit params ───────────────────────────────────────────────────────────
  const [side,     setSide]     = useState<BacktestParams["side"]>("long");
  const [tpAtr,    setTpAtr]    = useState(1.5);
  const [slAtr,    setSlAtr]    = useState(1.0);
  const [maxHold,  setMaxHold]  = useState(20);
  const [cooldown, setCooldown] = useState(5);

  // ── Results ───────────────────────────────────────────────────────────────
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [tradeTab, setTradeTab] = useState<"stats" | "log">("stats");
  const [tradePage, setTradePage] = useState(1);
  const TRADE_PAGE_SIZE = 50;

  // ── Condition helpers ─────────────────────────────────────────────────────
  const addCondition = () => {
    const used = new Set(conditions.map((c) => c.feature));
    const next = FEATURE_OPTIONS.find((f) => !used.has(f.value));
    if (next) setConditions((prev) => [...prev, { feature: next.value, buckets: [1] }]);
  };

  const removeCondition = (i: number) =>
    setConditions((prev) => prev.filter((_, idx) => idx !== i));

  const updateFeature = (i: number, feature: string) =>
    setConditions((prev) => prev.map((c, idx) => idx === i ? { ...c, feature } : c));

  const toggleBucket = (i: number, b: 1 | 2 | 3 | 4 | 5) =>
    setConditions((prev) => prev.map((c, idx) => {
      if (idx !== i) return c;
      const has = c.buckets.includes(b);
      const next = has ? c.buckets.filter((x) => x !== b) : [...c.buckets, b].sort() as typeof c.buckets;
      return { ...c, buckets: next.length > 0 ? next : [b] };
    }));

  // ── Load preset ───────────────────────────────────────────────────────────
  const loadPreset = (idx: number) => {
    const p = PRESETS[idx].params;
    setConditions(p.conditions.map((c) => ({ ...c })));
    setSide(p.side);
    setTpAtr(p.tpAtr);
    setSlAtr(p.slAtr);
    setMaxHold(p.maxHold);
    setCooldown(p.cooldown);
    setResult(null);
  };

  // ── Run backtest ──────────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (bars.length === 0 || conditions.length === 0) return;
    setRunning(true);
    setResult(null);
    // Defer to next frame so UI can update
    setTimeout(() => {
      try {
        const r = runBacktest(bars, { conditions, side, tpAtr, slAtr, maxHold, cooldown });
        setResult(r);
        setTradePage(1);
      } finally {
        setRunning(false);
      }
    }, 16);
  }, [bars, conditions, side, tpAtr, slAtr, maxHold, cooldown]);

  // ── Export trades ─────────────────────────────────────────────────────────
  const handleExport = () => {
    if (!result) return;
    const rows = result.trades.map((t, i) => ({
      "#":         i + 1,
      Symbol:      t.symbol,
      Side:        t.side,
      "Entry Time": new Date(t.entryTime).toLocaleString(),
      "Entry Price": t.entryPrice.toFixed(6),
      "Exit Time":  new Date(t.exitTime).toLocaleString(),
      "Exit Price": t.exitPrice.toFixed(6),
      "P&L %":     t.pnlPct.toFixed(4),
      "Exit Reason": t.exitReason,
      "Hold (bars)": t.durationBars,
    }));
    downloadXlsx(rows, "backtest_trades");
  };

  // ── Trades page slice ─────────────────────────────────────────────────────
  const trades     = result?.trades ?? [];
  const totalPages = Math.max(1, Math.ceil(trades.length / TRADE_PAGE_SIZE));
  const tradeSlice = trades.slice((tradePage - 1) * TRADE_PAGE_SIZE, tradePage * TRADE_PAGE_SIZE);

  // ── Stats convenience ─────────────────────────────────────────────────────
  const s = result?.stats;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-0">

      {/* ── Preset bar ────────────────────────────────────────────────── */}
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

      <div className="flex flex-col lg:flex-row gap-0 divide-y lg:divide-y-0 lg:divide-x divide-binance-border">

        {/* ═══ LEFT — Builder ═════════════════════════════════════════════ */}
        <div className="lg:w-80 flex-shrink-0 px-4 py-4 flex flex-col gap-4">

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-white uppercase tracking-wider">Entry Conditions</span>
              <button
                onClick={addCondition}
                disabled={conditions.length >= FEATURE_OPTIONS.length}
                className="text-xs px-2 py-0.5 rounded bg-binance-border text-binance-text hover:bg-binance-yellow hover:text-binance-dark disabled:opacity-40 transition"
              >+ Add</button>
            </div>

            <div className="flex flex-col gap-2">
              {conditions.map((cond, i) => (
                <div key={i} className="bg-binance-dark border border-binance-border rounded-lg p-2.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={cond.feature}
                      onChange={(e) => updateFeature(i, e.target.value)}
                      className="flex-1 text-xs bg-binance-border text-white rounded px-2 py-1.5 outline-none"
                    >
                      {FEATURE_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeCondition(i)}
                      disabled={conditions.length <= 1}
                      className="text-binance-muted hover:text-binance-red disabled:opacity-30 text-sm transition"
                    >✕</button>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {([1, 2, 3, 4, 5] as const).map((b) => (
                      <button
                        key={b}
                        onClick={() => toggleBucket(i, b)}
                        title={BUCKET_LABELS[b]}
                        className={`px-2 py-0.5 text-[10px] rounded font-semibold transition ${
                          cond.buckets.includes(b)
                            ? "bg-binance-yellow text-binance-dark"
                            : "bg-binance-border text-binance-muted hover:text-white"
                        }`}
                      >Q{b}</button>
                    ))}
                  </div>
                  <p className="text-[10px] text-binance-muted">
                    Match: {cond.buckets.map((b) => BUCKET_LABELS[b]).join(" OR ")}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Direction */}
          <div>
            <span className="text-xs font-semibold text-white uppercase tracking-wider block mb-2">Direction</span>
            <div className="flex gap-1">
              {(["long", "short", "both"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`flex-1 py-1.5 text-xs rounded font-semibold capitalize transition ${
                    side === s
                      ? s === "long"  ? "bg-binance-green text-white"
                      : s === "short" ? "bg-binance-red text-white"
                      : "bg-binance-yellow text-binance-dark"
                      : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                  }`}
                >{s}</button>
              ))}
            </div>
          </div>

          {/* Exit params */}
          <div>
            <span className="text-xs font-semibold text-white uppercase tracking-wider block mb-2">Exit Parameters</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "TP (ATR×)", value: tpAtr, set: setTpAtr, min: 0.1, step: 0.1 },
                { label: "SL (ATR×)", value: slAtr, set: setSlAtr, min: 0.1, step: 0.1 },
                { label: "Max Hold (bars)", value: maxHold, set: setMaxHold, min: 1, step: 1 },
                { label: "Cooldown (bars)", value: cooldown, set: setCooldown, min: 0, step: 1 },
              ].map(({ label, value, set, min, step }) => (
                <div key={label} className="flex flex-col gap-1">
                  <label className="text-[10px] text-binance-muted">{label}</label>
                  <input
                    type="number"
                    value={value}
                    min={min}
                    step={step}
                    onChange={(e) => set(parseFloat(e.target.value) || min)}
                    className="w-full bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-white outline-none focus:border-binance-yellow transition"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Risk preview */}
          {slAtr > 0 && tpAtr > 0 && (
            <div className="text-xs text-binance-muted bg-binance-dark border border-binance-border rounded-lg px-3 py-2 space-y-0.5">
              <p>R:R = <span className="text-white font-semibold">{(tpAtr / slAtr).toFixed(2)}</span></p>
              <p>Min win rate to break even: <span className="text-white font-semibold">
                {(slAtr / (tpAtr + slAtr) * 100).toFixed(1)}%
              </span></p>
            </div>
          )}

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={running || bars.length === 0}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition flex items-center justify-center gap-2"
          >
            {running ? (
              <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
              </svg>Running…</>
            ) : "▶ Run Backtest"}
          </button>

          {bars.length === 0 && (
            <p className="text-xs text-binance-red text-center">Fetch and Analyze data first</p>
          )}
        </div>

        {/* ═══ RIGHT — Results ════════════════════════════════════════════ */}
        <div className="flex-1 min-w-0 px-4 py-4 flex flex-col gap-4">

          {!result && !running && (
            <div className="flex flex-col items-center justify-center flex-1 py-16 text-binance-muted gap-3">
              <span className="text-4xl">🎯</span>
              <p className="text-sm">Configure conditions and click <strong className="text-white">▶ Run Backtest</strong></p>
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

              {/* ── Tabs ────────────────────────────────────────────── */}
              <div className="flex gap-1 border-b border-binance-border pb-0">
                {(["stats", "log"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTradeTab(t)}
                    className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition -mb-px ${
                      tradeTab === t
                        ? "border-purple-400 text-purple-400"
                        : "border-transparent text-binance-muted hover:text-white"
                    }`}
                  >
                    {t === "stats" ? "📊 Statistics" : "📋 Trade Log"}
                  </button>
                ))}
                {tradeTab === "log" && result.trades.length > 0 && (
                  <button
                    onClick={handleExport}
                    className="ml-auto px-3 py-1 text-xs rounded bg-binance-border text-binance-text hover:bg-binance-yellow hover:text-binance-dark transition"
                  >📥 Export</button>
                )}
              </div>

              {/* ── Stats view ────────────────────────────────────── */}
              {tradeTab === "stats" && s && (
                <div className="flex flex-col gap-4">
                  {/* Key stats grid */}
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
                      value={`-${s.maxDrawdownPct.toFixed(2)}%`}
                      color="text-binance-red" />
                    <Stat label="Sharpe"
                      value={s.sharpe.toFixed(2)}
                      color={s.sharpe >= 1.5 ? "text-binance-green" : s.sharpe >= 0.5 ? "text-binance-yellow" : "text-binance-red"} />
                    <Stat label="Avg Win"
                      value={`+${s.avgWinPct.toFixed(3)}%`}
                      color="text-binance-green" />
                    <Stat label="Avg Loss"
                      value={`${s.avgLossPct.toFixed(3)}%`}
                      color="text-binance-red" />
                    <Stat label="Avg Hold"
                      value={`${s.avgHoldBars.toFixed(1)}b`} />
                    <Stat label="Max Consec L"
                      value={String(s.maxConsecLosses)}
                      color={s.maxConsecLosses >= 5 ? "text-binance-red" : "text-white"} />
                    <Stat label="Best Trade"
                      value={`+${s.bestTradePct.toFixed(3)}%`}
                      color="text-binance-green" />
                    <Stat label="Worst Trade"
                      value={`${s.worstTradePct.toFixed(3)}%`}
                      color="text-binance-red" />
                  </div>

                  {/* Equity curve */}
                  <div className="bg-binance-dark border border-binance-border rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-white">Equity Curve (cumulative %)</span>
                      <span className="text-xs text-binance-muted">{result.trades.length} trades</span>
                    </div>
                    <EquityCurve curve={result.equityCurve} />
                  </div>

                  {/* Exit breakdown */}
                  {result.trades.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      {(["tp", "sl", "maxhold"] as const).map((reason) => {
                        const cnt = result.trades.filter((t) => t.exitReason === reason).length;
                        const pct = (cnt / result.trades.length * 100).toFixed(1);
                        const color = reason === "tp" ? "text-binance-green" : reason === "sl" ? "text-binance-red" : "text-binance-muted";
                        return (
                          <div key={reason} className="bg-binance-dark border border-binance-border rounded-lg py-2">
                            <div className={`text-sm font-bold ${color}`}>{cnt}</div>
                            <div className="text-binance-muted text-[10px]">
                              {reason === "tp" ? "✓ TP Hit" : reason === "sl" ? "✗ SL Hit" : "⏱ Max Hold"}
                            </div>
                            <div className="text-[10px] text-binance-muted">{pct}%</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Trade log ─────────────────────────────────────── */}
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
                              const idx    = (tradePage - 1) * TRADE_PAGE_SIZE + i + 1;
                              const isWin  = t.pnlPct > 0;
                              const pLabel = t.exitReason === "tp" ? "✓ TP" : t.exitReason === "sl" ? "✗ SL" : "⏱";
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
                                    t.exitReason === "tp" ? "text-binance-green" : t.exitReason === "sl" ? "text-binance-red" : "text-binance-muted"
                                  }`}>{pLabel}</td>
                                  <td className="px-3 py-1.5 text-right text-binance-muted">{t.durationBars}b</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Simple pagination */}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
