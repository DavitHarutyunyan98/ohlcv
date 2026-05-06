"use client";

/**
 * Trades Chart — candlestick chart with entry/exit markers + trade lines.
 *
 * Reuses the same lightweight-charts setup as CandlestickChart but adds:
 *   • Markers at entry and exit bars (▲/▼ for entries, ●/✕ for exits, colored by P&L).
 *   • Thin line series connecting entry price → exit price for each trade,
 *     colored green for wins / red for losses.
 *   • Filter chips (All / Wins / Losses / Long / Short) that re-render markers.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Kline } from "@/lib/types";
import type { Trade } from "@/lib/backtest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyChart = any;

interface Props {
  klines:   Kline[];
  trades:   Trade[];
  symbol:   string;
  interval: string;
}

type Filter = "all" | "wins" | "losses" | "long" | "short";

export default function TradesChart({ klines, trades, symbol, interval }: Props) {
  const containerRef     = useRef<HTMLDivElement>(null);
  const chartRef         = useRef<AnyChart>(null);
  const candleSeriesRef  = useRef<AnyChart>(null);
  const volumeSeriesRef  = useRef<AnyChart>(null);
  const lineSeriesRef    = useRef<AnyChart[]>([]);
  const roRef            = useRef<ResizeObserver | null>(null);

  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (filter === "wins")   return t.pnlPct  >  0;
      if (filter === "losses") return t.pnlPct <=  0;
      if (filter === "long")   return t.side === "long";
      if (filter === "short")  return t.side === "short";
      return true;
    });
  }, [trades, filter]);

  // Build chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    import("lightweight-charts").then((lc) => {
      if (destroyed || !containerRef.current) return;

      const chart = lc.createChart(containerRef.current, {
        width:  containerRef.current.clientWidth,
        height: 480,
        layout: { background: { color: "#1E2329" }, textColor: "#B7BDC6" },
        grid: {
          vertLines: { color: "#2B3139" },
          horzLines: { color: "#2B3139" },
        },
        crosshair: { mode: lc.CrosshairMode.Normal },
        rightPriceScale: { borderColor: "#2B3139", scaleMargins: { top: 0.1, bottom: 0.25 } },
        timeScale: { borderColor: "#2B3139", timeVisible: true, secondsVisible: false },
      });

      const candle = chart.addCandlestickSeries({
        upColor:        "#03A66D",
        downColor:      "#CF304A",
        borderUpColor:  "#03A66D",
        borderDownColor:"#CF304A",
        wickUpColor:    "#03A66D",
        wickDownColor:  "#CF304A",
      });

      const volume = chart.addHistogramSeries({
        color:        "#03A66D",
        priceFormat:  { type: "volume" },
        priceScaleId: "volume",
      });

      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

      chartRef.current        = chart;
      candleSeriesRef.current = candle;
      volumeSeriesRef.current = volume;

      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      });
      ro.observe(containerRef.current);
      roRef.current = ro;
    });

    return () => {
      destroyed = true;
      roRef.current?.disconnect();
      chartRef.current?.remove();
      chartRef.current        = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lineSeriesRef.current   = [];
    };
  }, []); // run once

  // Push klines whenever they change
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleSeriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!chart || !candle || !volume || klines.length === 0) return;

    const candleData = klines.map((k) => ({
      time:  (k.openTime / 1000) as unknown as import("lightweight-charts").Time,
      open:  parseFloat(k.open),
      high:  parseFloat(k.high),
      low:   parseFloat(k.low),
      close: parseFloat(k.close),
    }));
    const volumeData = klines.map((k) => ({
      time:  (k.openTime / 1000) as unknown as import("lightweight-charts").Time,
      value: parseFloat(k.volume),
      color: parseFloat(k.close) >= parseFloat(k.open) ? "rgba(3,166,109,0.5)" : "rgba(207,48,74,0.5)",
    }));

    candle.setData(candleData);
    volume.setData(volumeData);
    chart.timeScale().fitContent();
  }, [klines]);

  // Push markers + trade lines whenever filtered trades change
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleSeriesRef.current;
    if (!chart || !candle) return;

    // Clear previous trade lines
    for (const s of lineSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* noop */ }
    }
    lineSeriesRef.current = [];

    if (filtered.length === 0) {
      candle.setMarkers([]);
      return;
    }

    // Build markers
    type Marker = {
      time:     unknown;
      position: "aboveBar" | "belowBar" | "inBar";
      color:    string;
      shape:    "arrowUp" | "arrowDown" | "circle" | "square";
      text?:    string;
      size?:    number;
    };
    const markers: Marker[] = [];

    for (const t of filtered) {
      const isWin = t.pnlPct > 0;

      // Entry marker
      markers.push({
        time:     (t.entryTime / 1000) as unknown as import("lightweight-charts").Time,
        position: t.side === "long" ? "belowBar" : "aboveBar",
        color:    t.side === "long" ? "#03A66D" : "#CF304A",
        shape:    t.side === "long" ? "arrowUp"  : "arrowDown",
        text:     t.side === "long" ? "L"        : "S",
        size:     1,
      });

      // Exit marker
      markers.push({
        time:     (t.exitTime / 1000) as unknown as import("lightweight-charts").Time,
        position: t.side === "long" ? "aboveBar" : "belowBar",
        color:    isWin ? "#03A66D" : "#CF304A",
        shape:    "circle",
        text:     `${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%`,
        size:     1,
      });

      // Trade line connecting entry → exit
      try {
        const line = chart.addLineSeries({
          color:           isWin ? "rgba(3,166,109,0.55)" : "rgba(207,48,74,0.55)",
          lineWidth:       2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        line.setData([
          { time: (t.entryTime / 1000) as unknown as import("lightweight-charts").Time, value: t.entryPrice },
          { time: (t.exitTime  / 1000) as unknown as import("lightweight-charts").Time, value: t.exitPrice  },
        ]);
        lineSeriesRef.current.push(line);
      } catch {
        /* if the series API fails, just skip the line */
      }
    }

    // Markers must be sorted by time
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    candle.setMarkers(markers);
  }, [filtered]);

  // Aggregates for the filter row (must be called before any early return)
  const stats = useMemo(() => {
    const wins   = trades.filter((t) => t.pnlPct  >  0).length;
    const losses = trades.filter((t) => t.pnlPct <=  0).length;
    const longs  = trades.filter((t) => t.side === "long").length;
    const shorts = trades.filter((t) => t.side === "short").length;
    return { all: trades.length, wins, losses, longs, shorts };
  }, [trades]);

  if (klines.length === 0) {
    return (
      <div className="flex items-center justify-center h-[480px] text-binance-muted">
        No klines available for this symbol
      </div>
    );
  }

  const filterLabels: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "all",    label: "All",    count: stats.all,    color: "" },
    { key: "wins",   label: "Wins",   count: stats.wins,   color: "text-binance-green" },
    { key: "losses", label: "Losses", count: stats.losses, color: "text-binance-red" },
    { key: "long",   label: "Long",   count: stats.longs,  color: "text-binance-green" },
    { key: "short",  label: "Short",  count: stats.shorts, color: "text-binance-red" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-binance-muted font-medium uppercase tracking-wider">Filter:</span>
        {filterLabels.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 text-xs rounded font-medium transition ${
              filter === f.key
                ? "bg-binance-yellow text-binance-dark"
                : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
            }`}
          >
            {f.label} <span className={`ml-1 ${filter === f.key ? "" : f.color}`}>{f.count}</span>
          </button>
        ))}

        <span className="ml-auto text-[11px] text-binance-muted">
          <span className="text-white font-mono font-semibold">{symbol || "—"}</span>
          {interval && <span> · {interval}</span>}
          {" · "}{filtered.length} of {trades.length} trades shown
        </span>
      </div>

      <div ref={containerRef} className="rounded-lg overflow-hidden border border-binance-border" style={{ minHeight: 480 }} />

      <div className="flex flex-wrap gap-3 text-[11px] text-binance-muted">
        <span><span className="inline-block w-3 text-center text-binance-green font-bold">▲</span> Long entry</span>
        <span><span className="inline-block w-3 text-center text-binance-red font-bold">▼</span> Short entry</span>
        <span><span className="inline-block w-3 text-center text-binance-green font-bold">●</span> Win exit</span>
        <span><span className="inline-block w-3 text-center text-binance-red font-bold">●</span> Loss exit</span>
        <span className="ml-auto">Lines connect entry → exit, colored by P&amp;L.</span>
      </div>
    </div>
  );
}
