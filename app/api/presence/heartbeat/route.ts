import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { clientIp, takeToken } from "../../../../lib/rate-limit";
import { deviceFrom } from "../../../../lib/growth/links";
import { geoFromHeaders } from "../../../../lib/analytics/geo";
import { isExcludedPath, normalizePath } from "../../../../lib/analytics/normalize";
import { heartbeatSchema } from "../../../../lib/validations/presence";
import { PRESENCE_HEARTBEAT_MS } from "../../../../lib/realtime/constants";
import {
  isOwnerOnline,
  prunePresence,
  releasePresence,
  touchPresence,
} from "../../../../lib/realtime/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P11 — presence heartbeat.
 *
 * Shaped after `/api/analytics/collect` on purpose, because it has the same
 * three hazards: it is anonymous, it writes a row, and it is called
 * repeatedly. So it honours opt-outs first, meters second, and validates
 * third — in that order, so an opted-out request never reaches the code that
 * records.
 *
 * What comes *back* is deliberately narrow. The response carries `ownerOnline`
 * and nothing else: telling a visitor "four other people are reading this page"
 * would publish other visitors' behaviour to anyone who opens dev tools, which
 * is not a trade a site with a stated cookieless, no-IP privacy posture gets to
 * make for a decorative badge. The full snapshot exists, and only the
 * authenticated dashboard can read it.
 */

/** Sweep abandoned rows at most this often per instance. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = 0;

/** Same opt-out contract as the analytics ingest — see that route for why. */
function optedOut(headers: Headers): boolean {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}

export async function POST(request: Request) {
  // An opted-out visitor still gets a truthful answer about the owner; they
  // simply are not counted themselves.
  if (optedOut(request.headers)) {
    return NextResponse.json({
      ownerOnline: await isOwnerOnline().catch(() => false),
      intervalMs: PRESENCE_HEARTBEAT_MS,
      recorded: false,
    });
  }

  const ip = clientIp(request);
  // One beat per 20s per tab is the design; 12 burst with a 0.2/s refill leaves
  // room for several tabs from one address without letting a script hold the
  // table open. Metered on IP alone — keying on the token would let a caller
  // rotate it to mint unlimited buckets, which is exactly what the limiter is
  // supposed to stop.
  if (!takeToken(`presence:${ip}`, 12, 0.2).ok) {
    return NextResponse.json(
      { ownerOnline: false, intervalMs: PRESENCE_HEARTBEAT_MS },
      { status: 429 },
    );
  }

  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid heartbeat." }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const isOwner = session?.user?.role === "ADMIN";

  try {
    if (parsed.data.leaving) {
      await releasePresence(parsed.data.token);
      return NextResponse.json({ ownerOnline: false, intervalMs: PRESENCE_HEARTBEAT_MS });
    }

    const path = normalizePath(parsed.data.path);
    // The admin area is excluded from analytics, but the owner *being* in it is
    // the signal the chat widget's "online" badge is built on — so an owner
    // beats from an excluded path while a visitor on one is simply not
    // recorded. The path itself is never stored for the owner.
    if (isOwner) {
      await touchPresence({
        token: parsed.data.token,
        role: "OWNER",
        path: "/admin",
        device: deviceFrom(request.headers.get("user-agent") ?? ""),
        country: null,
        userId: session?.user?.id ?? null,
      });
    } else if (!isExcludedPath(path)) {
      await touchPresence({
        token: parsed.data.token,
        role: "VISITOR",
        path,
        device: deviceFrom(request.headers.get("user-agent") ?? ""),
        country: geoFromHeaders(request.headers).country,
        userId: null,
      });
    }

    const now = Date.now();
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      // Not awaited into the response path: a slow prune must not make a
      // visitor's heartbeat slow. A failure here is invisible and harmless —
      // every read already filters on freshness, so a stale row costs storage,
      // not correctness.
      void prunePresence(now).catch((error) => console.error("[presence] prune failed:", error));
    }

    return NextResponse.json({
      ownerOnline: await isOwnerOnline(now),
      intervalMs: PRESENCE_HEARTBEAT_MS,
      recorded: true,
    });
  } catch (error) {
    console.error("POST /api/presence/heartbeat failed:", error);
    // Presence is decorative. A database blip must degrade the badge, not
    // surface an error to a visitor who never asked for any of this.
    return NextResponse.json({ ownerOnline: false, intervalMs: PRESENCE_HEARTBEAT_MS });
  }
}
