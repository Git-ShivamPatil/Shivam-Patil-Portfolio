import { registerSecretValue } from "./secrets";

/**
 * P13 — the mounted-secret half of the vault.
 *
 * The registry, redaction and reporting live in `./secrets`, which is pure and
 * safe to import from anywhere. This file is the part that touches a
 * filesystem, and it is deliberately the only part that does: `node:fs`
 * anywhere in the import graph that `instrumentation.ts` can reach makes the
 * bundler warn about a module the Edge runtime does not have, and
 * instrumentation reaches the error reporter, which reaches `scrub()`.
 *
 * **What `_FILE` indirection buys.** `AUTH_SECRET_FILE=/run/secrets/auth_secret`
 * reads the value from disk instead of from the environment. That is the Docker
 * and Kubernetes convention, and it exists because an environment variable is
 * visible to every process in the container and shows up in `docker inspect`,
 * while a mounted file has an owner and a mode. docker-compose.yml uses exactly
 * this for AUTH_SECRET.
 *
 * On Vercel nothing is mounted, so `loadSecretFiles()` finds no `*_FILE` keys
 * and returns before the dynamic import ever runs.
 */

// Re-exported so callers have one import for "secrets", regardless of which
// half a given symbol lives in.
export {
  SECRETS,
  isInjected,
  missingRequired,
  redact,
  scrub,
  secret,
  secretsReport,
  type SecretName,
  type SecretStatus,
} from "./secrets";

/**
 * Read every `NAME_FILE` mount into the registry.
 *
 * Called once from `register()` in instrumentation.ts, which Next runs before
 * it serves anything — so by the time any handler calls `secret()`, a mounted
 * value is already there.
 *
 * Eager rather than per-access on purpose: secrets do not change during a
 * process lifetime, so re-reading a file on every lookup would be pure waste.
 */
export async function loadSecretFiles(): Promise<void> {
  const mounts = Object.keys(process.env).filter((key) => key.endsWith("_FILE"));
  if (mounts.length === 0) return;

  const { readFileSync } = await import("node:fs");

  for (const key of mounts) {
    const path = process.env[key];
    if (!path) continue;
    try {
      const value = readFileSync(path, "utf8").trim();
      if (value) registerSecretValue(key.slice(0, -"_FILE".length), value);
    } catch (error) {
      // Loud, and without the file's contents. A misconfigured secret mount
      // that silently falls through to an unset value is how a service ends up
      // running unauthenticated with nobody noticing.
      console.error(
        `[vault] ${key} is set but unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
