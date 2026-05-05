import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

type CandleRow = {
  symbol: string;
  open_time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  close_time: number;
};

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, mode, symbols, interval, startDate, endDate, candles } = body as {
    sessionId?: string;
    mode?: string;
    symbols?: string[];
    interval?: string;
    startDate?: string;
    endDate?: string;
    candles: CandleRow[];
  };

  let sid = sessionId;

  // ── If no sessionId, create a new session record ───────────────────────────
  if (!sid) {
    const { data: session, error: sessionErr } = await supabase
      .from("ohlcv_sessions")
      .insert({
        mode:          mode ?? "unknown",
        symbols:       symbols ?? [],
        interval:      interval ?? "",
        start_date:    startDate ?? null,
        end_date:      endDate   ?? null,
        total_pairs:   (symbols ?? []).length,
        total_candles: 0, // updated at end
      })
      .select("id")
      .single();

    if (sessionErr) {
      return NextResponse.json({ error: sessionErr.message }, { status: 500 });
    }
    sid = session.id as string;
  }

  // ── Upsert candles for this chunk ──────────────────────────────────────────
  const rows = (candles ?? []).map((c) => ({
    session_id:  sid,
    symbol:      c.symbol,
    interval:    interval ?? "",
    open_time:   c.open_time,
    open_price:  parseFloat(c.open),
    high_price:  parseFloat(c.high),
    low_price:   parseFloat(c.low),
    close_price: parseFloat(c.close),
    volume:      parseFloat(c.volume),
    close_time:  c.close_time,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("ohlcv_candles")
      .upsert(rows, { onConflict: "symbol,interval,open_time", ignoreDuplicates: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ sessionId: sid, saved: rows.length });
}
