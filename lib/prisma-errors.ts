function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}

/** True for Prisma's "Unique constraint failed" error (P2002) — e.g. a duplicate slug. */
export function isUniqueConstraintError(error: unknown): boolean {
  return hasCode(error, "P2002");
}

/**
 * True for Prisma's "record not found" error (P2025), which `update` and
 * `delete` throw when the id doesn't exist. Worth distinguishing because it
 * is a client mistake, not a server fault: reporting it as a 500 tells an
 * admin who double-clicked delete that the app is broken, and buries a real
 * outage in the same noise.
 */
export function isNotFoundError(error: unknown): boolean {
  return hasCode(error, "P2025");
}

/**
 * True for a unique-constraint violation on a *specific* field.
 *
 * The distinction matters wherever a caller retries on P2002. A blind retry
 * assumes the only unique column that can fail is the one it is regenerating;
 * if a second unique column collides, the retry regenerates the wrong value and
 * loops until it gives up, turning a deterministic failure into a slow one.
 *
 * Prisma reports the offending columns in `meta.target`, which is a string[] on
 * PostgreSQL but has been a bare string on other connectors and in older
 * versions — both shapes are accepted here rather than assuming one.
 */
export function isUniqueConstraintOn(error: unknown, field: string): boolean {
  if (!isUniqueConstraintError(error)) return false;

  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === "string") return target === field || target.endsWith(`_${field}_key`);

  // No target reported. Treat it as a match rather than swallowing a real
  // collision: the caller's retry is the safer branch when we cannot tell.
  return true;
}
