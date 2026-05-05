import type { Kline } from "./types";

export type DataSource = "spot" | "futures";

/**
 * Fetch ALL klines for a symbol+interval in a date range,
 * auto-paginating past Binance's 1000-candle-per-request limit.
 *
 * @param source  "spot" → /api/klines, "futures" → /api/futures/klines
 * @param onPage  called after each page with running total
 */
export async function fetchAllKlines(
  symbol: string,
  interval: string,
  startTime?: number,
  endTime?: number,
  onPage?: (fetched: number) => void,
  source: DataSource = "spot"
): Promise<Kline[]> {
  const all: Kline[] = [];
  let cursor = startTime;
  const MAX = 100_000;

  const endpoint = source === "futures" ? "/api/futures/klines" : "/api/klines";

  while (all.length < MAX) {
    const params = new URLSearchParams({ symbol, interval, limit: "1000" });
    if (cursor)  params.set("startTime", String(cursor));
    if (endTime) params.set("endTime",   String(endTime));

    const res  = await fetch(`${endpoint}?${params}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

    const batch: Kline[] = data.klines ?? [];
    if (batch.length === 0) break;

    all.push(...batch);
    onPage?.(all.length);

    if (batch.length < 1000) break;

    cursor = batch[batch.length - 1].closeTime + 1;
    if (endTime && cursor >= endTime) break;

    await new Promise((r) => setTimeout(r, 80));
  }

  return all;
}
