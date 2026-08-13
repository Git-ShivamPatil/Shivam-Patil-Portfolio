/**
 * P20 — the lineage DAG.
 *
 * **Declared, not inferred.** A lineage graph that is written by hand and drifts
 * from the code is worse than none: it is a diagram people trust. So the two
 * things that make it trustworthy are here rather than in the component — each
 * node names the **file** that implements it, and `validateLineage` refuses a
 * graph with a cycle, a dangling edge or an unreachable node.
 *
 * That last part matters more than it sounds. A DAG with a cycle is not a
 * pipeline, and a node nothing reaches is a stage that does not run. Both render
 * as a perfectly plausible picture.
 */

export type NodeKind = "source" | "transform" | "sink" | "view";

export interface LineageNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** The file that actually does this. Checked by a test. */
  file: string;
  detail: string;
}

export interface LineageEdge {
  from: string;
  to: string;
  /** What flows along this edge. */
  label?: string;
}

export const LINEAGE_NODES: LineageNode[] = [
  {
    id: "beacon",
    label: "Browser beacon",
    kind: "source",
    file: "components/analytics-tracker.tsx",
    detail:
      "Page views, scroll depth, click cells and outbound clicks. Honours DNT and Sec-GPC before it collects anything.",
  },
  {
    id: "collect",
    label: "Ingest",
    kind: "transform",
    file: "app/api/analytics/collect/route.ts",
    detail:
      "Anonymous, rate-limited, and everything it receives is re-normalised server-side. Writes happen in after(), off the response path.",
  },
  {
    id: "pageview",
    label: "PageView ledger",
    kind: "sink",
    file: "prisma/schema.prisma",
    detail:
      "One row per view, keyed by an idempotent viewId. No IP; the visitor pseudonym is a salted hash that rotates every UTC day.",
  },
  {
    id: "event",
    label: "AnalyticsEvent ledger",
    kind: "sink",
    file: "prisma/schema.prisma",
    detail: "Clicks, downloads, outbound navigations and rage clicks.",
  },
  {
    id: "counter",
    label: "Rolled-up counters",
    kind: "sink",
    file: "lib/analytics/collect.ts",
    detail:
      "Denormalised totals per (kind, key), so the dashboard never groups over every event ever recorded.",
  },
  {
    id: "heatmap",
    label: "Heatmap cells",
    kind: "sink",
    file: "lib/analytics/collect.ts",
    detail:
      "A sparse counter per grid cell. Never raw points — an exact (x, y, timestamp) trail is a behavioural fingerprint.",
  },
  {
    id: "prune",
    label: "Retention prune",
    kind: "transform",
    file: "app/api/cron/prune-analytics/route.ts",
    detail:
      "Deletes ledger rows past 180 days in bounded batches. Aggregates are kept — they are the safe form.",
  },
  {
    id: "warehouse",
    label: "Warehouse export",
    kind: "transform",
    file: "lib/dataeng/pipeline.ts",
    detail:
      "Aggregates by day, path, country and device in Postgres. Nothing per-visitor leaves the database.",
  },
  {
    id: "duckdb",
    label: "DuckDB in the browser",
    kind: "view",
    file: "components/dataeng/olap-console.tsx",
    detail:
      "The export is queried with real SQL on the visitor's machine. No query reaches a server.",
  },
  {
    id: "report",
    label: "Admin dashboard",
    kind: "view",
    file: "lib/analytics/report.ts",
    detail: "The read model. Reads the ledgers and counters; never writes.",
  },
  {
    id: "live",
    label: "Live dashboard",
    kind: "view",
    file: "lib/realtime/live.ts",
    detail: "The same ledgers over a narrow window, so live and daily cannot disagree.",
  },
];

export const LINEAGE_EDGES: LineageEdge[] = [
  { from: "beacon", to: "collect", label: "sendBeacon" },
  { from: "collect", to: "pageview" },
  { from: "collect", to: "event" },
  { from: "collect", to: "counter", label: "upsert" },
  { from: "collect", to: "heatmap", label: "upsert" },
  { from: "pageview", to: "prune" },
  { from: "event", to: "prune" },
  { from: "pageview", to: "warehouse" },
  { from: "event", to: "warehouse" },
  { from: "warehouse", to: "duckdb", label: "JSON over HTTP" },
  { from: "pageview", to: "report" },
  { from: "event", to: "report" },
  { from: "counter", to: "report" },
  { from: "heatmap", to: "report" },
  { from: "pageview", to: "live" },
  { from: "event", to: "live" },
];

export interface LineageProblem {
  kind: "cycle" | "dangling" | "unreachable";
  detail: string;
}

/**
 * Refuse a graph that is not a pipeline.
 *
 * Three failures, each of which renders as a believable picture:
 *
 * - **A dangling edge** points at a node that does not exist. The line is drawn
 *   to nowhere, or silently dropped, and a stage looks disconnected.
 * - **A cycle** means it is not a DAG at all. Data cannot flow round a loop,
 *   and a diagram showing one is describing something that cannot happen.
 * - **An unreachable node** has no path from any source. It is a stage nothing
 *   feeds, which is either a missing edge or a stage that does not run.
 */
export function validateLineage(
  nodes: LineageNode[] = LINEAGE_NODES,
  edges: LineageEdge[] = LINEAGE_EDGES,
): LineageProblem[] {
  const problems: LineageProblem[] = [];
  const ids = new Set(nodes.map((node) => node.id));

  for (const edge of edges) {
    if (!ids.has(edge.from)) {
      problems.push({ kind: "dangling", detail: `edge from unknown node "${edge.from}"` });
    }
    if (!ids.has(edge.to)) {
      problems.push({ kind: "dangling", detail: `edge to unknown node "${edge.to}"` });
    }
  }

  // Depth-first search with three colours. The "grey" set is what detects a
  // cycle: reaching a node that is still on the current path means the path
  // closes on itself.
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  const visited = new Set<string>();
  const onPath = new Set<string>();

  const walk = (id: string): void => {
    if (onPath.has(id)) {
      problems.push({ kind: "cycle", detail: `cycle through "${id}"` });
      return;
    }
    if (visited.has(id)) return;
    onPath.add(id);
    for (const next of outgoing.get(id) ?? []) walk(next);
    onPath.delete(id);
    visited.add(id);
  };

  for (const node of nodes) walk(node.id);

  const reachable = new Set<string>();
  const sources = nodes.filter((node) => node.kind === "source");
  const queue = sources.map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(outgoing.get(id) ?? []));
  }
  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      problems.push({ kind: "unreachable", detail: `"${node.id}" has no path from any source` });
    }
  }

  return problems;
}

/**
 * Assign nodes to columns by longest path from a source.
 *
 * Longest rather than shortest: a node that is both two hops and four hops from
 * a source belongs in the fourth column, or an edge would run backwards and the
 * diagram would read as flowing the wrong way. The graph is acyclic (checked
 * above), so the longest path terminates.
 */
export function layerLineage(
  nodes: LineageNode[] = LINEAGE_NODES,
  edges: LineageEdge[] = LINEAGE_EDGES,
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }

  const depth = new Map<string, number>();
  const resolve = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);

    const parents = incoming.get(id) ?? [];
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => resolve(parent, seen) + 1));
    depth.set(id, value);
    return value;
  };

  for (const node of nodes) resolve(node.id);
  return depth;
}
