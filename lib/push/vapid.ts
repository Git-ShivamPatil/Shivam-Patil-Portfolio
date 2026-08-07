import webpush from "web-push";
import { prisma } from "../prisma";

/**
 * Web Push (RFC 8030 / VAPID) sender.
 *
 * Every entry point here is a no-op when VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
 * aren't set, so the whole feature degrades to "no notifications" rather than
 * throwing — a portfolio should still build and run on a clone with no
 * secrets configured.
 */

let configured = false;

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

function configure(): boolean {
  if (!pushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      // The subject must be a mailto: or https: URL identifying the sender —
      // push services reject the JWT otherwise.
      process.env.VAPID_SUBJECT ?? "mailto:shivampatilinfo@gmail.com",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    configured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Deliver to every stored subscription, optionally narrowed to one user.
 *
 * Subscriptions that the push service reports as gone (404/410) are deleted:
 * they represent a browser profile that has revoked or reinstalled, and
 * retrying them forever would be pure waste.
 */
export async function sendPushToAll(
  payload: PushPayload,
  options: { userId?: string } = {},
): Promise<{ sent: number; pruned: number }> {
  if (!configure()) return { sent: 0, pruned: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: options.userId ? { userId: options.userId } : undefined,
  });

  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          dead.push(subscription.id);
        } else {
          console.error("[push] send failed:", status, error);
        }
      }
    }),
  );

  if (dead.length > 0) {
    await prisma.pushSubscription
      .deleteMany({ where: { id: { in: dead } } })
      .catch((error) => console.error("[push] prune failed:", error));
  }

  return { sent, pruned: dead.length };
}

/** Push to whoever holds an ADMIN role — i.e. the site owner. */
export async function sendPushToOwner(payload: PushPayload): Promise<void> {
  if (!configure()) return;

  const owners = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  await Promise.all(owners.map((owner) => sendPushToAll(payload, { userId: owner.id })));
}
