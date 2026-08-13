import { describe, it, expect, vi } from "vitest";

// lib/integrations/activity.ts reaches the cache module, which builds the
// Prisma client at import time. `summariseEvents` is pure — it never touches
// the database — so a stub keeps this suite free of one, which is the property
// CI depends on.
vi.mock("../lib/prisma", () => ({ prisma: {} }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fuzzyMatch, rank } from "../lib/devex/fuzzy";
import {
  NAVIGATION_COMMANDS,
  TERMINAL_COMMANDS,
  allCommands,
  parseLine,
  resolvePage,
} from "../lib/devex/commands";
import { layoutSkillGraph, nodeRadius } from "../lib/devex/graph";
import { summariseEvents } from "../lib/integrations/activity";

/**
 * P17 — the interface layer.
 *
 * Two things here are worth pinning because they are wrong in ways nobody
 * notices: a fuzzy ranker that puts the obvious answer second, and a graph
 * layout that moves between builds so every rendered diff is noise.
 */

describe("fuzzy matching", () => {
  it("matches initials, which is how a palette is actually used", () => {
    // Substring matching cannot do this at all, and it is the primary way
    // anyone drives a command palette.
    expect(fuzzyMatch("sd", "System design").score).toBeGreaterThan(0);
    expect(fuzzyMatch("sd", "System design").score).toBeGreaterThan(
      fuzzyMatch("sd", "Saved feeds").score,
    );
  });

  it("requires every character, in order", () => {
    expect(fuzzyMatch("xyz", "System design").score).toBe(0);
    // Right characters, wrong order.
    expect(fuzzyMatch("ngised", "design").score).toBe(0);
  });

  it("ranks a contiguous match above a scattered one", () => {
    expect(fuzzyMatch("term", "Terminal").score).toBeGreaterThan(
      fuzzyMatch("term", "The experience of remote work").score,
    );
  });

  it("prefers the shorter of two equally good matches", () => {
    expect(fuzzyMatch("ask", "Ask").score).toBeGreaterThan(
      fuzzyMatch("ask", "Ask about the architecture").score,
    );
  });

  it("treats spaces in the query as separators", () => {
    expect(fuzzyMatch("sys des", "System design").score).toBeGreaterThan(0);
  });

  it("returns everything for an empty query, in authored order", () => {
    const results = rank("", allCommands(), 5);
    expect(results).toHaveLength(5);
    expect(results[0].item.id).toBe(allCommands()[0].id);
  });

  it("folds accents, so \"resume\" finds \"Résumé\"", () => {
    // A real hole this test caught: strict comparison scored the Résumé page
    // ZERO for the spelling almost everyone types, and ranked "Achievements"
    // first — "resume" is a subsequence of its keyword list. The palette
    // confidently offered the wrong page for one of the likeliest searches on
    // a portfolio.
    expect(fuzzyMatch("resume", "Résumé").score).toBeGreaterThan(0);

    const results = rank("resume", allCommands(), 12);
    expect(results[0].item.label).toContain("sum");
  });

  it("scores a keyword-only hit below a label hit", () => {
    // Something whose *name* matches is what the user meant; something whose
    // description happens to contain the letters usually is not.
    const onLabel = rank("terminal", allCommands(), 12)[0];
    expect(onLabel.item.id).toBe("nav-terminal");
  });

  it("finds pages by synonym, not just by name", () => {
    // "hire" appears in no label — only in the services keywords.
    const results = rank("hire", allCommands(), 5);
    expect(results.some((result) => result.item.id === "nav-services")).toBe(true);
  });
});

describe("the command registry", () => {
  it("offers no route that needs a session", () => {
    // A palette that sends a visitor somewhere they will be redirected away
    // from is worse than one that omits it.
    for (const command of NAVIGATION_COMMANDS) {
      expect(command.href ?? "").not.toMatch(/^\/(admin|account|login|register)/);
    }
  });

  it("gives every command a unique id", () => {
    const ids = allCommands().map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every navigation command at a real route", () => {
    // Catches a palette entry left behind after a page was renamed.
    for (const command of NAVIGATION_COMMANDS) {
      const path = (command.href ?? "").split("#")[0];
      if (path === "/" || path === "") continue;
      const candidates = [
        join(process.cwd(), "app", path, "page.tsx"),
        join(process.cwd(), "app", path, "route.ts"),
      ];
      const exists = candidates.some((candidate) => {
        try {
          readFileSync(candidate);
          return true;
        } catch {
          return false;
        }
      });
      expect(exists, `${command.href} has no page`).toBe(true);
    }
  });
});

describe("terminal parsing", () => {
  it("splits a command from its argument", () => {
    expect(parseLine("ask what is this?")).toEqual({ name: "ask", argument: "what is this?" });
    expect(parseLine("help")).toEqual({ name: "help", argument: "" });
    expect(parseLine("  ls  ")).toEqual({ name: "ls", argument: "" });
  });

  it("lowercases the command but never the argument", () => {
    // `ask` takes a question, and lowercasing it changes what is being asked.
    expect(parseLine("ASK How does RAG work?")).toEqual({
      name: "ask",
      argument: "How does RAG work?",
    });
  });

  it("resolves a page however someone types it", () => {
    expect(resolvePage("about")?.href).toBe("/about");
    expect(resolvePage("/about")?.href).toBe("/about");
    expect(resolvePage("About")?.href).toBe("/about");
    // Prefix, so "sys" reaches /system-design.
    expect(resolvePage("sys")?.href).toBe("/system-design");
  });

  it("returns null rather than guessing wildly", () => {
    expect(resolvePage("")).toBeNull();
    expect(resolvePage("zzzz")).toBeNull();
  });

  it("documents every command it implements", () => {
    const source = readFileSync(join(process.cwd(), "components/devex/terminal.tsx"), "utf8");
    for (const command of TERMINAL_COMMANDS) {
      // A command missing from `help` is a command nobody discovers.
      expect(source).toContain(`case "${command.name}"`);
    }
  });
});

describe("skill graph layout", () => {
  const input = {
    projects: [
      { id: "a", label: "Rate limiter", skills: ["Go", "Redis", "Postgres"] },
      { id: "b", label: "Inference server", skills: ["Rust", "Redis"] },
      { id: "c", label: "Banking", skills: ["Go", "Kubernetes"] },
    ],
  };

  it("is deterministic — the same input draws the same picture", () => {
    // Seeded, so a diff in the rendered SVG means the *data* changed. With
    // Math.random() every build would produce a different layout and the
    // output would be untestable and unreviewable.
    const first = layoutSkillGraph(input);
    const second = layoutSkillGraph(input);
    expect(first.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      second.nodes.map((node) => [node.id, node.x, node.y]),
    );
  });

  it("deduplicates a skill shared by two projects", () => {
    const layout = layoutSkillGraph(input);
    const redis = layout.nodes.filter((node) => node.id === "s:redis");
    expect(redis).toHaveLength(1);
    expect(redis[0].degree).toBe(2);
  });

  it("produces one edge per project-skill pair", () => {
    expect(layoutSkillGraph(input).edges).toHaveLength(7);
  });

  it("never emits NaN coordinates", () => {
    // Two nodes at identical positions divide by zero and fling each other to
    // infinity, which renders as an empty SVG rather than an error.
    for (const node of layoutSkillGraph(input).nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("keeps every node inside the viewBox", () => {
    const layout = layoutSkillGraph(input);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(layout.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it("handles an empty corpus without throwing", () => {
    expect(layoutSkillGraph({ projects: [] }).nodes).toEqual([]);
  });

  it("sizes a node by degree, compressed so one hub does not dwarf the rest", () => {
    const layout = layoutSkillGraph(input);
    const shared = layout.nodes.find((node) => node.id === "s:redis")!;
    const single = layout.nodes.find((node) => node.id === "s:rust")!;
    expect(nodeRadius(shared)).toBeGreaterThan(nodeRadius(single));
    // Square root, not linear: twice the degree must not be twice the radius.
    expect(nodeRadius(shared)).toBeLessThan(nodeRadius(single) * 2);
  });
});

describe("activity summary", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");
  const day = (offset: number) => new Date(now - offset * 86_400_000).toISOString();

  it("weights a push by its commit count", () => {
    // A push carrying five commits is more activity than a single star, and
    // counting both as 1 makes the map flat.
    const summary = summariseEvents(
      [
        { type: "PushEvent", created_at: day(0), payload: { commits: [1, 2, 3, 4, 5] } },
        { type: "WatchEvent", created_at: day(0) },
      ],
      now,
    );
    expect(summary.total).toBe(6);
  });

  it("covers the whole window including empty days", () => {
    const summary = summariseEvents([{ type: "WatchEvent", created_at: day(0) }], now);
    expect(summary.days).toHaveLength(90);
    expect(summary.days.filter((entry) => entry.count === 0)).toHaveLength(89);
  });

  it("does not break a streak just because today is empty", () => {
    // The day is not over. A counter that resets at midnight and recovers at
    // the first commit is noise, not a signal.
    const summary = summariseEvents(
      [
        { type: "PushEvent", created_at: day(1), payload: { commits: [1] } },
        { type: "PushEvent", created_at: day(2), payload: { commits: [1] } },
      ],
      now,
    );
    expect(summary.currentStreak).toBe(2);
  });

  it("reports no busiest day when there was no activity", () => {
    expect(summariseEvents([], now).busiestDay).toBeNull();
  });

  it("drops events outside the window rather than folding them into edge days", () => {
    const summary = summariseEvents(
      [{ type: "PushEvent", created_at: day(200), payload: { commits: [1] } }],
      now,
    );
    expect(summary.total).toBe(0);
  });
});

describe("the theme customiser", () => {
  const source = readFileSync(join(process.cwd(), "components/devex/theme-customizer.tsx"), "utf8");
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("clamps hue so the palette cannot become a third colour", () => {
    // The brief is unambiguous: light is pink + cream, dark is neon + black,
    // and a third hue anywhere is a defect. A free colour picker would let any
    // visitor break that in one drag.
    expect(source).toContain("MAX_HUE_SHIFT = 18");
  });

  it("never touches lightness, which is what the contrast floor depends on", () => {
    // Rotating hue at fixed L and C provably cannot move a contrast ratio.
    expect(css).toContain("oklch(from var(--accent-base) l c calc(h + var(--accent-hue-shift)))");
    expect(css).not.toContain("hue-rotate(var(--accent-hue-shift))");
  });

  it("degrades where the relative-colour syntax is missing", () => {
    // An unsupported browser must get the designed palette, not a broken one.
    expect(css).toContain("@supports (color: oklch(from red l c h))");
  });

  it("declares defaults for the properties it writes", () => {
    // A var() with no fallback and no definition collapses the whole
    // declaration — the radius would vanish for anyone who never opened it.
    expect(css).toContain("--accent-hue-shift: 0deg;");
    expect(css).toContain("--density: 1;");
  });
});
