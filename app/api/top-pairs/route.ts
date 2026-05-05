import { NextRequest, NextResponse } from "next/server";
import { getTopPairs } from "@/lib/binance";

export const runtime = "nodejs";
export const revalidate = 60; // cache 60s

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const quote = searchParams.get("quote")?.toUpperCase() ?? "USDT";
  const topN  = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  try {
    const pairs = await getTopPairs(quote, topN);
    return NextResponse.json({ pairs, quote, count: pairs.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
