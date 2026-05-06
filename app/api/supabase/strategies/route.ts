import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

// Expected table: ohlcv_strategies
//   id          uuid (text) primary key
//   name        text
//   description text
//   params      jsonb
//   source      text
//   created_at  bigint   (epoch ms)
//   updated_at  bigint   (epoch ms)
//   last_stats  jsonb    nullable
//   tuned_on    text     nullable
//   interval    text     nullable
//
// If the table is missing the route returns 503 like other supabase endpoints.

interface RowIn {
  id:          string;
  name:        string;
  description: string;
  params:      unknown;
  source:      string;
  createdAt:   number;
  updatedAt:   number;
  lastStats?:  unknown;
  tunedOn?:    string;
  interval?:   string;
}

interface RowOut {
  id:          string;
  name:        string;
  description: string;
  params:      unknown;
  source:      string;
  created_at:  number;
  updated_at:  number;
  last_stats?: unknown;
  tuned_on?:   string | null;
  interval?:   string | null;
}

function toApi(r: RowOut) {
  return {
    id:          r.id,
    name:        r.name,
    description: r.description ?? "",
    params:      r.params,
    source:      r.source,
    createdAt:   Number(r.created_at),
    updatedAt:   Number(r.updated_at),
    lastStats:   r.last_stats ?? null,
    tunedOn:     r.tuned_on ?? undefined,
    interval:    r.interval ?? undefined,
  };
}

// ─── GET /api/supabase/strategies ─────────────────────────────────────────────

export async function GET() {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const { data, error } = await supabase
    .from("ohlcv_strategies")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ strategies: (data ?? []).map((r: RowOut) => toApi(r)) });
}

// ─── POST /api/supabase/strategies (upsert) ───────────────────────────────────

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  let body: RowIn;
  try { body = (await req.json()) as RowIn; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body?.id || !body.name || !body.params) {
    return NextResponse.json({ error: "Missing id, name, or params" }, { status: 400 });
  }

  const row = {
    id:          body.id,
    name:        body.name,
    description: body.description ?? "",
    params:      body.params,
    source:      body.source ?? "builder",
    created_at:  body.createdAt,
    updated_at:  body.updatedAt,
    last_stats:  body.lastStats ?? null,
    tuned_on:    body.tunedOn ?? null,
    interval:    body.interval ?? null,
  };

  const { error } = await supabase
    .from("ohlcv_strategies")
    .upsert(row, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ─── DELETE /api/supabase/strategies?id=... ───────────────────────────────────

export async function DELETE(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase
    .from("ohlcv_strategies")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
