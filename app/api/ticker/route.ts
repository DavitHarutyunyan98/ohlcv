import { NextRequest, NextResponse } from "next/server";
import { getTicker } from "@/lib/binance";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol = searchParams.get("symbol")?.toUpperCase();

  try {
    const tickers = await getTicker(symbol ?? undefined);
    return NextResponse.json({ tickers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
