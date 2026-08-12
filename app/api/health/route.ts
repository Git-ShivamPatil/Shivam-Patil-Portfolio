import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { prisma } from "../../../lib/prisma";
import { clientIp, consume } from "../../../lib/rate-limit";
import { missingRequired, secretsReport } from "../../../lib/security/vault";
import { isSentryConfigured } from "../../../lib/observability/sentry";
import { isRedisConfigured } from "../../../lib/security/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P14 — liveness and readiness.
 *
 * Two audiences, one endpoint, and the difference between what they see is the
 * whole design:
 *
 * - **Anonymous** gets a status, a version and whether the database answered.
 *   That is what a container orchestrator, an uptime monitor or a load balancer
 *   needs, and it is deliberately the least interesting information about this
 *   deployment. It is also rate-limited, because it runs a query.
 * - **An admin** additionally gets the secrets report: which integrations are
 *   configured and what each missing one disables. Never a value, not even a
 *   redacted one — this is an HTTP response, and two characters of a production
 *   database password is still two characters of it.
 *
 * The status codes matter more than the body. A 200 means "route traffic here";
 * a 503 means "do not". Returning 200 with `{"status":"degraded"}` in the body
 * would be read as healthy by every automated consumer there is.
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

async function databaseCheck(): Promise<Check> {
  const started = Date.now();
  try {
    // The cheapest possible round trip. A health check that runs a real query
    // is a health check that gets slower as the site gets busier, and one that
    // can take the site down by being polled.
    await prisma.$queryRaw`SELECT 1`;
    return { name: "database", ok: true, detail: "reachable", latencyMs: Date.now() - started };
  } catch (error) {
    return {
      name: "database",
      ok: false,
      // The message, not the connection string. lib/prisma.ts holds the URL;
      // Prisma's errors have been known to echo it back.
      detail: error instanceof Error ? error.name : "unreachable",
      latencyMs: Date.now() - started,
    };
  }
}

export async function GET(request: Request) {
  // Anonymous and it runs a query, so it is metered like every other endpoint
  // with that shape. Generous enough for a monitor polling every 30 seconds
  // from several regions.
  if (!(await consume(`health:${clientIp(request)}`, 30, 0.5)).ok) {
    return NextResponse.json({ status: "throttled" }, { status: 429 });
  }

  const [database, session] = await Promise.all([databaseCheck(), auth().catch(() => null)]);
  const isAdmin = session?.user?.role === "ADMIN";

  const missing = missingRequired();
  // "Healthy" means it can serve, not that every optional integration is
  // configured. Web push being off is a feature being off; the database being
  // unreachable is an outage.
  const healthy = database.ok && missing.length === 0;

  const body: Record<string, unknown> = {
    status: healthy ? "ok" : "degraded",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    region: process.env.VERCEL_REGION ?? null,
    checks: [database] satisfies Check[],
    // Safe to state publicly: whether error reporting and shared rate limiting
    // are switched on says nothing an attacker can use, and their absence is
    // exactly what tends to go unnoticed.
    features: {
      errorReporting: isSentryConfigured(),
      sharedRateLimit: isRedisConfigured(),
    },
  };

  if (isAdmin) {
    body.secrets = secretsReport();
    body.missingRequired = missing;
  }

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
