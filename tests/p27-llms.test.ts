import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({ prisma: {} }));

const robots = (await import("../app/robots")).default;
const { buildLlmsTxt, buildLlmsFullTxt } = await import("../lib/seo/llms");
const { indexableRoutes, ROUTE_GROUPS } = await import("../lib/site-routes");
const { siteUrl } = await import("../lib/seo/site");

/**
 * P27 — the AI-crawler surface.
 *
 * Every assertion here corresponds to something that was actually wrong, or to
 * a mechanism the fix depends on that nothing else checks:
 *
 * - `/api/openapi` — a hand-written OpenAPI 3.1 document, the most
 *   machine-legible artifact on the domain — sat behind a blanket
 *   `Disallow: /api/`. Nothing was protecting it; it was collateral from a
 *   rule aimed at machinery.
 * - The allow depends on **longest-prefix matching** beating the broader
 *   `Disallow`. If someone later "tidies" the broad rule away, or narrows the
 *   allow to `/api/`, the mechanism silently inverts.
 * - `llms.txt` is generated from the route registry precisely so it cannot
 *   become the fourth hand-maintained copy of the route map that §48 found
 *   three of, already disagreeing by ten routes.
 */

const rules = () => {
  const result = robots().rules;
  return Array.isArray(result) ? result : [result];
};

const assistantRule = () =>
  rules().find((rule) => {
    const agents = Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent];
    return agents.includes("ClaudeBot");
  });

const asArray = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

describe("robots.txt", () => {
  it("still hides the machinery from every crawler", () => {
    const wildcard = rules().find((rule) => rule.userAgent === "*");
    expect(wildcard).toBeDefined();
    expect(asArray(wildcard!.disallow)).toEqual(
      expect.arrayContaining(["/api/", "/admin/", "/account/", "/d/"]),
    );
  });

  it("names the assistant crawlers that matter", () => {
    const agents = asArray(assistantRule()?.userAgent);
    // Not an exhaustive list — a spot check that the three biggest are present,
    // so a refactor cannot quietly empty the array.
    expect(agents).toEqual(expect.arrayContaining(["GPTBot", "ClaudeBot", "PerplexityBot"]));
  });

  it("grants Google-Extended separately from search indexing", () => {
    // Google-Extended is not a crawler: it governs whether Gemini may use what
    // Googlebot already fetched. Listing it is the only way to express that
    // split, and it is easy to drop by mistake because it looks redundant.
    expect(asArray(assistantRule()?.userAgent)).toContain("Google-Extended");
  });

  it("opens the OpenAPI document to assistants", () => {
    expect(asArray(assistantRule()?.allow)).toContain("/api/openapi");
  });

  it("keeps the allow MORE SPECIFIC than the disallow it has to beat", () => {
    // This is the whole mechanism. Crawlers resolve a conflict by prefix
    // length, so every allowed API path must be strictly longer than the
    // `/api/` rule it sits inside. An allow of `/api/` itself would tie, and a
    // tie is resolved in favour of allowing — which would expose all of it.
    const allowed = asArray(assistantRule()?.allow).filter((path) => path.startsWith("/api"));
    expect(allowed.length).toBeGreaterThan(0);
    for (const path of allowed) {
      expect(
        path.length,
        `${path} must be longer than "/api/" to win on specificity`,
      ).toBeGreaterThan("/api/".length);
    }
  });

  it("does not open anything under /admin or /account to assistants", () => {
    const allowed = asArray(assistantRule()?.allow);
    expect(allowed.some((path) => path.startsWith("/admin") || path.startsWith("/account"))).toBe(
      false,
    );
    expect(asArray(assistantRule()?.disallow)).toEqual(
      expect.arrayContaining(["/admin/", "/account/"]),
    );
  });

  it("declares the sitemap and the canonical host on the canonical origin", () => {
    expect(robots().sitemap).toBe(`${siteUrl}/sitemap.xml`);
    expect(robots().host).toBe(siteUrl);
  });
});

describe("llms.txt", () => {
  const context = {
    projects: [
      { slug: "rate-limiter", title: "Rate limiter", summary: "Token buckets at the edge." },
    ],
    posts: [{ slug: "on-locks", title: "On locks", excerpt: "Why the lease lives in Postgres." }],
  };

  it("lists every indexable route, so it cannot drift from the registry", () => {
    const document = buildLlmsTxt(context);
    const missing = indexableRoutes()
      .map((route) => `${siteUrl}${route.href === "/" ? "/" : route.href}`)
      .filter((url) => !document.includes(`](${url})`));

    // The failure this guards: someone adds a route to lib/site-routes.ts and
    // this document keeps its own idea of what exists. That is exactly how the
    // drawer, the hub and the sitemap ended up ten routes apart.
    expect(missing, `routes missing from llms.txt: ${missing.join(", ")}`).toEqual([]);
  });

  it("uses the registry's own blurbs rather than a second set of descriptions", () => {
    const document = buildLlmsTxt(context);
    for (const route of indexableRoutes()) {
      expect(document).toContain(route.blurb);
    }
  });

  it("points at the OpenAPI document, which is the reason robots.txt was opened", () => {
    expect(buildLlmsTxt(context)).toContain(`${siteUrl}/api/openapi`);
  });

  it("carries every route group that has routes in it", () => {
    const document = buildLlmsTxt(context);
    for (const group of ROUTE_GROUPS) {
      const populated = indexableRoutes().some((route) => route.group === group.id);
      if (populated) expect(document).toContain(`## ${group.label}`);
    }
  });

  it("includes projects and posts with absolute URLs", () => {
    const document = buildLlmsTxt(context);
    expect(document).toContain(`${siteUrl}/projects/rate-limiter`);
    expect(document).toContain(`${siteUrl}/blog/on-locks`);
  });

  it("emits only absolute URLs — a relative link is useless to an off-site reader", () => {
    const document = buildLlmsTxt(context);
    const relative = [...document.matchAll(/\]\((?!https?:\/\/)([^)]+)\)/g)].map((m) => m[1]);
    expect(relative).toEqual([]);
  });
});

describe("llms-full.txt", () => {
  const chunks = [
    { url: "/skills", title: "Skills", heading: "Languages", content: "C++, Rust, Go." },
    { url: "/skills", title: "Skills", heading: "Languages", content: "TypeScript, Python." },
    { url: "/skills", title: "Skills", heading: "Infrastructure", content: "Postgres, Redis." },
    { url: "/about", title: "About", heading: "", content: "Systems-minded." },
  ];

  it("groups passages under one entry per URL", () => {
    const document = buildLlmsFullTxt(chunks);
    expect(document.match(/^## Skills$/gm)).toHaveLength(1);
    expect(document.match(/^## About$/gm)).toHaveLength(1);
  });

  it("does not repeat a heading once per passage", () => {
    // Chunking splits one section into several passages that all carry the
    // same heading. Printing it per passage reads as a document with the same
    // subtitle a dozen times over.
    expect(buildLlmsFullTxt(chunks).match(/^### Languages$/gm)).toHaveLength(1);
  });

  it("keeps every passage's text", () => {
    const document = buildLlmsFullTxt(chunks);
    for (const chunk of chunks) expect(document).toContain(chunk.content);
  });

  it("cites the source URL for each page", () => {
    expect(buildLlmsFullTxt(chunks)).toContain(`Source: ${siteUrl}/skills`);
  });

  it("survives an empty corpus without producing a broken document", () => {
    // The route falls back to [] when the database is unreachable. A crash
    // here would turn a degraded read into a 500 served to precisely the
    // audience this route exists for.
    const document = buildLlmsFullTxt([]);
    expect(document).toContain("# ");
    expect(document.length).toBeGreaterThan(0);
  });
});
