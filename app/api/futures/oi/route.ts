import { NextRequest, NextResponse } from "next/server";
import { getOpenInterestHistory, toOIPeriod } from "@/lib/futuresBinance";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol    = searchParams.get("symbol")?.toUpperCase();
  const interval  = searchParams.get("interval") ?? "1h";
  const startTime = searchParams.get("startTime") ? parseInt(searchParams.get("startTime")!, 10) : undefined;
  const endTime   = searchParams.get("endTime")   ? parseInt(searchParams.get("endTime")!,   10) : undefined;
  const limit     = Math.min(parseInt(searchParams.get("limit") ?? "500", 10), 500);

  if (!symbol) {
    return NextResponse.json({ error: "Missing required parameter: symbol" }, { status: 400 });
  }

  const period = toOIPeriod(interval);

  try {
    const records = await getOpenInterestHistory(symbol, period, startTime, endTime, limit);
    return NextResponse.json({ symbol, period, records });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // OI history can fail for some symbols — return empty gracefully
    return NextResponse.json({ symbol, period, records: [], warning: message });
  }
}
