import { NextRequest, NextResponse } from "next/server";
import { getFuturesKlines } from "@/lib/futuresBinance";

export const runtime = "nodejs";

const VALID_INTERVALS = [
  "1m","3m","5m","15m","30m",
  "1h","2h","4h","6h","8h","12h",
  "1d","3d","1w",
];

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol   = searchParams.get("symbol")?.toUpperCase();
  const interval = searchParams.get("interval") ?? "1h";
  const limit    = Math.min(parseInt(searchParams.get("limit") ?? "500", 10), 1500);
  const startTime = searchParams.get("startTime") ? parseInt(searchParams.get("startTime")!, 10) : undefined;
  const endTime   = searchParams.get("endTime")   ? parseInt(searchParams.get("endTime")!,   10) : undefined;

  if (!symbol) {
    return NextResponse.json({ error: "Missing required parameter: symbol" }, { status: 400 });
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json(
      { error: `Invalid interval. Must be one of: ${VALID_INTERVALS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const klines = await getFuturesKlines(symbol, interval, limit, startTime, endTime);
    return NextResponse.json({ symbol, interval, klines });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
