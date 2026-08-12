import type { ChatAuthor } from "../generated/prisma/enums";
import { sseFrame } from "./sse";

export interface ChatMessagePayload {
  id: string;
  author: ChatAuthor;
  body: string;
  createdAt: string;
  deliveredAt: string;
  readAt: string | null;
}

/**
 * Everything the SSE stream can emit.
 *
 * `read` carries the ids the *other* party has now seen, so a client can mark
 * its own outbound bubbles without refetching the thread. `presence` reports
 * whether the site owner currently has the admin console open.
 */
export type ChatEvent =
  | { type: "ready"; conversationId: string; messages: ChatMessagePayload[] }
  | { type: "message"; message: ChatMessagePayload }
  | { type: "typing"; who: "VISITOR" | "OWNER"; until: string }
  | { type: "read"; ids: string[]; at: string }
  | { type: "presence"; ownerOnline: boolean };

/**
 * Serialise one event as an SSE frame.
 *
 * The frame's event name is the payload's own `type`, so a client's
 * `addEventListener("message", ...)` and the discriminant it switches on can
 * never disagree.
 */
export function encodeSSE(event: ChatEvent): string {
  return sseFrame(event.type, event);
}
