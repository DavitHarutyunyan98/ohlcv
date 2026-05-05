"use client";

import { useState, useMemo } from "react";
import Pagination from "./Pagination";
import type { Kline } from "@/lib/types";

type SortKey = "openTime" | "open" | "high" | "low" | "close" | "volume" | "change";

interface Props {
  klines: Kline[];
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    year: "2-digit", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtNum(s: string, decimals?: number): string {
  const n = parseFloat(s);
  if (isNaN(n)) return "—";
  const d = decimals ?? (n >= 1000 ? 2 : n >= 1 ? 4 : 6);
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtVol(s: string) {
  const n = parseFloat(s);
  if (isNaN(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(3) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(3) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

export default function CandlesTable({ klines }: Props) {
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortKey, setSortKey]   = useState<SortKey>("openTime");
  const [sortAsc, setSortAsc]   = useState(false);

  const withChange = useMemo(() =>
    klines.map((k, i) => {
      const prev   = klines[i - 1];
      const change = prev
        ? ((parseFloat(k.close) - parseFloat(prev.close)) / parseFloat(prev.close)) * 100
        : 0;
      return { ...k, change };
    }),
  [klines]);

  const sorted = useMemo(() => {
    return [...withChange].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "change") { av = a.change; bv = b.change; }
      else { av = parseFloat(a[sortKey] as string); bv = parseFloat(b[sortKey] as string); }
      return sortAsc ? av - bv : bv - av;
    });
  }, [withChange, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const slice      = sorted.slice((page - 1) * pageSize, page * pageSize);

  const toggle = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === "openTime"); }
    setPage(1);
  };

  const Th = ({ col, label, right = true }: { col: SortKey; label: string; right?: boolean }) => (
    <th
      onClick={() => toggle(col)}
      className={`px-3 py-3 text-xs uppercase tracking-wider font-medium cursor-pointer select-none hover:text-white transition ${
        sortKey === col ? "text-binance-yellow" : "text-binance-muted"
      } ${right ? "text-right" : "text-left"}`}
    >
      <span className={`flex items-center gap-1 ${right ? "justify-end" : ""}`}>
        {label}
        <span className="text-[10px]">{sortKey === col ? (sortAsc ? "▲" : "▼") : "⇅"}</span>
      </span>
    </th>
  );

  if (klines.length === 0) return null;

  return (
    <div className="mt-4 bg-binance-card border border-binance-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-binance-border flex items-center justify-between">
        <span className="text-sm font-semibold text-white">
          All Candles
          <span className="ml-2 text-binance-muted font-normal text-xs">
            {klines.length.toLocaleString()} total
          </span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-binance-border">
              <Th col="openTime" label="Time"   right={false} />
              <Th col="open"     label="Open"   />
              <Th col="high"     label="High"   />
              <Th col="low"      label="Low"    />
              <Th col="close"    label="Close"  />
              <Th col="change"   label="Chg %"  />
              <Th col="volume"   label="Volume" />
            </tr>
          </thead>
          <tbody>
            {slice.map((k) => {
              const isUp = parseFloat(k.close) >= parseFloat(k.open);
              return (
                <tr
                  key={k.openTime}
                  className="border-b border-binance-border/30 hover:bg-binance-border/20 transition"
                >
                  <td className="px-3 py-2 text-xs text-binance-muted font-mono whitespace-nowrap">
                    {fmtTime(k.openTime)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmtNum(k.open)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-binance-green">{fmtNum(k.high)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-binance-red">{fmtNum(k.low)}</td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                    {fmtNum(k.close)}
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-semibold ${k.change >= 0 ? "text-binance-green" : "text-binance-red"}`}>
                    {k.change >= 0 ? "+" : ""}{k.change.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-binance-muted">
                    {fmtVol(k.volume)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        onPage={(p) => { setPage(p); }}
        pageSize={pageSize}
        totalRows={sorted.length}
        onPageSize={(n) => { setPageSize(n); setPage(1); }}
      />
    </div>
  );
}
