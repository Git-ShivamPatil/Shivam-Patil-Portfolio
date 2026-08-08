import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { takeToken, clientIp } from "../lib/rate-limit";

/**
 * P6 — token bucket.
 *
 * Guards chat sends, typing pings, newsletter signups and booking creation.
 * A bucket that never refills locks a legitimate user out; one that refills
 * too fast is decorative.
 */
describe("token bucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows exactly the burst capacity, then refuses", () => {
    const key = `burst-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) {
      expect(takeToken(key, 5, 1).ok, `request ${i + 1}`).toBe(true);
    }
    const blocked = takeToken(key, 5, 1);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("refills over time at the configured rate", () => {
    const key = `refill-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) takeToken(key, 5, 1);
    expect(takeToken(key, 5, 1).ok).toBe(false);

    // One token per second: after 1s exactly one more request gets through.
    vi.advanceTimersByTime(1000);
    expect(takeToken(key, 5, 1).ok).toBe(true);
    expect(takeToken(key, 5, 1).ok).toBe(false);
  });

  it("never refills above capacity", () => {
    const key = `cap-${Math.random()}`;
    takeToken(key, 3, 1);
    // An hour of idling must not bank 3600 tokens.
    vi.advanceTimersByTime(3_600_000);
    expect(takeToken(key, 3, 1).ok).toBe(true);
    expect(takeToken(key, 3, 1).ok).toBe(true);
    expect(takeToken(key, 3, 1).ok).toBe(true);
    expect(takeToken(key, 3, 1).ok).toBe(false);
  });

  it("meters each key independently", () => {
    const a = `iso-a-${Math.random()}`;
    const b = `iso-b-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) takeToken(a, 3, 1);
    expect(takeToken(a, 3, 1).ok).toBe(false);
    // One noisy visitor must not lock everyone else out.
    expect(takeToken(b, 3, 1).ok).toBe(true);
  });

  it("reports a retryAfter that is actually long enough", () => {
    const key = `retry-${Math.random()}`;
    // Slow refill: 0.2/sec means ~5s per token.
    for (let i = 0; i < 2; i += 1) takeToken(key, 2, 0.2);
    const blocked = takeToken(key, 2, 0.2);
    expect(blocked.ok).toBe(false);

    // Waiting exactly the advertised time must let the next request through.
    vi.advanceTimersByTime(blocked.retryAfter * 1000);
    expect(takeToken(key, 2, 0.2).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the left-most x-forwarded-for entry", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" },
    });
    expect(clientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(
      clientIp(new Request("https://example.com", { headers: { "x-real-ip": "198.51.100.4" } })),
    ).toBe("198.51.100.4");
    expect(clientIp(new Request("https://example.com"))).toBe("unknown");
  });
});
