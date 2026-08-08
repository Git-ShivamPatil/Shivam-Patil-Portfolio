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
