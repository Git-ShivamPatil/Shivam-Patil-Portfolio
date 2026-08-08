import { describe, it, expect } from "vitest";

import {
  clampCell,
  clampDepth,
  clampDuration,
  formatDuration,
  isExcludedPath,
  normalizePath,
  outboundTarget,
  refererHost,
  sanitizeLabel,
  sanitizeTarget,
  toBucket,
  toGridCell,
} from "../lib/analytics/normalize";
import { countryFlag, countryName, geoFromHeaders } from "../lib/analytics/geo";
import { findDownload, downloadHref, TRACKED_DOWNLOADS } from "../lib/analytics/downloads";
import { collectSchema } from "../lib/validations/analytics";
import { GRID_X, GRID_Y, MAX_EVENTS_PER_BATCH } from "../lib/analytics/constants";

/**
 * P10 — analytics.
 *
 * The tests concentrate on the two boundaries where a mistake is expensive and
 * silent: what the anonymous ingest endpoint is willing to store, and how a
 * click becomes a heatmap cell. Everything else about this phase is visible the
 * moment you look at the dashboard; a mis-bucketed coordinate or an unbounded
 * field is not.
 */

describe("normalizePath", () => {
  it("reduces a URL to its page key", () => {
    expect(normalizePath("/services")).toBe("/services");
    expect(normalizePath("https://shivamsfolio.com/blog/post")).toBe("/blog/post");
  });

  it("drops query and hash", () => {
    // Not tidiness: keeping utm/ref parameters would split one page into a
    // dozen near-duplicates, and each would collect a fraction of the clicks —
    // which is precisely what makes a heatmap useless.
    expect(normalizePath("/blog?utm_source=x&ref=abc#top")).toBe("/blog");
  });

  it("treats a trailing slash as the same page", () => {
    expect(normalizePath("/services/")).toBe("/services");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("///")).toBe("/");
  });

  it("collapses a value that would read as an origin in the dashboard", () => {
    expect(normalizePath("//evil.com/x")).toBe("/evil.com/x");
  });

  it("never returns something without a leading slash", () => {
    for (const input of ["services", "", "   ", null, undefined, 42, {}]) {
      expect(normalizePath(input).startsWith("/")).toBe(true);
    }
  });

  it("bounds the length of an attacker-supplied path", () => {
    expect(normalizePath(`/${"a".repeat(5000)}`).length).toBeLessThanOrEqual(160);
  });

  it("strips control characters", () => {
    // NUL and UNIT SEPARATOR, written as escapes rather than raw bytes —
    // raw control characters in a source file make git treat it as binary.
    expect(normalizePath("/serv\u0000ices\u001f")).toBe("/services");
  });
});

describe("isExcludedPath", () => {
  it("excludes the admin area and auth screens", () => {
    // The dashboard must not be measuring its own author, and an auth path can
    // carry a token in the URL that has no business in an analytics row.
    expect(isExcludedPath("/admin")).toBe(true);
    expect(isExcludedPath("/admin/analytics")).toBe(true);
    expect(isExcludedPath("/api/analytics/collect")).toBe(true);
    expect(isExcludedPath("/reset-password/abc123")).toBe(true);
  });

  it("does not exclude a page that merely starts with the same letters", () => {
    expect(isExcludedPath("/administration-guide")).toBe(false);
    expect(isExcludedPath("/logins")).toBe(false);
  });

  it("allows ordinary pages", () => {
    expect(isExcludedPath("/")).toBe(false);
    expect(isExcludedPath("/projects/atlas")).toBe(false);
  });
});

describe("refererHost", () => {
  it("returns the bare host", () => {
    expect(refererHost("https://www.google.com/search?q=x")).toBe("google.com");
  });

  it("returns null for our own host", () => {
    // Otherwise the top-sources list would report that the site's biggest
    // referrer is itself, which is true and useless.
    expect(refererHost("https://shivamsfolio.com/about", "www.shivamsfolio.com")).toBeNull();
    expect(refererHost("https://www.shivamsfolio.com/about", "shivamsfolio.com")).toBeNull();
  });

  it("returns null rather than throwing on junk", () => {
    for (const input of ["", "not a url", "://", null, undefined, 7]) {
      expect(refererHost(input)).toBeNull();
    }
  });
});

describe("toBucket", () => {
  it("maps the full range without producing an out-of-range index", () => {
    // A raw floor puts fraction 1.0 into a bucket that does not exist, and a
    // click on the right-hand edge is a perfectly ordinary click.
    expect(toBucket(0, 24)).toBe(0);
    expect(toBucket(0.5, 24)).toBe(12);
    expect(toBucket(1, 24)).toBe(23);
  });

  it("clamps out-of-range input to the end it points at", () => {
    expect(toBucket(-3, 24)).toBe(0);
    expect(toBucket(9, 24)).toBe(23);
    // An infinity is degenerate but directional; NaN carries no information at
    // all, so only NaN collapses to the first bucket.
    expect(toBucket(Infinity, 24)).toBe(23);
    expect(toBucket(-Infinity, 24)).toBe(0);
    expect(toBucket(NaN, 24)).toBe(0);
  });
});

describe("toGridCell", () => {
  it("puts the same element in the same cell at different viewport widths", () => {
    // The property the whole heatmap rests on. x is normalised against the
    // centred content column, so a button 25% into the column lands in the
    // same cell on a 1280px screen and a 1920px one. Normalising by viewport
    // width instead would smear one element across several columns and make
    // aggregation meaningless.
    const narrow = toGridCell({
      x: 50 + 0.25 * 1180,
      y: 500,
      contentLeft: 50,
      contentWidth: 1180,
      documentHeight: 4000,
    });
    const wide = toGridCell({
      x: 370 + 0.25 * 1180,
      y: 500,
      contentLeft: 370,
      contentWidth: 1180,
      documentHeight: 4000,
    });
    expect(narrow).toEqual(wide);
    expect(narrow.x).toBe(Math.floor(0.25 * GRID_X));
  });

  it("measures y against the document, not the viewport", () => {
    // A viewport-relative y would pile every click into the top band no matter
    // how far down the page it happened.
    const top = toGridCell({
      x: 0,
      y: 0,
      contentLeft: 0,
      contentWidth: 1000,
      documentHeight: 4000,
    });
    const middle = toGridCell({
      x: 0,
      y: 2000,
      contentLeft: 0,
      contentWidth: 1000,
      documentHeight: 4000,
    });
    expect(top.y).toBe(0);
    expect(middle.y).toBe(GRID_Y / 2);
  });

  it("clamps a full-bleed click to an edge cell rather than escaping the grid", () => {
    const left = toGridCell({
      x: 0,
      y: 10,
      contentLeft: 300,
      contentWidth: 1180,
      documentHeight: 4000,
    });
    const right = toGridCell({
      x: 1900,
      y: 10,
      contentLeft: 300,
      contentWidth: 1180,
      documentHeight: 4000,
    });
    expect(left.x).toBe(0);
    expect(right.x).toBe(GRID_X - 1);
  });

  it("survives a degenerate measurement instead of producing NaN", () => {
    // A click during layout, or inside a collapsed ancestor, reports zeroes.
    const cell = toGridCell({
      x: 10,
      y: 10,
      contentLeft: 0,
      contentWidth: 0,
      documentHeight: 0,
    });
    expect(Number.isInteger(cell.x)).toBe(true);
    expect(Number.isInteger(cell.y)).toBe(true);
  });

  it("always yields indices the schema and the unique key accept", () => {
    for (const x of [-5000, 0, 640, 99999]) {
      for (const y of [-1, 0, 12345]) {
        const cell = toGridCell({
          x,
          y,
          contentLeft: 100,
          contentWidth: 1180,
          documentHeight: 3000,
        });
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(GRID_X);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(GRID_Y);
      }
    }
  });
});

describe("sanitizeTarget", () => {
  it("keeps ordinary identifiers intact", () => {
    expect(sanitizeTarget("resume-download")).toBe("resume-download");
    expect(sanitizeTarget("github.com")).toBe("github.com");
    expect(sanitizeTarget("cell:3-17")).toBe("cell:3-17");
  });

  it("cannot carry markup", () => {
    // This value is rendered in the admin dashboard and arrives over an
    // anonymous endpoint, so the alphabet is the boundary that matters.
    expect(sanitizeTarget("<img src=x onerror=alert(1)>")).not.toContain("<");
    expect(sanitizeTarget("<script>")).toBe("script");
  });

  it("normalises case and trims separator noise", () => {
    expect(sanitizeTarget("  Resume  Download  ")).toBe("resume-download");
    expect(sanitizeTarget("---x---")).toBe("x");
  });

  it("returns null rather than an empty key", () => {
    // An empty string would become a counter row keyed on nothing.
    for (const input of ["", "   ", "!!!", null, undefined, 5, {}]) {
      expect(sanitizeTarget(input)).toBeNull();
    }
  });

  it("bounds the length", () => {
    expect(sanitizeTarget("a".repeat(5000))!.length).toBeLessThanOrEqual(120);
  });
});

describe("sanitizeLabel", () => {
  it("collapses whitespace and bounds length", () => {
    expect(sanitizeLabel("  Résumé   —  download  ")).toBe("Résumé — download");
    expect(sanitizeLabel("x".repeat(500))!.length).toBeLessThanOrEqual(80);
  });

  it("strips control characters", () => {
    expect(sanitizeLabel("a\u0000b")).toBe("ab");
  });

  it("returns null for nothing usable", () => {
    expect(sanitizeLabel("")).toBeNull();
    expect(sanitizeLabel(undefined)).toBeNull();
  });
});

describe("outboundTarget", () => {
  it("records the host and discards the path", () => {
    // Which sites we send people to is the useful signal. Which page of
    // someone else's site a particular visitor opened is a browsing record,
    // and this endpoint has no business holding one.
    expect(outboundTarget("https://github.com/Git-ShivamPatil/secret-repo")).toBe("github.com");
    expect(outboundTarget("https://www.linkedin.com/in/x")).toBe("linkedin.com");
  });

  it("refuses non-http schemes", () => {
    for (const href of ["javascript:alert(1)", "mailto:a@b.com", "tel:+1", "data:text/html,x"]) {
      expect(outboundTarget(href)).toBeNull();
    }
  });

  it("returns null for our own host", () => {
    expect(outboundTarget("https://shivamsfolio.com/about", "shivamsfolio.com")).toBeNull();
  });
});

describe("clamps", () => {
  it("bounds scroll depth to a percentage", () => {
    expect(clampDepth(50.4)).toBe(50);
    expect(clampDepth(-10)).toBe(0);
    expect(clampDepth(999)).toBe(100);
    expect(clampDepth(NaN)).toBe(0);
    expect(clampDepth("nope")).toBe(0);
  });

  it("caps duration so one stuck tab cannot skew every average", () => {
    expect(clampDuration(1500)).toBe(1500);
    expect(clampDuration(-1)).toBe(0);
    expect(clampDuration(99 * 60 * 60 * 1000)).toBe(30 * 60 * 1000);
    expect(clampDuration(undefined)).toBe(0);
  });

  it("forces network-supplied cell indices back into the grid", () => {
    expect(clampCell(999, 999)).toEqual({ x: GRID_X - 1, y: GRID_Y - 1 });
    expect(clampCell(-4, -4)).toEqual({ x: 0, y: 0 });
    expect(clampCell(1.9, "3")).toEqual({ x: 1, y: 3 });
    expect(clampCell(null, NaN)).toEqual({ x: 0, y: 0 });
  });
});

describe("formatDuration", () => {
  it("reads as seconds below a minute and as minutes above", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(4200)).toBe("4s");
    expect(formatDuration(62_000)).toBe("1m 2s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(NaN)).toBe("0s");
  });
});

describe("geoFromHeaders", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("reads Vercel's edge headers", () => {
    const geo = geoFromHeaders(
      headers({
        "x-vercel-ip-country": "in",
        "x-vercel-ip-country-region": "MH",
        "x-vercel-ip-city": "Navi%20Mumbai",
        "x-vercel-ip-timezone": "Asia/Kolkata",
      }),
    );
    // City names arrive percent-encoded because HTTP headers are ASCII-only.
    expect(geo).toEqual({
      country: "IN",
      region: "MH",
      city: "Navi Mumbai",
      timezone: "Asia/Kolkata",
    });
  });

  it("falls back to Cloudflare's headers", () => {
    expect(geoFromHeaders(headers({ "cf-ipcountry": "DE" })).country).toBe("DE");
  });

  it("rejects the edge's placeholders instead of inventing countries", () => {
    // "XX" is unknown and "T1" is a Tor exit node. Stored verbatim they show
    // up in the dashboard as real places.
    expect(geoFromHeaders(headers({ "x-vercel-ip-country": "XX" })).country).toBeNull();
    expect(geoFromHeaders(headers({ "x-vercel-ip-country": "T1" })).country).toBeNull();
    expect(geoFromHeaders(headers({ "x-vercel-ip-country": "INDIA" })).country).toBeNull();
  });

  it("survives a malformed percent-encoding rather than throwing on ingest", () => {
    expect(geoFromHeaders(headers({ "x-vercel-ip-city": "100%" })).city).toBe("100%");
  });

  it("returns nulls with no headers, which is local development", () => {
    expect(geoFromHeaders(headers({}))).toEqual({
      country: null,
      region: null,
      city: null,
      timezone: null,
    });
  });
});

describe("country display", () => {
  it("resolves a code to a name", () => {
    expect(countryName("IN")).toBe("India");
    expect(countryName("de")).toBe("Germany");
  });

  it("always returns something printable, whatever it is given", () => {
    // The contract is "never throws, never renders an empty table cell", not a
    // specific string. Intl handles more than expected — "ZZ" is CLDR's own
    // unknown-region code and comes back as "Unknown Region" rather than
    // throwing — so pinning exact wording here would be pinning ICU's data,
    // which is not ours and does change between runtimes.
    expect(countryName(null)).toBe("Unknown");
    expect(countryName(undefined)).toBe("Unknown");
    for (const code of ["ZZ", "Q1", "!!", "toolong", ""]) {
      const name = countryName(code);
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("builds a flag from regional indicators", () => {
    expect(countryFlag("IN")).toBe("🇮🇳");
    expect(countryFlag(null)).toBe("🌍");
    expect(countryFlag("XYZ")).toBe("🌍");
  });
});

describe("download registry", () => {
  it("resolves a known slug", () => {
    const resume = findDownload("resume");
    expect(resume?.file).toBe("/Shivam-Patil-SDE-II-Resume.pdf");
    expect(downloadHref("resume")).toBe("/d/resume");
  });

  it("is a closed allowlist, not a path parameter", () => {
    // /d/<slug> issues a redirect. If the slug could name its own destination
    // this would be an open redirect on the production domain, and "it's only
    // for downloads" would not change what a phishing link did with it.
    for (const slug of ["../../etc/passwd", "https://evil.com", "//evil.com", "unknown"]) {
      expect(findDownload(slug)).toBeNull();
    }
  });

  it("only ever resolves to a site-relative file", () => {
    for (const download of TRACKED_DOWNLOADS) {
      expect(download.file.startsWith("/")).toBe(true);
      expect(download.file.startsWith("//")).toBe(false);
    }
  });
});

describe("collectSchema", () => {
  const valid = {
    viewId: "0b3c1d2e-4f5a-6b7c-8d9e-0f1a2b3c4d5e",
    path: "/services",
  };

  it("accepts a minimal payload", () => {
    expect(collectSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a full payload", () => {
    const result = collectSchema.safeParse({
      ...valid,
      referrer: "https://google.com/",
      timezone: "Asia/Kolkata",
      durationMs: 42_000,
      scrollDepth: 80,
      cells: [{ x: 3, y: 17, n: 4 }],
      events: [{ type: "download", target: "resume", label: "Résumé", path: "/resume" }],
    });
    expect(result.success).toBe(true);
  });

  it("caps the number of rows one accepted request can produce", () => {
    // The rate limiter caps requests; this caps the blast radius of any single
    // request that gets through. Without it, one 204 could insert thousands of
    // rows — a far cheaper attack than sending thousands of requests.
    const cells = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, (_, i) => ({
      x: i % GRID_X,
      y: 0,
      n: 1,
    }));
    expect(collectSchema.safeParse({ ...valid, cells }).success).toBe(false);

    const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => ({
      type: "click" as const,
      target: "x",
    }));
    expect(collectSchema.safeParse({ ...valid, events }).success).toBe(false);
  });

  it("rejects out-of-range grid coordinates", () => {
    // These land in a unique key. Anything outside the grid would either be
    // clamped into a cell it does not belong in or create one nothing reads.
    expect(collectSchema.safeParse({ ...valid, cells: [{ x: GRID_X, y: 0, n: 1 }] }).success).toBe(
      false,
    );
    expect(collectSchema.safeParse({ ...valid, cells: [{ x: 0, y: GRID_Y, n: 1 }] }).success).toBe(
      false,
    );
    expect(collectSchema.safeParse({ ...valid, cells: [{ x: -1, y: 0, n: 1 }] }).success).toBe(
      false,
    );
    expect(collectSchema.safeParse({ ...valid, cells: [{ x: 0.5, y: 0, n: 1 }] }).success).toBe(
      false,
    );
  });

  it("caps a single cell's claimed click count", () => {
    expect(collectSchema.safeParse({ ...valid, cells: [{ x: 0, y: 0, n: 10_000 }] }).success).toBe(
      false,
    );
  });

  it("rejects a view id that is not one", () => {
    for (const viewId of ["", "short", "a".repeat(65), "has spaces", "../../x", "<script>"]) {
      expect(collectSchema.safeParse({ ...valid, viewId }).success).toBe(false);
    }
  });

  it("rejects an unknown event type", () => {
    expect(
      collectSchema.safeParse({ ...valid, events: [{ type: "purchase", target: "x" }] }).success,
    ).toBe(false);
  });

  it("rejects unexpected keys rather than ignoring them", () => {
    // Silently dropping an unknown field is how a client and a server drift
    // apart while both appear to be working.
    expect(collectSchema.safeParse({ ...valid, ip: "1.2.3.4" }).success).toBe(false);
    expect(
      collectSchema.safeParse({ ...valid, cells: [{ x: 0, y: 0, n: 1, raw: "1,2" }] }).success,
    ).toBe(false);
  });

  it("rejects an oversized string field", () => {
    expect(collectSchema.safeParse({ ...valid, path: "/" + "a".repeat(400) }).success).toBe(false);
    expect(collectSchema.safeParse({ ...valid, referrer: "x".repeat(600) }).success).toBe(false);
  });
});
