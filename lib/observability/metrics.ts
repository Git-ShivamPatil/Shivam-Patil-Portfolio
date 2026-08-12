import { prisma } from "../prisma";
import { freshSince } from "../realtime/presence";

/**
 * P14 — Prometheus exposition.
 *
 * **Every metric here is a gauge read from Postgres, and there is not a single
 * counter. That is deliberate, and it is the interesting part of this file.**
 *
 * The blueprint asks for RED metrics — rate, errors, duration — which are
 * counters incremented in the process handling each request. On a serverless
 * runtime those counters live in one instance's memory, and a Prometheus scrape
 * reaches whichever instance the platform happens to route it to. The series
 * would jump between unrelated instances' totals on consecutive scrapes, so
 * `rate()` over it would produce numbers that look precise and mean nothing.
 * A counter that resets without warning is worse than no counter, because a
 * dashboard built on it looks like it is working.
 *
 * So what is exposed instead is the state that is genuinely shared: the
 * database. Those numbers are the same no matter which instance answers, which
 * is the property a scrape target has to have. Request rate and latency are
 * already answered by the platform's own per-function metrics, which can see
 * every invocation — something no endpoint running *inside* one invocation ever
 * can.
 *
 * If this were self-hosted from the Dockerfile, the honest RED implementation
 * would be an in-process registry here plus one replica per scrape target. The
 * shape of the runtime decides the shape of the metrics, not the other way
 * round.
 */

interface Metric {
  name: string;
  help: string;
  type: "gauge";
  samples: { labels?: Record<string, string>; value: number }[];
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
    lines.push(`${metric.name}${labels ? `{${labels}}` : ""} ${sample.value}`);
  }
  return lines.join("\n");
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
  ];

  // A trailing newline is required by the exposition format; without it the
  // last sample is silently dropped by some scrapers.
  return `${metrics.map(render).join("\n")}\n`;
}
