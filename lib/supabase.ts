import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !key) {
  console.warn("[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — DB features disabled.");
}

export const supabase = url && key ? createClient(url, key) : null;

// ─── DB types ────────────────────────────────────────────────────────────────

export interface DbSession {
  id: string;
  mode: string;
  symbols: string[];
  interval: string;
  start_date: string | null;
  end_date: string | null;
  total_pairs: number;
  total_candles: number;
  created_at: string;
}

export interface DbCandle {
  session_id: string;
  symbol: string;
  interval: string;
  open_time: number;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  close_time: number;
}
