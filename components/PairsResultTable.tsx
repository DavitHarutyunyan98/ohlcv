"use client";

import { useState, useMemo } from "react";
import Pagination from "./Pagination";
import type { PairResult } from "@/lib/types";

type SortKey = "symbol" | "change" | "periodOpen" | "periodClose" | "periodHigh" | "periodLow" | "totalVolume" | "candles";

interface Props {
  results: PairResult[];
  quote: string;
  activePair: string;
  onSelect: (symbol: string) => void;
  loading?: boolean;
  progress?: number;
  total?: number;
  currentSymbol?: string;
}

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

export default function PairsResultTable({
  results, quote, activePair, onSelect,
  loading, progress = 0, total = 0, currentSymbol = "",
}: Props) {
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortKey, setSortKey]   = useState<SortKey>("totalVolume");
  const [sortAsc, setSortAsc]   = useState(false);
  const [search, setSearch]     = useState("");

  const filtered = useMemo(() =>
    results.filter((r) => !search || r.symbol.includes(search.toUpperCase())),
  [results, search]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      if (sortKey === "symbol") return sortAsc
        ? a.symbol.localeCompare(b.symbol)
        : b.symbol.localeCompare(a.symbol);
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortAsc ? av - bv : bv - av;
    }),
  [filtered, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const slice      = sorted.slice((page - 1) * pageSize, page * pageSize);
  const pct        = total > 0 ? (progress / total) * 100 : 0;

  const toggle = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === "symbol"); }
    setPage(1);
  };

  const Th = ({ col, label, left = false }: { col: SortKey; label: string; left?: boolean }) => (
    <th
      onClick={() => toggle(col)}
      className={`px-3 py-3 text-xs uppercase tracking-wider font-medium cursor-pointer select-none hover:text-white transition ${
        sortKey === col ? "text-binance-yellow" : "text-binance-muted"
      } ${left ? "text-left" : "text-right"}`}
    >
      <span className={`flex items-center gap-1 ${left ? "" : "justify-end"}`}>
        {label}
        <span className="text-[10px]">{sortKey === col ? (sortAsc ? "▲" : "▼") : "⇅"}</span>
      </span>
    </th>
  );

  const okCount  = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="mt-4 bg-binance-card border border-binance-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-binance-border flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-white">
          Pairs Results
          {results.length > 0 && (
            <span className="ml-2 text-xs font-normal text-binance-muted">
              {okCount} OK{errCount > 0 && <span className="text-binance-red"> · {errCount} failed</span>}
            </span>
          )}
        </span>

        {/* Live progress */}
        {loading && (
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="flex-1 h-1.5 bg-binance-border rounded-full overflow-hidden">
              <div className="h-full bg-binance-yellow rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-binance-muted whitespace-nowrap">
              {progress}/{total}
              {currentSymbol && <span className="ml-1 text-white font-mono">{currentSymbol}</span>}
            </span>
          </div>
        )}

        {/* Search */}
        <div className="flex items-center gap-2 bg-binance-dark border border-binance-border rounded px-2.5 py-1.5 ml-auto">
          <svg className="w-3.5 h-3.5 text-binance-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            className="bg-transparent text-xs text-white outline-none w-24 placeholder:text-binance-muted"
            placeholder="Filter pair…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-binance-border">
              <th className="px-3 py-3 text-left text-xs text-binance-muted font-medium w-8">#</th>
              <Th col="symbol"      label="Pair"    left />
              <Th col="periodOpen"  label="Open"        />
              <Th col="periodHigh"  label="High"        />
              <Th col="periodLow"   label="Low"         />
              <Th col="periodClose" label="Close"       />
              <Th col="change"      label="Change %"    />
              <Th col="totalVolume" label="Volume"      />
              <Th col="candles"     label="Bars"        />
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && !loading ? (
              <tr>
                <td colSpan={10} className="text-center py-12 text-binance-muted text-sm">
                  {results.length === 0 ? "Fetch OHLCV to see results" : "No pairs match your filter"}
                </td>
              </tr>
            ) : (
              slice.map((r, i) => {
                const idx      = (page - 1) * pageSize + i + 1;
                const isUp     = r.change >= 0;
                const isActive = r.symbol === activePair;
                const base     = r.symbol.replace(new RegExp(`${quote}$`), "");

                if (r.status === "error") {
                  return (
                    <tr key={r.symbol} className="border-b border-binance-border/30 opacity-50">
                      <td className="px-3 py-2 text-xs text-binance-muted">{idx}</td>
                      <td className="px-3 py-2 font-semibold text-sm">{base}<span className="text-binance-muted">/{quote}</span></td>
                      <td colSpan={8} className="px-3 py-2 text-xs text-binance-red">{r.error ?? "Error"}</td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={r.symbol}
                    onClick={() => onSelect(r.symbol)}
                    className={`border-b border-binance-border/30 cursor-pointer hover:bg-binance-border/20 transition ${
                      isActive ? "bg-binance-yellow/10 border-l-2 border-l-binance-yellow" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-xs text-binance-muted">{idx}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-binance-border flex items-center justify-center text-[9px] font-bold text-binance-yellow flex-shrink-0">
                          {base.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-semibold text-white text-xs">{base}</div>
                          <div className="text-[10px] text-binance-muted">{quote}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtPrice(r.periodOpen)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-binance-green">{fmtPrice(r.periodHigh)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-binance-red">{fmtPrice(r.periodLow)}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                      {fmtPrice(r.periodClose)}
                    </td>
                    <td className={`px-3 py-2 text-right text-xs font-bold ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                      {isUp ? "+" : ""}{r.change.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-binance-muted">{fmtVol(r.totalVolume)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-binance-muted">{r.candles.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelect(r.symbol); }}
                        className={`px-2 py-0.5 text-xs rounded font-medium transition whitespace-nowrap ${
                          isActive
                            ? "bg-binance-yellow text-binance-dark"
                            : "bg-binance-border text-binance-text hover:bg-binance-yellow hover:text-binance-dark"
                        }`}
                      >Chart</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        onPage={setPage}
        pageSize={pageSize}
        totalRows={sorted.length}
        onPageSize={(n) => { setPageSize(n); setPage(1); }}
      />
    </div>
  );
}
