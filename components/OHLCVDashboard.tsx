"use client";

import { useState, useEffect, useCallback } from "react";
import CandlestickChart from "./CandlestickChart";
import OHLCVTable from "./OHLCVTable";
import PairSearch from "./PairSearch";

export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
}

const INTERVALS = [
  { label: "1m",  value: "1m" },
  { label: "5m",  value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h",  value: "1h" },
  { label: "4h",  value: "4h" },
  { label: "1d",  value: "1d" },
  { label: "1w",  value: "1w" },
];

const LIMITS = [50, 100, 200, 500];

export default function OHLCVDashboard() {
  const [symbol, setSymbol]     = useState("BTCUSDT");
  const [interval, setInterval] = useState("1h");
  const [limit, setLimit]       = useState(200);
  const [klines, setKlines]     = useState<Kline[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [lastPrice, setLastPrice] = useState<string | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<"chart" | "table">("chart");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchKlines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      setKlines(data.klines);

      if (data.klines.length >= 2) {
        const last  = parseFloat(data.klines[data.klines.length - 1].close);
        const prev  = parseFloat(data.klines[data.klines.length - 2].close);
        setLastPrice(last.toFixed(last < 1 ? 6 : 2));
        setPriceChange(((last - prev) / prev) * 100);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, limit]);

  // Fetch on param change
  useEffect(() => {
    fetchKlines();
  }, [fetchKlines]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchKlines, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchKlines]);

  const last  = klines[klines.length - 1];
  const isUp  = last ? parseFloat(last.close) >= parseFloat(last.open) : true;

  return (
    <div className="flex flex-col min-h-screen bg-binance-dark text-binance-text">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-binance-border bg-binance-card">
        <div className="flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path d="M16 0L19.7 3.7L9.7 13.7L6 10L16 0Z" fill="#F0B90B"/>
            <path d="M22 6L25.7 9.7L9.7 25.7L6 22L22 6Z" fill="#F0B90B"/>
            <path d="M3.7 12.3L7.4 16L3.7 19.7L0 16L3.7 12.3Z" fill="#F0B90B"/>
            <path d="M28.3 12.3L32 16L28.3 19.7L24.6 16L28.3 12.3Z" fill="#F0B90B"/>
            <path d="M9.7 18.3L13.4 22L16 24.6L18.6 22L22.3 18.3L26 22L16 32L6 22L9.7 18.3Z" fill="#F0B90B"/>
          </svg>
          <span className="text-white font-bold text-lg tracking-wide">
            Binance OHLCV Explorer
          </span>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-binance-muted cursor-pointer select-none">
            <div
              className={`relative w-10 h-5 rounded-full transition-colors ${
                autoRefresh ? "bg-binance-yellow" : "bg-binance-border"
              }`}
              onClick={() => setAutoRefresh((v) => !v)}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  autoRefresh ? "translate-x-5" : ""
                }`}
              />
            </div>
            Auto-refresh (30s)
          </label>
          <button
            onClick={fetchKlines}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-binance-yellow text-binance-dark text-sm font-semibold rounded hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            )}
            Refresh
          </button>
        </div>
      </header>

      {/* ── Controls ────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-binance-border bg-binance-card flex flex-wrap items-end gap-4">
        {/* Pair search */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-binance-muted font-medium uppercase tracking-wider">
            Trading Pair
          </label>
          <PairSearch value={symbol} onChange={setSymbol} />
        </div>

        {/* Interval */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-binance-muted font-medium uppercase tracking-wider">
            Interval
          </label>
          <div className="flex gap-1">
            {INTERVALS.map((i) => (
              <button
                key={i.value}
                onClick={() => setInterval(i.value)}
                className={`px-3 py-1.5 text-sm rounded font-medium transition ${
                  interval === i.value
                    ? "bg-binance-yellow text-binance-dark"
                    : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                }`}
              >
                {i.label}
              </button>
            ))}
          </div>
        </div>

        {/* Limit */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-binance-muted font-medium uppercase tracking-wider">
            Candles
          </label>
          <div className="flex gap-1">
            {LIMITS.map((l) => (
              <button
                key={l}
                onClick={() => setLimit(l)}
                className={`px-3 py-1.5 text-sm rounded font-medium transition ${
                  limit === l
                    ? "bg-binance-yellow text-binance-dark"
                    : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Price banner ────────────────────────────────────── */}
      {lastPrice && (
        <div className="px-6 py-3 bg-binance-card border-b border-binance-border flex items-center gap-4">
          <span className="text-2xl font-bold text-white">
            {symbol.replace(/^(.+?)(USDT|BTC|ETH|BNB|BUSD)$/, "$1 / $2")}
          </span>
          <span
            className={`text-2xl font-mono font-bold ${
              isUp ? "text-binance-green" : "text-binance-red"
            }`}
          >
            ${lastPrice}
          </span>
          <span
            className={`text-sm font-semibold px-2 py-0.5 rounded ${
              priceChange >= 0
                ? "bg-binance-green/20 text-binance-green"
                : "bg-binance-red/20 text-binance-red"
            }`}
          >
            {priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(2)}%
          </span>
          {last && (
            <div className="flex gap-6 ml-4 text-sm text-binance-muted">
              <span>O: <span className="text-white">{parseFloat(last.open).toLocaleString()}</span></span>
              <span>H: <span className="text-binance-green">{parseFloat(last.high).toLocaleString()}</span></span>
              <span>L: <span className="text-binance-red">{parseFloat(last.low).toLocaleString()}</span></span>
              <span>C: <span className="text-white">{parseFloat(last.close).toLocaleString()}</span></span>
              <span>V: <span className="text-white">{parseFloat(last.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></span>
            </div>
          )}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────── */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-binance-red/20 border border-binance-red/40 text-binance-red rounded-lg text-sm">
          ⚠ {error}
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="px-6 pt-4 flex gap-2">
        {(["chart", "table"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition ${
              activeTab === tab
                ? "bg-binance-card text-white border-t border-l border-r border-binance-border"
                : "text-binance-muted hover:text-white"
            }`}
          >
            {tab === "chart" ? "📈 Chart" : "📋 Table"}
          </button>
        ))}
      </div>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex-1 px-6 pb-6">
        <div className="bg-binance-card border border-binance-border rounded-b-xl rounded-tr-xl overflow-hidden">
          {activeTab === "chart" ? (
            <div className="p-4">
              {loading && klines.length === 0 ? (
                <div className="flex items-center justify-center h-[480px] text-binance-muted">
                  <div className="flex flex-col items-center gap-3">
                    <svg className="animate-spin w-8 h-8 text-binance-yellow" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-binance-yellow"/>
                    </svg>
                    <span>Loading chart data…</span>
                  </div>
                </div>
              ) : (
                <CandlestickChart klines={klines} symbol={symbol} interval={interval} />
              )}
            </div>
          ) : (
            <OHLCVTable klines={klines} loading={loading} />
          )}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="text-center text-xs text-binance-muted pb-4">
        Data provided by Binance API · {klines.length} candles loaded
      </footer>
    </div>
  );
}
