"use client";

import { useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FilledPair {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
}

interface PairResult {
  symbol: string;
  candles: number;
  periodOpen: number;
  periodHigh: number;
  periodLow: number;
  periodClose: number;
  totalVolume: number;
  change: number;
  status: "ok" | "error";
  error?: string;
}

type ResultSortKey = "symbol" | "change" | "periodClose" | "totalVolume" | "candles" | "periodHigh" | "periodLow";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const QUOTE_OPTIONS = ["USDT", "BTC", "ETH", "BNB", "FDUSD"];
const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w"];

function fmtPrice(n: number): string {
  if (n === 0) return "—";
  if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)     return n.toFixed(4);
  return n.toFixed(6);
}

function fmtVol(n: number): string {
  if (n === 0) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(3) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(3) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

// Auto-paginate klines until we have all candles in the date range
async function fetchAllKlines(
  symbol: string,
  barLength: string,
  startTime?: number,
  endTime?: number
): Promise<Kline[]> {
  const all: Kline[] = [];
  let cursor = startTime;
  const MAX_CANDLES = 50_000; // safety cap

  while (all.length < MAX_CANDLES) {
    const params = new URLSearchParams({ symbol, interval: barLength, limit: "1000" });
    if (cursor)   params.set("startTime", String(cursor));
    if (endTime)  params.set("endTime",   String(endTime));

    const res  = await fetch(`/api/klines?${params}`);
    const data = await res.json();
    const batch: Kline[] = data.klines ?? [];

    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 1000) break; // last page

    cursor = batch[batch.length - 1].closeTime + 1;
    if (endTime && cursor >= endTime) break;

    // brief pause between pages to be polite to the API
    await new Promise((r) => setTimeout(r, 80));
  }

  return all;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  onSelectPair: (symbol: string) => void;
  activePair: string;
}

export default function TopPairsTab({ onSelectPair, activePair }: Props) {
  // Config
  const [quote, setQuote]         = useState("USDT");
  const [topNInput, setTopNInput] = useState("50");
  const [barLength, setBarLength] = useState("1h");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");

  // Fill state
  const [filledPairs, setFilledPairs]   = useState<FilledPair[]>([]);
  const [fillLoading, setFillLoading]   = useState(false);
  const [fillError, setFillError]       = useState<string | null>(null);

  // Fetch state
  const [results, setResults]               = useState<PairResult[]>([]);
  const [fetchLoading, setFetchLoading]     = useState(false);
  const [fetchProgress, setFetchProgress]   = useState(0);
  const [fetchTotal, setFetchTotal]         = useState(0);
  const [currentSymbol, setCurrentSymbol]   = useState("");

  // Results table sort
  const [sortKey, setSortKey]   = useState<ResultSortKey>("totalVolume");
  const [sortAsc, setSortAsc]   = useState(false);

  // ── Fill ──────────────────────────────────────────────────────────────────

  const handleFill = useCallback(async () => {
    const n = parseInt(topNInput, 10);
    if (isNaN(n) || n < 1) return;

    setFillLoading(true);
    setFillError(null);
    setResults([]);

    try {
      const res  = await fetch(`/api/top-pairs?quote=${quote}&limit=${n}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch pairs");
      setFilledPairs(data.pairs);
    } catch (e) {
      setFillError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setFillLoading(false);
    }
  }, [quote, topNInput]);

  const removePair = (symbol: string) =>
    setFilledPairs((prev) => prev.filter((p) => p.symbol !== symbol));

  const clearAll = () => { setFilledPairs([]); setResults([]); };

  // ── Fetch OHLCV ───────────────────────────────────────────────────────────

  const handleFetch = useCallback(async () => {
    if (filledPairs.length === 0) return;

    setFetchLoading(true);
    setFetchProgress(0);
    setFetchTotal(filledPairs.length);
    setResults([]);

    const startTime = startDate ? new Date(startDate).getTime()                 : undefined;
    const endTime   = endDate   ? new Date(endDate + "T23:59:59").getTime()     : undefined;

    const CONCURRENCY = 5;
    const accumulated: PairResult[] = [];

    for (let i = 0; i < filledPairs.length; i += CONCURRENCY) {
      const batch = filledPairs.slice(i, i + CONCURRENCY);

      const settled = await Promise.allSettled(
        batch.map((p) => fetchAllKlines(p.symbol, barLength, startTime, endTime))
      );

      settled.forEach((result, idx) => {
        const sym = batch[idx].symbol;

        if (result.status === "fulfilled" && result.value.length > 0) {
          const klines      = result.value;
          const periodOpen  = parseFloat(klines[0].open);
          const periodClose = parseFloat(klines[klines.length - 1].close);
          const periodHigh  = Math.max(...klines.map((k) => parseFloat(k.high)));
          const periodLow   = Math.min(...klines.map((k) => parseFloat(k.low)));
          const totalVolume = klines.reduce((s, k) => s + parseFloat(k.volume), 0);
          const change      = ((periodClose - periodOpen) / periodOpen) * 100;

          accumulated.push({
            symbol: sym, candles: klines.length,
            periodOpen, periodHigh, periodLow, periodClose,
            totalVolume, change, status: "ok",
          });
        } else {
          const msg = result.status === "rejected"
            ? String(result.reason)
            : "No data returned";
          accumulated.push({
            symbol: sym, candles: 0,
            periodOpen: 0, periodHigh: 0, periodLow: 0, periodClose: 0,
            totalVolume: 0, change: 0,
            status: "error", error: msg,
          });
        }
      });

      setFetchProgress(i + batch.length);
      setCurrentSymbol(batch[batch.length - 1].symbol);
      // snapshot results as they arrive so user sees live updates
      setResults([...accumulated]);

      if (i + CONCURRENCY < filledPairs.length) await new Promise((r) => setTimeout(r, 120));
    }

    setCurrentSymbol("");
    setFetchLoading(false);
  }, [filledPairs, barLength, startDate, endDate]);

  // ── Sort helpers ──────────────────────────────────────────────────────────

  const toggleSort = (key: ResultSortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === "symbol"); }
  };

  const sortedResults = [...results].sort((a, b) => {
    if (sortKey === "symbol") {
      return sortAsc
        ? a.symbol.localeCompare(b.symbol)
        : b.symbol.localeCompare(a.symbol);
    }
    const av = a[sortKey] as number;
    const bv = b[sortKey] as number;
    return sortAsc ? av - bv : bv - av;
  });

  const SortTh = ({ col, label, className = "" }: { col: ResultSortKey; label: string; className?: string }) => (
    <th
      className={`px-3 py-3 font-medium cursor-pointer select-none hover:text-white transition ${
        sortKey === col ? "text-binance-yellow" : "text-binance-muted"
      } ${className}`}
      onClick={() => toggleSort(col)}
    >
      <span className="flex items-center gap-1 justify-end">
        {label}
        <span className="text-[10px]">{sortKey === col ? (sortAsc ? "▲" : "▼") : "⇅"}</span>
      </span>
    </th>
  );

  const today = new Date().toISOString().split("T")[0];
  const progressPct = fetchTotal > 0 ? (fetchProgress / fetchTotal) * 100 : 0;
  const okCount  = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-0">

      {/* ══ Configuration panel ══════════════════════════════════════════ */}
      <div className="px-6 py-5 border-b border-binance-border bg-binance-dark/40 flex flex-wrap gap-6 items-end">

        {/* Quote */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Quote asset</label>
          <div className="flex gap-1">
            {QUOTE_OPTIONS.map((q) => (
              <button key={q} onClick={() => setQuote(q)}
                className={`px-3 py-1.5 text-xs rounded font-medium transition ${
                  quote === q
                    ? "bg-binance-yellow text-binance-dark"
                    : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                }`}
              >{q}</button>
            ))}
          </div>
        </div>

        {/* Top N */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Number of pairs</label>
          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              value={topNInput}
              onChange={(e) => setTopNInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFill()}
              placeholder="e.g. 200"
              className="w-28 bg-binance-dark border border-binance-border rounded px-3 py-1.5 text-sm text-white outline-none focus:border-binance-yellow transition"
            />
            <button
              onClick={handleFill}
              disabled={fillLoading}
              className="flex items-center gap-2 px-4 py-1.5 bg-binance-yellow text-binance-dark text-sm font-bold rounded hover:opacity-90 disabled:opacity-50 transition"
            >
              {fillLoading
                ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg> Filling…</>
                : "▼ Fill"}
            </button>
          </div>
          {fillError && <p className="text-xs text-binance-red mt-0.5">{fillError}</p>}
        </div>

        {/* Date range */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-binance-muted uppercase tracking-wider font-medium">Date range</label>
          <div className="flex items-center gap-2">
            <input type="date" max={endDate || today} value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-binance-dark border border-binance-border rounded px-2.5 py-1.5 text-sm text-binance-text focus:border-binance-yellow outline-none transition [color-scheme:dark]"
            />
            <span className="text-binance-muted">→</span>
            <input type="date" min={startDate} max={today} value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-binance-dark border border-binance-border rounded px-2.5 py-1.5 text-sm text-binance-text focus:border-binance-yellow outline-none transition [color-scheme:dark]"
            />
            {(startDate || endDate) && (
              <button onClick={() => { setStartDate(""); setEndDate(""); }}
                className="text-binance-muted hover:text-binance-red transition text-sm"
              >✕</button>
            )}
          </div>
          <p className="text-[11px] text-binance-muted">
            {!startDate && !endDate ? "Leave empty for most recent data" : "Full range fetched (auto-paginated)"}
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

        {/* Fetch button */}
        <div className="flex flex-col gap-1.5 ml-auto">
          <label className="text-xs text-binance-muted uppercase tracking-wider font-medium opacity-0 select-none">action</label>
          <button
            onClick={handleFetch}
            disabled={fetchLoading || filledPairs.length === 0}
            className="flex items-center gap-2 px-6 py-2 bg-binance-green text-white text-sm font-bold rounded hover:opacity-90 disabled:opacity-40 transition"
          >
            {fetchLoading ? (
              <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg>
              Fetching…</>
            ) : (
              <>⚡ Fetch OHLCV</>
            )}
          </button>
          {filledPairs.length === 0 && !fillLoading && (
            <p className="text-[11px] text-binance-muted">Fill pairs first</p>
          )}
        </div>
      </div>

      {/* ══ Filled pairs chips ═══════════════════════════════════════════ */}
      {filledPairs.length > 0 && (
        <div className="px-6 py-4 border-b border-binance-border bg-binance-dark/20">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm font-semibold text-white">
              {filledPairs.length} pairs filled
            </span>
            <span className="text-xs text-binance-muted">· click × to remove a pair</span>
            <button onClick={clearAll} className="ml-auto text-xs text-binance-muted hover:text-binance-red transition">
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {filledPairs.map((p) => {
              const chg  = parseFloat(p.priceChangePercent);
              const isUp = chg >= 0;
              return (
                <div
                  key={p.symbol}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                    p.symbol === activePair
                      ? "bg-binance-yellow/20 border-binance-yellow text-binance-yellow"
                      : "bg-binance-border/60 border-binance-border text-binance-text"
                  }`}
                >
                  <button onClick={() => onSelectPair(p.symbol)} className="hover:underline">
                    {p.symbol.replace(new RegExp(`${quote}$`), "")}
                  </button>
                  <span className={`text-[10px] ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                    {isUp ? "+" : ""}{chg.toFixed(1)}%
                  </span>
                  <button
                    onClick={() => removePair(p.symbol)}
                    className="text-binance-muted hover:text-binance-red transition ml-0.5"
                  >×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ Fetch progress ════════════════════════════════════════════════ */}
      {fetchLoading && (
        <div className="px-6 py-3 border-b border-binance-border bg-binance-dark/40">
          <div className="flex items-center justify-between mb-1.5 text-xs text-binance-muted">
            <span>
              Fetching <span className="text-white font-mono">{currentSymbol}</span>
              {" "}· {fetchProgress} / {fetchTotal} pairs
            </span>
            <span>{progressPct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-binance-border rounded-full overflow-hidden">
            <div
              className="h-full bg-binance-yellow rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* ══ Results summary bar ═══════════════════════════════════════════ */}
      {results.length > 0 && (
        <div className="px-6 py-2 border-b border-binance-border bg-binance-dark/20 flex items-center gap-4 text-xs">
          <span className="text-binance-muted">
            {fetchLoading ? "Loading…" : "Done ·"}
            {" "}<span className="text-binance-green font-medium">{okCount} OK</span>
            {errCount > 0 && <span className="text-binance-red font-medium"> · {errCount} failed</span>}
          </span>
          {!fetchLoading && (
            <span className="text-binance-muted">
              Date range: <span className="text-white">{startDate || "—"} → {endDate || "now"}</span>
              {" "}· Bar: <span className="text-white">{barLength}</span>
            </span>
          )}
        </div>
      )}

      {/* ══ Results table ════════════════════════════════════════════════ */}
      {results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-binance-border text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 text-binance-muted font-medium w-8">#</th>
                <SortTh col="symbol"      label="Pair"        className="text-left" />
                <SortTh col="periodOpen"  label="Open"        />
                <SortTh col="periodHigh"  label="High"        />
                <SortTh col="periodLow"   label="Low"         />
                <SortTh col="periodClose" label="Close"       />
                <SortTh col="change"      label="Change %"    />
                <SortTh col="totalVolume" label="Volume"      />
                <SortTh col="candles"     label="Candles"     />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((r, i) => {
                const isUp     = r.change >= 0;
                const isActive = r.symbol === activePair;
                const base     = r.symbol.replace(new RegExp(`${quote}$`), "");

                if (r.status === "error") {
                  return (
                    <tr key={r.symbol} className="border-b border-binance-border/40 opacity-50">
                      <td className="px-4 py-2.5 text-binance-muted text-xs">{i + 1}</td>
                      <td className="px-3 py-2.5 font-semibold text-binance-text">{base}<span className="text-binance-muted">/{quote}</span></td>
                      <td colSpan={7} className="px-3 py-2.5 text-xs text-binance-red">{r.error ?? "Error"}</td>
                      <td />
                    </tr>
                  );
                }

                return (
                  <tr
                    key={r.symbol}
                    onClick={() => onSelectPair(r.symbol)}
                    className={`border-b border-binance-border/40 cursor-pointer transition hover:bg-binance-border/20 ${
                      isActive ? "bg-binance-yellow/10 border-l-2 border-l-binance-yellow" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 text-binance-muted text-xs">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-binance-border flex items-center justify-center text-[10px] font-bold text-binance-yellow flex-shrink-0">
                          {base.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-semibold text-white text-sm">{base}</div>
                          <div className="text-[11px] text-binance-muted">{quote}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-text">{fmtPrice(r.periodOpen)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-green">{fmtPrice(r.periodHigh)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-red">{fmtPrice(r.periodLow)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                      {fmtPrice(r.periodClose)}
                    </td>
                    <td className={`px-3 py-2.5 text-right text-sm font-bold ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                      {isUp ? "+" : ""}{r.change.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-muted">{fmtVol(r.totalVolume)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-muted">{r.candles.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectPair(r.symbol); }}
                        className={`px-2.5 py-1 text-xs rounded font-medium transition whitespace-nowrap ${
                          isActive
                            ? "bg-binance-yellow text-binance-dark"
                            : "bg-binance-border text-binance-text hover:bg-binance-yellow hover:text-binance-dark"
                        }`}
                      >
                        Chart
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {filledPairs.length === 0 && !fillLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-binance-muted gap-3">
          <span className="text-4xl">📊</span>
          <p className="text-sm">Enter a number of pairs, choose a quote asset, then click <strong className="text-white">▼ Fill</strong>.</p>
        </div>
      )}

      {filledPairs.length > 0 && results.length === 0 && !fetchLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-binance-muted gap-3">
          <span className="text-3xl">⚡</span>
          <p className="text-sm">
            {filledPairs.length} pairs ready. Set a date range &amp; bar length, then click{" "}
            <strong className="text-white">Fetch OHLCV</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
