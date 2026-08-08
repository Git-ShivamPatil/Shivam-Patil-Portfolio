import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P5 — stale-on-error caching.
 *
 * The whole point of this layer is the failure path: when GitHub rate-limits
 * or LeetCode throttles a serverless IP, the panel must serve the last good
 * reading rather than an error. These tests pin that behaviour, including the
 * case where the cache store itself is unavailable.
 */
const findUnique = vi.fn();
const upsert = vi.fn();

vi.mock("../lib/prisma", () => ({
  prisma: {
    integrationCache: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}));

const { cached } = await import("../lib/integrations/cache");

beforeEach(() => {
  findUnique.mockReset();
  upsert.mockReset();
  upsert.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cached()", () => {
  it("fetches and stores when nothing is cached", async () => {
    findUnique.mockResolvedValue(null);
    const fetcher = vi.fn().mockResolvedValue({ stars: 42 });

    const result = await cached("k", 60, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ data: { stars: 42 }, stale: false });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("serves a fresh cache entry without calling the upstream", async () => {
    findUnique.mockResolvedValue({
      payload: { stars: 7 },
      fetchedAt: new Date("2026-01-01"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const fetcher = vi.fn();

    const result = await cached("k", 60, fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ data: { stars: 7 }, stale: false });
  });

  it("serves the expired entry as STALE when the upstream fails", async () => {
    const fetchedAt = new Date("2026-01-01");
    findUnique.mockResolvedValue({
      payload: { stars: 7 },
      fetchedAt,
      // Already expired, so a refetch is attempted...
      expiresAt: new Date(Date.now() - 1000),
    });
    // ...and the refetch fails.
    const fetcher = vi.fn().mockRejectedValue(new Error("429 Too Many Requests"));

    const result = await cached("k", 60, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ data: { stars: 7 }, stale: true });
    expect(result?.fetchedAt).toBe(fetchedAt);
  });

  it("returns null only when there is no cache AND the fetch fails", async () => {
    findUnique.mockResolvedValue(null);
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));

    expect(await cached("k", 60, fetcher)).toBeNull();
  });

  it("still returns fresh data when the cache STORE is down", async () => {
    // A Postgres outage must not take the GitHub panel down with it.
    findUnique.mockRejectedValue(new Error("db unreachable"));
    upsert.mockRejectedValue(new Error("db unreachable"));
    const fetcher = vi.fn().mockResolvedValue({ stars: 1 });

    const result = await cached("k", 60, fetcher);

    expect(result).toMatchObject({ data: { stars: 1 }, stale: false });
  });

  it("does not let a failed cache write throw", async () => {
    findUnique.mockResolvedValue(null);
    upsert.mockRejectedValue(new Error("write failed"));

    await expect(cached("k", 60, async () => ({ ok: true }))).resolves.toMatchObject({
      data: { ok: true },
    });
  });
});
