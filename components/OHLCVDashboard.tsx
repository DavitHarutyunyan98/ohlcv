"use client";

import { useState, useCallback, useEffect } from "react";
import CandlestickChart from "./CandlestickChart";
import CandlesTable from "./CandlesTable";
import PairsResultTable from "./PairsResultTable";
import PairSearch from "./PairSearch";
import AnalysisPanel from "./AnalysisPanel";
import type {
  Kline, FilledPair, PairResult, DbSession,
  FundingRate, OIRecord, EnrichedBar, AnalysisResult,
} from "@/lib/types";
import { fetchAllKlines } from "@/lib/fetchKlines";
import { computeIndicators, tagSymbol } from "@/lib/indicators";
import { analyzeEnrichedBars } from "@/lib/analysis";

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERVALS   = ["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","3d","1w"];
const QUOTES      = ["USDT","BTC","ETH","BNB","FDUSD"];
const CONCURRENCY = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pairResult(sym: string, klines: Kline[]): PairResult {
  const periodOpen  = parseFloat(klines[0].open);
  const periodClose = parseFloat(klines[klines.length - 1].close);
  return {
    symbol:      sym,
    candles:     klines.length,
    periodOpen,
    periodHigh:  Math.max(...klines.map((k) => parseFloat(k.high))),
    periodLow:   Math.min(...klines.map((k) => parseFloat(k.low))),
    periodClose,
    totalVolume: klines.reduce((s, k) => s + parseFloat(k.volume), 0),
    change:      ((periodClose - periodOpen) / periodOpen) * 100,
    status:      "ok",
    klines,
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function OHLCVDashboard() {
  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"single" | "multi">("single");

  // ── Data source ───────────────────────────────────────────────────────────
  const [dataSource, setDataSource] = useState<"futures" | "spot">("futures");

  // ── Single mode ───────────────────────────────────────────────────────────
  const [symbol, setSymbol]             = useState("BTCUSDT");
  const [singleKlines, setSingleKlines] = useState<Kline[]>([]);
  const [singleFetched, setSingleFetched] = useState(0);

  // ── Multi mode ────────────────────────────────────────────────────────────
  const [topNInput, setTopNInput]     = useState("50");
  const [quote, setQuote]             = useState("USDT");
  const [filledPairs, setFilledPairs] = useState<FilledPair[]>([]);
  const [fillLoading, setFillLoading] = useState(false);
  const [fillError, setFillError]     = useState<string | null>(null);
  const [multiResults, setMultiResults] = useState<PairResult[]>([]);
  const [multiProgress, setMultiProgress] = useState(0);
  const [multiTotal, setMultiTotal]   = useState(0);
  const [currentSym, setCurrentSym]   = useState("");

  // ── Shared ────────────────────────────────────────────────────────────────
  const [barLength, setBarLength]     = useState("1h");
  const [startDate, setStartDate]     = useState("");
  const [endDate, setEndDate]         = useState("");
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError]   = useState<string | null>(null);

  // ── Active pair (chart in multi mode) ────────────────────────────────────
  const [activePair, setActivePair]   = useState("");
  const [activeKlines, setActiveKlines] = useState<Kline[]>([]);

  // ── Supabase ──────────────────────────────────────────────────────────────
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState<string | null>(null);
  const [sessions, setSessions]       = useState<DbSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [supabaseEnabled, setSupabaseEnabled] = useState(false);

  // ── Analysis ──────────────────────────────────────────────────────────────
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [enrichedBars,   setEnrichedBars]   = useState<EnrichedBar[]>([]);
  const [analyzing,      setAnalyzing]      = useState(false);
  const [analyzeError,   setAnalyzeError]   = useState<string | null>(null);

  // Probe Supabase once
  useEffect(() => {
    fetch("/api/supabase/sessions")
      .then((r) => { if (r.ok) setSupabaseEnabled(true); })
      .catch(() => {});
  }, []);

  const today = new Date().toISOString().split("T")[0];

  const dateRange = {
    start: startDate ? new Date(startDate).getTime()             : undefined,
    end:   endDate   ? new Date(endDate + "T23:59:59").getTime() : undefined,
  };

  // ── Fill pairs ────────────────────────────────────────────────────────────
  const handleFill = useCallback(async () => {
    const n = parseInt(topNInput, 10);
    if (isNaN(n) || n < 1) return;
    setFillLoading(true);
    setFillError(null);
    setMultiResults([]);
    setAnalysisResult(null);
    try {
      const endpoint = dataSource === "futures"
        ? `/api/futures/top-pairs?quote=${quote}&limit=${n}`
        : `/api/top-pairs?quote=${quote}&limit=${n}`;
      const res  = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setFilledPairs(data.pairs);
    } catch (e) {
      setFillError(e instanceof Error ? e.message : "Error");
    } finally {
      setFillLoading(false);
    }
  }, [topNInput, quote, dataSource]);

  // ── Fetch OHLCV ───────────────────────────────────────────────────────────
  const handleFetch = useCallback(async () => {
    setFetchLoading(true);
    setFetchError(null);
    setAnalysisResult(null);
    setEnrichedBars([]);

    try {
      if (mode === "single") {
        setSingleKlines([]);
        setSingleFetched(0);
        const klines = await fetchAllKlines(
          symbol, barLength, dateRange.start, dateRange.end,
          (n) => setSingleFetched(n),
          dataSource,
        );
        setSingleKlines(klines);
      } else {
        if (filledPairs.length === 0) return;
        setMultiResults([]);
        setMultiProgress(0);
        setMultiTotal(filledPairs.length);

        const accumulated: PairResult[] = [];

        for (let i = 0; i < filledPairs.length; i += CONCURRENCY) {
          const batch = filledPairs.slice(i, i + CONCURRENCY);
          setCurrentSym(batch[0].symbol);

          const settled = await Promise.allSettled(
            batch.map((p) =>
              fetchAllKlines(p.symbol, barLength, dateRange.start, dateRange.end, undefined, dataSource)
            )
          );

          settled.forEach((result, idx) => {
            const sym = batch[idx].symbol;
            if (result.status === "fulfilled" && result.value.length > 0) {
              accumulated.push(pairResult(sym, result.value));
            } else {
              const msg = result.status === "rejected" ? String(result.reason) : "No data";
              accumulated.push({
                symbol: sym, candles: 0, periodOpen: 0, periodHigh: 0,
                periodLow: 0, periodClose: 0, totalVolume: 0, change: 0,
                status: "error", error: msg,
              });
            }
          });

          setMultiProgress(i + batch.length);
          setMultiResults([...accumulated]);
          if (i + CONCURRENCY < filledPairs.length)
            await new Promise((r) => setTimeout(r, 120));
        }

        setCurrentSym("");
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setFetchLoading(false);
    }
  }, [mode, symbol, barLength, dateRange.start, dateRange.end, filledPairs, dataSource]);

  // ── Select pair (multi → chart) ───────────────────────────────────────────
  const handleSelectPair = useCallback((sym: string) => {
    setActivePair(sym);
    const found = multiResults.find((r) => r.symbol === sym);
    if (found?.klines) setActiveKlines(found.klines);
  }, [multiResults]);

  // ── Save to Supabase ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const okSymbols = mode === "single"
      ? [symbol]
      : multiResults.filter((r) => r.status === "ok").map((r) => r.symbol);

    const tagged = mode === "single"
      ? singleKlines.map((k) => ({ ...k, _symbol: symbol }))
      : multiResults.flatMap((r) =>
          (r.klines ?? []).map((k) => ({ ...k, _symbol: r.symbol }))
        );

    if (tagged.length === 0) return;
    setSaving(true);
    setSaveMsg(null);

    const CHUNK = 500;
    let sessionId: string | null = null;
    let totalSaved = 0;

    try {
      for (let i = 0; i < tagged.length; i += CHUNK) {
        const chunk = tagged.slice(i, i + CHUNK);
        const body: Record<string, unknown> = {
          candles: chunk.map((k) => ({
            symbol:     k._symbol,
            open_time:  k.openTime,
            open:       k.open,
            high:       k.high,
            low:        k.low,
            close:      k.close,
            volume:     k.volume,
            close_time: k.closeTime,
          })),
          interval: barLength,
        };
        if (!sessionId) {
          body.mode      = `${dataSource}-${mode}`;
          body.symbols   = okSymbols;
          body.startDate = startDate || null;
          body.endDate   = endDate   || null;
        } else {
          body.sessionId = sessionId;
        }

        const res = await fetch("/api/supabase/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body:   JSON.stringify(body),
        });

        let data: Record<string, unknown>;
        try { data = await res.json(); }
        catch { throw new Error(`HTTP ${res.status}: ${res.statusText}`); }
        if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);

        if (!sessionId) sessionId = data.sessionId as string;
        totalSaved += data.saved as number;
        setSaveMsg(`Saving… ${totalSaved.toLocaleString()} / ${tagged.length.toLocaleString()} candles`);
      }
      setSaveMsg(`✓ Saved ${totalSaved.toLocaleString()} candles (session ${(sessionId ?? "").slice(0, 8)}…)`);
    } catch (e) {
      setSaveMsg(`✗ ${e instanceof Error ? e.message : "Save failed"}`);
    } finally {
      setSaving(false);
    }
  }, [mode, symbol, barLength, startDate, endDate, singleKlines, multiResults, dataSource]);

  // ── Analyze ───────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalysisResult(null);

    try {
      let allBars: EnrichedBar[] = [];

      if (mode === "single") {
        if (singleKlines.length === 0) throw new Error("No klines loaded");

        // For single mode: also fetch funding + OI for richer analysis
        let funding: FundingRate[] = [];
        let oi: OIRecord[] = [];

        if (dataSource === "futures") {
          const [fundRes, oiRes] = await Promise.allSettled([
            fetch(`/api/futures/funding?symbol=${symbol}&limit=1000${dateRange.start ? `&startTime=${dateRange.start}` : ""}${dateRange.end ? `&endTime=${dateRange.end}` : ""}`).then((r) => r.json()),
            fetch(`/api/futures/oi?symbol=${symbol}&interval=${barLength}&limit=500${dateRange.start ? `&startTime=${dateRange.start}` : ""}${dateRange.end ? `&endTime=${dateRange.end}` : ""}`).then((r) => r.json()),
          ]);
          if (fundRes.status === "fulfilled") funding = fundRes.value.rates ?? [];
          if (oiRes.status === "fulfilled")   oi      = oiRes.value.records ?? [];
        }

        const bars = computeIndicators(singleKlines, funding, oi);
        tagSymbol(bars, symbol);
        allBars = bars;

      } else {
        // Multi mode: compute indicators per pair (no funding/OI to keep it fast)
        for (const r of multiResults) {
          if (r.status !== "ok" || !r.klines || r.klines.length === 0) continue;
          const bars = computeIndicators(r.klines, [], []);
          tagSymbol(bars, r.symbol);
          allBars.push(...bars);
        }
      }

      if (allBars.length < 30) throw new Error("Not enough bars for analysis (need ≥ 30)");

      const result = analyzeEnrichedBars(allBars);
      setEnrichedBars(allBars);
      setAnalysisResult(result);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [mode, symbol, barLength, singleKlines, multiResults, dataSource, dateRange.start, dateRange.end]);

  // ── Load sessions ─────────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    const res  = await fetch("/api/supabase/sessions");
    const data = await res.json();
    if (res.ok) setSessions(data.sessions ?? []);
  }, []);

  useEffect(() => {
    if (showHistory && supabaseEnabled) loadSessions();
  }, [showHistory, supabaseEnabled, loadSessions]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const chartKlines  = mode === "single" ? singleKlines : activeKlines;
  const chartSymbol  = mode === "single" ? symbol       : activePair;
  const hasResults   = mode === "single" ? singleKlines.length > 0 : multiResults.length > 0;
  const canFetch     = mode === "single" || filledPairs.length > 0;
  const canSave      = supabaseEnabled && hasResults && !fetchLoading;
  const canAnalyze   = hasResults && !fetchLoading && !analyzing;

  const lastK        = singleKlines[singleKlines.length - 1];
  const lastPrice    = lastK ? parseFloat(lastK.close) : null;
  const prevK        = singleKlines[singleKlines.length - 2];
  const priceDelta   = lastPrice && prevK
    ? ((lastPrice - parseFloat(prevK.close)) / parseFloat(prevK.close)) * 100
    : 0;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-binance-dark text-binance-text flex flex-col">

      {/* ══ Header ════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-binance-border bg-binance-card">
        <div className="flex items-center gap-3">
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
            <path d="M16 0L19.7 3.7L9.7 13.7L6 10L16 0Z" fill="#F0B90B"/>
            <path d="M22 6L25.7 9.7L9.7 25.7L6 22L22 6Z" fill="#F0B90B"/>
            <path d="M3.7 12.3L7.4 16L3.7 19.7L0 16L3.7 12.3Z" fill="#F0B90B"/>
            <path d="M28.3 12.3L32 16L28.3 19.7L24.6 16L28.3 12.3Z" fill="#F0B90B"/>
            <path d="M9.7 18.3L13.4 22L16 24.6L18.6 22L22.3 18.3L26 22L16 32L6 22L9.7 18.3Z" fill="#F0B90B"/>
          </svg>
          <span className="text-white font-bold text-lg tracking-wide">Binance OHLCV</span>
          {/* Data source badge */}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            dataSource === "futures"
              ? "bg-binance-yellow/20 text-binance-yellow"
              : "bg-binance-border text-binance-muted"
          }`}>
            {dataSource === "futures" ? "FUTURES (USDT-M)" : "SPOT"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {supabaseEnabled && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition ${
                showHistory
                  ? "bg-binance-yellow text-binance-dark"
                  : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
              }`}
            >
              📂 History
            </button>
          )}
        </div>
      </header>

      {/* ══ Config panel ══════════════════════════════════════════════════ */}
      <div className="px-6 py-5 border-b border-binance-border bg-binance-card">
        <div className="flex flex-wrap items-end gap-5">

          {/* Data source toggle */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Data Source</label>
            <div className="flex rounded overflow-hidden border border-binance-border">
              {(["futures", "spot"] as const).map((src) => (
                <button
                  key={src}
                  onClick={() => {
                    setDataSource(src);
                    setFilledPairs([]);
                    setMultiResults([]);
                    setSingleKlines([]);
                    setAnalysisResult(null);
                  }}
                  className={`px-4 py-2 text-sm font-medium transition ${
                    dataSource === src
                      ? "bg-binance-yellow text-binance-dark"
                      : "bg-binance-dark text-binance-text hover:bg-binance-border"
                  }`}
                >
                  {src === "futures" ? "Futures" : "Spot"}
                </button>
              ))}
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Mode</label>
            <div className="flex rounded overflow-hidden border border-binance-border">
              {(["single", "multi"] as const).map((m) => (
                <button key={m} onClick={() => { setMode(m); setFetchError(null); setAnalysisResult(null); }}
                  className={`px-4 py-2 text-sm font-medium transition ${
                    mode === m
                      ? "bg-binance-yellow text-binance-dark"
                      : "bg-binance-dark text-binance-text hover:bg-binance-border"
                  }`}
                >
                  {m === "single" ? "Single Pair" : "Top N Pairs"}
                </button>
              ))}
            </div>
          </div>

          {/* Single: pair search */}
          {mode === "single" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Pair</label>
              <PairSearch value={symbol} onChange={(s) => { setSymbol(s); setAnalysisResult(null); }} />
            </div>
          )}

          {/* Multi: top-N + quote + fill */}
          {mode === "multi" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Top N pairs</label>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {QUOTES.map((q) => (
                    <button key={q} onClick={() => setQuote(q)}
                      className={`px-2.5 py-1.5 text-xs rounded font-medium transition ${
                        quote === q
                          ? "bg-binance-yellow text-binance-dark"
                          : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                      }`}
                    >{q}</button>
                  ))}
                </div>
                <input
                  type="number" min="1" value={topNInput}
                  onChange={(e) => setTopNInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFill()}
                  placeholder="e.g. 50"
                  className="w-24 bg-binance-dark border border-binance-border rounded px-3 py-1.5 text-sm text-white outline-none focus:border-binance-yellow transition"
                />
                <button onClick={handleFill} disabled={fillLoading}
                  className="px-3 py-1.5 bg-binance-border text-binance-text text-sm font-medium rounded hover:bg-[#414d5c] disabled:opacity-50 transition flex items-center gap-1.5"
                >
                  {fillLoading
                    ? <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg>Filling…</>
                    : "▼ Fill"}
                </button>
              </div>
              {fillError && <p className="text-xs text-binance-red">{fillError}</p>}
            </div>
          )}

          {/* Date range */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Date range</label>
            <div className="flex items-center gap-2">
              <input type="date" max={endDate || today} value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-binance-dark border border-binance-border rounded px-2.5 py-1.5 text-sm text-binance-text focus:border-binance-yellow outline-none transition [color-scheme:dark]"
              />
              <span className="text-binance-muted text-sm">→</span>
              <input type="date" min={startDate} max={today} value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-binance-dark border border-binance-border rounded px-2.5 py-1.5 text-sm text-binance-text focus:border-binance-yellow outline-none transition [color-scheme:dark]"
              />
              {(startDate || endDate) && (
                <button onClick={() => { setStartDate(""); setEndDate(""); }} className="text-binance-muted hover:text-binance-red transition">✕</button>
              )}
            </div>
            <p className="text-[11px] text-binance-muted">
              {startDate || endDate ? "Auto-paginated — all candles fetched" : "Leave empty for most recent data"}
            </p>
          </div>

          {/* Bar length */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Bar length</label>
            <div className="flex flex-wrap gap-1">
              {INTERVALS.map((iv) => (
                <button key={iv} onClick={() => setBarLength(iv)}
                  className={`px-2.5 py-1.5 text-xs rounded font-medium transition ${
                    barLength === iv
                      ? "bg-binance-yellow text-binance-dark"
                      : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                  }`}
                >{iv}</button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5 ml-auto">
            <label className="text-xs opacity-0 select-none">action</label>
            <div className="flex gap-2">
              <button
                onClick={handleFetch}
                disabled={fetchLoading || !canFetch}
                className="flex items-center gap-2 px-5 py-2 bg-binance-yellow text-binance-dark text-sm font-bold rounded hover:opacity-90 disabled:opacity-40 transition"
              >
                {fetchLoading
                  ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg>Fetching…</>
                  : "⚡ Fetch"}
              </button>

              {canAnalyze && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-bold rounded hover:bg-purple-500 disabled:opacity-50 transition"
                >
                  {analyzing
                    ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg>Analyzing…</>
                    : "🔬 Analyze"}
                </button>
              )}

              {canSave && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-binance-green text-white text-sm font-bold rounded hover:opacity-90 disabled:opacity-50 transition"
                >
                  {saving ? "Saving…" : "💾 Save"}
                </button>
              )}
            </div>
            {saveMsg && (
              <p className={`text-xs mt-0.5 ${saveMsg.startsWith("✓") ? "text-binance-green" : "text-binance-red"}`}>
                {saveMsg}
              </p>
            )}
            {analyzeError && (
              <p className="text-xs mt-0.5 text-binance-red">✗ {analyzeError}</p>
            )}
          </div>
        </div>

        {/* Filled pairs chips */}
        {mode === "multi" && filledPairs.length > 0 && (
          <div className="mt-4 pt-4 border-t border-binance-border">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs text-binance-muted">
                <span className="text-white font-semibold">{filledPairs.length}</span> pairs filled · click × to remove
              </span>
              <button onClick={() => { setFilledPairs([]); setMultiResults([]); setAnalysisResult(null); }}
                className="ml-auto text-xs text-binance-muted hover:text-binance-red transition"
              >Clear all</button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {filledPairs.map((p) => {
                const chg  = parseFloat(p.priceChangePercent);
                const isUp = chg >= 0;
                return (
                  <div key={p.symbol}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${
                      p.symbol === activePair
                        ? "bg-binance-yellow/20 border-binance-yellow text-binance-yellow"
                        : "bg-binance-border/60 border-binance-border text-binance-text"
                    }`}
                  >
                    <button onClick={() => handleSelectPair(p.symbol)} className="hover:underline">
                      {p.symbol.replace(new RegExp(`${quote}$`), "")}
                    </button>
                    <span className={`text-[10px] ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                      {isUp ? "+" : ""}{chg.toFixed(1)}%
                    </span>
                    <button
                      onClick={() => setFilledPairs((prev) => prev.filter((x) => x.symbol !== p.symbol))}
                      className="text-binance-muted hover:text-binance-red transition ml-0.5"
                    >×</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══ Error ═════════════════════════════════════════════════════════ */}
      {fetchError && (
        <div className="mx-6 mt-4 px-4 py-3 bg-binance-red/20 border border-binance-red/40 text-binance-red rounded-lg text-sm">
          ⚠ {fetchError}
        </div>
      )}

      {/* ══ Main content ══════════════════════════════════════════════════ */}
      <div className="flex-1 px-6 py-5 flex flex-col gap-0">

        {/* Single mode: live progress */}
        {mode === "single" && fetchLoading && (
          <div className="mb-3 flex items-center gap-3 text-sm text-binance-muted">
            <svg className="animate-spin w-4 h-4 text-binance-yellow flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
            </svg>
            Fetching <span className="text-white font-mono">{symbol}</span>
            {dataSource === "futures" && <span className="text-binance-yellow text-xs ml-1">[FUTURES]</span>}
            · <span className="text-white">{singleFetched.toLocaleString()}</span> candles so far…
          </div>
        )}

        {/* Price banner (single mode) */}
        {mode === "single" && lastPrice !== null && (
          <div className="mb-4 flex flex-wrap items-center gap-4 px-4 py-3 bg-binance-card border border-binance-border rounded-xl">
            <span className="text-xl font-bold text-white">
              {symbol.replace(/^(.+?)(USDT|BTC|ETH|BNB|BUSD|FDUSD)$/, "$1 / $2")}
            </span>
            <span className={`text-xl font-mono font-bold ${priceDelta >= 0 ? "text-binance-green" : "text-binance-red"}`}>
              {lastPrice >= 1 ? lastPrice.toFixed(2) : lastPrice.toFixed(6)}
            </span>
            <span className={`text-sm font-semibold px-2 py-0.5 rounded ${priceDelta >= 0 ? "bg-binance-green/20 text-binance-green" : "bg-binance-red/20 text-binance-red"}`}>
              {priceDelta >= 0 ? "▲" : "▼"} {Math.abs(priceDelta).toFixed(2)}%
            </span>
            {lastK && (
              <div className="flex gap-4 text-xs text-binance-muted">
                <span>O: <span className="text-white">{parseFloat(lastK.open).toLocaleString()}</span></span>
                <span>H: <span className="text-binance-green">{parseFloat(lastK.high).toLocaleString()}</span></span>
                <span>L: <span className="text-binance-red">{parseFloat(lastK.low).toLocaleString()}</span></span>
                <span>V: <span className="text-white">{parseFloat(lastK.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></span>
              </div>
            )}
            <span className="ml-auto text-xs text-binance-muted">
              {singleKlines.length.toLocaleString()} candles · {barLength}
              {dataSource === "futures" && <span className="ml-2 text-binance-yellow">PERP</span>}
              {(startDate || endDate) && <span className="ml-2 text-binance-yellow">📅 {startDate || "…"} → {endDate || "now"}</span>}
            </span>
          </div>
        )}

        {/* Active pair banner (multi mode) */}
        {mode === "multi" && activePair && activeKlines.length > 0 && (
          <div className="mb-3 flex items-center gap-3 px-4 py-2 bg-binance-card border border-binance-border rounded-xl text-sm">
            <span className="font-bold text-white">{activePair}</span>
            <span className="text-binance-muted">· {activeKlines.length.toLocaleString()} candles · {barLength}</span>
            <button onClick={() => { setActivePair(""); setActiveKlines([]); }}
              className="ml-auto text-xs text-binance-muted hover:text-binance-red"
            >✕ Close chart</button>
          </div>
        )}

        {/* Chart */}
        {chartKlines.length > 0 && (
          <div className="mb-4 bg-binance-card border border-binance-border rounded-xl p-4">
            <CandlestickChart klines={chartKlines} symbol={chartSymbol} interval={barLength} />
          </div>
        )}

        {/* Single: candles table */}
        {mode === "single" && <CandlesTable klines={singleKlines} symbol={symbol} interval={barLength} />}

        {/* Multi: pairs result table */}
        {mode === "multi" && (multiResults.length > 0 || fetchLoading) && (
          <PairsResultTable
            results={multiResults}
            quote={quote}
            activePair={activePair}
            onSelect={handleSelectPair}
            loading={fetchLoading}
            progress={multiProgress}
            total={multiTotal}
            currentSymbol={currentSym}
          />
        )}

        {/* Analysis panel */}
        {analysisResult && (
          <AnalysisPanel
            result={analysisResult}
            bars={enrichedBars}
            klines={mode === "single" ? singleKlines : activeKlines}
            symbol={mode === "single" ? symbol : (activePair || `${multiResults.filter((r) => r.status === "ok").length} pairs`)}
            interval={barLength}
          />
        )}

        {/* Empty state */}
        {!fetchLoading && !hasResults && (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-binance-muted gap-3">
            <span className="text-5xl">📊</span>
            <p className="text-base">
              {mode === "single"
                ? <>Select a pair, set a date range, and click <strong className="text-white">⚡ Fetch</strong>.</>
                : filledPairs.length === 0
                  ? <>Enter a count, click <strong className="text-white">▼ Fill</strong>, then <strong className="text-white">⚡ Fetch</strong>.</>
                  : <>{filledPairs.length} pairs ready — click <strong className="text-white">⚡ Fetch</strong> to load OHLCV.</>
              }
            </p>
            <p className="text-xs">
              Then click <strong className="text-purple-400">🔬 Analyze</strong> to compute indicators and find patterns.
            </p>
          </div>
        )}
      </div>

      {/* ══ Supabase history ══════════════════════════════════════════════ */}
      {showHistory && supabaseEnabled && (
        <div className="mx-6 mb-6 bg-binance-card border border-binance-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-binance-border flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Saved Sessions</span>
            <button onClick={loadSessions} className="text-xs text-binance-muted hover:text-white transition">↻ Refresh</button>
          </div>
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-binance-muted text-sm">No saved sessions yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-binance-border text-binance-muted uppercase tracking-wider">
                    <th className="text-left px-4 py-2 font-medium">Date</th>
                    <th className="text-left px-4 py-2 font-medium">Mode</th>
                    <th className="text-left px-4 py-2 font-medium">Pairs</th>
                    <th className="text-left px-4 py-2 font-medium">Interval</th>
                    <th className="text-right px-4 py-2 font-medium">Candles</th>
                    <th className="text-left px-4 py-2 font-medium">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-binance-border/40 hover:bg-binance-border/20">
                      <td className="px-4 py-2 text-binance-muted">{new Date(s.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2 capitalize">{s.mode}</td>
                      <td className="px-4 py-2 text-white">{s.symbols.slice(0, 3).join(", ")}{s.symbols.length > 3 ? ` +${s.symbols.length - 3}` : ""}</td>
                      <td className="px-4 py-2">{s.interval}</td>
                      <td className="px-4 py-2 text-right font-mono">{s.total_candles.toLocaleString()}</td>
                      <td className="px-4 py-2 text-binance-muted">{s.start_date ?? "—"} → {s.end_date ?? "now"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <footer className="text-center text-xs text-binance-muted pb-4">
        Binance OHLCV Explorer · Futures &amp; Spot · Strategy Analysis
      </footer>
    </div>
  );
}
