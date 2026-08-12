import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { auth } from "../../../auth";
import { collectMetrics } from "../../../lib/observability/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P14 — the Prometheus scrape target.
 *
 * Guarded, unlike a typical /metrics inside a private network. This one is on
 * the public internet, and the numbers on it — bookings by status, confirmed
 * subscribers, traffic — are business facts, not operational trivia. The same
 * constant-time bearer check the retention cron uses, or an admin session.
 *
 * See lib/observability/metrics.ts for why every metric here is a gauge and
 * why there are no request counters.
 */

function authorized(request: Request, isAdmin: boolean): boolean {
  if (isAdmin) return true;

  const secret = process.env.METRICS_TOKEN ?? process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Length-guarded first: timingSafeEqual throws on a length mismatch rather
  // than returning false.
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function GET(request: Request) {
  const session = await auth().catch(() => null);
  if (!authorized(request, session?.user?.role === "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  try {
    return new NextResponse(await collectMetrics(), {
      headers: {
        // The version the exposition format specifies. A scraper that gets
        // text/plain without it still works; one that gets application/json
        // does not.
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/metrics failed:", error);
    // 500 rather than an empty body: a scrape that silently returns nothing
    // shows up as every series going to zero, which reads as an outage of the
    // thing being measured rather than of the measuring.
    return NextResponse.json({ error: "Could not collect metrics." }, { status: 500 });
  }
}
