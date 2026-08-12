import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import {
  resolveIdentity,
  getVisitorConversation,
  toPayload,
  authorFor,
} from "../../../../lib/chat";
import { publish } from "../../../../lib/realtime/hub";
import { chatMessageSchema } from "../../../../lib/validations/chat";
import { consume, clientIp } from "../../../../lib/rate-limit";
import { notifyOwnerOfChatMessage } from "../../../../lib/push/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upstream half of the chat transport (the SSE stream is the downstream half). */
export async function POST(request: Request) {
  const identity = await resolveIdentity({ mint: true });

  // 10-message burst, then ~1/second sustained. Enough for a fast typist,
  // not enough for a script.
  const limit = await consume(
    `chat:${identity.guestId ?? identity.userId ?? clientIp(request)}`,
    10,
    1,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "You're sending messages too quickly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = chatMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const { body, conversationId, name, email } = parsed.data;

  // The owner replies into a named thread; a visitor can only ever write to
  // their own, so the client-supplied conversationId is ignored for them.
  const conversation =
    identity.role === "OWNER"
      ? conversationId
        ? await prisma.chatConversation.findUnique({ where: { id: conversationId } })
        : null
      : await getVisitorConversation(identity, true);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  try {
    const message = await prisma.chatMessage.create({
      data: { conversationId: conversation.id, author: authorFor(identity.role), body },
    });

    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: message.createdAt,
        status: "OPEN",
        // Sending implies you stopped typing.
        ...(identity.role === "OWNER" ? { ownerTypingUntil: null } : { visitorTypingUntil: null }),
        // Capture the visitor's details opportunistically — the widget asks
        // for them on first contact, and having them turns an anonymous
        // thread into a lead the owner can follow up on.
        ...(identity.role === "VISITOR" && name && !conversation.visitorName
          ? { visitorName: name }
          : {}),
        ...(identity.role === "VISITOR" && email && !conversation.visitorEmail
          ? { visitorEmail: email }
          : {}),
      },
    });

    publish(conversation.id, { type: "message", message: toPayload(message) });

    // Best-effort: a push failure must not fail the send.
    if (identity.role === "VISITOR") {
      notifyOwnerOfChatMessage({ conversationId: conversation.id, body, name }).catch((error) =>
        console.error("[chat] owner push notification failed:", error),
      );
    }

    return NextResponse.json({ message: toPayload(message) }, { status: 201 });
  } catch (error) {
    console.error("POST /api/chat/messages failed:", error);
    return NextResponse.json({ error: "Could not send that message." }, { status: 500 });
  }
}

/** Thread history — used by the widget when SSE is unavailable. */
export async function GET(request: Request) {
  const identity = await resolveIdentity();
  const url = new URL(request.url);
  const requestedId = url.searchParams.get("conversationId");

  const conversation =
    identity.role === "OWNER" && requestedId
      ? await prisma.chatConversation.findUnique({ where: { id: requestedId } })
      : await getVisitorConversation(identity, false);

  if (!conversation) return NextResponse.json({ conversationId: null, messages: [] });

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return NextResponse.json({
    conversationId: conversation.id,
    messages: messages.map(toPayload),
  });
}
