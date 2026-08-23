import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { primaryRoutes, SITE_ROUTES } from "../lib/site-routes";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/**
 * The content column is the header nav.
 *
 * Content used to sit in a flat 1180px column while the top bar ran edge to
 * edge, so nothing in the page lined up with anything in the bar. Now the
 * column IS the nav's span: `.shell`, `.home-inner` and `.header-nav` all read
 * `--content-w`, and the nav uses `space-between`, so the first link starts at
 * the column's left edge and the last ends at its right.
 *
 * That coupling is enforced by CSS. What CSS cannot enforce is the two numbers
 * that were MEASURED against it and then written down somewhere else — those
 * are what this file guards, because each fails silently:
 *
 * - The skill graph's simulation canvas. It is laid out server-side at a fixed
 *   width and rendered with `width: 100%`. If it is wider than the column, the
 *   whole drawing scales down and takes its text with it — that is exactly how
 *   forty labels ended up at 7px and then at 6.1px. Nothing throws; the page
 *   just gets harder to read.
 *
 * - The résumé link in the top bar. Removing it would widen nothing and break
 *   nothing, which is the problem: it is the second click a recruiter makes,
 *   and it was absent from the bar entirely until it was asked for.
 */
describe("content column", () => {
  const globals = read("app/globals.css");

  /** The single declaration of the column width. */
  const contentWidth = (() => {
    const match = globals.match(/--content-w:\s*(\d+)px/);
    expect(match, "--content-w is not declared in app/globals.css").toBeTruthy();
    return Number(match![1]);
  })();

  it("is read by every container rather than repeated", () => {
    // `.shell` is the site-wide column; `.home-inner` is the homepage's own
    // measure; `.header-nav` is what the other two are aligned TO. All three
    // must reference the token — a literal in any of them is a value that will
    // not move when the others do.
    expect(globals, ".shell does not read --content-w").toMatch(
      /\.shell\s*\{[^}]*var\(--content-w\)/,
    );
    expect(globals, ".header-nav does not read --content-w").toMatch(
      /\.header-nav\s*\{[^}]*var\(--content-w\)/,
    );
    expect(read("app/home.css"), ".home-inner does not read --content-w").toMatch(
      /\.home-inner\s*\{[^}]*var\(--content-w\)/,
    );
  });

  it("pins the nav's first and last link to its edges", () => {
    // `justify-content: center` would leave the links floating inside the
    // track, and the alignment would only look right by coincidence of the
    // current label widths.
    expect(globals, ".header-nav must use space-between to pin its end links").toMatch(
      /\.header-nav\s*\{[^}]*justify-content:\s*space-between/,
    );
  });

  it("never lays the skill graph out wider than the column", () => {
    // A graph simulated at 900 units and rendered into a 626px column scales to
    // 0.70, and SVG text scales with the drawing. Measured at that size: 7px
    // labels. Laid out at the column's width it renders 1:1 at 10px.
    const graph = read("lib/devex/graph.ts");
    const width = graph.match(/^const WIDTH = (\d+);/m);
    expect(width, "WIDTH is not declared in lib/devex/graph.ts").toBeTruthy();
    expect(
      Number(width![1]),
      `skill graph is laid out at ${width![1]}px but the column is ${contentWidth}px — ` +
        "the drawing will scale down and shrink its own labels",
    ).toBeLessThanOrEqual(contentWidth);
  });
});

describe("header navigation", () => {
  it("carries the résumé", () => {
    // Explicitly requested, and explicitly requested to stay. It is the second
    // click a recruiter makes and it is a one-line deletion away from being
    // gone with nothing failing.
    const hrefs = primaryRoutes().map((route) => route.href);
    expect(hrefs, "/resume must stay in the header nav").toContain("/resume");
  });

  it("orders every primary route explicitly", () => {
    // primaryRoutes() appends anything flagged `primary` but missing from
    // PRIMARY_ORDER rather than dropping it, so an omission is invisible in the
    // rendered bar — it just lands last. This is the check that names it.
    const routes = read("lib/site-routes.ts");
    const block = routes.match(/const PRIMARY_ORDER = \[([\s\S]*?)\];/);
    expect(block, "PRIMARY_ORDER is not declared").toBeTruthy();
    const ordered = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const flagged = SITE_ROUTES.filter((route) => route.primary).map((route) => route.href);
    expect([...flagged].sort()).toEqual([...ordered].sort());
  });

  it("keeps the bar short enough to stay a bar", () => {
    // Every item added widens the nav, and the content column widens with it.
    // Past a handful the bar stops being a summary and --content-w stops being
    // a measure anyone chose.
    expect(primaryRoutes().length).toBeLessThanOrEqual(6);
  });
});
