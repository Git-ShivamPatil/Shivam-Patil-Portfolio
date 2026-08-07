import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { resolveIdentity, getVisitorConversation, counterpartOf } from "../../../../lib/chat";
import { publish } from "../../../../lib/realtime/hub";
import { chatReadSchema } from "../../../../lib/validations/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read receipts.
 *
 * The caller acknowledges having seen everything the *other* party sent, so
 * this stamps readAt on the counterpart's unread messages and publishes the
 * affected ids — the original sender's stream turns its ticks from
 * "delivered" to "read" without refetching the thread.
 */
export async function POST(request: Request) {
  const identity = await resolveIdentity();

  const parsed = chatReadSchema.safeParse(await request.json().catch(() => ({})));
  const requestedId = parsed.success ? parsed.data.conversationId : undefined;

  const conversation =
    identity.role === "OWNER" && requestedId
      ? await prisma.chatConversation.findUnique({ where: { id: requestedId } })
      : await getVisitorConversation(identity, false);

  if (!conversation) return NextResponse.json({ ok: true, ids: [] });

  const counterpart = counterpartOf(identity.role);
  const now = new Date();

  try {
    const unread = await prisma.chatMessage.findMany({
      where: { conversationId: conversation.id, author: counterpart, readAt: null },
      select: { id: true },
    });

    if (unread.length === 0) return NextResponse.json({ ok: true, ids: [] });

    const ids = unread.map((m) => m.id);
    await prisma.chatMessage.updateMany({
      where: { id: { in: ids } },
      data: { readAt: now },
    });

    publish(conversation.id, { type: "read", ids, at: now.toISOString() });

    return NextResponse.json({ ok: true, ids });
  } catch (error) {
    console.error("POST /api/chat/read failed:", error);
    return NextResponse.json({ ok: false, ids: [] }, { status: 500 });
  }
}
