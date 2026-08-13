import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { auth } from "../../../../auth";
import { drainOutbox, outboxDepth, type Handler } from "../../../../lib/distsys/outbox";
import { pruneIdempotency } from "../../../../lib/distsys/idempotency";
import { sendContactFormEmail } from "../../../../lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * P18 — the outbox worker.
 *
 * Shaped exactly like the retention cron, including the constant-time bearer
 * check, because it has the same threat model: an unauthenticated endpoint that
 * does real work on a schedule.
 *
 * **The handlers are here rather than beside their features on purpose.** An
 * outbox is only worth having if the set of things that can be emitted is
 * enumerable — a handler registered from wherever happens to import first is a
 * queue whose behaviour depends on the module graph. `drainOutbox` dead-letters
 * an unknown topic rather than retrying it forever, which turns "someone
 * emitted an event nobody handles" into a visible count instead of an infinite
 * retry loop.
 */

function authorized(request: Request, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * Every topic the site can emit.
 *
 * A handler must be idempotent: the worker guarantees at-least-once delivery,
 * not exactly-once. Exactly-once across a process boundary is not available at
 * any price — the acknowledgement can always be the thing that is lost — so the
 * honest design is to retry and make the handler tolerate it.
 */
const HANDLERS: Record<string, Handler> = {
  "contact.received": async (payload) => {
    const { name, email, message } = payload as { name: string; email: string; message: string };
    // Sending twice is a duplicate email, which is the acceptable failure. Not
    // sending at all is the one this whole mechanism exists to prevent.
    await sendContactFormEmail({ name, email, message });
  },

  "newsletter.confirmed": async () => {
    // No side effect yet — the confirmation email is sent inline by the
    // confirm route. Registered so the topic is not dead-lettered if something
    // starts emitting it before the handler is written.
  },

  "booking.confirmed": async () => {
    // The Razorpay webhook already sends its own confirmation inline, and that
    // path is signature-verified and idempotent. Registered for the same reason
    // as above.
  },

  "index.rebuild": async () => {
    const { rebuildIndex } = await import("../../../../lib/ai/indexer");
    await rebuildIndex();
  },
};

export async function GET(request: Request) {
  const session = await auth().catch(() => null);
  if (!authorized(request, session?.user?.role === "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  try {
    const drained = await drainOutbox(HANDLERS);
    const pruned = await pruneIdempotency();
    const depth = await outboxDepth();

    return NextResponse.json({ drained, prunedIdempotencyRecords: pruned, depth });
  } catch (error) {
    console.error("GET /api/cron/outbox failed:", error);
    return NextResponse.json({ error: "Outbox drain failed." }, { status: 500 });
  }
}
