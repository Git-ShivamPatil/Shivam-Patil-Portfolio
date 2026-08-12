import { NextResponse } from "next/server";
import { clientIp, consume } from "../../../lib/rate-limit";
import { reportError } from "../../../lib/observability/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P14 — the client half of error reporting.
 *
 * `onRequestError` in instrumentation.ts covers everything thrown on the
 * server. This covers the errors that only exist in a browser: a hydration
 * mismatch, a component that throws after an interaction, anything that reaches
 * app/global-error.tsx. Those never touch a server log at all.
 *
 * It posts through us rather than letting the browser talk to Sentry directly,
 * which is the whole reason the endpoint exists. A browser-side DSN is public
 * by construction, and `connect-src 'self'` — the CSP directive doing the most
 * work in P13 — would have to be widened to allow it. Relaying keeps the DSN
 * server-side and the policy tight.
 *
 * **Everything arriving here is attacker-controlled**, since it is anonymous
 * and accepts a stack trace. So it is metered hard, bounded hard, and the error
 * is reconstructed from scratch rather than forwarded — a caller cannot choose
 * their own tags, level or fingerprint and pollute the issue stream.
 */

const MAX_MESSAGE = 500;
const MAX_STACK = 4_000;

export async function POST(request: Request) {
  // Tighter than the analytics beacon: a page in a crash loop would otherwise
  // report forever, and one broken deploy would be thousands of identical
  // events. Five per client with a slow refill is enough to see the problem.
  if (!(await consume(`error-report:${clientIp(request)}`, 5, 1 / 60)).ok) {
    return new NextResponse(null, { status: 204 });
  }

  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > 8_000) return new NextResponse(null, { status: 204 });

  let body: { message?: unknown; stack?: unknown; digest?: unknown; path?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const message = typeof body.message === "string" ? body.message.slice(0, MAX_MESSAGE) : "";
  if (!message) return new NextResponse(null, { status: 204 });

  const error = new Error(message);
  error.name = "ClientError";
  error.stack =
    typeof body.stack === "string" ? `ClientError: ${message}\n${body.stack.slice(0, MAX_STACK)}` : undefined;

  await reportError(error, {
    source: "client",
    path: typeof body.path === "string" ? body.path.slice(0, 200) : undefined,
    tags: {
      // Next's error digest, which is the only handle on the matching server
      // error when one exists — a digest is what a production build shows the
      // browser instead of the real message.
      digest: typeof body.digest === "string" ? body.digest.slice(0, 64) : undefined,
      userAgent: request.headers.get("user-agent")?.slice(0, 160),
    },
  });

  // 204 whatever happened. The page is already showing an error screen; there
  // is nothing useful a failed report could tell it.
  return new NextResponse(null, { status: 204 });
}
