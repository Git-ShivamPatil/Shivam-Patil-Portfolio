import { LINEAGE_EDGES, LINEAGE_NODES, layerLineage, validateLineage } from "../../lib/dataeng/lineage";

/**
 * P20 — the lineage DAG, drawn on the server.
 *
 * A server component: layered, laid out and rendered as SVG in the initial
 * HTML, hydrating nothing — the same call every other diagram on this site
 * makes.
 *
 * **It validates itself.** `validateLineage` refuses a graph with a cycle, a
 * dangling edge or a node no source reaches, and this renders the problems
 * rather than drawing a picture that is wrong. A lineage diagram is exactly the
 * kind of artefact people trust without checking, so one that cannot be wrong
 * quietly is worth more than one that is merely pretty.
 */
export function LineageGraph() {
  const problems = validateLineage();
  const depth = layerLineage();

  const columns = new Map<number, typeof LINEAGE_NODES>();
  for (const node of LINEAGE_NODES) {
    const layer = depth.get(node.id) ?? 0;
    columns.set(layer, [...(columns.get(layer) ?? []), node]);
  }

  const columnCount = Math.max(...columns.keys()) + 1;
  const columnWidth = 210;
  const rowHeight = 92;
  const width = columnCount * columnWidth;
  const height = Math.max(...[...columns.values()].map((nodes) => nodes.length)) * rowHeight + 40;

  const position = new Map<string, { x: number; y: number }>();
  for (const [layer, nodes] of columns) {
    nodes.forEach((node, index) => {
      position.set(node.id, {
        x: layer * columnWidth + 90,
        // Centred within the column, so a column of two does not sit against
        // the top edge beside a column of six.
        y: (height - nodes.length * rowHeight) / 2 + index * rowHeight + 40,
      });
    });
  }

  if (problems.length > 0) {
    return (
      <div className="lineage-problems" role="alert">
        <p>
          The lineage graph does not describe a pipeline, so it is not drawn. A diagram people
          trust is worse than none when it is wrong:
        </p>
        <ul>
          {problems.map((problem) => (
            <li key={`${problem.kind}-${problem.detail}`}>
              <strong>{problem.kind}</strong> — {problem.detail}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <figure className="lineage">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="lineage-title lineage-desc">
        <title id="lineage-title">Analytics data lineage</title>
        <desc id="lineage-desc">
          {LINEAGE_NODES.length} stages and {LINEAGE_EDGES.length} flows, from the browser beacon
          through the ledgers to the dashboards and the browser-side warehouse. Each stage is listed
          with the file that implements it below the diagram.
        </desc>

        <g className="lineage-edges">
          {LINEAGE_EDGES.map((edge) => {
            const from = position.get(edge.from);
            const to = position.get(edge.to);
            if (!from || !to) return null;
            // A cubic curve with horizontal control points, so edges leave and
            // enter their nodes flat and the direction of flow reads left to
            // right even where two columns are far apart.
            const midX = (from.x + to.x) / 2;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={`M ${from.x + 62} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 62} ${to.y}`}
                fill="none"
              />
            );
          })}
        </g>

        <g className="lineage-nodes">
          {LINEAGE_NODES.map((node) => {
            const point = position.get(node.id);
            if (!point) return null;
            return (
              <g key={node.id} className={`lineage-node lineage-${node.kind}`}>
                <rect x={point.x - 62} y={point.y - 20} width={124} height={40} rx={9} />
                <text x={point.x} y={point.y + 4} textAnchor="middle">
                  {node.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <figcaption>
        Every stage names the file that implements it, and the graph is validated before it is
        drawn — a cycle, a dangling edge or a stage nothing reaches renders as an error instead of
        a plausible picture.
      </figcaption>

      <dl className="lineage-legend">
        {LINEAGE_NODES.map((node) => (
          <div key={node.id} data-kind={node.kind}>
            <dt>
              {node.label} <code>{node.file}</code>
            </dt>
            <dd>{node.detail}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
