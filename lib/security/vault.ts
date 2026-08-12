import { readFileSync } from "node:fs";

/**
 * P13 — the secret vault.
 *
 * The blueprint names Vault. Running a Vault cluster for a portfolio on a free
 * tier would be theatre, so what this is instead is the part of Vault that
 * actually earns its keep at this size: **one place that knows what every
 * secret is, where it comes from, whether it is present, and how to keep it out
 * of a log.** The storage backend is the platform's encrypted environment (and,
 * for containers, a mounted file); the discipline is here.
 *
 * Three properties it provides that scattered `process.env.X` does not:
 *
 * 1. **`_FILE` indirection.** `RESEND_API_KEY_FILE=/run/secrets/resend` reads
 *    the value from disk. That is the Docker and Kubernetes secret convention,
 *    and it exists because an environment variable is visible to every process
 *    in the container and lands in `docker inspect` output, while a mounted
 *    file has permissions. P14 adds the container; this is what makes it able
 *    to hold secrets properly.
 * 2. **Redaction.** `redact()` is what makes it safe to log configuration at
 *    boot. A secret that has to be *remembered* not to be logged eventually
 *    gets logged.
 * 3. **A presence report.** Every integration on this site degrades rather than
 *    throws when its keys are missing, which is the right behaviour and also
 *    means a missing key is silent. `secretsReport()` turns "silently disabled"
 *    into something /api/health can state out loud.
 */

/** Every secret this app knows about, and what stops working without it. */
export const SECRETS = {
  DATABASE_URL: { required: true, disables: "everything — this is the database" },
  DIRECT_URL: { required: false, disables: "migrations (the app runs on the pooled URL)" },
  AUTH_SECRET: { required: true, disables: "session signing — sign-in cannot work" },
  AUTH_GOOGLE_ID: { required: false, disables: "the Google sign-in button" },
  AUTH_GOOGLE_SECRET: { required: false, disables: "the Google sign-in button" },
  AUTH_GITHUB_ID: { required: false, disables: "the GitHub sign-in button" },
  AUTH_GITHUB_SECRET: { required: false, disables: "the GitHub sign-in button" },
  RESEND_API_KEY: { required: false, disables: "outbound email (leads still persist)" },
  VAPID_PRIVATE_KEY: { required: false, disables: "web push delivery" },
  VAPID_PUBLIC_KEY: { required: false, disables: "web push subscription" },
  RAZORPAY_KEY_ID: { required: false, disables: "paid bookings — /api/bookings returns 503" },
  RAZORPAY_KEY_SECRET: { required: false, disables: "paid bookings" },
  RAZORPAY_WEBHOOK_SECRET: { required: false, disables: "booking confirmation from webhooks" },
  S3_ACCESS_KEY_ID: { required: false, disables: "media uploads (library stays read-only)" },
  S3_SECRET_ACCESS_KEY: { required: false, disables: "media uploads" },
  GITHUB_TOKEN: { required: false, disables: "nothing — raises the GitHub API rate limit" },
  CRON_SECRET: { required: false, disables: "unattended analytics pruning" },
  UPSTASH_REDIS_REST_URL: { required: false, disables: "shared rate limiting (falls back to memory)" },
  UPSTASH_REDIS_REST_TOKEN: { required: false, disables: "shared rate limiting" },
  SENTRY_DSN: { required: false, disables: "error reporting (errors still hit the platform log)" },
} as const;

export type SecretName = keyof typeof SECRETS;

/**
 * Read a secret.
 *
 * `NAME_FILE` wins over `NAME` when both are set, because the file form is the
 * more deliberate one: nobody mounts a secret file by accident.
 */
export function secret(name: SecretName | (string & {})): string | undefined {
  const fromFile = process.env[`${name}_FILE`];
  if (fromFile) {
    try {
      const value = readFileSync(fromFile, "utf8").trim();
      if (value) return value;
    } catch (error) {
      // Loud, and without the path's contents. A misconfigured secret mount
      // that silently falls through to an unset value is how a service ends up
      // running unauthenticated without anyone noticing.
      console.error(
        `[vault] ${name}_FILE is set but unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return process.env[name] || undefined;
}

/**
 * Render a secret safe to print.
 *
 * Shows the first and last two characters of anything long enough for that to
 * be useless to an attacker but useful to a human comparing "is the key on
 * Vercel the same one as in .env.local". Anything shorter is fully masked —
 * for a 6-character value, four visible characters is most of it.
 */
export function redact(value: string | undefined | null): string {
  if (!value) return "(unset)";
  if (value.length < 12) return "•".repeat(8);
  return `${value.slice(0, 2)}…${value.slice(-2)} (${value.length} chars)`;
}

/**
 * Scrub anything that looks like a secret out of a string before it is logged
 * or reported.
 *
 * Deliberately conservative and pattern-based rather than clever: it replaces
 * the *known* secret values, which is the case that actually matters — a
 * connection string or an API key interpolated into an error message. Guessing
 * at unknown secrets by shape would mangle legitimate output.
 */
export function scrub(text: string): string {
  let output = text;
  for (const name of Object.keys(SECRETS) as SecretName[]) {
    const value = secret(name);
    // Short values produce false positives everywhere; a real secret is long.
    if (!value || value.length < 12) continue;
    output = output.split(value).join(`[redacted:${name}]`);
  }
  return output;
}

export interface SecretStatus {
  name: string;
  present: boolean;
  required: boolean;
  /** Where the value came from, never what it is. */
  source: "file" | "env" | "unset";
  disables: string;
}

/**
 * What is configured and what is not.
 *
 * Never includes a value, not even a redacted one — this feeds an HTTP
 * response, and "two characters of the production database password" is still
 * two characters of the production database password.
 */
export function secretsReport(): SecretStatus[] {
  return (Object.keys(SECRETS) as SecretName[]).map((name) => {
    const fromFile = Boolean(process.env[`${name}_FILE`]);
    const value = secret(name);
    return {
      name,
      present: Boolean(value),
      required: SECRETS[name].required,
      source: value ? (fromFile ? "file" : "env") : "unset",
      disables: SECRETS[name].disables,
    };
  });
}

/** The required secrets that are missing. Empty means the app can serve. */
export function missingRequired(): string[] {
  return secretsReport()
    .filter((entry) => entry.required && !entry.present)
    .map((entry) => entry.name);
}
