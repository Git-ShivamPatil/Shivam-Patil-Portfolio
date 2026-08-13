import type { Metadata } from "next";
import { OlapConsole } from "../../components/dataeng/olap-console";
import { LineageGraph } from "../../components/dataeng/lineage-graph";
import { WINDOW_DAYS, recentEventTimes, tumblingWindows } from "../../lib/dataeng/pipeline";
import { readOrFallback } from "../../lib/db-read";
import "../../components/dataeng/dataeng.css";

export const metadata: Metadata = {
  title: "Data — Shivam Patil",
  description:
    "The analytics pipeline end to end: a validated lineage DAG, tumbling-window aggregation, and a warehouse export you can query with real SQL in your own browser.",
  alternates: { canonical: "/data" },
};

// The window chart is a live read; the rest of the page is static. Ten minutes
// is short enough that the windows mean something and long enough that opening
// the page does not run the query every time.
export const revalidate = 600;

const WINDOW_MS = 5 * 60_000;
const WINDOW_COUNT = 24;

export default async function DataPage() {
  const { times, now } = await readOrFallback("data/recent-events", () => recentEventTimes(), {
    times: [],
    now: 0,
  });
  const windows = tumblingWindows(times, WINDOW_MS, now, WINDOW_COUNT);
  const busiest = Math.max(1, ...windows.map((point) => point.count));

  return (
    <div className="shell py-16">
      <section className="page-hero" data-reveal>
        <p className="eyebrow">Data engineering</p>
        <h1 data-split>
          The pipeline,
          <br />
          <em>end to end.</em>
        </h1>
        <p className="page-lede">
          Where a page view goes after it is recorded: through the ingest, into two ledgers and two
          rolled-up aggregates, out to a warehouse export, and finally into a DuckDB instance
          running in your browser — where you can write your own SQL against it.
        </p>
      </section>

      <section className="mt-12" data-reveal>
        <div className="section-heading">
          <h2>
            Lineage, <em>validated.</em>
          </h2>
          <p>
            Declared rather than inferred, and checked before it is drawn: a cycle, an edge to a
            stage that does not exist, or a stage no source reaches renders as an error instead of a
            believable picture.
          </p>
        </div>
        <LineageGraph />
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            Tumbling <em>windows.</em>
          </h2>
          <p>
            Interactions in {WINDOW_COUNT} fixed five-minute windows, aligned to the epoch rather
            than to now — windows that shift under you make two readings incomparable, which is the
            most common way a &ldquo;real-time&rdquo; chart lies. The blueprint names Flink; there
            is no stream processor here and there cannot be one, because a Flink job is a
            long-running process with checkpointed state and this runs on functions that live for
            seconds. The semantics are the same and the difference is real: this recomputes from
            the ledger on read, so it is correct and gets slower as the ledger grows, where a true
            streaming engine holds state between events and answers in constant time.
          </p>
        </div>
        <ol className="windows" aria-label={`Interactions per five-minute window, ${busiest} at peak`}>
          {windows.map((point) => (
            <li
              key={point.start}
              data-empty={point.count === 0}
              style={{ height: `${Math.max(2, (point.count / busiest) * 100)}%` }}
              title={`${new Date(point.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — ${point.count}`}
            />
          ))}
        </ol>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            Query it <em>yourself.</em>
          </h2>
          <p>
            The export covers the last {WINDOW_DAYS} days, aggregated by day, path, country and
            device <em>before it leaves the database</em> — there is no row in it that corresponds
            to a person, which is what makes publishing it compatible with everything the analytics
            phase promised. DuckDB compiles to WebAssembly and runs the query on your machine, so
            there is no query endpoint to attack and nothing to rate limit.
          </p>
        </div>
        <OlapConsole />
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            Why JSON and <em>not Parquet.</em>
          </h2>
        </div>
        <div className="ask-how-grid">
          <article>
            <h3>The honest trade</h3>
            <p>
              Writing Parquet needs a writer library — a couple of megabytes, or a native binding —
              running on a serverless function, to serve a few thousand rows that gzip to a handful
              of kilobytes. DuckDB reads JSON natively. At a hundred times this size, column pruning
              and predicate pushdown would start to matter and the trade flips.
            </p>
          </article>
          <article>
            <h3>It is ELT, not ETL</h3>
            <p>
              The raw events are already loaded — the ingest writes them as they arrive — so there
              is nothing to extract and then load. The transform runs after the load, over data
              already in the warehouse. That is the whole reason ELT displaced ETL once storage got
              cheap: transforming on the way in throws away the rows you did not yet know you would
              need.
            </p>
          </article>
          <article>
            <h3>Aggregated before it is published</h3>
            <p>
              Grouping happens in Postgres, not in the browser. Shipping the ledger and letting
              DuckDB aggregate it would be simpler and would publish a per-visitor row for every
              view ever recorded — undoing the one thing the analytics phase spent its whole design
              budget protecting.
            </p>
          </article>
          <article>
            <h3>Cached at the edge</h3>
            <p>
              The export is four <code>groupBy</code> queries against Neon. Without an hour of{" "}
              <code>s-maxage</code> in front of it, every visitor who opened this page would run
              them again — which is how a demo becomes the reason the database is slow.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
