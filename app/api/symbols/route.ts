import { NextRequest, NextResponse } from "next/server";
import { getSymbols } from "@/lib/binance";

export const runtime = "nodejs";

// Cache the symbol list for 5 minutes on the edge
export const revalidate = 300;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const quote = searchParams.get("quote")?.toUpperCase(); // e.g. "USDT"
  const search = searchParams.get("search")?.toUpperCase() ?? "";

  try {
    let symbols = await getSymbols();

    if (quote) {
      symbols = symbols.filter((s) => s.quoteAsset === quote);
    }

    if (search) {
      symbols = symbols.filter((s) => s.symbol.includes(search));
    }

    return NextResponse.json({ symbols });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
