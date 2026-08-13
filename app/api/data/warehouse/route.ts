import { NextResponse } from "next/server";
import { clientIp, consume } from "../../../../lib/rate-limit";
import { buildWarehouse } from "../../../../lib/dataeng/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P20 — the warehouse export.
 *
 * Public, and that is a deliberate decision rather than an oversight. Everything
 * in it is aggregated by day, path, country and device *before it leaves the
 * database*, so there is no row corresponding to a person — which is exactly
 * the shape P10 spent its privacy budget producing. Publishing the ledger
 * itself would undo that; publishing the aggregate does not.
 *
 * Cached hard at the edge because it changes once a day at most and is the
 * heaviest read on the site. Without this, every visitor who opens the OLAP
 * console runs four groupBy queries against Neon.
 */
export async function GET(request: Request) {
  if (!(await consume(`warehouse:${clientIp(request)}`, 10, 0.2)).ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const warehouse = await buildWarehouse();
    return NextResponse.json(warehouse, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        // DuckDB-WASM fetches this from the page's own origin, so no CORS is
        // needed — and none is granted. An export that anyone can hotlink is a
        // different decision from one this site's own page reads.
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("GET /api/data/warehouse failed:", error);
    return NextResponse.json(
      { error: "Could not build the export." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
