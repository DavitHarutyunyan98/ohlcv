"use client";

import { useState, useEffect, useRef } from "react";

interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

interface Props {
  value: string;
  onChange: (symbol: string) => void;
}

const POPULAR = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "MATICUSDT",
];

export default function PairSearch({ value, onChange }: Props) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SymbolInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (query.length < 1) {
      // Show popular
      setResults(POPULAR.map((s) => ({ symbol: s, baseAsset: s.replace("USDT","").replace("BTC",""), quoteAsset: s.endsWith("USDT") ? "USDT" : "BTC" })));
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/symbols?search=${query.toUpperCase()}&quote=USDT`);
        const data = await res.json();
        setResults((data.symbols ?? []).slice(0, 30));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query, open]);

  const select = (sym: string) => {
    onChange(sym);
    setQuery(sym);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center gap-2 bg-binance-dark border border-binance-border rounded px-3 py-2 w-52 focus-within:border-binance-yellow transition">
        <svg className="w-4 h-4 text-binance-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          className="bg-transparent text-white outline-none text-sm w-full font-mono"
          value={query}
          placeholder="e.g. BTCUSDT"
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value.toUpperCase()); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.length >= 3) select(query);
            if (e.key === "Escape") setOpen(false);
          }}
        />
        {loading && (
          <svg className="animate-spin w-3.5 h-3.5 text-binance-yellow flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
          </svg>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 w-64 bg-binance-card border border-binance-border rounded-lg shadow-xl max-h-72 overflow-y-auto">
          {query.length < 1 && (
            <div className="px-3 py-2 text-xs text-binance-muted border-b border-binance-border font-medium uppercase tracking-wider">
              Popular pairs
            </div>
          )}
          {results.map((s) => (
            <button
              key={s.symbol}
              onClick={() => select(s.symbol)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-binance-border transition flex items-center justify-between ${
                s.symbol === value ? "text-binance-yellow" : "text-binance-text"
              }`}
            >
              <span className="font-mono font-medium">{s.symbol}</span>
              <span className="text-xs text-binance-muted">{s.baseAsset} / {s.quoteAsset}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
