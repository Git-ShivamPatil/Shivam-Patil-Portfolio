/**
 * Provenance footer for a live-data panel.
 *
 * Being explicit that a number came from cache — and how old it is — is the
 * point of the stale-on-error strategy: a visitor should be able to tell the
 * difference between "this is live" and "the upstream is down, here's the last
 * good reading", rather than silently trusting a stale figure.
 */
export function StaleNote({ fetchedAt, stale }: { fetchedAt: Date; stale: boolean }) {
  const iso = fetchedAt.toISOString();
  return (
    <p className={`stat-provenance${stale ? "is-stale" : ""}`}>
      <span className={stale ? "" : "live-dot"} aria-hidden="true" />
      {stale ? "Upstream unavailable — showing last good data from " : "Live · fetched "}
      <time dateTime={iso}>{fetchedAt.toUTCString().replace("GMT", "UTC")}</time>
    </p>
  );
}
