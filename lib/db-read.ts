/**
 * Resilience wrapper for public **read** paths.
 *
 * Two distinct problems this solves, both real:
 *
 * 1. `next build` executes `generateStaticParams` and prerenders static pages,
 *    which means a production build hard-fails if the database is unreachable
 *    for even a moment. That is wrong on its own terms — a Neon blip during a
 *    Vercel deploy should not fail the deploy — and it is why CI, which has no
 *    database at all, could never go green.
 *
 * 2. A single failing content query should degrade one section, not return a
 *    500 for the whole page.
 *
 * Deliberately **not** applied to writes, admin queries, or auth. Silently
 * swallowing a failed write would lose data, and an admin screen showing an
 * empty list because the database is down is actively misleading. Those paths
 * must keep throwing.
 *
 * The pairing that makes this safe: every page relying on a fallback also sets
 * `revalidate`, so a build that prerendered empty content self-heals on the
 * next revalidation instead of serving an empty page forever.
 */
export async function readOrFallback<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // Loud on purpose. This path existing must never make a real outage quiet.
    // Not every rejection is an Error. Next surfaces build-time worker
    // failures as an ErrorEvent, which stringifies to "[object ErrorEvent]"
    // and has no .message - precisely the case this wrapper handles, so it
    // must not be the case it reports uselessly.
    const reason =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : typeof error === "object" && error !== null
          ? JSON.stringify(error, Object.getOwnPropertyNames(error)).slice(0, 500)
          : String(error);
    console.error(`[db-read] "${label}" failed - serving fallback. ${reason}`);
    return fallback;
  }
}
