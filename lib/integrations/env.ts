/**
 * Environment reads for the live-data integrations.
 *
 * `process.env.X ?? "default"` is not enough on its own. `??` only fires on
 * null/undefined, and a variable that is *declared but empty* — which is what
 * Vercel hands a project where the key exists with a blank value, and what a
 * shell does after `export GITHUB_USERNAME=` — arrives as `""`. Worse, a
 * template that interpolates an unset value (`GITHUB_USERNAME=$USER` in a
 * Dockerfile, a mis-quoted CI expression) can deliver the literal four-letter
 * string "undefined". Both slide straight through `??` into the URL, producing
 * requests to /users/undefined/events/public: a hard 404 that the cache layer
 * records as a transient upstream failure and retries forever, so the logs
 * name rate limiting when the real cause is configuration.
 */
const UNUSABLE = new Set(["", "undefined", "null", "none"]);

/**
 * Returns a usable username, or null when neither the env var nor the fallback
 * is usable — in which case the caller must render its empty state rather than
 * building a URL out of nothing.
 */
export function resolveUsername(raw: string | undefined, fallback: string): string | null {
  const candidate = (raw ?? "").trim();
  if (!UNUSABLE.has(candidate.toLowerCase())) return candidate;
  const backup = fallback.trim();
  return UNUSABLE.has(backup.toLowerCase()) ? null : backup;
}

/**
 * Path-segment encoding for a value that came from the environment.
 *
 * A username is interpolated directly into an api.github.com path. Encoding it
 * means a stray "../" or a space in a mis-set variable can only ever produce a
 * 404 from the intended host, never a request to a path we did not mean to ask
 * for.
 */
export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
