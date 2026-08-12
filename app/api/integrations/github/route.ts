import { NextResponse } from "next/server";
import { getGitHubStats } from "../../../../lib/integrations/github";

export const runtime = "nodejs";
// The freshness window is owned by the integration cache, not by Next's
// route cache — layering a second TTL on top would make staleness unpredictable.
export const dynamic = "force-dynamic";

/**
 * P12 — an edge cache in front of the database cache, not instead of it.
 *
 * The two layers answer different questions and neither replaces the other.
 * IntegrationCache decides when to call GitHub again (an hour); this decides
 * how many visitors it takes to wake a serverless function at all. A minute is
 * short enough that the panel is never visibly behind the row it is reading,
 * and `stale-while-revalidate` means the visitor who arrives at second 61 is
 * served instantly from the edge while the refresh happens behind them.
 *
 * Deliberately not longer: a long s-maxage here would put a second, invisible
 * TTL on top of the one lib/integrations/cache.ts owns, and staleness that two
 * layers both control is staleness nobody can reason about.
 */
const EDGE_CACHE = "public, s-maxage=60, stale-while-revalidate=600";

export async function GET() {
  const result = await getGitHubStats();
  if (!result) {
    // A 503 must not be cached at the edge — the next request has to be allowed
    // to find the upstream healthy again.
    return NextResponse.json(
      { error: "GitHub stats are unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      data: result.data,
      fetchedAt: result.fetchedAt.toISOString(),
      stale: result.stale,
    },
    { headers: { "Cache-Control": EDGE_CACHE } },
  );
}
