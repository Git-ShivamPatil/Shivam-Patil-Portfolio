import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { resolveIdentity, getVisitorConversation, TYPING_TTL_MS } from "../../../../lib/chat";
import { publish } from "../../../../lib/realtime/hub";
import { chatTypingSchema } from "../../../../lib/validations/chat";
import { consume, clientIp } from "../../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Typing ping. The client debounces to at most one call every ~2s while the
 * composer has content; each call extends a deadline TTL_MS into the future.
 *
 * A deadline rather than a boolean, so a client that closes its tab mid-word
 * can't leave the indicator stuck on — the state expires on its own.
 */
export async function POST(request: Request) {
  const identity = await resolveIdentity();

  const limit = await consume(
    `typing:${identity.guestId ?? identity.userId ?? clientIp(request)}`,
    8,
    1,
  );
  if (!limit.ok) {
    // Typing is cosmetic: swallow the excess quietly rather than surfacing an
    // error the user can do nothing about.
    return NextResponse.json({ ok: true });
  }

  const parsed = chatTypingSchema.safeParse(await request.json().catch(() => ({})));
  const requestedId = parsed.success ? parsed.data.conversationId : undefined;

  const conversation =
    identity.role === "OWNER" && requestedId
      ? await prisma.chatConversation.findUnique({ where: { id: requestedId } })
      : await getVisitorConversation(identity, false);

  if (!conversation) return NextResponse.json({ ok: true });

  const until = new Date(Date.now() + TYPING_TTL_MS);

  try {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: identity.role === "OWNER" ? { ownerTypingUntil: until } : { visitorTypingUntil: until },
    });

    publish(conversation.id, {
      type: "typing",
      who: identity.role,
      until: until.toISOString(),
    });
  } catch (error) {
    console.error("POST /api/chat/typing failed:", error);
  }

  return NextResponse.json({ ok: true });
}
