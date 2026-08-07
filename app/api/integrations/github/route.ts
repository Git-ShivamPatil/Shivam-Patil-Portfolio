import { NextResponse } from "next/server";
import { getGitHubStats } from "../../../../lib/integrations/github";

export const runtime = "nodejs";
// The freshness window is owned by the integration cache, not by Next's
// route cache — layering a second TTL on top would make staleness unpredictable.
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getGitHubStats();
  if (!result) {
    return NextResponse.json({ error: "GitHub stats are unavailable." }, { status: 503 });
  }
  return NextResponse.json({
    data: result.data,
    fetchedAt: result.fetchedAt.toISOString(),
    stale: result.stale,
  });
}
