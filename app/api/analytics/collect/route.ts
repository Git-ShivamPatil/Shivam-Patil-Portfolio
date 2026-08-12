import { NextResponse, after } from "next/server";
import { clientIp, consume } from "../../../../lib/rate-limit";
import { collectSchema } from "../../../../lib/validations/analytics";
import { recordVisit } from "../../../../lib/analytics/collect";
import { geoFromHeaders } from "../../../../lib/analytics/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P10 — analytics ingest.
 *
 * Three properties this endpoint has to hold, in order of importance:
 *
 * 1. **It never affects the visitor.** The write happens in `after()` and the
 *    response is always 204, even for a payload we rejected. A tracker that
 *    can produce a visible error, a console spew, or a slow request has cost
 *    the site more than the data is worth.
 * 2. **It honours opt-outs before it does anything else.** DNT and Sec-GPC are
 *    checked ahead of the rate limiter and the parser, so an opt-out request
 *    is not merely unrecorded — it never touches the code that records.
 * 3. **It is bounded.** Anonymous and row-writing is the combination that
 *    needs metering; the token bucket caps request rate and the zod schema
 *    (lib/validations/analytics.ts) caps how many rows any one accepted
 *    request can produce.
 */

/** 204 with no body — the browser's `sendBeacon` ignores the response anyway. */
function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * Do Not Track / Global Privacy Control.
 *
 * Honoured rather than ignored, which is a choice — most analytics ignores
 * both, and DNT in particular is widely treated as dead. It costs two header
 * reads and it is the difference between "we collect nothing that identifies
 * you" being a design claim and being a behaviour. GPC additionally carries
 * legal weight under CCPA/CPRA.
 */
function optedOut(headers: Headers): boolean {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}

export async function POST(request: Request) {
  if (optedOut(request.headers)) return noContent();

  const ip = clientIp(request);

  // Sized for a real reading session, not for a single page: a long visit
  // legitimately produces a periodic flush every 30s plus a flush per
  // navigation. 40 burst with a ~0.5/s refill covers that comfortably while
  // still cutting a scripted loop off in under a minute. Metered on IP alone
  // for the same reason as the /r/[code] redirect — the visitor hash mixes in
  // the User-Agent, so keying on both would let a caller rotate that header to
  // mint an unlimited number of fresh buckets.
  const budget = await consume(`analytics:${ip}`, 40, 0.5);
  if (!budget.ok) return noContent();

  // `sendBeacon` posts a Blob, so the Content-Type is whatever the client set
  // and cannot be relied on. Parse the text and let JSON.parse decide.
  const raw = await request.text().catch(() => "");
  // 16KB is far above the largest legitimate payload (a full 40-event batch is
  // ~4KB) and far below anything worth a parse attempt.
  if (!raw || raw.length > 16_384) return noContent();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noContent();
  }

  const parsed = collectSchema.safeParse(body);
  if (!parsed.success) return noContent();

  const context = {
    ip,
    userAgent: request.headers.get("user-agent") ?? "",
    geo: geoFromHeaders(request.headers),
    selfHost: request.headers.get("host"),
  };

  // Deferred: the browser is told "done" immediately and the database work
  // happens after the response is flushed.
  after(() => recordVisit(parsed.data, context));

  return noContent();
}
