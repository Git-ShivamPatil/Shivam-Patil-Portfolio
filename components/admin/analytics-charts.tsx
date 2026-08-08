import type { CounterRow, SiteAnalytics } from "../../lib/analytics/report";
import { formatDuration } from "../../lib/analytics/normalize";
import { RAGE_CLICK_COUNT, RAGE_CLICK_WINDOW_MS } from "../../lib/analytics/constants";
import { smoothPath } from "../../lib/chart-path";

/**
 * P10 — the analytics dashboard's visuals.
 *
 * A server component drawing hand-written SVG, matching the P8 growth charts:
 * everything renders in the initial HTML and no charting library reaches the
 * client. Colours are CSS variables so the charts follow the theme toggle live
 * rather than being baked to one palette at render time.
 */

const CHART_W = 720;
const CHART_H = 190;

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="border-app-line relative overflow-hidden rounded-2xl border p-5">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 -right-8 -z-10 h-24 w-24 rounded-full opacity-30 blur-2xl"
        style={{ background: "radial-gradient(circle, var(--cyan), transparent 70%)" }}
      />
      <p className="text-app-muted text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="text-app-fg mt-2 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-app-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

/**
 * Views and unique visitors on one axis.
 *
 * Two series rather than two charts: uniques are always a subset of views, so
 * the gap between the lines *is* the "returning / multi-page" signal. Split
 * across two panels that relationship has to be reconstructed by eye.
 */
function TrafficChart({ daily, days }: { daily: SiteAnalytics["daily"]; days: number }) {
  const max = Math.max(1, ...daily.map((point) => point.views));
  const stepX = daily.length > 1 ? CHART_W / (daily.length - 1) : CHART_W;
  const toY = (value: number) => CHART_H - 10 - (value / max) * (CHART_H - 28);

  const viewPoints: [number, number][] = daily.map((point, index) => [
    index * stepX,
    toY(point.views),
  ]);
  const uniquePoints: [number, number][] = daily.map((point, index) => [
    index * stepX,
    toY(point.uniques),
  ]);

  const viewsLine = smoothPath(viewPoints);
  const viewsArea = `${viewsLine} L ${CHART_W} ${CHART_H} L 0 ${CHART_H} Z`;
  const peak = daily.reduce((best, point) => (point.views > best.views ? point : best), daily[0]);
  const total = daily.reduce((sum, point) => sum + point.views, 0);

  return (
    <figure className="border-app-line relative overflow-hidden rounded-2xl border p-5">
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-app-fg text-sm font-bold">Traffic, last {days} days</h3>
        <span className="text-app-muted text-xs tabular-nums">
          {total} views · peak {peak?.views ?? 0} on {peak?.date ?? "—"}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-44 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Page views and unique visitors over the last ${days} days, peaking at ${peak?.views ?? 0} views`}
      >
        <defs>
          <linearGradient id="views-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="views-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--violet)" />
            <stop offset="60%" stopColor="var(--cyan)" />
            <stop offset="100%" stopColor="var(--lime)" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={CHART_W}
            y1={CHART_H * fraction}
            y2={CHART_H * fraction}
            stroke="var(--line)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
        ))}

        <path d={viewsArea} fill="url(#views-fill)" />
        <path
          d={viewsLine}
          fill="none"
          stroke="url(#views-stroke)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={smoothPath(uniquePoints)}
          fill="none"
          stroke="var(--fg)"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {viewPoints.map(([x, y], index) =>
          daily[index].views > 0 ? (
            <circle key={daily[index].date} cx={x} cy={y} r="2.5" fill="var(--fg)">
              <title>{`${daily[index].date}: ${daily[index].views} views, ${daily[index].uniques} unique`}</title>
            </circle>
          ) : null,
        )}
      </svg>

      <div className="text-app-muted mt-2 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4 rounded"
            style={{ background: "linear-gradient(90deg, var(--violet), var(--lime))" }}
          />
          Views
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-app-fg/45 inline-block h-0.5 w-4 rounded" />
          Unique visitors
        </span>
      </div>
    </figure>
  );
}

const DEVICE_COLOURS: Record<string, string> = {
  desktop: "var(--cyan)",
  mobile: "var(--lime)",
  tablet: "var(--violet)",
  bot: "var(--orange)",
  unknown: "var(--line)",
};

/** Donut. Arc lengths come from stroke-dasharray, so there is no path maths. */
function DeviceChart({ devices }: { devices: SiteAnalytics["devices"] }) {
  const total = devices.reduce((sum, device) => sum + device.count, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  // Each arc's offset is the prefix sum of everything before it, derived from
  // the array rather than a counter carried across the map — React may re-run
  // this, and a mutable accumulator would resume mid-way and stack every
  // segment onto the wrong angle.
  const segments = devices.map((device, index) => {
    const preceding = devices.slice(0, index).reduce((sum, other) => sum + other.count, 0);
    return {
      ...device,
      length: (device.count / total) * circumference,
      offset: (preceding / total) * circumference,
    };
  });

  return (
    <figure className="border-app-line rounded-2xl border p-5">
      <figcaption className="text-app-fg mb-3 text-sm font-bold">Devices</figcaption>
      {total === 0 ? (
        <p className="text-app-muted text-sm">No views yet.</p>
      ) : (
        <div className="flex items-center gap-5">
          <svg
            viewBox="0 0 140 140"
            className="h-32 w-32 shrink-0 -rotate-90"
            role="img"
            aria-label={devices.map((d) => `${d.device} ${d.count}`).join(", ")}
          >
            <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--line)" strokeWidth="16" />
            {segments.map((segment) => (
              <circle
                key={segment.device}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={DEVICE_COLOURS[segment.device] ?? "var(--line)"}
                strokeWidth="16"
                strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                strokeDashoffset={-segment.offset}
                strokeLinecap="butt"
              >
                <title>{`${segment.device}: ${segment.count}`}</title>
              </circle>
            ))}
          </svg>
          <ul className="flex flex-col gap-1.5 text-sm">
            {devices.map((device) => (
              <li key={device.device} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: DEVICE_COLOURS[device.device] ?? "var(--line)" }}
                />
                <span className="text-app-fg capitalize">{device.device}</span>
                <span className="text-app-muted tabular-nums">
                  {Math.round((device.count / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}

function BarRow({
  label,
  title,
  count,
  max,
  prefix,
}: {
  label: string;
  title?: string;
  count: number;
  max: number;
  prefix?: string;
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      {prefix && (
        <span aria-hidden="true" className="w-5 shrink-0 text-base leading-none">
          {prefix}
        </span>
      )}
      <span className="text-app-fg w-32 shrink-0 truncate" title={title ?? label}>
        {label}
      </span>
      <span className="bg-app-line/40 relative h-2.5 flex-1 overflow-hidden rounded-full">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${(count / max) * 100}%`,
            background: "linear-gradient(90deg, var(--cyan), var(--lime))",
          }}
        />
      </span>
      <span className="text-app-muted w-10 text-right tabular-nums">{count}</span>
    </li>
  );
}

function GeoPanel({ countries }: { countries: SiteAnalytics["countries"] }) {
  const max = Math.max(1, ...countries.map((country) => country.views));

  return (
    <figure className="border-app-line rounded-2xl border p-5">
      <figcaption className="text-app-fg mb-3 text-sm font-bold">Countries</figcaption>
      {countries.length === 0 ? (
        <p className="text-app-muted text-sm">
          No geo data yet. Country resolution comes from the edge — locally there is no header to
          read, so this fills in only once traffic arrives through the CDN.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {countries.map((country) => (
            <BarRow
              key={country.code ?? "unknown"}
              prefix={country.flag}
              label={country.name}
              count={country.views}
              max={max}
            />
          ))}
        </ul>
      )}
    </figure>
  );
}

function ReferrerPanel({ referrers }: { referrers: SiteAnalytics["referrers"] }) {
  const max = Math.max(1, ...referrers.map((referrer) => referrer.count));

  return (
    <figure className="border-app-line rounded-2xl border p-5">
      <figcaption className="text-app-fg mb-3 text-sm font-bold">Referrers</figcaption>
      {referrers.length === 0 ? (
        <p className="text-app-muted text-sm">
          Every visit so far arrived without a referrer — typed, bookmarked, or from an app that
          strips it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {referrers.map((referrer) => (
            <BarRow
              key={referrer.source}
              label={referrer.source}
              count={referrer.count}
              max={max}
            />
          ))}
        </ul>
      )}
    </figure>
  );
}

/**
 * Top pages, with scroll reach shown as a bar rather than a number.
 *
 * Reach is the column worth looking at: a page with high views and 20% reach
 * is one nobody reads past the hero, which is a different problem from a page
 * nobody opens — and the two are indistinguishable from a view count alone.
 */
function PagesTable({ pages }: { pages: SiteAnalytics["pages"] }) {
  if (pages.length === 0) {
    return (
      <div className="border-app-line rounded-2xl border p-5">
        <h3 className="text-app-fg mb-2 text-sm font-bold">Pages</h3>
        <p className="text-app-muted text-sm">No page views recorded in this window yet.</p>
      </div>
    );
  }

  return (
    <div className="border-app-line overflow-x-auto rounded-2xl border">
      <table className="w-full text-left text-sm">
        <caption className="text-app-fg px-4 pt-4 pb-2 text-left text-sm font-bold">
          Pages by views
        </caption>
        <thead>
          <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
            <th className="px-4 py-3 font-semibold">Path</th>
            <th className="px-4 py-3 font-semibold">Views</th>
            <th className="px-4 py-3 font-semibold">Avg time</th>
            <th className="px-4 py-3 font-semibold">Scroll reach</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => (
            <tr key={page.path} className="border-app-line border-b last:border-0">
              <td className="text-app-fg max-w-[18rem] truncate px-4 py-2.5 font-mono text-xs">
                {page.path}
              </td>
              <td className="text-app-muted px-4 py-2.5 tabular-nums">{page.views}</td>
              <td className="text-app-muted px-4 py-2.5 tabular-nums">
                {formatDuration(page.avgDurationMs)}
              </td>
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="bg-app-line/40 relative h-2 w-24 overflow-hidden rounded-full">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${page.avgScroll}%`,
                        background: "linear-gradient(90deg, var(--violet), var(--cyan))",
                      }}
                    />
                  </span>
                  <span className="text-app-muted tabular-nums">{page.avgScroll}%</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CounterTable({
  title,
  empty,
  rows,
  keyHeading,
}: {
  title: string;
  empty: string;
  rows: CounterRow[];
  keyHeading: string;
}) {
  return (
    <div className="border-app-line overflow-x-auto rounded-2xl border">
      <table className="w-full text-left text-sm">
        <caption className="text-app-fg px-4 pt-4 pb-2 text-left text-sm font-bold">
          {title}
        </caption>
        {rows.length === 0 ? (
          <tbody>
            <tr>
              <td className="text-app-muted px-4 pb-4 text-sm">{empty}</td>
            </tr>
          </tbody>
        ) : (
          <>
            <thead>
              <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
                <th className="px-4 py-3 font-semibold">{keyHeading}</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Unique</th>
                <th className="px-4 py-3 font-semibold">Last</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-app-line border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="text-app-fg font-medium">{row.label || row.key}</span>
                    {row.label && (
                      <span className="text-app-muted ml-2 font-mono text-xs">{row.key}</span>
                    )}
                  </td>
                  <td className="text-app-muted px-4 py-2.5 tabular-nums">{row.total}</td>
                  <td className="text-app-muted px-4 py-2.5 tabular-nums">{row.uniqueTotal}</td>
                  <td className="text-app-muted px-4 py-2.5 text-xs tabular-nums">
                    {row.lastAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </table>
    </div>
  );
}

/** Repeated clicks on one spot — the closest thing to a bug report nobody filed. */
function FrictionPanel({ friction }: { friction: SiteAnalytics["friction"] }) {
  return (
    <figure className="border-app-line rounded-2xl border p-5">
      <figcaption className="text-app-fg mb-1 text-sm font-bold">Friction</figcaption>
      {/* Thresholds read from the constants the tracker actually uses, so this
          sentence cannot drift away from the behaviour it describes. */}
      <p className="text-app-muted mb-3 text-xs">
        {RAGE_CLICK_COUNT} or more clicks on the same spot inside {RAGE_CLICK_WINDOW_MS / 1000}s —
        usually something that looks interactive and isn&apos;t.
      </p>
      {friction.length === 0 ? (
        <p className="text-app-muted text-sm">Nothing recorded. That is the good outcome.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {friction.map((row) => (
            <li
              key={`${row.path}|${row.target}`}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="text-app-fg shrink-0 font-mono text-xs">{row.path}</span>
                {/* An explicit separator, not just a margin — the two values
                    run together into one unreadable string otherwise, both
                    visually at small sizes and for a screen reader. */}
                <span aria-hidden="true" className="text-app-muted/50 text-xs">
                  ·
                </span>
                <span className="text-app-muted truncate text-xs">{row.target}</span>
              </span>
              <span className="text-app-muted shrink-0 tabular-nums">{row.count}×</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

export function AnalyticsCharts({ analytics }: { analytics: SiteAnalytics }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Views" value={analytics.totalViews} hint={`last ${analytics.days} days`} />
        <StatTile
          label="Visitors"
          value={analytics.uniqueVisitors}
          hint="unique, deduped per day"
        />
        <StatTile
          label="Avg time"
          value={formatDuration(analytics.avgDurationMs)}
          hint="visible time only"
        />
        <StatTile label="Avg scroll" value={`${analytics.avgScroll}%`} hint="depth reached" />
        <StatTile label="Downloads" value={analytics.totalDownloads} hint="all time" />
      </div>

      <TrafficChart daily={analytics.daily} days={analytics.days} />

      <div className="grid gap-6 md:grid-cols-2">
        <GeoPanel countries={analytics.countries} />
        <div className="flex flex-col gap-6">
          <DeviceChart devices={analytics.devices} />
          <ReferrerPanel referrers={analytics.referrers} />
        </div>
      </div>

      <PagesTable pages={analytics.pages} />

      <div className="grid gap-6 md:grid-cols-2">
        <CounterTable
          title="Downloads"
          keyHeading="File"
          rows={analytics.downloads}
          empty="No downloads counted yet. Links routed through /d/<slug> are counted server-side, so this holds even with scripting off."
        />
        <CounterTable
          title="Outbound clicks"
          keyHeading="Destination"
          rows={analytics.outbound}
          empty="No outbound clicks yet."
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <CounterTable
          title="Tracked elements"
          keyHeading="Element"
          rows={analytics.elements}
          empty="No tracked elements yet. Add data-analytics-id to anything worth counting."
        />
        <FrictionPanel friction={analytics.friction} />
      </div>
    </div>
  );
}
