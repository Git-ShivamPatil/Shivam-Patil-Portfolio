import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../next.config";

/**
 * P12 — the delivery layer.
 *
 * Cache headers are the kind of thing that is either exactly right or silently
 * catastrophic, and nothing in a normal build or test run looks at them. The
 * service worker is the sharpest edge: a hard-cached `sw.js` is stuck forever,
 * because the thing that would have fetched its replacement is the stale copy.
 */

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  const headers = nextConfig.headers;
  if (!headers) throw new Error("next.config.ts declares no headers()");
  return (await headers()) as HeaderRule[];
}

function ruleFor(all: HeaderRule[], source: string): HeaderRule {
  const found = all.find((rule) => rule.source === source);
  if (!found) throw new Error(`no header rule for ${source}`);
  return found;
}

function headerValue(rule: HeaderRule, key: string): string {
  const found = rule.headers.find((header) => header.key.toLowerCase() === key.toLowerCase());
  if (!found) throw new Error(`${rule.source} has no ${key}`);
  return found.value;
}

describe("cache headers", () => {
  it("never lets the service worker be cached", async () => {
    const cacheControl = headerValue(ruleFor(await rules(), "/sw.js"), "Cache-Control");
    expect(cacheControl).toContain("max-age=0");
    expect(cacheControl).toContain("must-revalidate");
    expect(cacheControl).not.toContain("immutable");
  });

  it("leaves /_next/static to Next rather than restating it", async () => {
    // Next already serves content-hashed assets as immutable for a year.
    // Declaring it again changes nothing in production and makes the build warn
    // that a custom Cache-Control there can break dev behaviour — which it can,
    // because dev serves those paths differently.
    const sources = (await rules()).map((rule) => rule.source);
    expect(sources).not.toContain("/_next/static/:path*");
  });

  it("gives the résumé a short browser TTL and a long edge one", async () => {
    // The file changes a few times a year, and the number of people who take it
    // is a headline metric — so it must not be pinned in a visitor's own cache
    // for a year while the edge can still be purged.
    const cacheControl = headerValue(
      ruleFor(await rules(), "/Shivam-Patil-SDE-II-Resume.pdf"),
      "Cache-Control",
    );
    expect(cacheControl).toMatch(/max-age=3600\b/);
    expect(cacheControl).toContain("s-maxage=86400");
    expect(cacheControl).toContain("stale-while-revalidate");
  });
});

describe("image delivery", () => {
  it("prefers AVIF over WebP", async () => {
    // Next ships WebP only by default. The header wordmark is a photograph,
    // which is exactly the content AVIF wins on.
    expect(nextConfig.images?.formats?.[0]).toBe("image/avif");
  });
});

describe("build output shape", () => {
  it("only asks for standalone output when the Dockerfile asks for it", () => {
    // Vercel does its own output tracing. Pinning standalone unconditionally
    // would change how production deploys to solve a problem it does not have.
    expect(process.env.DOCKER_BUILD).not.toBe("1");
    expect(nextConfig.output).toBeUndefined();
  });
});

describe("vendored fonts", () => {
  const fontDir = join(process.cwd(), "app/fonts");

  it("ships every face layout.tsx declares", () => {
    const files = new Set(readdirSync(fontDir));
    for (const face of [
      "manrope-variable.woff2",
      "playfair-display-variable.woff2",
      "playfair-display-variable-italic.woff2",
      "dm-mono-400.woff2",
      "dm-mono-500.woff2",
    ]) {
      expect(files.has(face), `${face} is missing`).toBe(true);
    }
  });

  it("keeps the build off the network", () => {
    // next/font/google fetches at build time, and that dependency broke a build
    // once already: Google began 404ing four Playfair Display files its own
    // stylesheet points at. A build that fails because a third party is having
    // a bad day is the same class of problem CI's missing database rules out.
    // Matched as an import rather than as a substring: the comment above the
    // font declarations names next/font/google on purpose, to record why it is
    // gone.
    const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
    const imports = layout.match(/^import .*$/gm) ?? [];
    expect(imports.some((line) => line.includes("next/font/local"))).toBe(true);
    expect(imports.some((line) => line.includes("next/font/google"))).toBe(false);
  });

  it("carries no duplicate faces", () => {
    // Manrope and Playfair are variable fonts: one file covers the whole weight
    // range. Downloading them per weight yields five byte-identical copies.
    const sizes = readdirSync(fontDir)
      .filter((file) => file.endsWith(".woff2"))
      .map((file) => readFileSync(join(fontDir, file)).length);
    expect(new Set(sizes).size).toBe(sizes.length);
  });
});
