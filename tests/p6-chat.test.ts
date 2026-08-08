import { describe, it, expect, vi } from "vitest";
import { subscribe, publish } from "../lib/realtime/hub";
import { encodeSSE, type ChatEvent } from "../lib/realtime/events";

// lib/chat.ts reaches for next/headers and auth at module scope.
vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { authorFor, counterpartOf, toPayload } = await import("../lib/chat");

/**
 * P6 — chat plumbing.
 *
 * The read-receipt direction is the subtle one: acknowledging a thread must
 * stamp the *counterpart's* messages, never your own, or every message would
 * instantly mark itself read.
 */
describe("author roles", () => {
  it("maps a side to the author it writes as", () => {
    expect(authorFor("OWNER")).toBe("OWNER");
    expect(authorFor("VISITOR")).toBe("VISITOR");
  });

  it("maps a side to the author whose messages it acknowledges", () => {
    expect(counterpartOf("OWNER")).toBe("VISITOR");
    expect(counterpartOf("VISITOR")).toBe("OWNER");
  });

  it("never lets a side acknowledge its own messages", () => {
    for (const role of ["OWNER", "VISITOR"] as const) {
      expect(counterpartOf(role)).not.toBe(authorFor(role));
    }
  });
});

describe("toPayload", () => {
  it("serialises dates to ISO strings and preserves null readAt", () => {
    const payload = toPayload({
      id: "m1",
      author: "VISITOR",
      body: "hello",
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      deliveredAt: new Date("2026-01-02T03:04:05.000Z"),
      readAt: null,
    });

    expect(payload.createdAt).toBe("2026-01-02T03:04:05.000Z");
    expect(payload.readAt).toBeNull();
    expect(payload.body).toBe("hello");
  });
});

describe("encodeSSE", () => {
  it("emits a well-formed named frame terminated by a blank line", () => {
    const event: ChatEvent = { type: "presence", ownerOnline: true };
    const frame = encodeSSE(event);

    expect(frame.startsWith("event: presence\n")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame).toContain(`data: {"type":"presence","ownerOnline":true}`);
  });

  it("keeps a multi-line body on one data line so the frame is not split", () => {
    // A raw newline inside a data: line would terminate the frame early. JSON
    // encoding escapes it, which is what makes this safe.
    const frame = encodeSSE({
      type: "message",
      message: {
        id: "m",
        author: "VISITOR",
        body: "line one\nline two",
        createdAt: "2026-01-01T00:00:00.000Z",
        deliveredAt: "2026-01-01T00:00:00.000Z",
        readAt: null,
      },
    });
    const dataLines = frame.split("\n").filter((l) => l.startsWith("data: "));
    expect(dataLines).toHaveLength(1);
    expect(frame).toContain("\\n");
  });
});

describe("realtime hub", () => {
  it("delivers only to subscribers of the same conversation", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe("conv-a", a);
    const offB = subscribe("conv-b", b);

    publish("conv-a", { type: "presence", ownerOnline: true });

    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it("stops delivering after unsubscribe", () => {
    const fn = vi.fn();
    subscribe("conv-c", fn)();
    publish("conv-c", { type: "presence", ownerOnline: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps delivering to the others when one subscriber throws", () => {
    const boom = vi.fn(() => {
      throw new Error("subscriber exploded");
    });
    const healthy = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const off1 = subscribe("conv-d", boom);
    const off2 = subscribe("conv-d", healthy);

    expect(() => publish("conv-d", { type: "presence", ownerOnline: true })).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    off1();
    off2();
  });

  it("publishing to an unknown conversation is a no-op", () => {
    expect(() => publish("never-existed", { type: "presence", ownerOnline: true })).not.toThrow();
  });
});
