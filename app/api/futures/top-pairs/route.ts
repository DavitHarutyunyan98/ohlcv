import { NextRequest, NextResponse } from "next/server";
import { getTopFuturesPairs } from "@/lib/futuresBinance";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const quote = searchParams.get("quote") ?? "USDT";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 300);

  try {
    const pairs = await getTopFuturesPairs(quote, limit);
    return NextResponse.json({
      pairs: pairs.map((p) => ({
        symbol:             p.symbol,
        lastPrice:          p.lastPrice,
        priceChangePercent: p.priceChangePercent,
        quoteVolume:        p.quoteVolume,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
