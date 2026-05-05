"use client";

import { useEffect, useRef } from "react";
import type { Kline } from "./OHLCVDashboard";

interface Props {
  klines: Kline[];
  symbol: string;
  interval: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyChart = any;

export default function CandlestickChart({ klines, symbol, interval }: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<AnyChart>(null);
  const candleSeriesRef = useRef<AnyChart>(null);
  const volumeSeriesRef = useRef<AnyChart>(null);
  const roRef           = useRef<ResizeObserver | null>(null);

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    import("lightweight-charts").then((lc) => {
      if (destroyed || !containerRef.current) return;

      const chart = lc.createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 480,
        layout: {
          background: { color: "#1E2329" },
          textColor: "#B7BDC6",
        },
        grid: {
          vertLines: { color: "#2B3139" },
          horzLines: { color: "#2B3139" },
        },
        crosshair: { mode: lc.CrosshairMode.Normal },
        rightPriceScale: {
          borderColor: "#2B3139",
          scaleMargins: { top: 0.1, bottom: 0.25 },
        },
        timeScale: {
          borderColor: "#2B3139",
          timeVisible: true,
          secondsVisible: false,
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor:        "#03A66D",
        downColor:      "#CF304A",
        borderUpColor:  "#03A66D",
        borderDownColor:"#CF304A",
        wickUpColor:    "#03A66D",
        wickDownColor:  "#CF304A",
      });

      const volumeSeries = chart.addHistogramSeries({
        color:        "#03A66D",
        priceFormat:  { type: "volume" },
        priceScaleId: "volume",
      });

      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      chartRef.current        = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;

      // Responsive resize
      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      ro.observe(containerRef.current!);
      roRef.current = ro;
    });

    return () => {
      destroyed = true;
      roRef.current?.disconnect();
      chartRef.current?.remove();
      chartRef.current        = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []); // run once

  // Push new data whenever klines change
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || klines.length === 0) return;

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
      color:
        parseFloat(k.close) >= parseFloat(k.open)
          ? "rgba(3,166,109,0.5)"
          : "rgba(207,48,74,0.5)",
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [klines]);

  if (klines.length === 0) {
    return (
      <div className="flex items-center justify-center h-[480px] text-binance-muted">
        No data available
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 text-sm text-binance-muted">
        <span className="font-semibold text-white">{symbol}</span>
        <span>·</span>
        <span>{interval} candles</span>
        <span>·</span>
        <span>{klines.length} bars</span>
      </div>
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden"
        style={{ minHeight: 480 }}
      />
    </div>
  );
}
