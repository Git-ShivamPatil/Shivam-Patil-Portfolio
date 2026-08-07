import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { auth } from "../auth";
import type { ChatMessagePayload } from "./realtime/events";

export const GUEST_COOKIE = "sf_chat_guest";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

/** How long a single typing ping keeps the indicator lit. */
export const TYPING_TTL_MS = 5000;

export interface ChatIdentity {
  /** Which side of the conversation this request is acting as. */
  role: "VISITOR" | "OWNER";
  guestId: string | null;
  userId: string | null;
}

/**
 * Identify the caller.
 *
 * An authenticated ADMIN is the site owner replying from /admin/chat;
 * everyone else is a visitor keyed by an opaque 32-byte cookie. The cookie
 * value *is* the credential — there is nothing to sign, because guessing a
 * 256-bit random id is not a practical attack, and a signature would only
 * prove we minted it, not who holds it.
 */
export async function resolveIdentity(options: { mint?: boolean } = {}): Promise<ChatIdentity> {
  const session = await auth();
  if (session?.user?.role === "ADMIN") {
    return { role: "OWNER", guestId: null, userId: session.user.id };
  }

  const jar = await cookies();
  let guestId = jar.get(GUEST_COOKIE)?.value ?? null;

  if (!guestId && options.mint) {
    guestId = randomBytes(32).toString("hex");
    jar.set(GUEST_COOKIE, guestId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_COOKIE_MAX_AGE,
    });
  }

  return { role: "VISITOR", guestId, userId: session?.user?.id ?? null };
}

/**
 * Find (or optionally create) the conversation this visitor owns.
 *
 * Returns null when a visitor has no cookie yet and `create` is false — that
 * is the "first paint, nothing to show" case, not an error.
 */
export async function getVisitorConversation(identity: ChatIdentity, create: boolean) {
  if (!identity.guestId) return null;

  const existing = await prisma.chatConversation.findUnique({
    where: { guestId: identity.guestId },
  });
  if (existing || !create) return existing;

  return prisma.chatConversation.create({
    data: { guestId: identity.guestId, userId: identity.userId ?? undefined },
  });
}

export function toPayload(message: {
  id: string;
  author: ChatMessagePayload["author"];
  body: string;
  createdAt: Date;
  deliveredAt: Date;
  readAt: Date | null;
}): ChatMessagePayload {
  return {
    id: message.id,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    deliveredAt: message.deliveredAt.toISOString(),
    readAt: message.readAt ? message.readAt.toISOString() : null,
  };
}

/** The author value a given side writes as. */
export function authorFor(role: ChatIdentity["role"]) {
  return role === "OWNER" ? ("OWNER" as const) : ("VISITOR" as const);
}

/** The author value a given side reads receipts *for*. */
export function counterpartOf(role: ChatIdentity["role"]) {
  return role === "OWNER" ? ("VISITOR" as const) : ("OWNER" as const);
}
