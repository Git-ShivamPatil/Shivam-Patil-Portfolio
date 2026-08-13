import { layoutSkillGraph, nodeRadius, type GraphInput } from "../../lib/devex/graph";

/**
 * P17 — the skill graph, drawn on the server.
 *
 * A **server component**: the layout is simulated during the render and the
 * result ships as SVG in the initial HTML. Nothing here hydrates, no charting
 * or physics library reaches the browser, and the picture is byte-identical for
 * every visitor because the simulation is seeded. Same call P8's click chart,
 * P10's traffic chart and the /system-design diagrams already made.
 *
 * The edges are real: they come from which technologies each project's `stack`
 * and `tags` actually list. A skill's size is its degree, so the ones that show
 * up across several projects read as bigger — which is the one thing a list of
 * skills cannot show and is the reason this is worth drawing at all.
 */
export function SkillGraph({ input }: { input: GraphInput }) {
  const layout = layoutSkillGraph(input);

  if (layout.nodes.length === 0) {
    return (
      <p className="graph-empty">
        The graph draws itself from the technologies each project lists — there are none published
        yet.
      </p>
    );
  }

  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  return (
    <figure className="skill-graph">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="skill-graph-svg"
        role="img"
        aria-labelledby="skill-graph-title skill-graph-desc"
      >
        <title id="skill-graph-title">Skills connected to the projects that use them</title>
        {/* The description is the accessible equivalent of the picture. A graph
            with only a title tells a screen reader that a graph exists and
            nothing about what is in it. */}
        <desc id="skill-graph-desc">
          {layout.nodes.filter((node) => node.kind === "project").length} projects and{" "}
          {layout.nodes.filter((node) => node.kind === "skill").length} technologies,{" "}
          {layout.edges.length} connections. The full breakdown is in the skill list below this
          graph.
        </desc>

        <g className="skill-graph-edges">
          {layout.edges.map((edge, index) => {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) return null;
            return (
              <line
                key={`${edge.source}-${edge.target}-${index}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
              />
            );
          })}
        </g>

        <g className="skill-graph-nodes">
          {layout.nodes.map((node) => (
            <g
              key={node.id}
              className={`skill-graph-node skill-graph-${node.kind}`}
              // Hover and focus highlighting is pure CSS keyed off this
              // attribute — no JavaScript, and it survives the page being
              // served with scripting off.
              data-kind={node.kind}
            >
              <circle cx={node.x} cy={node.y} r={nodeRadius(node)} />
              <text x={node.x} y={node.y - nodeRadius(node) - 7} textAnchor="middle">
                {node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <figcaption>
        Every line is a technology a project actually lists. Larger nodes appear in more projects —
        the one thing a flat list of skills cannot show.
      </figcaption>
    </figure>
  );
}
