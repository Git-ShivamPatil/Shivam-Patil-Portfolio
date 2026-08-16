/**
 * Provenance footer for a live-data panel.
 *
 * Being explicit that a number came from cache — and how old it is — is the
 * point of the stale-on-error strategy: a visitor should be able to tell the
 * difference between "this is live" and "the upstream is down, here's the last
 * good reading", rather than silently trusting a stale figure.
 *
 * `fetchedAt` accepts a string as well as a Date because this component is now
 * rendered on both sides of the client boundary. The server components hold a
 * real Date from Prisma; the polling hook holds the ISO *string* the API route
 * produced with `.toISOString()`. The previous `fetchedAt: Date` signature made
 * the second case a runtime TypeError rather than a type error, because JSON
 * across that boundary is untyped.
 */
export function StaleNote({ fetchedAt, stale }: { fetchedAt: Date | string; stale: boolean }) {
  const when = typeof fetchedAt === "string" ? new Date(fetchedAt) : fetchedAt;
  const iso = when.toISOString();
  return (
    <p className={stale ? "stat-provenance is-stale" : "stat-provenance"}>
      {/* Two different marks, not two different colours. Light theme is a
          two-colour system, so there is no warning hue available — and the
          pale --orange this used to use measured 1.14:1 against the panel,
          which is not a subtle colour, it is an invisible one. A filled pip
          versus a hollow ring reads at a glance in both themes and in
          greyscale. */}
      <span className={stale ? "stale-pip" : "live-dot"} aria-hidden="true" />
      {stale ? "Upstream unavailable — showing last good data from " : "Live · fetched "}
      {/* toUTCString() is locale- and timezone-independent, so the server and
          client render the same characters. A localised format here would be a
          hydration mismatch on every visitor outside UTC. */}
      <time dateTime={iso}>{when.toUTCString().replace("GMT", "UTC")}</time>
    </p>
  );
}
