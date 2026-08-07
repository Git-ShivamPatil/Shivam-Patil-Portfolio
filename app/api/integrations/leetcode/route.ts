import { NextResponse } from "next/server";
import { getLeetCodeStats } from "../../../../lib/integrations/leetcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getLeetCodeStats();
  if (!result) {
    return NextResponse.json({ error: "LeetCode stats are unavailable." }, { status: 503 });
  }
  return NextResponse.json({
    data: result.data,
    fetchedAt: result.fetchedAt.toISOString(),
    stale: result.stale,
  });
}
