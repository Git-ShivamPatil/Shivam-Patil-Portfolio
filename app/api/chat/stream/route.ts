import { prisma } from "../../../../lib/prisma";
import { resolveIdentity, getVisitorConversation, toPayload } from "../../../../lib/chat";
import { subscribe } from "../../../../lib/realtime/hub";
import { encodeSSE, type ChatEvent } from "../../../../lib/realtime/events";

// Must be Node, not Edge: this holds a long-lived stream and talks to Prisma.
export const runtime = "nodejs";
// A streamed response must never be cached or statically evaluated.
export const dynamic = "force-dynamic";

/** How often the stream reconciles against Postgres. */
const POLL_MS = 1500;
/** Comment frame interval — keeps proxies from reaping an idle connection. */
const HEARTBEAT_MS = 15000;
/** Hard lifetime; the browser's EventSource reconnects automatically after. */
const MAX_STREAM_MS = 4 * 60 * 1000;

/**
 * Server-Sent Events transport for the visitor chat widget.
 *
 * Vercel's serverless runtime cannot host a raw WebSocket server, so the
 * downstream half of "WS-Chat" is SSE and the upstream half is a plain POST
 * to /api/chat/messages. From the client's point of view the semantics are
 * the same — push delivery, typing indicators, read receipts — and swapping
 * in a real socket later only touches this file plus the client hook.
 *
 * Delivery is guaranteed by the Postgres poll below; the in-memory hub is
 * layered on top purely to make same-instance delivery feel instant. Both
 * paths funnel through the same cursor, so an event arriving twice is
 * de-duplicated rather than shown twice.
 */
export async function GET(request: Request) {
  const identity = await resolveIdentity({ mint: true });

  const url = new URL(request.url);
  // The owner streams a specific visitor thread from the admin console;
  // a visitor always streams their own.
  const requestedId = url.searchParams.get("conversationId");

  const conversation =
    identity.role === "OWNER" && requestedId
      ? await prisma.chatConversation.findUnique({ where: { id: requestedId } })
      : await getVisitorConversation(identity, true);

  if (!conversation) {
    return new Response("Conversation not found.", { status: 404 });
  }
  const conversationId = conversation.id;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSSE(event)));
        } catch {
          // The client vanished between our check and the enqueue.
          closed = true;
        }
      };

      const history = await prisma.chatMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        take: 200,
      });

      // Cursor is the newest message id we've emitted, tracked alongside its
      // timestamp: createdAt alone can collide when two rows share a
      // millisecond, which would silently drop one of them.
      let lastCreatedAt = history.at(-1)?.createdAt ?? new Date(0);
      const emitted = new Set(history.map((m) => m.id));
      let lastTypingSignature = "";
      let lastReadSignature = "";

      send({ type: "ready", conversationId, messages: history.map(toPayload) });

      const unsubscribe = subscribe(conversationId, (event) => {
        if (event.type === "message") {
          if (emitted.has(event.message.id)) return;
          emitted.add(event.message.id);
          const created = new Date(event.message.createdAt);
          if (created > lastCreatedAt) lastCreatedAt = created;
        }
        send(event);
      });

      const poll = async () => {
        if (closed) return;
        try {
          const fresh = await prisma.chatMessage.findMany({
            where: { conversationId, createdAt: { gte: lastCreatedAt } },
            orderBy: { createdAt: "asc" },
            take: 100,
          });

          for (const message of fresh) {
            if (emitted.has(message.id)) continue;
            emitted.add(message.id);
            if (message.createdAt > lastCreatedAt) lastCreatedAt = message.createdAt;
            send({ type: "message", message: toPayload(message) });
          }

          const state = await prisma.chatConversation.findUnique({
            where: { id: conversationId },
            select: { visitorTypingUntil: true, ownerTypingUntil: true },
          });

          if (state) {
            const now = Date.now();
            // Only report the *other* side typing — echoing a client's own
            // typing back to it would light its own indicator.
            const theirDeadline =
              identity.role === "OWNER" ? state.visitorTypingUntil : state.ownerTypingUntil;
            const who = identity.role === "OWNER" ? "VISITOR" : "OWNER";
            const active = theirDeadline && theirDeadline.getTime() > now;
            const signature = active ? theirDeadline.toISOString() : "";
            if (signature !== lastTypingSignature) {
              lastTypingSignature = signature;
              send({
                type: "typing",
                who,
                until: active ? theirDeadline.toISOString() : new Date(0).toISOString(),
              });
            }
          }

          // Read receipts for messages this side authored.
          const mine = identity.role === "OWNER" ? "OWNER" : "VISITOR";
          const readRows = await prisma.chatMessage.findMany({
            where: { conversationId, author: mine, readAt: { not: null } },
            select: { id: true, readAt: true },
            orderBy: { readAt: "desc" },
            take: 50,
          });
          const readSignature = readRows.map((r) => r.id).join(",");
          if (readSignature && readSignature !== lastReadSignature) {
            lastReadSignature = readSignature;
            send({
              type: "read",
              ids: readRows.map((r) => r.id),
              at: (readRows[0].readAt ?? new Date()).toISOString(),
            });
          }
        } catch (error) {
          console.error("[chat/stream] poll failed:", error);
        }
      };

      const pollTimer = setInterval(poll, POLL_MS);
      const heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          // A bare SSE comment: ignored by EventSource, but enough traffic to
          // stop an intermediary from treating the connection as idle.
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const shutdown = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        clearTimeout(lifetimeTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the platform.
        }
      };

      const lifetimeTimer = setTimeout(shutdown, MAX_STREAM_MS);
      request.signal.addEventListener("abort", shutdown);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx-style proxies not to buffer the stream into oblivion.
      "X-Accel-Buffering": "no",
    },
  });
}
