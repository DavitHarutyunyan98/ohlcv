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

const QUOTE_OPTIONS = ["USDT", "BTC", "ETH", "BNB"];
const TOP_N_OPTIONS = [10, 20, 50, 100];

export default function TopPairsTable({ quote: initialQuote, topN: initialTopN, onSelectPair, activePair }: Props) {
  const [pairs, setPairs]       = useState<Ticker24hr[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [sortKey, setSortKey]   = useState<SortKey>("quoteVolume");
  const [sortAsc, setSortAsc]   = useState(false);
  const [quote, setQuote]       = useState(initialQuote);
  const [topN, setTopN]         = useState(initialTopN);
  const [search, setSearch]     = useState("");

  const fetchPairs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/top-pairs?quote=${quote}&limit=${topN}`);
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
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-binance-border">
        {/* Quote filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-binance-muted uppercase tracking-wider">Quote</span>
          <div className="flex gap-1">
            {QUOTE_OPTIONS.map((q) => (
              <button
                key={q}
                onClick={() => setQuote(q)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                  quote === q ? "bg-binance-yellow text-binance-dark" : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Top N */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-binance-muted uppercase tracking-wider">Show</span>
          <div className="flex gap-1">
            {TOP_N_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setTopN(n)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                  topN === n ? "bg-binance-yellow text-binance-dark" : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                }`}
              >
                Top {n}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 bg-binance-dark border border-binance-border rounded px-2.5 py-1.5 ml-auto">
          <svg className="w-3.5 h-3.5 text-binance-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            className="bg-transparent text-sm text-white outline-none w-32 placeholder:text-binance-muted"
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button
          onClick={fetchPairs}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-binance-yellow text-binance-dark text-xs font-semibold rounded hover:opacity-90 disabled:opacity-50 transition"
        >
          {loading ? "…" : "↻"} Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-binance-red/20 border border-binance-red/40 text-binance-red rounded text-sm">
          ⚠ {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-binance-border text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 text-binance-muted font-medium">#</th>
              <th className="text-left px-4 py-3 text-binance-muted font-medium">Pair</th>
              <th className="text-right px-4 py-3 font-medium">
                <SortBtn col="lastPrice" label="Price" />
              </th>
              <th className="text-right px-4 py-3 font-medium">
                <SortBtn col="priceChangePercent" label="24h %" />
              </th>
              <th className="text-right px-4 py-3 font-medium text-binance-muted hidden md:table-cell">24h High</th>
              <th className="text-right px-4 py-3 font-medium text-binance-muted hidden md:table-cell">24h Low</th>
              <th className="text-right px-4 py-3 font-medium">
                <SortBtn col="quoteVolume" label="Volume" />
              </th>
              <th className="text-right px-4 py-3 font-medium">
                <SortBtn col="count" label="Trades" />
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && pairs.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-16 text-binance-muted">
                  <svg className="animate-spin w-6 h-6 text-binance-yellow mx-auto mb-2" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                  </svg>
                  Loading top pairs…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-16 text-binance-muted">No pairs found</td>
              </tr>
            ) : (
              sorted.map((p, i) => {
                const chg = parseFloat(p.priceChangePercent);
                const isUp = chg >= 0;
                const base = p.symbol.replace(quote, "");
                const isActive = p.symbol === activePair;

                return (
                  <tr
                    key={p.symbol}
                    onClick={() => onSelectPair(p.symbol)}
                    className={`border-b border-binance-border/40 cursor-pointer transition hover:bg-binance-border/30 ${
                      isActive ? "bg-binance-yellow/10 border-l-2 border-l-binance-yellow" : ""
                    }`}
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
                    <td className="px-4 py-2.5 text-right font-mono text-white">
                      {fmtPrice(p.lastPrice)}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold text-sm ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                      {isUp ? "+" : ""}{chg.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-binance-green hidden md:table-cell font-mono">
                      {fmtPrice(p.highPrice)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-binance-red hidden md:table-cell font-mono">
                      {fmtPrice(p.lowPrice)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-binance-muted font-mono">
                      {fmtVol(p.quoteVolume)} {quote}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-binance-muted font-mono">
                      {p.count.toLocaleString()}
                    </td>
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

      <div className="px-4 py-2 text-xs text-binance-muted border-t border-binance-border">
        {sorted.length} pairs · click any row to view chart
      </div>
    </div>
  );
}
