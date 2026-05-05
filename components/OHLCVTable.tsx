"use client";

import type { Kline } from "@/lib/types";

interface Props {
  klines: Kline[];
  loading: boolean;
}

function fmt(val: string, decimals = 2): string {
  const n = parseFloat(val);
  if (isNaN(n)) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OHLCVTable({ klines, loading }: Props) {
  if (loading && klines.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-binance-muted">
        <svg className="animate-spin w-6 h-6 text-binance-yellow mr-3" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
        </svg>
        Loading…
      </div>
    );
  }

  if (klines.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-binance-muted">
        No data
      </div>
    );
  }

  const reversed = [...klines].reverse();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-binance-border text-binance-muted text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-3 font-medium">Time</th>
            <th className="text-right px-4 py-3 font-medium">Open</th>
            <th className="text-right px-4 py-3 font-medium">High</th>
            <th className="text-right px-4 py-3 font-medium">Low</th>
            <th className="text-right px-4 py-3 font-medium">Close</th>
            <th className="text-right px-4 py-3 font-medium">Change</th>
            <th className="text-right px-4 py-3 font-medium">Volume</th>
            <th className="text-right px-4 py-3 font-medium">Trades</th>
          </tr>
        </thead>
        <tbody>
          {reversed.map((k, i) => {
            const open  = parseFloat(k.open);
            const close = parseFloat(k.close);
            const change = ((close - open) / open) * 100;
            const isUp  = close >= open;
            const decimals = close < 1 ? 6 : close < 100 ? 4 : 2;

            return (
              <tr
                key={k.openTime}
                className={`border-b border-binance-border/40 hover:bg-binance-border/30 transition ${
                  i === 0 ? "bg-binance-border/20" : ""
                }`}
              >
                <td className="px-4 py-2.5 text-binance-muted font-mono text-xs">
                  {fmtTime(k.openTime)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {fmt(k.open, decimals)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-binance-green">
                  {fmt(k.high, decimals)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-binance-red">
                  {fmt(k.low, decimals)}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono font-semibold ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                  {fmt(k.close, decimals)}
                </td>
                <td className={`px-4 py-2.5 text-right text-xs font-semibold ${isUp ? "text-binance-green" : "text-binance-red"}`}>
                  {isUp ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-binance-muted">
                  {parseFloat(k.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-binance-muted">
                  {k.trades.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
