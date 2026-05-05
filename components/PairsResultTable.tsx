"use client";

import { useState, useMemo } from "react";
import Pagination from "./Pagination";
import type { PairResult } from "@/lib/types";
import { downloadXlsx } from "@/lib/downloadXlsx";

// ─── Flat row — one entry per candle per pair ─────────────────────────────────

interface FlatRow {
  symbol:   string;
  openTime: number;
  open:     number;
  high:     number;
  low:      number;
  close:    number;
  volume:   number;
  change:   number; // vs previous candle of the same symbol
}

type SortKey = "symbol" | "openTime" | "open" | "high" | "low" | "close" | "volume" | "change";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    year: "2-digit", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtNum(n: number): string {
  if (n === 0) return "0";
  if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)     return n.toFixed(4);
  return n.toFixed(6);
}

function fmtVol(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(3) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(3) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  results:       PairResult[];
  quote:         string;
  activePair:    string;
  onSelect:      (symbol: string) => void;
  loading?:      boolean;
  progress?:     number;
  total?:        number;
  currentSymbol?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PairsResultTable({
  results, quote, activePair, onSelect,
  loading, progress = 0, total = 0, currentSymbol = "",
}: Props) {
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortKey, setSortKey]   = useState<SortKey>("openTime");
  const [sortAsc, setSortAsc]   = useState(true);
  const [filterSym, setFilterSym] = useState("");

  // ── Flatten all klines into a single list, one row per bar per pair ────────
  const flatRows = useMemo<FlatRow[]>(() => {
    const prevClose = new Map<string, number>();
    const rows: FlatRow[] = [];

    for (const r of results) {
      if (r.status !== "ok" || !r.klines || r.klines.length === 0) continue;

      // Sort ascending by time within each symbol so change% is correct
      const sorted = [...r.klines].sort((a, b) => a.openTime - b.openTime);

      for (const k of sorted) {
        const close = parseFloat(k.close);
        const prev  = prevClose.get(r.symbol);
        const change = prev !== undefined ? ((close - prev) / prev) * 100 : 0;
        prevClose.set(r.symbol, close);

        rows.push({
          symbol:   r.symbol,
          openTime: k.openTime,
          open:     parseFloat(k.open),
          high:     parseFloat(k.high),
          low:      parseFloat(k.low),
          close,
          volume:   parseFloat(k.volume),
          change,
        });
      }
    }

    return rows;
  }, [results]);

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() =>
    filterSym
      ? flatRows.filter((r) => r.symbol.includes(filterSym.toUpperCase()))
      : flatRows,
  [flatRows, filterSym]);

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      const av = sortKey === "symbol" ? a.symbol : a[sortKey as keyof FlatRow] as number;
      const bv = sortKey === "symbol" ? b.symbol : b[sortKey as keyof FlatRow] as number;
      if (typeof av === "string" && typeof bv === "string")
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    }),
  [filtered, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const slice      = sorted.slice((page - 1) * pageSize, page * pageSize);
  const pct        = total > 0 ? (progress / total) * 100 : 0;

  const toggle = (key: SortKey, defaultAsc = true) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(defaultAsc); }
    setPage(1);
  };

  // Summary counts
  const okPairs    = results.filter((r) => r.status === "ok").length;
  const errPairs   = results.filter((r) => r.status === "error").length;
  const totalBars  = flatRows.length;

  // ── Column header ─────────────────────────────────────────────────────────
  const Th = ({
    col, label, left = false, defaultAsc = false,
  }: { col: SortKey; label: string; left?: boolean; defaultAsc?: boolean }) => (
    <th
      onClick={() => toggle(col, defaultAsc)}
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

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="mt-4 bg-binance-card border border-binance-border rounded-xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-binance-border flex flex-wrap items-center gap-3">
        <div>
          <span className="text-sm font-semibold text-white">All Bars</span>
          <span className="ml-2 text-xs text-binance-muted">
            {totalBars.toLocaleString()} rows · {okPairs} pairs
            {errPairs > 0 && <span className="text-binance-red"> · {errPairs} failed</span>}
          </span>
        </div>

        {/* Live fetch progress */}
        {loading && (
          <div className="flex items-center gap-2 flex-1 min-w-[160px]">
            <div className="flex-1 h-1.5 bg-binance-border rounded-full overflow-hidden">
              <div
                className="h-full bg-binance-yellow rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-binance-muted whitespace-nowrap">
              {progress}/{total}
              {currentSymbol && <span className="ml-1 text-white font-mono">{currentSymbol}</span>}
            </span>
          </div>
        )}

        {/* Download */}
        {flatRows.length > 0 && !loading && (
          <button
            onClick={() => {
              const rows = sorted.map((r) => ({
                Symbol:    r.symbol,
                Time:      fmtTime(r.openTime),
                Open:      r.open,
                High:      r.high,
                Low:       r.low,
                Close:     r.close,
                "Chg %":   r.change.toFixed(4),
                Volume:    r.volume,
              }));
              downloadXlsx(rows, `pairs_${quote}_bars`);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-binance-border text-binance-text rounded hover:bg-binance-yellow hover:text-binance-dark transition"
          >
            📥 Download XLSX
          </button>
        )}

        {/* Filter by symbol */}
        <div className="flex items-center gap-2 bg-binance-dark border border-binance-border rounded px-2.5 py-1.5 ml-auto">
          <svg className="w-3.5 h-3.5 text-binance-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            className="bg-transparent text-xs text-white outline-none w-28 placeholder:text-binance-muted"
            placeholder="Filter symbol…"
            value={filterSym}
            onChange={(e) => { setFilterSym(e.target.value); setPage(1); }}
          />
          {filterSym && (
            <button onClick={() => { setFilterSym(""); setPage(1); }} className="text-binance-muted hover:text-binance-red text-sm">✕</button>
          )}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-binance-border">
              <th className="px-3 py-3 text-left text-xs text-binance-muted font-medium w-12">#</th>
              <Th col="symbol"   label="Pair"    left defaultAsc />
              <Th col="openTime" label="Time"    left defaultAsc />
              <Th col="open"     label="Open"    />
              <Th col="high"     label="High"    />
              <Th col="low"      label="Low"     />
              <Th col="close"    label="Close"   />
              <Th col="change"   label="Chg %"  />
              <Th col="volume"   label="Volume"  />
              <th className="px-3 py-3 w-16" />
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-14 text-binance-muted text-sm">
                  {loading
                    ? "Fetching data…"
                    : flatRows.length === 0
                      ? "Fetch OHLCV to see bars"
                      : "No bars match your filter"}
                </td>
              </tr>
            ) : (
              slice.map((row, i) => {
                const idx     = (page - 1) * pageSize + i + 1;
                const isUp    = row.close >= row.open;
                const isActive = row.symbol === activePair;
                const base    = row.symbol.replace(new RegExp(`${quote}$`), "");

                return (
                  <tr
                    key={`${row.symbol}-${row.openTime}`}
                    className={`border-b border-binance-border/25 hover:bg-binance-border/20 transition ${
                      isActive ? "bg-binance-yellow/5" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-xs text-binance-muted">{idx}</td>

                    {/* Symbol */}
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onSelect(row.symbol)}
                        className={`flex items-center gap-1.5 group ${isActive ? "text-binance-yellow" : "text-white"}`}
                      >
                        <span className="font-semibold text-xs group-hover:underline">{base}</span>
                        <span className="text-[10px] text-binance-muted">{quote}</span>
                      </button>
                    </td>

                    {/* Time */}
                    <td className="px-3 py-2 text-xs text-binance-muted font-mono whitespace-nowrap">
                      {fmtTime(row.openTime)}
                    </td>

                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtNum(row.open)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-binance-green">{fmtNum(row.high)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-binance-red">{fmtNum(row.low)}</td>

                    <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                      {fmtNum(row.close)}
                    </td>

                    <td className={`px-3 py-2 text-right text-xs font-semibold ${row.change >= 0 ? "text-binance-green" : "text-binance-red"}`}>
                      {row.change >= 0 ? "+" : ""}{row.change.toFixed(2)}%
                    </td>

                    <td className="px-3 py-2 text-right font-mono text-xs text-binance-muted">
                      {fmtVol(row.volume)}
                    </td>

                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onSelect(row.symbol)}
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

      {/* ── Pagination ─────────────────────────────────────────────────── */}
      <Pagination
        page={page}
        totalPages={totalPages}
        onPage={setPage}
        pageSize={pageSize}
        totalRows={sorted.length}
        onPageSize={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={[50, 100, 200, 500]}
      />
    </div>
  );
}
