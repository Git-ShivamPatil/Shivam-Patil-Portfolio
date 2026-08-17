import { prisma } from "../prisma";
import { freshSince } from "../realtime/presence";
import { redCumulative } from "../sre/report";
import { LATENCY_BUCKETS_MS } from "../sre/red";

/**
 * P14, extended by P21 — Prometheus exposition.
 *
 * **This file used to argue that it contained no counters, and that argument
 * was right at the time. P21 removed the thing that made it true.** The
 * original reasoning is kept below because it is still the reasoning — what
 * changed is one premise, not the logic.
 *
 * The argument was: RED metrics are counters incremented in the process
 * handling each request; on a serverless runtime those counters live in one
 * instance's memory; a scrape reaches whichever instance the platform routes it
 * to; so the series would jump between unrelated instances' totals and `rate()`
 * over it would produce numbers that look precise and mean nothing. Everything
 * exposed here was therefore a gauge read from Postgres — state that is
 * genuinely shared, and the same no matter which instance answers.
 *
 * The premise P21 removed is "those counters live in one instance's memory".
 * lib/sre/red.ts accumulates deltas per instance and appends them to Postgres,
 * so the counter is now in exactly the same shared state every gauge below
 * already used. The conclusion follows unchanged: shared state can be scraped,
 * per-instance memory cannot.
 *
 * The old note said the honest self-hosted implementation would be "an
 * in-process registry here plus one replica per scrape target". That is still
 * true and still cheaper. This is the version that works without controlling
 * the replica count.
 *
 * See lib/sre/report.ts `redCumulative` for why the request counter is typed
 * as a counter despite the retention sweep deleting rows underneath it.
 */

interface Metric {
  name: string;
  help: string;
  type: "gauge" | "counter" | "histogram";
  samples: {
    labels?: Record<string, string>;
    value: number;
    /**
     * Overrides the series name for this sample. Only histograms need it: the
     * format requires one metric family to emit three differently-suffixed
     * series (`_bucket`, `_sum`, `_count`) under a single HELP/TYPE pair.
     */
    name?: string;
  }[];
}

/** Prometheus label values escape backslash, double-quote and newline. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function render(metric: Metric): string {
  const lines = [`# HELP ${metric.name} ${metric.help}`, `# TYPE ${metric.name} ${metric.type}`];
  for (const sample of metric.samples) {
    const labels = Object.entries(sample.labels ?? {})
      .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
      .join(",");
    lines.push(`${sample.name ?? metric.name}${labels ? `{${labels}}` : ""} ${sample.value}`);
  }
  return lines.join("\n");
}

/**
 * The RED family, built from the shared counters in lib/sre/red.ts.
 *
 * Three metric families rather than one, because they answer different
 * questions and a dashboard needs to divide one by another: requests and errors
 * share label sets so `errors / requests` is a valid PromQL expression, and the
 * histogram drops `status_class` because a p95 split by status class is a p95
 * of two unrelated populations.
 */
function redMetrics(series: Awaited<ReturnType<typeof redCumulative>>): Metric[] {
  if (series.length === 0) return [];

  // Merge away status_class for the latency family. Buckets are cumulative
  // counts, so they add — the property lib/sre/histogram.ts exists to rely on.
  const byRoute = new Map<
    string,
    { route: string; method: string; buckets: number[]; sum: number }
  >();
  for (const row of series) {
    const key = `${row.route}|${row.method}`;
    const existing = byRoute.get(key);
    if (existing) {
      existing.sum += row.durationSumMs;
      for (let i = 0; i < row.buckets.length; i += 1) existing.buckets[i] += row.buckets[i];
    } else {
      byRoute.set(key, {
        route: row.route,
        method: row.method,
        buckets: [...row.buckets],
        sum: row.durationSumMs,
      });
    }
  }

  const boundaryLabels = [...LATENCY_BUCKETS_MS.map(String), "+Inf"];

  return [
    {
      name: "portfolio_http_requests_total",
      help: "Requests handled, by route pattern, method and status class. Resets when the retention sweep prunes.",
      type: "counter",
      samples: series.map((row) => ({
        labels: { route: row.route, method: row.method, status_class: row.statusClass },
        value: row.requests,
      })),
    },
    {
      name: "portfolio_http_request_errors_total",
      help: "Requests that returned 5xx. A 4xx is not counted here — a rejected input is the guard working.",
      type: "counter",
      samples: series
        .filter((row) => row.errors > 0)
        .map((row) => ({
          labels: { route: row.route, method: row.method },
          value: row.errors,
        })),
    },
    {
      name: "portfolio_http_request_duration_ms",
      help: "Request duration in milliseconds. Buckets are fixed in lib/sre/red.ts and are a one-way door.",
      type: "histogram",
      samples: [...byRoute.values()].flatMap((row) => [
        ...row.buckets.map((count, index) => ({
          name: "portfolio_http_request_duration_ms_bucket",
          labels: { route: row.route, method: row.method, le: boundaryLabels[index] },
          value: count,
        })),
        {
          name: "portfolio_http_request_duration_ms_sum",
          labels: { route: row.route, method: row.method },
          value: row.sum,
        },
        {
          name: "portfolio_http_request_duration_ms_count",
          labels: { route: row.route, method: row.method },
          // The +Inf bucket *is* the count, by definition of a cumulative
          // histogram. Deriving it rather than storing it separately means the
          // two can never disagree.
          value: row.buckets[row.buckets.length - 1],
        },
      ]),
    },
  ];
}

export async function collectMetrics(now = Date.now()): Promise<string> {
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const since1h = new Date(now - 60 * 60 * 1000);

  const [
    viewsDay,
    viewsHour,
    uniquesDay,
    eventsDay,
    presentVisitors,
    bookingsByStatus,
    messagesByStatus,
    subscribers,
    rageDay,
    redSeries,
  ] = await Promise.all([
    prisma.pageView.count({ where: { createdAt: { gte: since24h } } }),
    prisma.pageView.count({ where: { createdAt: { gte: since1h } } }),
    prisma.pageView.count({ where: { createdAt: { gte: since24h }, isUnique: true } }),
    prisma.analyticsEvent.count({ where: { createdAt: { gte: since24h } } }),
    prisma.presenceSession.count({
      where: { role: "VISITOR", lastSeenAt: { gte: freshSince(now) } },
    }),
    prisma.booking.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.contactMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.newsletterSubscriber.count({ where: { status: "CONFIRMED" } }),
    // The one error-shaped signal that is genuinely shared state: a rage click
    // is a visitor telling us something did not work.
    prisma.analyticsEvent.count({ where: { createdAt: { gte: since24h }, type: "RAGE" } }),
    // P21. Tolerated rather than awaited strictly: a scrape that fails entirely
    // because the RED table is missing would take the nine gauges below down
    // with it, and those predate this and work.
    redCumulative().catch((error) => {
      console.error("[metrics] RED series unavailable:", error);
      return [];
    }),
  ]);

  const metrics: Metric[] = [
    {
      name: "portfolio_build_info",
      help: "Always 1. The labels carry the deployed commit, environment and region.",
      type: "gauge",
      samples: [
        {
          labels: {
            version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
            environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
            region: process.env.VERCEL_REGION ?? "local",
          },
          value: 1,
        },
      ],
    },
    {
      name: "portfolio_page_views",
      help: "Page views recorded in the trailing window.",
      type: "gauge",
      samples: [
        { labels: { window: "1h" }, value: viewsHour },
        { labels: { window: "24h" }, value: viewsDay },
      ],
    },
    {
      name: "portfolio_unique_visitors_24h",
      help: "Distinct daily visitor pseudonyms seen in the last 24 hours.",
      type: "gauge",
      samples: [{ value: uniquesDay }],
    },
    {
      name: "portfolio_interaction_events_24h",
      help: "Tracked clicks, downloads and outbound navigations in the last 24 hours.",
      type: "gauge",
      samples: [{ value: eventsDay }],
    },
    {
      name: "portfolio_rage_clicks_24h",
      help: "Rage clicks in the last 24 hours — the site's own friction signal.",
      type: "gauge",
      samples: [{ value: rageDay }],
    },
    {
      name: "portfolio_visitors_present",
      help: "Visitor tabs inside the presence freshness window right now.",
      type: "gauge",
      samples: [{ value: presentVisitors }],
    },
    {
      name: "portfolio_bookings",
      help: "Bookings by status, all time.",
      type: "gauge",
      samples: bookingsByStatus.map((row) => ({
        labels: { status: row.status },
        value: row._count._all,
      })),
    },
    {
      name: "portfolio_contact_messages",
      help: "Inbox messages by status, all time.",
      type: "gauge",
      samples: messagesByStatus.map((row) => ({
        labels: { status: row.status },
        value: row._count._all,
      })),
    },
    {
      name: "portfolio_newsletter_subscribers",
      help: "Confirmed newsletter subscribers.",
      type: "gauge",
      samples: [{ value: subscribers }],
    },
    ...redMetrics(redSeries),
  ];

  // A trailing newline is required by the exposition format; without it the
  // last sample is silently dropped by some scrapers.
  return `${metrics.map(render).join("\n")}\n`;
}
