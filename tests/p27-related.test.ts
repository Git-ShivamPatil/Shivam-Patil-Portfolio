import { describe, expect, it, vi, beforeEach } from "vitest";

const retrieve = vi.fn();

vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../lib/ai/retrieve", () => ({ retrieve }));

const { relatedPages, queryFor } = await import("../lib/seo/related");
const { SITE_ROUTES } = await import("../lib/site-routes");

/**
 * P27 — the internal link graph.
 *
 * §55a is the reason this exists: twenty of thirty-three sitemap URLs with
 * `Last crawl: N/A`, three of the seven inspected "unknown to Google" outright.
 * Nothing was blocking them — the navigation is a JavaScript drawer, so the
 * crawlable link graph was far thinner than the site looks.
 *
 * The properties asserted here are the ones that decide whether this densifies
 * that graph or quietly does nothing: it must return *distinct pages* (a long
 * page contributes several chunks and would otherwise fill the block three
 * times over), must never link a page to itself, and must degrade to empty
 * rather than throwing when retrieval is unavailable.
 */

function chunk(url: string, title = url, heading = "") {
  return {
    id: url + heading,
    source: "page",
    url,
    title,
    heading,
    content: "…",
    score: 1,
    matchedBy: ["vector"],
  };
}

beforeEach(() => {
  retrieve.mockReset();
});

describe("relatedPages", () => {
  it("never links a page to itself", async () => {
    retrieve.mockResolvedValue([chunk("/projects/a"), chunk("/skills"), chunk("/system-design")]);

    const pages = await relatedPages({ self: "/projects/a", query: "rust" });
    expect(pages.map((page) => page.url)).not.toContain("/projects/a");
  });

  it("collapses several chunks of one page into a single link", async () => {
    // The failure this guards: retrieval returns CHUNKS. A long page such as
    // /skills contributes many, so a naive take(3) renders the same
    // destination three times and links to two fewer pages than it appears to.
    retrieve.mockResolvedValue([
      chunk("/skills", "Skills", "Languages"),
      chunk("/skills", "Skills", "Infrastructure"),
      chunk("/skills", "Skills", "Tooling"),
      chunk("/system-design", "System design"),
    ]);

    const pages = await relatedPages({ self: "/projects/a", query: "rust" });
    expect(pages.map((page) => page.url)).toEqual(["/skills", "/system-design"]);
  });

  it("honours the limit", async () => {
    retrieve.mockResolvedValue(["/a", "/b", "/c", "/d", "/e"].map((url) => chunk(url)));
    expect(await relatedPages({ self: "/self", query: "x", limit: 2 })).toHaveLength(2);
  });

  it("over-fetches so deduping still has candidates left", async () => {
    retrieve.mockResolvedValue([chunk("/skills")]);
    await relatedPages({ self: "/self", query: "x", limit: 3 });

    // Asking retrieval for exactly `limit` chunks is the bug: one long page
    // would consume all of them and the block would render a single link.
    expect(retrieve).toHaveBeenCalledWith("x", { limit: 12 });
  });

  it("prefers the registry's plain-language label over a chunk title", async () => {
    const registered = SITE_ROUTES.find((route) => route.href === "/skills");
    expect(registered).toBeDefined();

    retrieve.mockResolvedValue([chunk("/skills", "some corpus-derived title", "Languages")]);
    const [page] = await relatedPages({ self: "/self", query: "x" });

    expect(page.label).toBe(registered!.label);
    expect(page.blurb).toBe(registered!.blurb);
  });

  it("falls back to the chunk title for pages the registry does not list", async () => {
    // /projects/<slug> and /blog/<slug> are not registry entries — they are
    // generated from the database — so the corpus title is the page title.
    retrieve.mockResolvedValue([chunk("/projects/rate-limiter", "Distributed rate limiter")]);
    const [page] = await relatedPages({ self: "/self", query: "x" });
    expect(page.label).toBe("Distributed rate limiter");
  });

  it("returns an empty list rather than throwing when retrieval is unavailable", async () => {
    // A related-links block is an enhancement. A case study that 500s because
    // pgvector is briefly unavailable is a far worse outcome than one that
    // renders without a footer section.
    retrieve.mockRejectedValue(new Error("pgvector unavailable"));
    await expect(relatedPages({ self: "/self", query: "x" })).resolves.toEqual([]);
  });

  it("does not pad a thin result up to the limit", async () => {
    // Filler links are the pattern that reads as manipulation to a crawler,
    // and they lie to a visitor about what is on the other end.
    retrieve.mockResolvedValue([chunk("/skills")]);
    expect(await relatedPages({ self: "/self", query: "x", limit: 3 })).toHaveLength(1);
  });
});

describe("queryFor", () => {
  it("flattens arrays and drops empties", () => {
    expect(queryFor(["Rate limiter", null, ["Rust", "Redis"], undefined, ""])).toBe(
      "Rate limiter Rust Redis",
    );
  });

  it("caps at the length retrieve() itself truncates to", () => {
    // retrieve() slices the query to 400 characters. Sending more is wasted
    // work and hides which terms actually reached the retriever.
    expect(queryFor([Array.from({ length: 200 }, () => "term")]).length).toBeLessThanOrEqual(400);
  });
});
