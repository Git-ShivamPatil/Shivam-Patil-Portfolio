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
      ruleFor(await rules(), "/Shivam-Patil-SDE-Resume.pdf"),
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
    for (const face of ["manrope-variable.woff2"]) {
      expect(files.has(face), `${face} is missing`).toBe(true);
    }
  });

  it("ships exactly one family", () => {
    // The site is single-family by design: hierarchy comes from weight, size,
    // tracking and case, not from a second typeface. Playfair Display (two
    // faces) and DM Mono (two weights) were deleted — 94.7KB of font payload
    // that was buying an italic used by five CSS rules and a monospace used
    // almost entirely for 10px uppercase labels.
    //
    // This asserts the DIRECTORY, not the CSS, because that is the check that
    // cannot be satisfied by accident: a stray @font-face or a re-added
    // localFont() needs a file, and the file would show up here.
    const faces = readdirSync(fontDir).filter((file) => file.endsWith(".woff2"));
    expect(faces).toEqual(["manrope-variable.woff2"]);
  });

  it("routes every stylesheet through the family tokens", () => {
    // Every font declaration across the stylesheets was rewritten to
    // var(--font-label) / var(--font-code). A literal family name reappearing
    // in any of them is the regression this catches — it would still render,
    // so nothing else would fail.
    const sheets: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".css")) sheets.push(full);
      }
    };
    walk(join(process.cwd(), "app"));
    walk(join(process.cwd(), "components"));

    for (const sheet of sheets) {
      const css = readFileSync(sheet, "utf8");
      // Comments record why these families left; declarations must not name them.
      const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(declarations, `${sheet} still names a removed family`).not.toMatch(
        /DM Mono|Playfair Display|--font-dm-mono|--font-playfair/,
      );
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
    // Manrope is a variable font: one file covers 400-800. Downloading it per
    // weight would yield byte-identical copies. Trivially true at one file, and
    // kept because it is the guard that fires if a per-weight src[] comes back.
    const sizes = readdirSync(fontDir)
      .filter((file) => file.endsWith(".woff2"))
      .map((file) => readFileSync(join(fontDir, file)).length);
    expect(new Set(sizes).size).toBe(sizes.length);
  });
});
