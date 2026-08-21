import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOG_ENTRIES, entryById } from "../lib/engineering-log";
import { SITE_ROUTES } from "../lib/site-routes";

/**
 * P27 — the engineering log.
 *
 * The page's entire premise is that every entry states **what was believed
 * before the measurement**, including when that was wrong. An entry without a
 * real hypothesis is a changelog line wearing the schema, and enough of those
 * turn the page into exactly the thing it claims not to be.
 *
 * So these tests defend the premise rather than the rendering: that the field
 * exists, that it is substantial, that entries stay checkable against a commit,
 * and that the anchors the structured data emits actually resolve.
 */

describe("the log's premise", () => {
  it("gives every entry a hypothesis", () => {
    const missing = LOG_ENTRIES.filter((entry) => !entry.hypothesis?.trim()).map((e) => e.id);
    expect(missing, `entries with no hypothesis: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not let the hypothesis be a token sentence", () => {
    // The failure mode is not an empty field, it is a lazy one — "I thought it
    // was broken" carries nothing. A length floor is crude, but it is the only
    // automatable proxy for "this describes an actual prior belief".
    const thin = LOG_ENTRIES.filter((entry) => entry.hypothesis.length < 80).map((e) => e.id);
    expect(thin, `hypothesis too thin to be a real prior belief: ${thin.join(", ")}`).toEqual([]);
  });

  it("gives every entry the measurement that settled it", () => {
    for (const entry of LOG_ENTRIES) {
      expect(entry.measurement.length, `${entry.id} measurement`).toBeGreaterThan(80);
    }
  });

  it("gives every entry an invariant, even when the invariant is 'none'", () => {
    // A fix with nothing pinning it is a fix with a timer on it. One entry
    // honestly has no test — the outcome was a removal — and it says so rather
    // than leaving the field blank.
    for (const entry of LOG_ENTRIES) {
      expect(entry.invariant.trim().length, `${entry.id} invariant`).toBeGreaterThan(0);
    }
  });

  it("keeps symptoms free of the answer", () => {
    // A symptom that names the cause is written backwards, from the far side of
    // the debugging. It is the single easiest way for this page to drift into
    // being a changelog.
    for (const entry of LOG_ENTRIES) {
      expect(entry.symptom.toLowerCase(), `${entry.id} symptom`).not.toMatch(
        /\bbecause\b|\bthe cause was\b|\bturned out to be\b|\bthe bug was\b/,
      );
    }
  });
});

describe("the log stays checkable", () => {
  it("uses short git SHAs where a commit is claimed", () => {
    for (const entry of LOG_ENTRIES) {
      if (!entry.commit) continue;
      expect(entry.commit, `${entry.id} commit`).toMatch(/^[0-9a-f]{7,40}$/);
    }
  });

  it("has unique, URL-safe ids", () => {
    const ids = LOG_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("resolves every id through entryById", () => {
    // The structured data emits /engineering-log#<id> for each entry, so a
    // broken id is a broken anchor in a search result.
    for (const entry of LOG_ENTRIES) {
      expect(entryById(entry.id)?.title).toBe(entry.title);
    }
    expect(entryById("no-such-entry")).toBeUndefined();
  });

  it("renders an anchor for every id", () => {
    // Guards the pairing rather than either half: itemListJsonLd advertises
    // these anchors, and nothing else checks the page actually emits them.
    const page = readFileSync(join(process.cwd(), "app", "engineering-log", "page.tsx"), "utf8");
    expect(page).toContain("id={entry.id}");
  });

  it("dates every entry in ISO form, so <time dateTime> is valid", () => {
    for (const entry of LOG_ENTRIES) {
      expect(entry.date, `${entry.id} date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.date))).toBe(false);
    }
  });

  it("orders entries newest first", () => {
    const dates = LOG_ENTRIES.map((entry) => Date.parse(entry.date));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });
});

describe("the route", () => {
  it("is in the registry, so it reaches the sitemap and llms.txt", () => {
    // Without this the page is unlisted — exactly the failure §48 found ten of.
    const route = SITE_ROUTES.find((entry) => entry.href === "/engineering-log");
    expect(route).toBeDefined();
    expect(route!.noIndex).toBeUndefined();
  });

  it("describes itself in plain language, not jargon", () => {
    // The registry's own rule: the label says what a visitor gets, and the
    // discipline name goes in technicalLabel where it is still search signal.
    const route = SITE_ROUTES.find((entry) => entry.href === "/engineering-log")!;
    expect(route.label.toLowerCase()).not.toContain("log");
    expect(route.technicalLabel).toBeTruthy();
  });
});
