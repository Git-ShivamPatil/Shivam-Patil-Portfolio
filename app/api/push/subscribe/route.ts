import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { auth } from "../../../../auth";
import { vapidPublicKey, pushConfigured } from "../../../../lib/push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/** The browser needs the VAPID public key before it can subscribe. */
export async function GET() {
  return NextResponse.json({ publicKey: vapidPublicKey(), enabled: pushConfigured() });
}

export async function POST(request: Request) {
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Push is not configured on this server." }, { status: 503 });
  }

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;
  const session = await auth();

  try {
    // Upsert on endpoint: the browser reissues the same endpoint for a given
    // profile, so re-granting permission should refresh the row rather than
    // accumulate duplicates that all deliver the same notification.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId: session?.user?.id ?? null,
        userAgent: request.headers.get("user-agent")?.slice(0, 255) ?? null,
      },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId: session?.user?.id ?? null,
        lastSeenAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/push/subscribe failed:", error);
    return NextResponse.json({ error: "Could not save subscription." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const parsed = z.object({ endpoint: z.url() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  // deleteMany, not delete: unsubscribing an endpoint we never stored is a
  // no-op success, not a 404 the client has to special-case.
  await prisma.pushSubscription
    .deleteMany({ where: { endpoint: parsed.data.endpoint } })
    .catch((error) => console.error("DELETE /api/push/subscribe failed:", error));

  return NextResponse.json({ ok: true });
}
