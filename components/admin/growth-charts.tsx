import type { GrowthAnalytics } from "../../lib/growth/links";

/**
 * P8 — the growth dashboard's visuals.
 *
 * A server component with hand-written SVG rather than a charting library:
 * these are three fixed chart shapes over a few hundred points, and shipping
 * ~50KB of client JS to draw them would cost more than it returns. It also
 * means the charts render in the initial HTML, which is what makes the page
 * feel instant.
 *
 * Every colour is a CSS variable, so the charts follow the theme toggle live
 * instead of being baked to one palette at render time.
 */

const CHART_W = 720;
const CHART_H = 180;

/** Catmull-Rom → cubic Bézier, so the trend line curves instead of zig-zagging. */
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length < 3) return `M ${points.map((p) => p.join(" ")).join(" L ")}`;

  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    // 1/6 is the standard Catmull-Rom tension; higher overshoots on spikes,
    // which on a clicks chart would draw negative values.
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return path;
}

function ClicksChart({ daily }: { daily: GrowthAnalytics["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.clicks));
  const stepX = daily.length > 1 ? CHART_W / (daily.length - 1) : CHART_W;
  const points: [number, number][] = daily.map((day, index) => [
    index * stepX,
    // 8px of headroom so a peak day isn't clipped by the viewBox edge.
    CHART_H - 8 - (day.clicks / max) * (CHART_H - 24),
  ]);

  const line = smoothPath(points);
  const area = `${line} L ${CHART_W} ${CHART_H} L 0 ${CHART_H} Z`;
  const peak = daily.reduce((best, day) => (day.clicks > best.clicks ? day : best), daily[0]);

  return (
    <figure className="border-app-line relative overflow-hidden rounded-2xl border p-5">
      <figcaption className="mb-1 flex items-baseline justify-between">
        <h3 className="text-app-fg text-sm font-bold">Clicks, last 30 days</h3>
        <span className="text-app-muted text-xs tabular-nums">
          peak {peak?.clicks ?? 0} on {peak?.date ?? "—"}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Daily clicks over the last ${daily.length} days, peaking at ${peak?.clicks ?? 0}`}
      >
        <defs>
          <linearGradient id="clicks-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="clicks-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--cyan)" />
            <stop offset="55%" stopColor="var(--lime)" />
            <stop offset="100%" stopColor="var(--violet)" />
          </linearGradient>
        </defs>

        {/* Quartile guides — enough to read a value off, faint enough to ignore. */}
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

        <path d={area} fill="url(#clicks-fill)" />
        <path
          d={line}
          fill="none"
          stroke="url(#clicks-stroke)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map(([x, y], index) =>
          daily[index].clicks > 0 ? (
            <circle key={daily[index].date} cx={x} cy={y} r="2.5" fill="var(--fg)">
              <title>{`${daily[index].date}: ${daily[index].clicks} clicks`}</title>
            </circle>
          ) : null,
        )}
      </svg>
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
function DeviceChart({ devices }: { devices: GrowthAnalytics["devices"] }) {
  const total = devices.reduce((sum, device) => sum + device.count, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  // Each arc's start angle is the prefix sum of the counts before it,
  // computed from `devices` alone rather than from a counter carried across
  // iterations. A mutable accumulator renders identically on first paint but
  // isn't idempotent: React may re-run this map, and a second pass would
  // resume from wherever the first left the counter, stacking every segment
  // onto the wrong angle. Quadratic, over at most five devices.
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
        <p className="text-app-muted text-sm">No clicks yet.</p>
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

function RefererChart({ referers }: { referers: GrowthAnalytics["referers"] }) {
  const max = Math.max(1, ...referers.map((r) => r.count));

  return (
    <figure className="border-app-line rounded-2xl border p-5">
      <figcaption className="text-app-fg mb-3 text-sm font-bold">Top sources</figcaption>
      {referers.length === 0 ? (
        <p className="text-app-muted text-sm">No clicks yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {referers.map((referer) => (
            <li key={referer.source} className="flex items-center gap-3 text-sm">
              <span className="text-app-fg w-28 shrink-0 truncate" title={referer.source}>
                {referer.source}
              </span>
              <span className="bg-app-line/40 relative h-2.5 flex-1 overflow-hidden rounded-full">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${(referer.count / max) * 100}%`,
                    background: "linear-gradient(90deg, var(--cyan), var(--lime))",
                  }}
                />
              </span>
              <span className="text-app-muted w-8 text-right tabular-nums">{referer.count}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

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
      {/* Corner wash — pure decoration, kept behind the text via -z-10. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 -right-8 -z-10 h-24 w-24 rounded-full opacity-30 blur-2xl"
        style={{ background: "radial-gradient(circle, var(--lime), transparent 70%)" }}
      />
      <p className="text-app-muted text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="text-app-fg mt-2 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-app-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export function GrowthCharts({ analytics }: { analytics: GrowthAnalytics }) {
  const rate =
    analytics.totalClicks > 0
      ? `${((analytics.totalConversions / analytics.totalClicks) * 100).toFixed(1)}%`
      : "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Clicks" value={analytics.totalClicks} hint="all time" />
        <StatTile label="Unique" value={analytics.totalUniques} hint="deduped per day" />
        <StatTile label="Conversions" value={analytics.totalConversions} hint="leads, bookings" />
        <StatTile label="Rate" value={rate} hint="conversions / clicks" />
      </div>

      <ClicksChart daily={analytics.daily} />

      <div className="grid gap-6 md:grid-cols-2">
        <DeviceChart devices={analytics.devices} />
        <RefererChart referers={analytics.referers} />
      </div>

      {analytics.links.length > 0 && (
        <div className="border-app-line overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <caption className="text-app-fg px-4 pt-4 pb-2 text-left text-sm font-bold">
              Per-link performance
            </caption>
            <thead>
              <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
                <th className="px-4 py-3 font-semibold">Link</th>
                <th className="px-4 py-3 font-semibold">Clicks</th>
                <th className="px-4 py-3 font-semibold">Unique</th>
                <th className="px-4 py-3 font-semibold">Conversions</th>
                <th className="px-4 py-3 font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody>
              {analytics.links.map((link) => (
                <tr key={link.code} className="border-app-line border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="text-app-fg font-medium">{link.label}</span>
                    <span className="text-app-muted ml-2 font-mono text-xs">/r/{link.code}</span>
                  </td>
                  <td className="text-app-muted px-4 py-2.5 tabular-nums">{link.clicks}</td>
                  <td className="text-app-muted px-4 py-2.5 tabular-nums">{link.uniques}</td>
                  <td className="text-app-muted px-4 py-2.5 tabular-nums">{link.conversions}</td>
                  <td className="text-app-muted px-4 py-2.5 tabular-nums">
                    {link.clicks > 0
                      ? `${((link.conversions / link.clicks) * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
