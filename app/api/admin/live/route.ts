import { requireAdminApi } from "../../../../lib/api-guards";
import { sseResponse } from "../../../../lib/realtime/sse";
import { LIVE_POLL_MS, LIVE_STREAM_MS } from "../../../../lib/realtime/constants";
import { getLiveSnapshot } from "../../../../lib/realtime/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The stream closes itself at LIVE_STREAM_MS, comfortably inside this.
export const maxDuration = 60;

/**
 * P11 — the live dashboard feed.
 *
 * Admin-only, and guarded *before* the stream opens rather than inside it: a
 * 403 has to be a 403, not a `text/event-stream` that a browser will happily
 * reconnect to forever.
 *
 * Polling Postgres every LIVE_POLL_MS is the honest shape here. There is no
 * change feed to subscribe to — the writes come from `after()` callbacks in
 * other serverless invocations — so anything claiming to be push would be a
 * poll with extra steps. The interval is a deliberate floor on cost: at 4s this
 * is 15 reads a minute for exactly as long as an admin has the tab open, and
 * zero when nobody does.
 */
export async function GET(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  return sseResponse({
    signal: request.signal,
    lifetimeMs: LIVE_STREAM_MS,
    start: (writer) => {
      let inFlight = false;

      const tick = async () => {
        // A slow query must not stack up behind itself. Without this guard a
        // database hiccup turns a 4s poll into an unbounded queue of
        // overlapping reads, which is how a hiccup becomes an outage.
        if (writer.closed || inFlight) return;
        inFlight = true;
        try {
          writer.send("snapshot", await getLiveSnapshot());
        } catch (error) {
          console.error("[admin/live] snapshot failed:", error);
          writer.send("stalled", { at: new Date().toISOString() });
        } finally {
          inFlight = false;
        }
      };

      void tick();
      const timer = setInterval(tick, LIVE_POLL_MS);
      return () => clearInterval(timer);
    },
  });
}
