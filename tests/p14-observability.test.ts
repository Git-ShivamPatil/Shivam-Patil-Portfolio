import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSentryConfigured, reportError, resetSentryCache } from "../lib/observability/sentry";

/**
 * P14 — observability.
 *
 * The error reporter is the one piece of code in this project whose failure
 * mode is silence, so every property below is about it staying quiet in the
 * right way: no DSN means no network call, a broken DSN means one log line
 * rather than one per error, and a failed report never becomes a second error.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetSentryCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetSentryCache();
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("configuration", () => {
  it("is off when no DSN is set", () => {
    delete process.env.SENTRY_DSN;
    expect(isSentryConfigured()).toBe(false);
  });

  it("is on for a well-formed DSN", () => {
    process.env.SENTRY_DSN = "https://abc123@o1.ingest.sentry.io/456";
    expect(isSentryConfigured()).toBe(true);
  });

  it("treats a malformed DSN as off rather than throwing", () => {
    // A typo in an env var must not take down every error path in the app.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.SENTRY_DSN = "not-a-dsn";
    expect(isSentryConfigured()).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("complains about a bad DSN once, not once per error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.SENTRY_DSN = "https://no-project-id@sentry.io";
    isSentryConfigured();
    isSentryConfigured();
    isSentryConfigured();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("reportError", () => {
  it("makes no network call when reporting is off", async () => {
    delete process.env.SENTRY_DSN;
    const fetchMock = stubFetch();
    await reportError(new Error("boom"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a three-part envelope to the project endpoint", async () => {
    process.env.SENTRY_DSN = "https://pubkey@o1.ingest.sentry.io/456";
    const fetchMock = stubFetch();

    await reportError(new Error("boom"), { source: "route", path: "/projects/[slug]" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/456/envelope/");
    expect((init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain(
      "sentry_key=pubkey",
    );

    // header \n item-header \n payload
    const parts = String(init.body).split("\n");
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(parts[2]);
    expect(payload.exception.values[0].value).toBe("boom");
    expect(payload.transaction).toBe("/projects/[slug]");
    expect(payload.tags.source).toBe("route");
  });

  it("scrubs a secret out of the message before it leaves the process", async () => {
    process.env.SENTRY_DSN = "https://pubkey@o1.ingest.sentry.io/456";
    process.env.DATABASE_URL = "postgresql://user:hunter2@db.example/neondb";
    const fetchMock = stubFetch();

    await reportError(new Error("connect failed: postgresql://user:hunter2@db.example/neondb"));

    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    // A connection string interpolated into an error message is exactly how a
    // secret ends up in a third-party dashboard.
    expect(body).not.toContain("hunter2");
    expect(body).toContain("[redacted:DATABASE_URL]");
  });

  it("orders stack frames innermost-last, the way Sentry renders them", async () => {
    process.env.SENTRY_DSN = "https://pubkey@o1.ingest.sentry.io/456";
    const fetchMock = stubFetch();

    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at innermost (/app/lib/a.ts:1:1)",
      "    at middle (/app/lib/b.ts:2:2)",
      "    at outermost (/app/lib/c.ts:3:3)",
    ].join("\n");
    await reportError(error);

    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    const frames = JSON.parse(body.split("\n")[2]).exception.values[0].stacktrace.frames;
    // Reversed relative to V8's printing order. Getting this backwards makes
    // every error look like it originated in the framework.
    expect(frames[0].function).toBe("outermost");
    expect(frames.at(-1).function).toBe("innermost");
    expect(frames.at(-1).lineno).toBe(1);
  });

  it("caps stack depth so a runaway recursion is still reportable", async () => {
    process.env.SENTRY_DSN = "https://pubkey@o1.ingest.sentry.io/456";
    const fetchMock = stubFetch();

    const error = new Error("stack overflow");
    error.stack = [
      "Error: stack overflow",
      ...Array.from({ length: 500 }, (_, i) => `    at recurse (/app/lib/x.ts:${i + 1}:1)`),
    ].join("\n");
    await reportError(error);

    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    const frames = JSON.parse(body.split("\n")[2]).exception.values[0].stacktrace.frames;
    expect(frames.length).toBeLessThanOrEqual(50);
  });

  it("swallows a transport failure instead of raising a second error", async () => {
    process.env.SENTRY_DSN = "https://pubkey@o1.ingest.sentry.io/456";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    // The error being reported is the problem; a reporting failure must not
    // become a second one.
    await expect(reportError(new Error("boom"))).resolves.toBeUndefined();
  });

  it("wraps a non-Error throw rather than dropping it", async () => {
    process.env.SENTRY_DSN = "https://pubkey@o1.ingest.sentry.io/456";
    const fetchMock = stubFetch();
    await reportError("just a string");
    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain("just a string");
  });
});

describe("the container build", () => {
  const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");

  it("never runs the server as root", () => {
    expect(dockerfile).toMatch(/^USER nextjs$/m);
  });

  it("builds with an unreachable database, the same assertion CI makes", () => {
    // The build surviving no database is the feature, not a gap.
    expect(dockerfile).toContain("localhost:5432");
  });

  it("opts into standalone output rather than pinning it globally", () => {
    // Pinning `output: "standalone"` in next.config.ts would change how Vercel
    // deploys this project to solve a problem only the container has.
    expect(dockerfile).toContain("DOCKER_BUILD=1");
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain('process.env.DOCKER_BUILD === "1"');
  });

  it("health-checks readiness, not just an open port", () => {
    // A Next server answers on the port well before it can reach the database.
    expect(dockerfile).toContain("/api/health");
  });

  it("keeps env files out of the image", () => {
    const ignore = readFileSync(join(process.cwd(), ".dockerignore"), "utf8");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });
});
