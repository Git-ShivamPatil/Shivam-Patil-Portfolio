import { NextResponse } from "next/server";
import { getLeetCodeStats } from "../../../../lib/integrations/leetcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P12 — same two-layer split as the GitHub route, and a longer window.
 *
 * LeetCode's endpoint is unofficial and throttles serverless IPs, so the
 * database cache holds for six hours. Five minutes at the edge in front of that
 * is still far shorter than the freshness the panel actually has, and it means
 * a burst of visitors costs one function invocation rather than one each.
 */
const EDGE_CACHE = "public, s-maxage=300, stale-while-revalidate=3600";

export async function GET() {
  const result = await getLeetCodeStats();
  if (!result) {
    return NextResponse.json(
      { error: "LeetCode stats are unavailable." },
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
