import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { prisma } from "../../../../lib/prisma";
import { generateApiKey, TIER_MULTIPLIER, DAILY_CAP, utcDay } from "../../../../lib/api/metering";
import { isUniqueConstraintOn } from "../../../../lib/prisma-errors";
import { withRed } from "../../../../lib/sre/red";
import { consume, clientIp } from "../../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/account/api-keys";

/**
 * P27 — key management for the signed-in owner.
 *
 * Under `/account/`, which `robots.ts` disallows and which requires a session.
 * Keys are per-user, and a user only ever sees their own — the `userId` filter
 * is on every query here rather than trusting an id from the request body,
 * which is the shape an IDOR takes when someone adds a "which key?" parameter
 * later.
 *
 * **The secret is returned exactly once, by POST, and never again.** GET lists
 * prefixes and usage; there is no endpoint that can reveal a secret after
 * creation, because only its SHA-256 was stored. That is not an inconvenience
 * to work around — it is the property that makes a leaked database dump
 * useless.
 */

export const GET = withRed(ROUTE, handleGET);
export const POST = withRed(ROUTE, handlePOST);
export const DELETE = withRed(ROUTE, handleDELETE);

async function handleGET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      prefix: true,
      name: true,
      tier: true,
      status: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      // Today only. A key's lifetime total is a different question and a much
      // more expensive one; this is the number that decides whether the next
      // request will be refused.
      usage: {
        where: { day: utcDay() },
        select: { route: true, count: true, units: true },
      },
    },
  });

  return NextResponse.json({
    keys: keys.map((key) => {
      const today = key.usage.reduce((sum, row) => sum + row.count, 0);
      return {
        id: key.id,
        prefix: key.prefix,
        name: key.name,
        tier: key.tier,
        status: key.status,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
        usageToday: today,
        dailyCap: DAILY_CAP[key.tier],
        // Stated so the page can say "5× the anonymous limit" rather than
        // printing a number that means nothing without its baseline.
        rateMultiplier: TIER_MULTIPLIER[key.tier],
        byRoute: key.usage,
      };
    }),
  });
}

/** How many live keys one account may hold. */
const MAX_KEYS = 10;

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // Key creation writes a row and burns entropy; it is not a hot path and a
  // stuck client should not be able to fill the table.
  const limit = await consume(`api-keys:${clientIp(request)}`, 5, 0.05);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many key operations. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (name.length < 1) {
    return NextResponse.json({ error: "Give the key a name." }, { status: 400 });
  }

  const live = await prisma.apiKey.count({
    where: { userId: session.user.id, status: "ACTIVE" },
  });
  if (live >= MAX_KEYS) {
    return NextResponse.json(
      { error: `You already have ${MAX_KEYS} active keys. Revoke one first.` },
      { status: 409 },
    );
  }

  // Retried on a prefix collision, for the same reason booking references are
  // (lib/bookings.ts): `prefix` is @unique, and an unretried create turns a
  // 1-in-4-billion event into a 500 for the person it happens to.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generated = generateApiKey();
    try {
      const key = await prisma.apiKey.create({
        data: {
          hash: generated.hash,
          prefix: generated.prefix,
          name,
          userId: session.user.id,
        },
        select: { id: true, prefix: true, name: true, tier: true, createdAt: true },
      });

      return NextResponse.json(
        {
          key,
          // The only time this value exists outside the caller's own storage.
          secret: generated.secret,
          warning: "Copy this now. It is stored only as a hash and cannot be shown again.",
        },
        { status: 201 },
      );
    } catch (error) {
      if (!isUniqueConstraintOn(error, "prefix") && !isUniqueConstraintOn(error, "hash"))
        throw error;
      console.warn(`[api-keys] key collision on attempt ${attempt + 1}/3`);
    }
  }

  return NextResponse.json({ error: "Could not create a key. Try again." }, { status: 500 });
}

/**
 * Revoke a key.
 *
 * Marks it REVOKED rather than deleting the row. `UsageRecord` cascades on
 * delete, so removing the key would take its usage history with it — and the
 * history is the record of what a key did, which is exactly what you want to
 * still have after revoking one because it leaked.
 */
async function handleDELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which key?" }, { status: 400 });

  // Scoped by userId in the same statement, so a caller cannot revoke someone
  // else's key by guessing an id. `updateMany` rather than `update` because it
  // accepts a compound filter and reports how many rows matched.
  const result = await prisma.apiKey.updateMany({
    where: { id, userId: session.user.id, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "No such active key." }, { status: 404 });
  }

  return NextResponse.json({ revoked: id });
}
