"use client";

import { useMemo, useState } from "react";
import {
  runExperiment,
  summarise,
  type ExperimentConfig,
  type ExperimentResult,
  type ExperimentStep,
} from "../../lib/sre/chaos";
import { DEFAULT_POLICY } from "../../lib/sre/breaker";

/**
 * P21 — the chaos experiment, run in the visitor's browser.
 *
 * **The breaker being exercised here is the production breaker.** This
 * component imports lib/sre/breaker.ts, which is the same module
 * lib/sre/breaker-store.ts drives in front of the real GitHub and LeetCode
 * calls. There is no simulation of the breaker anywhere — only the dependency
 * is simulated, by lib/sre/chaos.ts injecting faults into calls that never
 * leave the page.
 *
 * That split is the entire reason this is worth showing. The alternative — a
 * hand-animated diagram of a state machine — would prove nothing, because the
 * thing a reader wants to know is whether the code actually behaves the way the
 * diagram claims. Here, if the circuit opens on the twelfth failure, it is
 * because `recordOutcome` opened it.
 *
 * Nothing is injected into the live site. The server-side arm of chaos.ts
 * exists, is off unless `CHAOS_ENABLED=1`, and is meant for a preview deploy.
 */

/** Named starting points, so the interesting shapes are one click away. */
const SCENARIOS: { id: string; label: string; blurb: string; config: ExperimentConfig }[] = [
  {
    id: "outage",
    label: "Total outage, then recovery",
    blurb:
      "The dependency dies completely at call 20 and comes back at call 70. The clearest view of open → half-open → closed.",
    config: {
      seed: 7,
      calls: 120,
      intervalMs: 1000,
      phases: [
        { atCall: 0, profile: { errorRate: 0, timeoutRate: 0, latencyMs: 40 }, label: "healthy" },
        { atCall: 20, profile: { errorRate: 1, timeoutRate: 0, latencyMs: 40 }, label: "down" },
        {
          atCall: 70,
          profile: { errorRate: 0, timeoutRate: 0, latencyMs: 40 },
          label: "recovered",
        },
      ],
    },
  },
  {
    id: "brownout",
    label: "Brownout — half the calls fail",
    blurb:
      "The hard case. A 50% failure rate sits exactly on the threshold, so the circuit flaps rather than settling — which is what a badly chosen ratio looks like.",
    config: {
      seed: 21,
      calls: 140,
      intervalMs: 1000,
      phases: [
        { atCall: 0, profile: { errorRate: 0, timeoutRate: 0, latencyMs: 40 }, label: "healthy" },
        {
          atCall: 15,
          profile: { errorRate: 0.5, timeoutRate: 0, latencyMs: 60 },
          label: "brownout",
        },
      ],
    },
  },
  {
    id: "hang",
    label: "Slow death — it hangs, never errors",
    blurb:
      "Every call times out at eight seconds instead of failing fast. This is where a breaker earns its keep: the saved figure below is the latency it refused to spend.",
    config: {
      seed: 99,
      calls: 100,
      intervalMs: 1000,
      phases: [
        { atCall: 0, profile: { errorRate: 0, timeoutRate: 0, latencyMs: 40 }, label: "healthy" },
        { atCall: 10, profile: { errorRate: 0, timeoutRate: 1, latencyMs: 40 }, label: "hanging" },
        {
          atCall: 65,
          profile: { errorRate: 0, timeoutRate: 0, latencyMs: 40 },
          label: "recovered",
        },
      ],
    },
  },
  {
    id: "blip",
    label: "A blip that should not open it",
    blurb:
      "Three failures in a row, then health. Below the minimum-samples floor the circuit stays closed — a breaker that opens on every hiccup is worse than none.",
    config: {
      seed: 3,
      calls: 60,
      intervalMs: 1000,
      phases: [
        { atCall: 0, profile: { errorRate: 0, timeoutRate: 0, latencyMs: 40 }, label: "healthy" },
        { atCall: 12, profile: { errorRate: 1, timeoutRate: 0, latencyMs: 40 }, label: "blip" },
        { atCall: 15, profile: { errorRate: 0, timeoutRate: 0, latencyMs: 40 }, label: "healthy" },
      ],
    },
  },
];

const STATE_LABEL: Record<string, string> = {
  closed: "Closed",
  open: "Open",
  "half-open": "Half-open",
};

function StripCell({ step }: { step: ExperimentStep }) {
  const title =
    `Call ${step.call} · ${step.phase} · ${step.result}` +
    (step.result === "rejected" ? "" : ` · ${step.latencyMs}ms`) +
    `\n${step.stateBefore} → ${step.stateAfter}` +
    (step.note ? `\n${step.note}` : "");

  return (
    <li
      className="chaos-cell"
      data-result={step.result}
      data-transition={step.transitioned || undefined}
      title={title}
    />
  );
}

export function ChaosLab() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [seedNudge, setSeedNudge] = useState(0);

  const scenario = SCENARIOS.find((entry) => entry.id === scenarioId) ?? SCENARIOS[0];

  // Recomputed rather than stored in state, and memoised on the two inputs that
  // determine it. The run is a pure function of (scenario, seed), so caching it
  // in state could only ever let the two disagree.
  const result: ExperimentResult = useMemo(
    () => runExperiment({ ...scenario.config, seed: scenario.config.seed + seedNudge }),
    [scenario, seedNudge],
  );

  const summary = summarise(result);
  const transitions = result.steps.filter((step) => step.transitioned);

  return (
    <div className="chaos-lab">
      <div className="chaos-controls">
        <div className="chaos-scenarios" role="group" aria-label="Failure scenario">
          {SCENARIOS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="chaos-scenario"
              data-active={entry.id === scenarioId}
              aria-pressed={entry.id === scenarioId}
              onClick={() => setScenarioId(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="chaos-reseed"
          onClick={() => setSeedNudge((current) => current + 1)}
        >
          New seed
          <span className="chaos-seed-value">#{scenario.config.seed + seedNudge}</span>
        </button>
      </div>

      <p className="chaos-blurb">{scenario.blurb}</p>

      <ol className="chaos-strip" aria-label="Each call in the experiment, in order">
        {result.steps.map((step) => (
          <StripCell key={step.call} step={step} />
        ))}
      </ol>

      <ul className="chaos-legend" aria-hidden="true">
        <li data-result="ok">succeeded</li>
        <li data-result="error">failed</li>
        <li data-result="timeout">timed out</li>
        <li data-result="rejected">refused by the breaker</li>
      </ul>

      <dl className="chaos-figures">
        <div>
          <dt>Calls refused</dt>
          <dd>
            {result.rejected}
            <small>{summary.rejectedPct.toFixed(0)}% of all calls</small>
          </dd>
        </div>
        <div>
          <dt>Latency not spent</dt>
          <dd>
            {(result.savedMs / 1000).toFixed(1)}s<small>on calls that never left</small>
          </dd>
        </div>
        <div>
          <dt>Reached the dependency</dt>
          <dd>
            {summary.attempted}
            <small>{summary.errorPct.toFixed(0)}% of those failed</small>
          </dd>
        </div>
        <div>
          <dt>Ended</dt>
          <dd>
            {STATE_LABEL[result.finalState]}
            <small>after {result.steps.length} calls</small>
          </dd>
        </div>
      </dl>

      <details className="chaos-log">
        <summary>
          {transitions.length} state {transitions.length === 1 ? "change" : "changes"}
        </summary>
        <ol>
          {transitions.map((step) => (
            <li key={step.call}>
              <code>
                {step.stateBefore} → {step.stateAfter}
              </code>
              <span>
                call {step.call}, {(step.atMs / 1000).toFixed(0)}s in — {step.note}
              </span>
            </li>
          ))}
          {transitions.length === 0 ? (
            <li>
              <span>
                The circuit never moved. With {DEFAULT_POLICY.minimumSamples} samples required
                before the ratio is consulted, a short burst of failures cannot open it.
              </span>
            </li>
          ) : null}
        </ol>
      </details>

      <p className="chaos-policy">
        Policy in force, and it is the one guarding the real integrations: opens above{" "}
        <strong>{Math.round(DEFAULT_POLICY.failureRatio * 100)}%</strong> failures over a{" "}
        <strong>{DEFAULT_POLICY.windowMs / 1000}s</strong> window, never below{" "}
        <strong>{DEFAULT_POLICY.minimumSamples}</strong> samples, probes after{" "}
        <strong>{DEFAULT_POLICY.cooldownMs / 1000}s</strong>, closes on{" "}
        <strong>{DEFAULT_POLICY.successesToClose}</strong> consecutive successes.
      </p>
    </div>
  );
}
