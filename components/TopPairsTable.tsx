"use client";

import { useState, useEffect, useCallback } from "react";

export interface Ticker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  count: number;
}

interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

type SortKey = "quoteVolume" | "priceChangePercent" | "lastPrice" | "count";

interface Props {
  quote: string;
  topN: number;
  onSelectPair: (symbol: string) => void;
  activePair: string;
}

function fmtPrice(s: string): string {
  const n = parseFloat(s);
  if (isNaN(n)) return "-";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  return n.toFixed(6);
}

function fmtVol(s: string): string {
  const n = parseFloat(s);
  if (isNaN(n)) return "-";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

const QUOTE_OPTIONS  = ["USDT", "BTC", "ETH", "BNB"];
const TOP_N_OPTIONS  = [10, 20, 50, 100];
const OHLCV_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

export default function TopPairsTable({ quote: initialQuote, topN: initialTopN, onSelectPair, activePair }: Props) {
  const [pairs, setPairs]           = useState<Ticker24hr[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [sortKey, setSortKey]       = useState<SortKey>("quoteVolume");
  const [sortAsc, setSortAsc]       = useState(false);
  const [quote, setQuote]           = useState(initialQuote);
  const [topN, setTopN]             = useState(initialTopN);
  const [search, setSearch]         = useState("");

  // Bulk OHLCV state
  const [ohlcvInterval, setOhlcvInterval]   = useState("1h");
  const [ohlcvData, setOhlcvData]           = useState<Map<string, Kline>>(new Map());
  const [bulkLoading, setBulkLoading]       = useState(false);
  const [bulkProgress, setBulkProgress]     = useState(0);
  const [bulkTotal, setBulkTotal]           = useState(0);
  const [bulkErrors, setBulkErrors]         = useState<string[]>([]);
  const showOhlcv = ohlcvData.size > 0;

  const fetchPairs = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Clear old OHLCV when top-pairs list changes
    setOhlcvData(new Map());
    try {
      const res  = await fetch(`/api/top-pairs?quote=${quote}&limit=${topN}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      setPairs(data.pairs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [quote, topN]);

  useEffect(() => { fetchPairs(); }, [fetchPairs]);

  // ── Bulk OHLCV fetch ────────────────────────────────────────────────────────
  const fetchBulkOhlcv = async () => {
    if (pairs.length === 0) return;
    setBulkLoading(true);
    setBulkProgress(0);
    setBulkTotal(pairs.length);
    setBulkErrors([]);
    setOhlcvData(new Map());

    const CONCURRENCY = 10; // batches to avoid hammering the server
    const results = new Map<string, Kline>();
    const errors: string[] = [];

    for (let i = 0; i < pairs.length; i += CONCURRENCY) {
      const batch = pairs.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((p) =>
          fetch(`/api/klines?symbol=${p.symbol}&interval=${ohlcvInterval}&limit=2`)
            .then((r) => r.json())
            .then((data) => ({ symbol: p.symbol, klines: data.klines as Kline[] }))
        )
      );

      settled.forEach((result, idx) => {
        const sym = batch[idx].symbol;
        if (result.status === "fulfilled" && result.value.klines?.length > 0) {
          // Use the second-to-last candle (last completed candle)
          const klines = result.value.klines;
          results.set(sym, klines[klines.length - 2] ?? klines[klines.length - 1]);
        } else {
          errors.push(sym);
        }
      });

      setBulkProgress(Math.min(i + CONCURRENCY, pairs.length));
      // Small pause between batches to be polite to the API
      if (i + CONCURRENCY < pairs.length) await new Promise((r) => setTimeout(r, 150));
    }

    setOhlcvData(new Map(results));
    setBulkErrors(errors);
    setBulkLoading(false);
  };

  // ── Sorting ─────────────────────────────────────────────────────────────────
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sorted = [...pairs]
    .filter((p) => !search || p.symbol.includes(search.toUpperCase()))
    .sort((a, b) => {
      const av = parseFloat(a[sortKey] as string);
      const bv = parseFloat(b[sortKey] as string);
      return sortAsc ? av - bv : bv - av;
    });

  const SortBtn = ({ col, label }: { col: SortKey; label: string }) => (
    <button
      onClick={() => toggleSort(col)}
      className={`flex items-center gap-1 hover:text-white transition ${
        sortKey === col ? "text-binance-yellow" : "text-binance-muted"
      }`}
    >
      {label}
      <span className="text-[10px]">{sortKey === col ? (sortAsc ? "▲" : "▼") : "⇅"}</span>
    </button>
  );

  return (
    <div>
      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-binance-border">
        {/* Quote */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-binance-muted uppercase tracking-wider">Quote</span>
          <div className="flex gap-1">
            {QUOTE_OPTIONS.map((q) => (
              <button key={q} onClick={() => setQuote(q)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                  quote === q ? "bg-binance-yellow text-binance-dark" : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                }`}
              >{q}</button>
            ))}
          </div>
        </div>

        {/* Top N */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-binance-muted uppercase tracking-wider">Show</span>
          <div className="flex gap-1">
            {TOP_N_OPTIONS.map((n) => (
              <button key={n} onClick={() => setTopN(n)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                  topN === n ? "bg-binance-yellow text-binance-dark" : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                }`}
              >Top {n}</button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 bg-binance-dark border border-binance-border rounded px-2.5 py-1.5 ml-auto">
          <svg className="w-3.5 h-3.5 text-binance-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            className="bg-transparent text-sm text-white outline-none w-28 placeholder:text-binance-muted"
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button onClick={fetchPairs} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-binance-border text-binance-text text-xs font-semibold rounded hover:bg-[#414d5c] disabled:opacity-50 transition"
        >
          {loading ? "…" : "↻"} Refresh
        </button>
      </div>

      {/* ── Bulk OHLCV bar ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-binance-border bg-binance-dark/60">
        <span className="text-xs text-binance-muted uppercase tracking-wider font-medium">Fetch OHLCV for all {pairs.length} pairs</span>

        <div className="flex gap-1">
          {OHLCV_INTERVALS.map((iv) => (
            <button key={iv} onClick={() => setOhlcvInterval(iv)}
              className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                ohlcvInterval === iv ? "bg-binance-yellow text-binance-dark" : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
              }`}
            >{iv}</button>
          ))}
        </div>

        <button
          onClick={fetchBulkOhlcv}
          disabled={bulkLoading || pairs.length === 0}
          className="flex items-center gap-2 px-4 py-1.5 bg-binance-yellow text-binance-dark text-xs font-bold rounded hover:opacity-90 disabled:opacity-50 transition"
        >
          {bulkLoading ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
              </svg>
              {bulkProgress}/{bulkTotal}
            </>
          ) : (
            <>⚡ Fetch {ohlcvInterval} OHLCV</>
          )}
        </button>

        {/* Progress bar */}
        {bulkLoading && (
          <div className="flex-1 min-w-[120px] h-1.5 bg-binance-border rounded-full overflow-hidden">
            <div
              className="h-full bg-binance-yellow rounded-full transition-all duration-300"
              style={{ width: `${(bulkProgress / bulkTotal) * 100}%` }}
            />
          </div>
        )}

        {showOhlcv && !bulkLoading && (
          <span className="text-xs text-binance-green">
            ✓ {ohlcvData.size} pairs loaded
            {bulkErrors.length > 0 && <span className="text-binance-red ml-2">· {bulkErrors.length} failed</span>}
          </span>
        )}

        {showOhlcv && (
          <button onClick={() => setOhlcvData(new Map())}
            className="text-xs text-binance-muted hover:text-binance-red transition"
          >✕ Clear</button>
        )}
      </div>

      {/* ── Error ─────────────────────────────────────────────── */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-binance-red/20 border border-binance-red/40 text-binance-red rounded text-sm">
          ⚠ {error}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-binance-border text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 text-binance-muted font-medium">#</th>
              <th className="text-left px-4 py-3 text-binance-muted font-medium">Pair</th>
              <th className="text-right px-4 py-3 font-medium"><SortBtn col="lastPrice" label="Price" /></th>
              <th className="text-right px-4 py-3 font-medium"><SortBtn col="priceChangePercent" label="24h %" /></th>
              <th className="text-right px-4 py-3 font-medium text-binance-muted hidden lg:table-cell">24h High</th>
              <th className="text-right px-4 py-3 font-medium text-binance-muted hidden lg:table-cell">24h Low</th>
              <th className="text-right px-4 py-3 font-medium"><SortBtn col="quoteVolume" label="Volume" /></th>

              {/* OHLCV columns — appear after bulk fetch */}
              {showOhlcv && <>
                <th className="text-right px-3 py-3 text-binance-yellow font-medium border-l border-binance-border whitespace-nowrap">
                  {ohlcvInterval} Open
                </th>
                <th className="text-right px-3 py-3 text-binance-green font-medium whitespace-nowrap">{ohlcvInterval} High</th>
                <th className="text-right px-3 py-3 text-binance-red font-medium whitespace-nowrap">{ohlcvInterval} Low</th>
                <th className="text-right px-3 py-3 text-binance-yellow font-medium whitespace-nowrap">{ohlcvInterval} Close</th>
                <th className="text-right px-3 py-3 text-binance-muted font-medium whitespace-nowrap">{ohlcvInterval} Vol</th>
              </>}

              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && pairs.length === 0 ? (
              <tr>
                <td colSpan={showOhlcv ? 12 : 8} className="text-center py-16 text-binance-muted">
                  <svg className="animate-spin w-6 h-6 text-binance-yellow mx-auto mb-2" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                  </svg>
                  Loading top pairs…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={showOhlcv ? 12 : 8} className="text-center py-16 text-binance-muted">No pairs found</td>
              </tr>
            ) : (
              sorted.map((p, i) => {
                const chg      = parseFloat(p.priceChangePercent);
                const isUp     = chg >= 0;
                const base     = p.symbol.replace(new RegExp(`${quote}$`), "");
                const isActive = p.symbol === activePair;
                const ohlcv    = ohlcvData.get(p.symbol);

                // Per-row OHLCV change
                const ohlcvChg = ohlcv
                  ? ((parseFloat(ohlcv.close) - parseFloat(ohlcv.open)) / parseFloat(ohlcv.open)) * 100
                  : null;

                return (
                  <tr
                    key={p.symbol}
                    onClick={() => onSelectPair(p.symbol)}
                    className={`border-b border-binance-border/40 cursor-pointer transition hover:bg-binance-border/30 ${
                      isActive ? "bg-binance-yellow/10 border-l-2 border-l-binance-yellow" : ""
                    } ${ohlcv && !isActive ? "bg-binance-card/50" : ""}`}
                  >
                    <td className="px-4 py-2.5 text-binance-muted text-xs">{i + 1}</td>
                    <td className="px-4 py-2.5">
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
                    <td className="px-4 py-2.5 text-right font-mono text-white">{fmtPrice(p.lastPrice)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold text-sm ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                      {isUp ? "+" : ""}{chg.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-binance-green hidden lg:table-cell font-mono">{fmtPrice(p.highPrice)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-binance-red hidden lg:table-cell font-mono">{fmtPrice(p.lowPrice)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-binance-muted font-mono">{fmtVol(p.quoteVolume)} {quote}</td>

                    {/* OHLCV columns */}
                    {showOhlcv && <>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-text border-l border-binance-border">
                        {ohlcv ? fmtPrice(ohlcv.open) : (
                          <span className="text-binance-border">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-green">
                        {ohlcv ? fmtPrice(ohlcv.high) : <span className="text-binance-border">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-red">
                        {ohlcv ? fmtPrice(ohlcv.low) : <span className="text-binance-border">—</span>}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${
                        ohlcvChg !== null ? (ohlcvChg >= 0 ? "text-binance-green" : "text-binance-red") : "text-binance-border"
                      }`}>
                        {ohlcv ? (
                          <span title={`${ohlcvChg !== null ? (ohlcvChg >= 0 ? "+" : "") + ohlcvChg.toFixed(2) + "%" : ""}`}>
                            {fmtPrice(ohlcv.close)}
                            {ohlcvChg !== null && (
                              <span className="ml-1 text-[10px] opacity-75">
                                {ohlcvChg >= 0 ? "▲" : "▼"}{Math.abs(ohlcvChg).toFixed(2)}%
                              </span>
                            )}
                          </span>
                        ) : <span className="text-binance-border">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-binance-muted">
                        {ohlcv ? fmtVol(ohlcv.volume) : <span className="text-binance-border">—</span>}
                      </td>
                    </>}

                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectPair(p.symbol); }}
                        className={`px-2.5 py-1 text-xs rounded font-medium transition ${
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
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 text-xs text-binance-muted border-t border-binance-border flex items-center justify-between">
        <span>{sorted.length} pairs · click any row to view chart</span>
        {showOhlcv && (
          <span className="text-binance-yellow">
            Showing last completed {ohlcvInterval} candle OHLCV
          </span>
        )}
      </div>
    </div>
  );
}
