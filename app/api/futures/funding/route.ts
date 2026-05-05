import { NextRequest, NextResponse } from "next/server";
import { getFundingRates } from "@/lib/futuresBinance";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol    = searchParams.get("symbol")?.toUpperCase();
  const startTime = searchParams.get("startTime") ? parseInt(searchParams.get("startTime")!, 10) : undefined;
  const endTime   = searchParams.get("endTime")   ? parseInt(searchParams.get("endTime")!,   10) : undefined;
  const limit     = Math.min(parseInt(searchParams.get("limit") ?? "1000", 10), 1000);

  if (!symbol) {
    return NextResponse.json({ error: "Missing required parameter: symbol" }, { status: 400 });
  }

  try {
    const rates = await getFundingRates(symbol, startTime, endTime, limit);
    return NextResponse.json({ symbol, rates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
