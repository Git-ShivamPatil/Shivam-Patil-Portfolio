import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sseFrame, sseResponse } from "../lib/realtime/sse";
import {
  EMPTY_PRESENCE,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TTL_MS,
  isPresenceToken,
} from "../lib/realtime/constants";
import { heartbeatSchema } from "../lib/validations/presence";
import { encodeSSE } from "../lib/realtime/events";

/**
 * P11 — realtime.
 *
 * The transport and the presence window are the two things here that can be
 * wrong without anything visibly breaking: a stream that never closes leaks a
 * function slot, and a freshness window that disagrees with the client's beat
 * interval makes present visitors flicker. Both are pinned below.
 */

const groupBy = vi.fn();
const count = vi.fn();
const upsert = vi.fn();
const deleteMany = vi.fn();
const findMany = vi.fn();
const pageViewCount = vi.fn();
const pageViewFindMany = vi.fn();
const eventCount = vi.fn();
const eventFindMany = vi.fn();

vi.mock("../lib/prisma", () => ({
  prisma: {
    presenceSession: {
      groupBy: (...args: unknown[]) => groupBy(...args),
      count: (...args: unknown[]) => count(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
    pageView: {
      count: (...args: unknown[]) => pageViewCount(...args),
      findMany: (...args: unknown[]) => pageViewFindMany(...args),
    },
    analyticsEvent: {
      count: (...args: unknown[]) => eventCount(...args),
      findMany: (...args: unknown[]) => eventFindMany(...args),
    },
  },
}));

const { freshSince, getPresence, isOwnerOnline, prunePresence, touchPresence } =
  await import("../lib/realtime/presence");
const { getLiveSnapshot } = await import("../lib/realtime/live");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SSE framing", () => {
  it("names the frame and JSON-encodes the payload", () => {
    expect(sseFrame("snapshot", { visitors: 2 })).toBe('event: snapshot\ndata: {"visitors":2}\n\n');
  });

  it("gives a chat event the same name as its discriminant", () => {
    // A client listens by event name and switches on `type`. If those two ever
    // disagreed, the listener would fire and the switch would fall through.
    const frame = encodeSSE({ type: "presence", ownerOnline: true });
    expect(frame.startsWith("event: presence\n")).toBe(true);
    expect(JSON.parse(frame.split("data: ")[1]).type).toBe("presence");
  });

  it("terminates every frame with a blank line", () => {
    // Without the double newline the client buffers the frame forever waiting
    // for the end of it — the stream looks connected and delivers nothing.
    expect(sseFrame("x", {}).endsWith("\n\n")).toBe(true);
  });
});

describe("sseResponse", () => {
  it("declares the streaming headers a proxy needs to leave it alone", async () => {
    const response = sseResponse({
      signal: new AbortController().signal,
      lifetimeMs: 50,
      start: (writer) => writer.close(),
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    await response.text();
  });

  it("emits what start() sends, then ends", async () => {
    const response = sseResponse({
      signal: new AbortController().signal,
      lifetimeMs: 5_000,
      start: (writer) => {
        writer.send("snapshot", { visitors: 1 });
        writer.send("snapshot", { visitors: 2 });
        writer.close();
      },
    });

    const body = await response.text();
    expect(body).toContain('data: {"visitors":1}');
    expect(body).toContain('data: {"visitors":2}');
  });

  it("closes at its lifetime cap and heartbeats until it does", async () => {
    vi.useFakeTimers();
    let cleanups = 0;

    const response = sseResponse({
      signal: new AbortController().signal,
      lifetimeMs: 1_000,
      heartbeatMs: 300,
      start: (writer) => {
        writer.send("hello", { ok: true });
        return () => {
          cleanups += 1;
        };
      },
    });

    await vi.advanceTimersByTimeAsync(1_200);
    const body = await response.text();
    vi.useRealTimers();

    expect(body).toContain("event: hello");
    // A silent stream is a stream an intermediary will reap.
    expect(body).toContain(": ping");
    expect(cleanups).toBe(1);
  });

  it("tears down when the client vanishes, and runs cleanup exactly once", async () => {
    const controller = new AbortController();
    let cleanups = 0;

    const response = sseResponse({
      signal: controller.signal,
      lifetimeMs: 60_000,
      start: (writer) => {
        writer.send("hello", {});
        return () => {
          cleanups += 1;
        };
      },
    });

    // Let start() run before aborting.
    await Promise.resolve();
    controller.abort();
    controller.abort();

    await response.text();
    expect(cleanups).toBe(1);
  });

  it("ignores sends after close instead of throwing", async () => {
    let threw = false;
    const response = sseResponse({
      signal: new AbortController().signal,
      lifetimeMs: 5_000,
      start: (writer) => {
        writer.close();
        try {
          writer.send("late", {});
        } catch {
          threw = true;
        }
      },
    });

    const body = await response.text();
    expect(threw).toBe(false);
    expect(body).not.toContain("event: late");
  });
});

describe("presence tokens", () => {
  it("accepts a dash-stripped UUID and nothing else", () => {
    expect(isPresenceToken("0123456789abcdef0123456789abcdef")).toBe(true);
    // A unique column fed by an anonymous endpoint: anything unbounded here
    // lets a caller pick their own row keys and mint one per request.
    expect(isPresenceToken("0123456789ABCDEF0123456789abcdef")).toBe(false);
    expect(isPresenceToken("short")).toBe(false);
    expect(isPresenceToken("0123456789abcdef0123456789abcdef0")).toBe(false);
    expect(isPresenceToken(null)).toBe(false);
    expect(isPresenceToken(42)).toBe(false);
  });

  it("applies the same rule at the request boundary", () => {
    expect(heartbeatSchema.safeParse({ token: "x", path: "/" }).success).toBe(false);
    // 32 characters, but "g" is not hex.
    expect(heartbeatSchema.safeParse({ token: "g".repeat(32), path: "/about" }).success).toBe(
      false,
    );
    expect(heartbeatSchema.safeParse({ token: "0".repeat(32), path: "/about" }).success).toBe(true);
    expect(
      heartbeatSchema.safeParse({ token: "0".repeat(32), path: "/x".repeat(400) }).success,
    ).toBe(false);
  });
});

describe("the freshness window", () => {
  it("leaves room for a dropped beat", () => {
    // Two beats per window. At one, a single lost request would blink a present
    // visitor out and back — which reads as a bug in the dashboard, not in the
    // network.
    expect(PRESENCE_TTL_MS).toBeGreaterThanOrEqual(PRESENCE_HEARTBEAT_MS * 2);
  });

  it("cuts off exactly one TTL back", () => {
    const now = 1_800_000_000_000;
    expect(freshSince(now).getTime()).toBe(now - PRESENCE_TTL_MS);
  });

  it("starts from a snapshot that claims nothing", () => {
    expect(EMPTY_PRESENCE.ownerOnline).toBe(false);
    expect(EMPTY_PRESENCE.visitors).toBe(0);
  });
});

describe("getPresence", () => {
  it("sums the grouped counts and reports the owner separately", async () => {
    count.mockResolvedValue(1);
    groupBy
      .mockResolvedValueOnce([
        { path: "/", _count: { _all: 3 } },
        { path: "/about", _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([{ country: "IN", _count: { _all: 4 } }]);

    const snapshot = await getPresence(1_800_000_000_000);

    expect(snapshot.ownerOnline).toBe(true);
    expect(snapshot.visitors).toBe(5);
    expect(snapshot.paths[0]).toEqual({ path: "/", count: 3 });
    expect(snapshot.countries).toEqual(["IN"]);
    expect(snapshot.at).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it("counts only OWNER rows inside the window for isOwnerOnline", async () => {
    count.mockResolvedValue(0);
    expect(await isOwnerOnline(1_800_000_000_000)).toBe(false);

    const where = count.mock.calls[0][0].where;
    expect(where.role).toBe("OWNER");
    expect(where.lastSeenAt.gte.getTime()).toBe(1_800_000_000_000 - PRESENCE_TTL_MS);
  });

  it("never counts a visitor's own tab as the owner being online", async () => {
    count.mockResolvedValue(0);
    groupBy.mockResolvedValue([{ path: "/", _count: { _all: 9 } }]);

    const snapshot = await getPresence();
    expect(snapshot.visitors).toBe(9);
    expect(snapshot.ownerOnline).toBe(false);
  });
});

describe("touchPresence", () => {
  it("upserts on the token and never resets startedAt", async () => {
    upsert.mockResolvedValue({});
    await touchPresence({
      token: "a".repeat(32),
      role: "VISITOR",
      path: "/about",
      device: "desktop",
      country: "IN",
      userId: null,
    });

    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ token: "a".repeat(32) });
    // A beat every 20s that also rewrote startedAt would make every session
    // measure zero seconds long.
    expect(args.update.startedAt).toBeUndefined();
    expect(args.update.lastSeenAt).toBeInstanceOf(Date);
    // Re-asserted so a visitor who signs in as the owner mid-session is
    // reclassified rather than staying a visitor until their tab closes.
    expect(args.update.role).toBe("VISITOR");
  });
});

describe("prunePresence", () => {
  it("deletes in a bounded batch, by id", async () => {
    findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    deleteMany.mockResolvedValue({ count: 2 });

    const removed = await prunePresence(1_800_000_000_000, 500);

    expect(removed).toBe(2);
    expect(findMany.mock.calls[0][0].take).toBe(500);
    // Deleting by id rather than re-stating the predicate: an unbounded
    // deleteMany over a traffic-sized table is a statement timeout, and a
    // timed-out delete rolls back whole, so the job makes no progress at all
    // while appearing to run.
    expect(deleteMany.mock.calls[0][0].where.id.in).toEqual(["a", "b"]);
  });

  it("does no work when there is nothing stale", async () => {
    findMany.mockResolvedValue([]);
    expect(await prunePresence()).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe("getLiveSnapshot", () => {
  const now = 1_800_000_000_000;

  beforeEach(() => {
    count.mockResolvedValue(0);
    groupBy.mockResolvedValue([]);
    pageViewCount.mockResolvedValue(7);
    eventCount.mockResolvedValue(3);
    eventFindMany.mockResolvedValue([]);
  });

  it("buckets recent views into per-minute counts, oldest first", async () => {
    pageViewFindMany
      // recentViews
      .mockResolvedValueOnce([])
      // sparkline rows: two in the current minute, one 5 minutes ago
      .mockResolvedValueOnce([
        { createdAt: new Date(now - 1_000) },
        { createdAt: new Date(now - 2_000) },
        { createdAt: new Date(now - 5 * 60_000 - 1_000) },
      ]);

    const snapshot = await getLiveSnapshot(now);

    expect(snapshot.perMinute).toHaveLength(30);
    // Newest bucket is the last element — the sparkline reads left to right.
    expect(snapshot.perMinute.at(-1)).toBe(2);
    // 5 minutes ago is 6 buckets back from the end: index 29 is "0 minutes ago".
    expect(snapshot.perMinute.at(-6)).toBe(1);
    expect(snapshot.perMinute.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("drops rows outside the sparkline window rather than folding them into edge buckets", async () => {
    pageViewFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { createdAt: new Date(now - 90 * 60_000) },
      // A clock skew between the app and Postgres can put a row in the
      // future; it must not land in the newest bucket and inflate "now".
      { createdAt: new Date(now + 30_000) },
    ]);

    const snapshot = await getLiveSnapshot(now);
    expect(snapshot.perMinute.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
