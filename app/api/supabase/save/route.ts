import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const body = await req.json();
  const { mode, symbols, interval, startDate, endDate, candles } = body as {
    mode: string;
    symbols: string[];
    interval: string;
    startDate?: string;
    endDate?: string;
    candles: Array<{
      symbol: string;
      open_time: number;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
      close_time: number;
    }>;
  };

  // 1. Create session record
  const { data: session, error: sessionErr } = await supabase
    .from("ohlcv_sessions")
    .insert({
      mode,
      symbols,
      interval,
      start_date: startDate ?? null,
      end_date: endDate ?? null,
      total_pairs: symbols.length,
      total_candles: candles.length,
    })
    .select("id")
    .single();

  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  }

  // 2. Batch-insert candles (chunks of 500 to stay under Supabase limits)
  const CHUNK = 500;
  const rows = candles.map((c) => ({
    session_id: session.id,
    symbol: c.symbol,
    interval,
    open_time: c.open_time,
    open_price: parseFloat(c.open),
    high_price: parseFloat(c.high),
    low_price: parseFloat(c.low),
    close_price: parseFloat(c.close),
    volume: parseFloat(c.volume),
    close_time: c.close_time,
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("ohlcv_candles")
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: "symbol,interval,open_time",
        ignoreDuplicates: true,
      });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ sessionId: session.id, saved: rows.length });
}
