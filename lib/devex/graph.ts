/**
 * P17 — layout for the skill graph.
 *
 * **Force-directed, but simulated to completion on the server.** A live physics
 * loop in the browser is the usual way to draw one of these, and it is the
 * wrong trade here: it ships a simulation, runs it on the main thread while the
 * page is trying to become interactive, and produces a slightly different
 * picture every visit. Running the same simulation to a fixed number of
 * iterations on the server produces one deterministic layout, ships as plain
 * SVG in the initial HTML, hydrates nothing, and is identical for every
 * visitor — which also means it can be screenshot-tested.
 *
 * That is the same call P8, P10 and /system-design already made about charts.
 *
 * Determinism needs one more thing: the initial positions must not be random.
 * They come from a seeded generator, so the graph is stable across builds and a
 * diff in the rendered output means the *data* changed.
 */

export interface GraphNode {
  id: string;
  label: string;
  /** "skill" nodes orbit; "project" nodes anchor. */
  kind: "skill" | "project";
  /** Edge count — drives radius, so a widely-used skill reads as bigger. */
  degree: number;
  x: number;
  y: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/**
 * Mulberry32 — a tiny, well-distributed PRNG.
 *
 * `Math.random()` would make the layout different on every render, which turns
 * "the graph moved" from a signal about the data into noise.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIDTH = 900;
const HEIGHT = 620;

/** Enough for this graph to settle; more only moves things by sub-pixels. */
const ITERATIONS = 320;

export interface GraphInput {
  /** Project title -> the technologies it used. */
  projects: { id: string; label: string; skills: string[] }[];
}

/**
 * Build and settle the layout.
 *
 * The forces are the standard three, and the constants are chosen for a graph
 * of tens of nodes rather than thousands:
 *
 * - **Repulsion** between every pair, so labels do not stack.
 * - **Attraction** along edges, so a skill sits near the projects that use it.
 * - **Centring**, weak, so the whole thing does not drift off the viewBox.
 *
 * Cooling is linear. Without it the graph oscillates forever around its minimum
 * and the final frame is arbitrary — which would reintroduce exactly the
 * non-determinism the seeded start removes.
 */
export function layoutSkillGraph(input: GraphInput): GraphLayout {
  const random = seededRandom(0x5f17);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const place = (id: string, label: string, kind: GraphNode["kind"]) => {
    if (nodes.has(id)) return;
    // Seeded start, spread over a circle rather than uniformly over the box:
    // a uniform start leaves nodes in the corners that never fully pull in.
    const angle = random() * Math.PI * 2;
    const radius = 120 + random() * 180;
    nodes.set(id, {
      id,
      label,
      kind,
      degree: 0,
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
    });
  };

  for (const project of input.projects) {
    place(`p:${project.id}`, project.label, "project");
    for (const skill of project.skills) {
      const skillId = `s:${skill.toLowerCase()}`;
      place(skillId, skill, "skill");
      edges.push({ source: `p:${project.id}`, target: skillId });
      nodes.get(skillId)!.degree += 1;
      nodes.get(`p:${project.id}`)!.degree += 1;
    }
  }

  const list = [...nodes.values()];
  if (list.length === 0) return { nodes: [], edges: [], width: WIDTH, height: HEIGHT };

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const temperature = 1 - iteration / ITERATIONS;

    for (let i = 0; i < list.length; i++) {
      let forceX = 0;
      let forceY = 0;
      const a = list[i];

      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const b = list[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        // The epsilon matters: two nodes at identical positions divide by zero
        // and fling each other to infinity, which shows up as an SVG with NaN
        // coordinates and nothing rendered.
        const distanceSquared = dx * dx + dy * dy || 0.01;
        const repulsion = 9000 / distanceSquared;
        const distance = Math.sqrt(distanceSquared);
        forceX += (dx / distance) * repulsion;
        forceY += (dy / distance) * repulsion;
      }

      // Centring, weak enough that structure wins over tidiness.
      forceX += (WIDTH / 2 - a.x) * 0.012;
      forceY += (HEIGHT / 2 - a.y) * 0.012;

      a.x += forceX * 0.08 * temperature;
      a.y += forceY * 0.08 * temperature;
    }

    for (const edge of edges) {
      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      // Spring toward a rest length rather than toward zero, so connected nodes
      // sit *near* each other instead of on top of each other.
      const pull = (distance - 110) * 0.02 * temperature;
      const stepX = (dx / distance) * pull;
      const stepY = (dy / distance) * pull;
      source.x += stepX;
      source.y += stepY;
      target.x -= stepX;
      target.y -= stepY;
    }
  }

  // Clamp inside the viewBox with a margin for the label and radius. Done once
  // at the end rather than every iteration: clamping during the simulation
  // pins nodes to the wall and distorts everything attached to them.
  for (const node of list) {
    node.x = Math.max(70, Math.min(WIDTH - 70, Number(node.x.toFixed(2))));
    node.y = Math.max(40, Math.min(HEIGHT - 40, Number(node.y.toFixed(2))));
  }

  return { nodes: list, edges, width: WIDTH, height: HEIGHT };
}

/** Node radius from degree, compressed so one hub does not dwarf everything. */
export function nodeRadius(node: GraphNode): number {
  const base = node.kind === "project" ? 9 : 5;
  return Number((base + Math.sqrt(node.degree) * 2.4).toFixed(2));
}
