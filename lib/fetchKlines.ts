import type { Kline } from "./types";

/**
 * Fetch ALL klines for a symbol+interval in a date range,
 * auto-paginating past Binance's 1000-candle-per-request limit.
 *
 * @param onPage  called after each page with running total, so UI can show progress
 */
export async function fetchAllKlines(
  symbol: string,
  interval: string,
  startTime?: number,
  endTime?: number,
  onPage?: (fetched: number) => void
): Promise<Kline[]> {
  const all: Kline[] = [];
  let cursor = startTime;
  const MAX = 100_000; // safety cap — ~4 years of 1h candles

  while (all.length < MAX) {
    const params = new URLSearchParams({ symbol, interval, limit: "1000" });
    if (cursor)  params.set("startTime", String(cursor));
    if (endTime) params.set("endTime",   String(endTime));

    const res  = await fetch(`/api/klines?${params}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

    const batch: Kline[] = data.klines ?? [];
    if (batch.length === 0) break;

    all.push(...batch);
    onPage?.(all.length);

    if (batch.length < 1000) break; // last page

    cursor = batch[batch.length - 1].closeTime + 1;
    if (endTime && cursor >= endTime) break;

    // Small pause between pages to avoid rate-limit
    await new Promise((r) => setTimeout(r, 80));
  }

  return all;
}
