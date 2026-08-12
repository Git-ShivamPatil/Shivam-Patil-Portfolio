"use client";

import { useEffect, useMemo, useState } from "react";
import { smoothPath } from "../../lib/chart-path";
import { countryFlag } from "../../lib/analytics/geo";
import { LIVE_POLL_MS, type LiveSnapshot } from "../../lib/realtime/constants";

/**
 * P11 — the live dashboard.
 *
 * The one client component in the admin area that holds a connection open, and
 * the only place on the site where a number is expected to change while you
 * watch it. Everything it renders comes from a single `snapshot` event, so
 * there is no partial-update reconciliation to get wrong: each frame replaces
 * the whole view.
 *
 * `EventSource` reconnects on its own after the server closes at its lifetime
 * cap, so there is no retry loop here. What the UI does own is saying which of
 * the three states it is in — live, reconnecting, or stalled (connected, but
 * the server's last read of Postgres failed) — because a dashboard that has
 * quietly stopped updating is worse than one that says so.
 */

const EMPTY: LiveSnapshot = {
  presence: { ownerOnline: false, visitors: 0, paths: [], countries: [], at: "" },
  viewsLast5m: 0,
  viewsLast60m: 0,
  eventsLast60m: 0,
  recentEvents: [],
  recentViews: [],
  perMinute: [],
};

type Status = "connecting" | "live" | "stalled";

function clock(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="border-app-line rounded-2xl border p-5">
      <p className="text-app-muted text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="text-app-fg mt-2 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-app-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

/** Views per minute over the last half hour. */
function Sparkline({ points }: { points: number[] }) {
  const path = useMemo(() => {
    if (points.length < 2) return "";
    const width = 600;
    const height = 90;
    const max = Math.max(1, ...points);
    const step = width / (points.length - 1);
    return smoothPath(
      points.map((value, index) => [
        Number((index * step).toFixed(2)),
        Number((height - (value / max) * (height - 8) - 4).toFixed(2)),
      ]),
    );
  }, [points]);

  if (!path) {
    return (
      <p className="text-app-muted py-6 text-center text-xs">
        No page views in the last 30 minutes.
      </p>
    );
  }

  return (
    <svg
      viewBox="0 0 600 90"
      preserveAspectRatio="none"
      className="h-24 w-full"
      role="img"
      aria-label={`Page views per minute over the last ${points.length} minutes`}
    >
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LiveDashboard() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(EMPTY);
  const [status, setStatus] = useState<Status>("connecting");
  // Relative timestamps have to be recomputed on a timer rather than read from
  // Date.now() during render — reading the clock while rendering makes output
  // depend on when React happens to re-render.
  const [now, setNow] = useState(0);

  useEffect(() => {
    const source = new EventSource("/api/admin/live");

    source.addEventListener("snapshot", (raw) => {
      try {
        setSnapshot(JSON.parse((raw as MessageEvent).data) as LiveSnapshot);
        setStatus("live");
        setNow(Date.now());
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });
    source.addEventListener("stalled", () => setStatus("stalled"));
    source.addEventListener("error", () => setStatus("connecting"));

    return () => source.close();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { presence } = snapshot;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium ${
            status === "live" ? "border-app-line text-app-fg" : "border-app-line text-app-muted"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${status === "live" ? "bg-app-accent animate-pulse" : "bg-app-muted"}`}
          />
          {status === "live" ? "Live" : status === "stalled" ? "Stalled" : "Connecting…"}
        </span>
        <span className="text-app-muted">
          Polls every {Math.round(LIVE_POLL_MS / 1000)}s · last frame {clock(presence.at)}
        </span>
        <span
          className={`ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium ${
            presence.ownerOnline ? "border-app-line text-app-fg" : "border-app-line text-app-muted"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${presence.ownerOnline ? "bg-app-accent" : "bg-app-muted"}`}
          />
          You are {presence.ownerOnline ? "visible as online" : "not showing as online"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="On site now" value={presence.visitors} hint="Tabs open, 45s window" />
        <Stat label="Views · 5 min" value={snapshot.viewsLast5m} />
        <Stat label="Views · 60 min" value={snapshot.viewsLast60m} />
        <Stat
          label="Events · 60 min"
          value={snapshot.eventsLast60m}
          hint="Clicks, downloads, outbound"
        />
      </div>

      <section className="border-app-line rounded-2xl border p-5">
        <h2 className="text-app-fg text-sm font-semibold">Page views per minute</h2>
        <p className="text-app-muted mt-1 mb-3 text-xs">Last 30 minutes.</p>
        <Sparkline points={snapshot.perMinute} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border-app-line rounded-2xl border p-5">
          <h2 className="text-app-fg text-sm font-semibold">Where they are</h2>
          {presence.paths.length === 0 ? (
            <p className="text-app-muted mt-3 text-xs">Nobody on the site right now.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {presence.paths.map((row) => (
                <li key={row.path} className="flex items-center justify-between gap-4">
                  <code className="text-app-fg truncate font-mono text-xs">{row.path}</code>
                  <span className="text-app-muted tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
          {presence.countries.length > 0 && (
            <p className="text-app-muted mt-4 text-xs">
              {presence.countries.map((code) => `${countryFlag(code)} ${code}`).join(" · ")}
            </p>
          )}
        </section>

        <section className="border-app-line rounded-2xl border p-5">
          <h2 className="text-app-fg text-sm font-semibold">Recent views</h2>
          {snapshot.recentViews.length === 0 ? (
            <p className="text-app-muted mt-3 text-xs">No page views in the last hour.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {snapshot.recentViews.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4">
                  <code className="text-app-fg truncate font-mono text-xs">{row.path}</code>
                  <span className="text-app-muted shrink-0 text-xs">
                    {countryFlag(row.country)} {row.device} · {ago(row.at, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="border-app-line rounded-2xl border p-5">
        <h2 className="text-app-fg text-sm font-semibold">Recent interactions</h2>
        {snapshot.recentEvents.length === 0 ? (
          <p className="text-app-muted mt-3 text-xs">No tracked interactions in the last hour.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {snapshot.recentEvents.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="border-app-line text-app-muted shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase">
                    {row.type}
                  </span>
                  <code className="text-app-fg truncate font-mono text-xs">{row.target}</code>
                </span>
                <span className="text-app-muted shrink-0 text-xs">
                  {countryFlag(row.country)} {ago(row.at, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
