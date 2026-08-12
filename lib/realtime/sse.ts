/**
 * P11 — the Server-Sent Events transport, factored out of the chat stream.
 *
 * The blueprint asks for WebSockets. Vercel's serverless runtime cannot hold a
 * socket server: there is no process that outlives a request to own the other
 * end of the upgrade. SSE is the transport that survives that constraint —
 * server-push over plain HTTP, with `EventSource` reconnecting on its own — and
 * the upstream half of every duplex feature is a normal POST. The one thing SSE
 * costs is a second connection for client→server traffic, which for a chat
 * message and a heartbeat is not a cost worth a self-hosted socket tier.
 *
 * Three details in here are the difference between a stream that works and one
 * that mysteriously stalls in production, and all three are invisible in local
 * development:
 *
 * 1. **Heartbeat comments.** Intermediaries reap a connection that has been
 *    silent, and a chat with nothing to say is silent by definition. A `:` line
 *    is ignored by `EventSource` and is enough traffic to stay alive.
 * 2. **A lifetime shorter than the platform's function ceiling.** When the
 *    platform kills a function mid-stream the client sees a network error and
 *    reconnects; when we close first it sees a clean end and reconnects. Both
 *    recover, but only one of them is a decision.
 * 3. **`X-Accel-Buffering: no`.** A buffering proxy will hold a streamed
 *    response until it has "enough" of it, which for an infinite stream is
 *    never.
 */

/** Serialise one named event as an SSE frame. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface SseWriter {
  /** Enqueue one named event. A no-op once the stream is closed. */
  send(event: string, data: unknown): void;
  /** Enqueue a bare comment line — invisible to EventSource, visible to proxies. */
  comment(text: string): void;
  /** End the stream. Idempotent, and runs every registered cleanup. */
  close(): void;
  readonly closed: boolean;
}

export interface SseOptions {
  /** The request's signal, so a vanished client tears the stream down. */
  signal: AbortSignal;
  /** Hard lifetime. Keep it under the platform's function ceiling. */
  lifetimeMs: number;
  /** Gap between keep-alive comments. */
  heartbeatMs?: number;
  /**
   * Runs once, with the stream already open. Anything it returns is treated as
   * a cleanup function and runs exactly once on close.
   */
  start: (writer: SseWriter) => void | (() => void) | Promise<void | (() => void)>;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * Build a streaming Response.
 *
 * The lifecycle here is the part worth being careful about: `closed` is checked
 * before every enqueue *and* the enqueue is still wrapped, because the client
 * can vanish between the check and the write, and a throw from inside
 * `controller.enqueue` on a dead stream would otherwise surface as an unhandled
 * rejection in the function's logs rather than as the routine event it is.
 */
export function sseResponse(options: SseOptions): Response {
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const cleanups: Array<() => void> = [];

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const writer: SseWriter = {
        get closed() {
          return closed;
        },
        send(event, data) {
          write(sseFrame(event, data));
        },
        comment(text) {
          write(`: ${text}\n\n`);
        },
        close() {
          if (closed) return;
          closed = true;
          for (const cleanup of cleanups) {
            try {
              cleanup();
            } catch (error) {
              console.error("[sse] cleanup threw:", error);
            }
          }
          try {
            controller.close();
          } catch {
            // Already closed by the platform.
          }
        },
      };

      const heartbeat = setInterval(() => writer.comment("ping"), heartbeatMs);
      const lifetime = setTimeout(() => writer.close(), options.lifetimeMs);
      cleanups.push(
        () => clearInterval(heartbeat),
        () => clearTimeout(lifetime),
      );

      // `once` matters: without it the listener outlives the stream on a reused
      // request signal and calls close() on an already-freed controller.
      options.signal.addEventListener("abort", () => writer.close(), { once: true });

      try {
        const cleanup = await options.start(writer);
        if (typeof cleanup === "function") {
          // The stream can be closed *while* start() is still awaiting; in that
          // case its cleanup would never run, so run it now.
          if (closed) cleanup();
          else cleanups.push(cleanup);
        }
      } catch (error) {
        console.error("[sse] start threw:", error);
        writer.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
