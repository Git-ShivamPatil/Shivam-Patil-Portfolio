import { pageMetadata } from "../../lib/seo/metadata";
import { ChaosLab } from "../../components/sre/chaos-lab";
import { readOrFallback } from "../../lib/db-read";
import { breakerReports } from "../../lib/sre/breaker-store";
import { breakerHistory, redReport, redSeries } from "../../lib/sre/report";
import { isOtlpConfigured, recentTraces } from "../../lib/sre/trace";
import { LATENCY_BUCKETS_MS } from "../../lib/sre/red";
import { smoothPath } from "../../lib/chart-path";
import { Disclosure, DisclosureGroup } from "../../components/ui/disclosure";
import "./reliability.css";

export const metadata = pageMetadata({
  title: "Reliability & Chaos Engineering",
  description:
    "SLOs, error budgets and a circuit breaker you can trip yourself. Break the service on purpose and watch how it degrades and recovers.",
  path: "/reliability",
});

// Every number here is a live read and most of them change by the minute, so
// there is nothing to prerender. `force-dynamic` rather than a short revalidate:
// a cached reliability page is the one kind of stale data that actively
// misleads, because the reason anyone opens it is to find out what is true now.
export const dynamic = "force-dynamic";

const WINDOW_MINUTES = 60;

function pct(value: number): string {
  return `${(value * 100).toFixed(value >= 0.01 ? 1 : 2)}%`;
}

function ms(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
}

function Sparkline({ points }: { points: { requests: number; errors: number }[] }) {
  const width = 720;
  const height = 90;
  const peak = Math.max(1, ...points.map((point) => point.requests));

  const toXY = (value: number, index: number): [number, number] => [
    (index / Math.max(1, points.length - 1)) * width,
    height - (value / peak) * (height - 6) - 3,
  ];

  const requestPath = smoothPath(points.map((point, index) => toXY(point.requests, index)));
  const errorPath = smoothPath(points.map((point, index) => toXY(point.errors, index)));
  const hasErrors = points.some((point) => point.errors > 0);

  return (
    <svg
      className="rel-spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Requests per minute over the last ${points.length} minutes, peaking at ${peak}`}
    >
      <path className="rel-spark-line" d={requestPath} />
      {/* Drawn only when there is something to draw. A flat zero line along the
          bottom reads as "errors measured at zero", which is true, but it is
          visually indistinguishable from a chart whose error series is broken. */}
      {hasErrors ? <path className="rel-spark-errors" d={errorPath} /> : null}
    </svg>
  );
}

export default async function ReliabilityPage() {
  const emptyReport = {
    windowMinutes: WINDOW_MINUTES,
    since: new Date(),
    routes: [],
    totals: { requests: 0, errors: 0, errorRate: 0, rate: 0, p50: null, p95: null, p99: null },
    instances: 0,
    empty: true,
  };

  const [report, series, breakers, history] = await Promise.all([
    readOrFallback("reliability/red", () => redReport(WINDOW_MINUTES), emptyReport),
    readOrFallback("reliability/series", () => redSeries(WINDOW_MINUTES), []),
    readOrFallback("reliability/breakers", () => breakerReports(), []),
    readOrFallback("reliability/history", () => breakerHistory(12), []),
  ]);

  const traces = recentTraces(8);

  return (
    <div className="shell py-16">
      <section className="page-hero" data-reveal>
        <p className="eyebrow">Site reliability</p>
        <h1 data-split>
          What this site
          <br />
          <em>knows about itself.</em>
        </h1>
        <p className="page-lede">
          Rate, errors and duration for its own endpoints, measured by the code that serves them.
          The circuit breakers in front of its two flaky upstreams, with every state change they
          have made. And an experiment that drives the production breaker through an outage, in your
          browser, so you can check that it does what the description says.
        </p>
      </section>

      <section className="mt-12" data-reveal>
        <div className="section-heading">
          <h2>
            RED, from <em>shared state.</em>
          </h2>
          <p>
            Rate, errors, duration — the three numbers that describe a request-serving system. The
            hard part here was not measuring them, it was making them survive being serverless: an
            in-process counter lives in one instance&rsquo;s memory, and a scrape reaches whichever
            instance the platform picks, so the series jumps between unrelated totals. Each instance
            therefore accumulates deltas and appends them to Postgres, where they sum correctly no
            matter how many instances ran. Percentiles come from fixed histogram buckets rather than
            stored averages, because a mean latency is the one number that never describes anyone.
          </p>
        </div>

        {report.empty ? (
          <p className="rel-empty">
            No requests recorded in the last {WINDOW_MINUTES} minutes. Metrics are flushed at most
            once every 15 seconds per instance, so a freshly deployed build reads empty until the
            first instrumented route is called — which is a different thing from an outage, and this
            page will not pretend otherwise.
          </p>
        ) : (
          <>
            <dl className="rel-figures">
              <div>
                <dt>Requests</dt>
                <dd>
                  {report.totals.requests.toLocaleString()}
                  <small>{report.totals.rate.toFixed(1)}/min</small>
                </dd>
              </div>
              <div data-bad={report.totals.errorRate > 0.01 || undefined}>
                <dt>Error rate</dt>
                <dd>
                  {pct(report.totals.errorRate)}
                  <small>{report.totals.errors} × 5xx</small>
                </dd>
              </div>
              <div>
                <dt>p50</dt>
                <dd>
                  {ms(report.totals.p50)}
                  <small>median</small>
                </dd>
              </div>
              <div>
                <dt>p95</dt>
                <dd>
                  {ms(report.totals.p95)}
                  <small>p99 {ms(report.totals.p99)}</small>
                </dd>
              </div>
              <div>
                <dt>Instances</dt>
                <dd>
                  {report.instances}
                  <small>reported in the window</small>
                </dd>
              </div>
            </dl>

            {series.length > 0 ? <Sparkline points={series} /> : null}

            <div className="rel-table-wrap">
              <table className="rel-table">
                <caption className="sr-only">
                  Per-route rate, error rate and latency percentiles over the last {WINDOW_MINUTES}{" "}
                  minutes
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">Requests</th>
                    <th scope="col">Rate</th>
                    <th scope="col">Errors</th>
                    <th scope="col">p50</th>
                    <th scope="col">p95</th>
                    <th scope="col">p99</th>
                    <th scope="col">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {report.routes.map((route) => (
                    <tr key={`${route.method} ${route.route}`}>
                      <th scope="row">
                        <span className="rel-method">{route.method}</span>
                        <code>{route.route}</code>
                      </th>
                      <td>{route.requests.toLocaleString()}</td>
                      <td>{route.rate.toFixed(1)}/min</td>
                      <td data-bad={route.errorRate > 0.01 || undefined}>{pct(route.errorRate)}</td>
                      <td>{ms(route.p50)}</td>
                      <td>{ms(route.p95)}</td>
                      <td>{ms(route.p99)}</td>
                      <td>{ms(route.maxMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="rel-note">
          Buckets are fixed at {LATENCY_BUCKETS_MS.join(", ")} and +∞ milliseconds. They are a
          one-way door — change them and every row written beforehand measures something else — so
          they were chosen for what this app actually does: 10ms is a cache hit, 100ms is a Neon
          round trip from the same region, 5s means an upstream is hanging. Instrumentation is
          opt-in per route, so a route absent from this table is one nobody wrapped, not one nobody
          called.
        </p>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            Circuit <em>breakers.</em>
          </h2>
          <p>
            Two upstreams sit behind one: GitHub, and LeetCode&rsquo;s unofficial endpoint, which
            throttles serverless IPs often enough that the failure path is the ordinary path rather
            than the rare one. The breaker opens on a failure <em>ratio</em> and not a failure
            count, because a threshold of five failures means something completely different at ten
            requests an hour than at ten thousand, and this site sees both.
          </p>
        </div>

        <div className="rel-breakers">
          {breakers.map((breaker) => (
            <article key={breaker.target} className="rel-breaker" data-state={breaker.state}>
              <h3>{breaker.target}</h3>
              <p className="rel-breaker-state">{breaker.state}</p>
              <p className="rel-breaker-detail">
                {breaker.samples === 0
                  ? "No calls in the window."
                  : `${breaker.failures}/${breaker.samples} failed — ${pct(breaker.ratio)}`}
              </p>
              <p className="rel-breaker-store">
                {breaker.shared
                  ? "State shared via Redis"
                  : "State per-instance — Redis is not configured"}
              </p>
            </article>
          ))}
        </div>

        {history.length > 0 ? (
          <ol className="rel-history">
            {history.map((row) => (
              <li key={row.id}>
                <code>
                  {row.target}: {row.from} → {row.to}
                </code>
                <span>{row.reason}</span>
                <time dateTime={row.createdAt.toISOString()}>
                  {row.createdAt.toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rel-note">
            No transitions recorded. Both upstreams have stayed inside the failure threshold since
            the breaker was deployed — which is the boring outcome, and the one worth having.
          </p>
        )}
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            Break it <em>yourself.</em>
          </h2>
          <p>
            The breaker exercised below is the one described above — the same module, imported into
            this page rather than reimplemented for it. Only the dependency is simulated. Time is
            simulated too, so ten minutes of cooldowns and probes resolve instantly; every random
            decision comes from a seeded generator, so a seed and a scenario reproduce a run
            exactly. Chaos engineering you cannot replay is an anecdote, not an experiment.
          </p>
        </div>
        <ChaosLab />
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            Traces, and <em>what they cost.</em>
          </h2>
          <p>
            W3C Trace Context in, OTLP over HTTP out — both implemented directly rather than pulled
            in as an SDK, which is the same trade this codebase already made for its Redis and S3
            clients: the protocol is small and completely specified, so speak it. The consequence is
            worth stating plainly: there is <strong>no auto-instrumentation</strong>. A span exists
            because a call site asked for one.
          </p>
        </div>

        <p className="rel-note">
          {isOtlpConfigured()
            ? "A collector is configured, so spans are exported off-box and the list below is only a local echo."
            : "No collector is configured, so spans stay in this instance's memory. The list below is therefore whatever landed on the instance that rendered this page — a debugging aid, not an observability backend, and it will look empty or partial precisely because it is honest about that."}
        </p>

        {traces.length > 0 ? (
          <ol className="rel-traces">
            {traces.map((trace) => {
              const started = Math.min(...trace.spans.map((span) => span.startedAt));
              const ended = Math.max(...trace.spans.map((span) => span.endedAt ?? span.startedAt));
              const total = Math.max(1, ended - started);

              return (
                <li key={trace.traceId}>
                  <p className="rel-trace-id">
                    <code>{trace.traceId.slice(0, 16)}…</code>
                    <span>{total}ms</span>
                  </p>
                  <ol className="rel-trace-spans">
                    {trace.spans.map((span) => {
                      const duration = (span.endedAt ?? span.startedAt) - span.startedAt;
                      return (
                        <li key={span.spanId} data-error={Boolean(span.error) || undefined}>
                          <span
                            className="rel-trace-bar"
                            style={{
                              marginLeft: `${((span.startedAt - started) / total) * 100}%`,
                              width: `${Math.max(1.5, (duration / total) * 100)}%`,
                            }}
                          />
                          <span className="rel-trace-name">{span.name}</span>
                          <span className="rel-trace-ms">{duration}ms</span>
                        </li>
                      );
                    })}
                  </ol>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rel-empty">
            No spans on this instance yet. Spans are recorded around guarded dependency calls, so
            one appears the first time this instance fetches GitHub or LeetCode stats.
          </p>
        )}
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            What is real, and <em>what is not.</em>
          </h2>
          <p>
            Four claims about this page, including the two that are limitations. Open any of them.
          </p>
        </div>
        {/* Unnamed, so these open independently: the point of the section is
            that a reader can compare what is real against what is simulated,
            which needs both visible at once. */}
        <DisclosureGroup label="What on this page is real">
          <Disclosure summary="The breaker is real" hint="In production">
            <p>
              It guards both integration fetchers in production. When it opens, the stats panels
              render last-good data through the existing stale-payload path rather than an error
              state — and they do it immediately instead of spending eight seconds rediscovering
              that the upstream is down.
            </p>
          </Disclosure>
          <Disclosure summary="The metrics are real" hint="Prometheus">
            <p>
              Every row is written by the code serving the request, and <code>/api/metrics</code>{" "}
              exposes them as a Prometheus counter and histogram. The counter resets when the
              retention sweep prunes, which is a counter reset — <code>rate()</code> is built to
              detect exactly that, so the type is honest.
            </p>
          </Disclosure>
          <Disclosure summary="The chaos is simulated, deliberately" hint="In your tab">
            <p>
              Faults are injected into a dependency that exists only in your tab. There is a
              server-side arm that injects into the real integration path, and it stays off unless{" "}
              <code>CHAOS_ENABLED=1</code> — it is for a preview deploy, where the question is
              whether the fallback renders, not for production, where the answer would cost a
              visitor their page.
            </p>
          </Disclosure>
          <Disclosure summary="The trace buffer is per-instance" hint="A real limit">
            <p>
              Without a collector, spans live in the memory of one serverless instance and the list
              above shows whichever instance answered. That is the same limitation that made
              in-process counters unusable, and it is not solved here — it is solved by configuring{" "}
              <code>OTEL_EXPORTER_OTLP_ENDPOINT</code>, which is a URL, not a code change.
            </p>
          </Disclosure>
        </DisclosureGroup>
      </section>
    </div>
  );
}
