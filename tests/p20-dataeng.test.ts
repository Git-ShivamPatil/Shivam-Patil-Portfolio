import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

vi.mock("../lib/prisma", () => ({ prisma: {} }));

import { tumblingWindows } from "../lib/dataeng/pipeline";
import {
  LINEAGE_EDGES,
  LINEAGE_NODES,
  layerLineage,
  validateLineage,
  type LineageEdge,
  type LineageNode,
} from "../lib/dataeng/lineage";

/**
 * P20 — data engineering.
 *
 * Two things worth pinning: window boundaries that shift under you (which makes
 * two readings incomparable while looking perfectly fine), and a lineage graph
 * that describes something impossible (which renders as a believable picture).
 */

describe("tumbling windows", () => {
  const minute = 60_000;

  it("aligns boundaries to the epoch, not to now", () => {
    // The property that makes two readings comparable. Anchoring on `now` gives
    // every call different buckets, so a chart refreshed a minute later shows
    // different numbers for the same events.
    const first = tumblingWindows([], 5 * minute, 1_700_000_123_456, 4);
    const later = tumblingWindows([], 5 * minute, 1_700_000_123_456 + 30_000, 4);
    expect(first.at(-1)!.start).toBe(later.at(-1)!.start);
  });

  it("assigns each event to exactly one window", () => {
    const now = 1_700_000_000_000;
    const start = Math.floor(now / (5 * minute)) * (5 * minute);
    const events = [start - 1, start, start + 1, start + 5 * minute - 1];

    const points = tumblingWindows(events, 5 * minute, now, 4);
    // Every event inside the covered range is counted once and only once.
    expect(points.reduce((sum, point) => sum + point.count, 0)).toBe(events.length);
  });

  it("is half-open — an event on a boundary belongs to the later window", () => {
    // [start, end). Without this an event exactly on a boundary is counted
    // twice, and totals quietly exceed the number of events.
    const now = 1_700_000_000_000;
    const start = Math.floor(now / minute) * minute;
    const points = tumblingWindows([start], minute, now, 3);
    expect(points.filter((point) => point.count > 0)).toHaveLength(1);
    expect(points.at(-1)!.count).toBe(1);
  });

  it("returns the requested number of windows, oldest first", () => {
    const points = tumblingWindows([], minute, 1_700_000_000_000, 12);
    expect(points).toHaveLength(12);
    const times = points.map((point) => Date.parse(point.start));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("drops events outside the covered range", () => {
    const now = 1_700_000_000_000;
    expect(
      tumblingWindows([now - 100 * minute], minute, now, 5).reduce((sum, p) => sum + p.count, 0),
    ).toBe(0);
  });
});

describe("the lineage graph", () => {
  it("is a valid DAG", () => {
    // The graph that ships must not be a picture of something impossible.
    expect(validateLineage()).toEqual([]);
  });

  it("names a file that exists for every stage", () => {
    // A lineage diagram is trusted without being checked, so the thing it
    // claims about the code has to be true.
    for (const node of LINEAGE_NODES) {
      expect(existsSync(join(process.cwd(), node.file)), `${node.id} -> ${node.file}`).toBe(true);
    }
  });

  it("detects a cycle", () => {
    const nodes: LineageNode[] = [
      { id: "a", label: "A", kind: "source", file: "package.json", detail: "" },
      { id: "b", label: "B", kind: "transform", file: "package.json", detail: "" },
    ];
    const edges: LineageEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    expect(validateLineage(nodes, edges).some((problem) => problem.kind === "cycle")).toBe(true);
  });

  it("detects an edge to a stage that does not exist", () => {
    const nodes: LineageNode[] = [
      { id: "a", label: "A", kind: "source", file: "package.json", detail: "" },
    ];
    const problems = validateLineage(nodes, [{ from: "a", to: "ghost" }]);
    expect(problems.some((problem) => problem.kind === "dangling")).toBe(true);
  });

  it("detects a stage nothing feeds", () => {
    // Either a missing edge or a stage that does not run. Both look fine drawn.
    const nodes: LineageNode[] = [
      { id: "a", label: "A", kind: "source", file: "package.json", detail: "" },
      { id: "orphan", label: "Orphan", kind: "sink", file: "package.json", detail: "" },
    ];
    const problems = validateLineage(nodes, []);
    expect(problems.some((problem) => problem.kind === "unreachable")).toBe(true);
  });

  it("layers by longest path, so no edge runs backwards", () => {
    // A node reachable in both two and four hops belongs in the fourth column;
    // shortest-path layering would draw an edge pointing back up the diagram.
    const depth = layerLineage();
    for (const edge of LINEAGE_EDGES) {
      expect(
        depth.get(edge.to)!,
        `${edge.from} -> ${edge.to} runs backwards`,
      ).toBeGreaterThan(depth.get(edge.from)!);
    }
  });

  it("starts every source at depth zero", () => {
    const depth = layerLineage();
    for (const node of LINEAGE_NODES.filter((entry) => entry.kind === "source")) {
      expect(depth.get(node.id)).toBe(0);
    }
  });

  it("routes both ledgers into the warehouse export", () => {
    // The claim the /data page makes about where its numbers come from.
    const intoWarehouse = LINEAGE_EDGES.filter((edge) => edge.to === "warehouse").map((e) => e.from);
    expect(intoWarehouse).toContain("pageview");
    expect(intoWarehouse).toContain("event");
  });
});

describe("the warehouse export", () => {
  it("never publishes a per-visitor column", async () => {
    // The whole reason the export can be public. Grouping happens in Postgres;
    // shipping the ledger and letting DuckDB aggregate it would publish a row
    // per view and undo P10's entire privacy design.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(join(process.cwd(), "lib/dataeng/pipeline.ts"), "utf8");
    expect(source).not.toContain("visitorHash");
    expect(source).not.toContain("viewId");
    // And it groups rather than selecting rows.
    expect(source).toContain("groupBy");
  });

  it("covers no more than the retention window", async () => {
    // Exporting beyond the point where rows are pruned would be inventing data.
    const { WINDOW_DAYS } = await import("../lib/dataeng/pipeline");
    const { RETENTION_DAYS } = await import("../lib/analytics/constants");
    expect(WINDOW_DAYS).toBeLessThanOrEqual(RETENTION_DAYS);
  });
});
