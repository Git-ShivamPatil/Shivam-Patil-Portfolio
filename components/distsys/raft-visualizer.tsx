"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCluster,
  hasQuorum,
  killNode,
  majority,
  reviveNode,
  seededRandom,
  tick,
  type RaftState,
} from "../../lib/distsys/raft";
import "./raft.css";

/**
 * P18 — the Raft visualiser.
 *
 * All this component does is *draw* and *drive the clock*: every rule lives in
 * lib/distsys/raft.ts, which is pure and has nineteen tests asserting the
 * protocol's actual invariants — a term only increases, two leaders cannot
 * exist in one term, a leader without quorum steps down. That split is the
 * whole point. A consensus animation is a cartoon; a consensus animation whose
 * state machine is separately asserted is a model you can trust while watching.
 *
 * The interesting thing to do here is kill the leader and watch the cluster
 * elect a new one — then kill a third node and watch it correctly elect nobody,
 * because two of five cannot form a majority.
 */

const CLUSTER_SIZE = 5;
const TICK_MS = 420;

export function RaftVisualizer() {
  // Seeded once per mount. Deterministic within a session, so pressing pause
  // and stepping produces the run you were already watching.
  const random = useMemo(() => seededRandom(1337), []);
  const [state, setState] = useState<RaftState>(() => createCluster(CLUSTER_SIZE, random));
  const [running, setRunning] = useState(false);
  const eventsRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setState((current) => tick(current, random)), TICK_MS);
    return () => clearInterval(timer);
  }, [running, random]);

  useEffect(() => {
    eventsRef.current?.scrollTo({ top: eventsRef.current.scrollHeight });
  }, [state.events]);

  const step = useCallback(() => setState((current) => tick(current, random)), [random]);
  const toggle = useCallback((id: number) => {
    setState((current) => {
      const node = current.nodes.find((candidate) => candidate.id === id);
      if (!node) return current;
      return node.state === "down" ? reviveNode(current, id, random) : killNode(current, id);
    });
  }, [random]);

  const alive = state.nodes.filter((node) => node.state !== "down").length;
  const quorum = hasQuorum(state);

  // Nodes on a circle. Positions are derived, not stored, so adding a node to
  // the cluster needs no layout change.
  const radius = 110;
  const centre = { x: 160, y: 140 };

  return (
    <div className="raft">
      <div className="raft-stage">
        <svg viewBox="0 0 320 280" role="img" aria-label="Raft cluster state">
          <title>Raft cluster</title>
          {state.nodes.map((node, index) => {
            const angle = (index / state.nodes.length) * Math.PI * 2 - Math.PI / 2;
            const x = centre.x + Math.cos(angle) * radius;
            const y = centre.y + Math.sin(angle) * radius;
            const isLeader = node.state === "leader";
            return (
              <g key={node.id} className={`raft-node raft-${node.state}`}>
                {/* Heartbeat spokes, drawn only while a leader is actually
                    leading — a line to a node it cannot reach would be a lie. */}
                {state.leaderId !== null && !isLeader && node.state !== "down" && (
                  <line
                    x1={centre.x + Math.cos((state.leaderId / state.nodes.length) * Math.PI * 2 - Math.PI / 2) * radius}
                    y1={centre.y + Math.sin((state.leaderId / state.nodes.length) * Math.PI * 2 - Math.PI / 2) * radius}
                    x2={x}
                    y2={y}
                    className="raft-heartbeat"
                  />
                )}
                <circle cx={x} cy={y} r={isLeader ? 21 : 17} />
                <text x={x} y={y + 4} textAnchor="middle" className="raft-id">
                  {node.id}
                </text>
                <text x={x} y={y + (isLeader ? 38 : 34)} textAnchor="middle" className="raft-term">
                  t{node.term}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="raft-controls">
          <button type="button" className="button button-solid" onClick={() => setRunning((r) => !r)}>
            {running ? "Pause" : "Run"}
          </button>
          <button type="button" className="button button-light" onClick={step} disabled={running}>
            Step
          </button>
          <button
            type="button"
            className="button button-text"
            onClick={() => {
              setRunning(false);
              setState(createCluster(CLUSTER_SIZE, random));
            }}
          >
            Reset
          </button>
        </div>

        <div className="raft-toggles">
          {state.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => toggle(node.id)}
              data-down={node.state === "down"}
              aria-pressed={node.state === "down"}
            >
              {node.state === "down" ? `Revive ${node.id}` : `Kill ${node.id}`}
            </button>
          ))}
        </div>
      </div>

      <div className="raft-side">
        <p className={quorum ? "raft-quorum" : "raft-quorum raft-quorum-lost"}>
          {alive}/{state.nodes.length} up · majority needs {majority(state.nodes.length)} ·{" "}
          {quorum
            ? state.leaderId !== null
              ? `leader is node ${state.leaderId}`
              : "electing…"
            : "no quorum — correctly electing nobody"}
        </p>

        {/* The log is the explanation. A visualisation of consensus without a
            running commentary shows *that* something happened and never *why*. */}
        <ol className="raft-events" ref={eventsRef} aria-live="polite" aria-label="Cluster events">
          {state.events.map((event, index) => (
            <li key={`${event.tick}-${index}`}>
              <span>t{event.tick}</span>
              {event.message}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
