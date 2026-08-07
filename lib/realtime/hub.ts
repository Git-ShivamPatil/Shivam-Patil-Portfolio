import type { ChatEvent } from "./events";

type Subscriber = (event: ChatEvent) => void;

/**
 * In-process fan-out for chat events.
 *
 * This is a *latency optimisation, not the delivery guarantee*. On a
 * serverless platform each request may land in a different instance, so a
 * message POSTed to instance A can never reach an SSE stream held open by
 * instance B through shared memory. Correctness therefore comes from the
 * stream's database poll (see app/api/chat/stream/route.ts); this hub only
 * collapses the poll interval to ~0 for the common single-instance case, and
 * for `pnpm dev` where there is only ever one process.
 *
 * Cached on globalThis so Next's dev-mode hot reload doesn't orphan the
 * existing subscribers behind a fresh module instance.
 */
const globalForHub = globalThis as unknown as {
  chatHub?: Map<string, Set<Subscriber>>;
};

const channels: Map<string, Set<Subscriber>> = (globalForHub.chatHub ??= new Map());

export function subscribe(conversationId: string, subscriber: Subscriber): () => void {
  let set = channels.get(conversationId);
  if (!set) {
    set = new Set();
    channels.set(conversationId, set);
  }
  set.add(subscriber);

  return () => {
    set.delete(subscriber);
    // Drop the channel entirely once empty, so a long-lived process doesn't
    // accumulate an entry per conversation that ever existed.
    if (set.size === 0) channels.delete(conversationId);
  };
}

export function publish(conversationId: string, event: ChatEvent): void {
  const set = channels.get(conversationId);
  if (!set) return;
  for (const subscriber of set) {
    try {
      subscriber(event);
    } catch (error) {
      // One broken stream must not stop delivery to the others.
      console.error("[realtime] subscriber threw:", error);
    }
  }
}
