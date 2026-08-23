import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  SITE_ROUTES,
  AUDIENCE_ROUTES,
  indexableRoutes,
  primaryRoutes,
  ROUTE_GROUPS,
} from "../lib/site-routes";
import { pageMetadata } from "../lib/seo/metadata";
import {
  personJsonLd,
  webSiteJsonLd,
  breadcrumbJsonLd,
  itemListJsonLd,
  faqJsonLd,
} from "../lib/seo/structured-data";
import { siteUrl } from "../lib/seo/site";

/**
 * P26. The invariants the findability pass established, asserted.
 *
 * **Every check here corresponds to something that was actually broken.** This
 * is not speculative coverage: each `it` below is a defect that existed in the
 * tree, was found by hand, and had nothing stopping it coming back.
 *
 * - Ten indexable routes were missing from the sitemap, because the sitemap
 *   kept its own list.
 * - Page titles hard-coded "— Shivam Patil" while the root layout also appended
 *   it, so titles double-suffixed the moment the template landed.
 * - `title.template` does not apply to the segment that defines it, so the
 *   homepage silently lost the name from its title.
 * - Descriptions were absent, duplicated, or outside the length Google renders.
 *
 * Unit tests rather than E2E, deliberately: these are properties of the source,
 * so they can be asserted in 40ms without a browser or a database, and they
 * fail in the `build` job — before the E2E job spends ten minutes getting to
 * the same conclusion.
 */

const APP = join(process.cwd(), "app");

/** Every `page.tsx` under app/, as a route path. */
function publicPageFiles(): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== "page.tsx") continue;
      const rel = full
        .slice(APP.length)
        .replace(/\\/g, "/")
        .replace(/\/page\.tsx$/, "");
      out.push({ route: rel === "" ? "/" : rel, file: full });
    }
  };
  walk(APP);
  return out;
}

/**
 * Routes that are real pages but deliberately outside the registry: private
 * areas, auth flows, and the two `noindex` utility pages. Listed explicitly so
 * that adding a genuinely public route and forgetting the registry FAILS,
 * rather than being absorbed by a wildcard.
 */
const NOT_IN_REGISTRY = new Set([
  "/account",
  "/admin",
  "/booking/success",
  "/forgot-password",
  "/invoice/[token]",
  "/login",
  "/newsletter/confirmed",
  "/offline",
  "/register",
  "/reset-password/[token]",
  "/search",
  // Dynamic children — their parents are registered and the sitemap adds each
  // slug from the database.
  "/blog/[slug]",
  "/projects/[slug]",
]);

describe("the route registry is the only route list", () => {
  it("registers every public page that exists on disk", () => {
    const onDisk = publicPageFiles()
      .map((page) => page.route)
      .filter((route) => !route.startsWith("/admin"))
      .filter((route) => !NOT_IN_REGISTRY.has(route));

    const registered = new Set([...SITE_ROUTES, ...AUDIENCE_ROUTES].map((route) => route.href));
    const missing = onDisk.filter((route) => !registered.has(route));

    // The exact failure that shipped: ten of these were absent, so the sitemap
    // never mentioned them and the drawer was their only door.
    expect(missing, `public pages missing from lib/site-routes.ts: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("points every registered route at a page that exists", () => {
    const onDisk = new Set(publicPageFiles().map((page) => page.route));
    const dangling = [...SITE_ROUTES, ...AUDIENCE_ROUTES]
      .map((route) => route.href)
      .filter((href) => !onDisk.has(href));
    expect(dangling, `registry entries with no page.tsx: ${dangling.join(", ")}`).toEqual([]);
  });

  it("puts every route in a group that exists", () => {
    const groups = new Set(ROUTE_GROUPS.map((group) => group.id));
    for (const route of SITE_ROUTES) {
      expect(groups.has(route.group), `${route.href} is in unknown group "${route.group}"`).toBe(
        true,
      );
    }
  });

  it("gives every route a blurb a stranger can act on", () => {
    for (const route of [...SITE_ROUTES, ...AUDIENCE_ROUTES]) {
      // The blurb is rendered under the label in the drawer, the footer
      // directory and the homepage map. An empty one leaves three holes.
      expect(route.blurb.length, `${route.href} has no blurb`).toBeGreaterThan(12);
      // Long enough to be a sentence, short enough to sit on one line at the
      // 220px column the footer directory uses.
      expect(route.blurb.length, `${route.href} blurb is too long: ${route.blurb}`).toBeLessThan(
        72,
      );
    }
  });

  it("keeps the top-bar nav small enough to fit beside the actions", () => {
    // SIX now — /resume was added, and the arithmetic was re-run rather than
    // assumed. A centred six-link bar needs 974px of viewport: 138px side
    // tracks either side of the 626px nav, plus 32px of gap and 40px of
    // padding. The nav still hides at 1040px, so there is 66px of headroom and
    // the breakpoint did not have to move.
    //
    // Note that the nav's width is now --content-w, so every link added widens
    // the CONTENT COLUMN too — see the token's note in app/globals.css. That is
    // deliberate coupling, and it is the reason this cap matters more than it
    // used to: a seventh link does not just crowd the bar, it re-measures the
    // whole site.
    //
    // The cap is what keeps them in step. Adding a sixth link without
    // re-measuring is the failure this catches: nothing overflows on a desktop
    // monitor, so it looks fine in review and breaks on a laptop — which is
    // exactly how the fifth one wrapped "Shivam Patil" across two lines at
    // 900px before this was raised.
    const primary = SITE_ROUTES.filter((route) => route.primary);
    expect(primary.length).toBeGreaterThan(0);
    expect(primary.length).toBeLessThanOrEqual(6);
  });

  it("orders the top bar explicitly rather than by declaration order", () => {
    // /system-design belongs to the right of /reach-out, but it is declared two
    // hundred lines above it in SITE_ROUTES. Without PRIMARY_ORDER the bar
    // inherits file position and puts it third, which is both wrong and
    // impossible to read the intent of from the code.
    const order = primaryRoutes().map((route) => route.href);
    expect(order).toEqual([
      "/about",
      "/resume",
      "/projects",
      "/skills",
      "/reach-out",
      "/system-design",
    ]);

    // Every primary route reaches the bar. A route flagged `primary` but left
    // out of PRIMARY_ORDER must be appended, never dropped.
    const flagged = SITE_ROUTES.filter((route) => route.primary).map((route) => route.href);
    expect(new Set(order)).toEqual(new Set(flagged));
  });

  it("never marks a noIndex route as indexable", () => {
    for (const route of indexableRoutes()) {
      expect(route.noIndex, `${route.href} is both indexable and noIndex`).toBeUndefined();
    }
  });
});

describe("page metadata", () => {
  const files = publicPageFiles().filter((page) => !page.route.startsWith("/admin"));

  it("never hard-codes the name suffix the root template already appends", () => {
    // `title.template` in app/layout.tsx appends " — Shivam Patil". A page that
    // also writes it renders "About — Shivam Patil — Shivam Patil", which is
    // exactly what happened when the template landed.
    const offenders: string[] = [];
    for (const page of files) {
      const source = readFileSync(page.file, "utf8");
      for (const match of source.matchAll(/title:\s*"([^"]*)"/g)) {
        if (match[1].includes("Shivam Patil") && page.route !== "/") {
          offenders.push(`${page.route}: "${match[1]}"`);
        }
      }
    }
    expect(offenders, `titles that double-suffix:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("keeps the name in the homepage title, which no template can add", () => {
    // Next.js does not apply `title.template` to the segment that defines it,
    // and app/page.tsx is that segment. The homepage is therefore the one page
    // whose title must carry the name itself — and the one page where a future
    // "tidy-up" of the apparent duplication would silently remove it.
    const home = readFileSync(join(APP, "page.tsx"), "utf8");
    const title = home.match(/title:\s*"([^"]*)"/)?.[1] ?? "";
    expect(title).toContain("Shivam Patil");
  });

  it("gives every public page a description Google will render whole", () => {
    const offenders: string[] = [];
    for (const page of files) {
      // Dynamic segments are skipped, and the reason is not laziness: their
      // descriptions are built inside `generateMetadata` from a project summary
      // or a post excerpt that lives in the database, so there is no literal in
      // the source to measure. `/projects/[slug]` additionally pads a short
      // summary with its category and stack precisely to clear the lower bound.
      // Asserting the length of those means asserting the length of content,
      // which belongs to whoever writes it, not to this file.
      if (page.route.includes("[")) continue;
      const source = readFileSync(page.file, "utf8");
      if (!source.includes("pageMetadata(")) continue;
      const description = source.match(/description:\s*\n?\s*"([^"]*)"/)?.[1];
      if (!description) {
        offenders.push(`${page.route}: no description`);
        continue;
      }
      // Under ~70 and Google rewrites it from page text; over ~160 and it is
      // cut mid-sentence.
      if (description.length < 70 || description.length > 160) {
        offenders.push(`${page.route}: ${description.length} chars`);
      }
    }
    expect(offenders, `descriptions outside 70–160:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("never ships the same description on two pages", () => {
    // Duplicate descriptions are the single most common reason a set of pages
    // competes with itself. Before this pass every page below the root shared
    // the layout's.
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const page of files) {
      const source = readFileSync(page.file, "utf8");
      const description = source.match(/description:\s*\n?\s*"([^"]*)"/)?.[1];
      if (!description) continue;
      const previous = seen.get(description);
      if (previous) duplicates.push(`${page.route} duplicates ${previous}`);
      else seen.set(description, page.route);
    }
    expect(duplicates, duplicates.join("\n")).toEqual([]);
  });

  it("builds a canonical, robots directive and social tags for every page", () => {
    const meta = pageMetadata({
      title: "Example",
      description: "A description written to sit inside the range this helper checks, comfortably.",
      path: "/example",
    });
    expect(meta.alternates?.canonical).toBe("/example");
    expect(meta.openGraph?.url).toBe(`${siteUrl}/example`);
    // The bug this guards: a page declaring `openGraph` replaces the parent's
    // object rather than merging into it, so a helper that forgot any of these
    // would silently drop them site-wide.
    expect(meta.openGraph?.title).toBe("Example");
    expect(meta.twitter?.title).toBe("Example");
    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });

  it("marks a noIndex page as noindex but still followable", () => {
    const meta = pageMetadata({
      title: "Private",
      description: "A description written to sit inside the range this helper checks, comfortably.",
      path: "/private",
      noIndex: true,
    });
    expect(meta.robots).toMatchObject({ index: false, follow: true });
  });
});

describe("structured data", () => {
  it("anchors Person and WebSite to stable ids so pages describe one entity", () => {
    // Without `@id`, a crawler reading thirty pages sees thirty unrelated
    // people who happen to share a name.
    expect(personJsonLd()["@id"]).toBe(`${siteUrl}/#person`);
    expect(webSiteJsonLd()["@id"]).toBe(`${siteUrl}/#website`);
    expect(webSiteJsonLd().publisher).toEqual({ "@id": `${siteUrl}/#person` });
  });

  it("carries the target vocabulary on the Person", () => {
    const knowsAbout = personJsonLd().knowsAbout as string[];
    for (const term of ["C++", "Rust", "Go", "distributed systems"]) {
      expect(knowsAbout, `knowsAbout is missing ${term}`).toContain(term);
    }
  });

  it("describes the occupation as an entity, not just a string", () => {
    const occupation = personJsonLd().hasOccupation as Record<string, unknown>;
    expect(occupation["@type"]).toBe("Occupation");
    expect(String(occupation.skills)).toContain("Rust");
  });

  it("points the SearchAction at a route that handles the parameter", () => {
    const action = webSiteJsonLd().potentialAction as Record<string, unknown>;
    const target = action.target as Record<string, unknown>;
    // A SearchAction pointing somewhere that ignores `?q=` renders a search box
    // in the result that returns nothing, which is worse than none.
    expect(String(target.urlTemplate)).toContain("/search?q={search_term_string}");
  });

  it("prepends Home to every breadcrumb trail exactly once", () => {
    const crumbs = breadcrumbJsonLd([{ name: "Projects", href: "/projects" }]);
    const items = crumbs.itemListElement as { name: string; position: number; item: string }[];
    expect(items.map((item) => item.name)).toEqual(["Home", "Projects"]);
    expect(items.map((item) => item.position)).toEqual([1, 2]);
    // The root must not render as "https://site.com/" with a trailing slash the
    // canonical does not use — two URLs for one page.
    expect(items[0].item).toBe(siteUrl);
  });

  it("numbers list items from one", () => {
    const list = itemListJsonLd("Things", [
      { name: "A", href: "/a" },
      { name: "B", href: "/b" },
    ]);
    const items = list.itemListElement as { position: number; url: string }[];
    expect(items.map((item) => item.position)).toEqual([1, 2]);
    expect(items[0].url).toBe(`${siteUrl}/a`);
  });

  it("shapes FAQ entries the way Google requires", () => {
    const faq = faqJsonLd([{ question: "Why?", answer: "Because." }]);
    const entries = faq.mainEntity as Record<string, unknown>[];
    expect(entries[0]["@type"]).toBe("Question");
    expect((entries[0].acceptedAnswer as Record<string, unknown>)["@type"]).toBe("Answer");
  });
});

/**
 * The canonical origin, asserted as a property of the source tree.
 *
 * Seven files each carried their own `process.env.NEXT_PUBLIC_SITE_URL ?? "…"`,
 * and the literals had already diverged: `app/api/openapi/route.ts` said
 * `www.shivamsfolio.com`; `lib/seo/site.ts`, `app/robots.ts`, `lib/mail.ts`
 * and three API routes said the bare apex. Production sets the variable, so
 * nothing showed — the split only surfaced where it is unset, and then
 * `robots.txt` advertised a sitemap on one host while the OpenAPI document
 * advertised servers on another.
 *
 * A test rather than a comment because the failure mode is additive: the next
 * route that needs an origin will inline the same expression unless something
 * objects.
 */
describe("the canonical origin has exactly one definition", () => {
  /** Every .ts/.tsx under app/ and lib/, excluding generated output. */
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "generated" || entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("is the www form, which is what canonical, og:url and the OAuth URIs use", () => {
    expect(siteUrl).toBe(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shivamsfolio.com");
  });

  it("is not re-derived with a hard-coded host anywhere else", () => {
    const offenders = [
      ...sourceFiles(join(process.cwd(), "app")),
      ...sourceFiles(join(process.cwd(), "lib")),
    ].filter((file) => {
      if (file.endsWith(join("lib", "seo", "site.ts"))) return false;
      const source = readFileSync(file, "utf8");
      // Only a hard-coded literal fallback counts. `?? new URL(request.url).origin`
      // is the correct pattern for the /r and /d redirect handlers — it keeps a
      // preview deployment redirecting to itself rather than to production.
      return /NEXT_PUBLIC_SITE_URL\s*\?\?\s*["'`]/.test(source);
    });

    expect(
      offenders.map((file) => file.replace(process.cwd(), "")),
      "import { siteUrl } from lib/seo/site instead of re-deriving it",
    ).toEqual([]);
  });
});
