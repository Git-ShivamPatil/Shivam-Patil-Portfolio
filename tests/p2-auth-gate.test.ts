import { describe, it, expect } from "vitest";
import { authConfig } from "../auth.config";

/**
 * P2/P3 — the route gate that proxy.ts runs on every /admin and /account hit.
 *
 * This exists because of a real regression: `authorized()` reads
 * `auth.user.role`, but proxy.ts builds its own adapter-less NextAuth
 * instance from authConfig alone. Auth.js's *default* session callback
 * rebuilds session.user from a fixed whitelist — name, email, image — and
 * silently drops every other claim. With no session callback in this config,
 * `role` came back undefined and the admin gate denied everyone, admins
 * included. The two suites below pin both halves so it cannot regress:
 * `session()` must project the claim, and `authorized()` must act on it.
 */

const callbacks = authConfig.callbacks;

function makeSession(user: Record<string, unknown> | null) {
  return { user, expires: "2099-01-01T00:00:00.000Z" };
}

function runAuthorized(auth: unknown, pathname: string) {
  // Only the two fields the callback actually reads.
  return callbacks.authorized({
    auth,
    request: { nextUrl: { pathname } },
  } as never);
}

describe("session callback", () => {
  it("projects id and role from the JWT onto session.user", () => {
    const result = callbacks.session({
      session: makeSession({ name: "Shivam" }),
      token: { id: "u_1", role: "ADMIN" },
    } as never) as { user: { id: string; role: string; name: string } };

    expect(result.user.role).toBe("ADMIN");
    expect(result.user.id).toBe("u_1");
    // Must not clobber what Auth.js already put there.
    expect(result.user.name).toBe("Shivam");
  });

  it("does not throw when there is no user on the session", () => {
    expect(() =>
      callbacks.session({
        session: makeSession(null),
        token: { id: "u_1", role: "USER" },
      } as never),
    ).not.toThrow();
  });
});

describe("authorized callback", () => {
  it("admits an ADMIN to /admin", () => {
    expect(runAuthorized(makeSession({ role: "ADMIN" }), "/admin/projects")).toBe(true);
  });

  it("denies a signed-in USER at /admin", () => {
    expect(runAuthorized(makeSession({ role: "USER" }), "/admin")).toBe(false);
  });

  it("denies when role is missing — the exact shape the old bug produced", () => {
    expect(runAuthorized(makeSession({ name: "Shivam" }), "/admin")).toBe(false);
  });

  it("denies anonymous visitors at /admin and /account", () => {
    expect(runAuthorized(null, "/admin")).toBe(false);
    expect(runAuthorized(null, "/account")).toBe(false);
  });

  it("admits any signed-in user to /account regardless of role", () => {
    expect(runAuthorized(makeSession({ role: "USER" }), "/account")).toBe(true);
  });

  it("leaves public routes open", () => {
    expect(runAuthorized(null, "/")).toBe(true);
    expect(runAuthorized(null, "/projects")).toBe(true);
  });

  it("gates nested admin paths, not just the root", () => {
    // A prefix check is what makes /admin/analytics safe too.
    expect(runAuthorized(makeSession({ role: "USER" }), "/admin/analytics/deep")).toBe(false);
  });
});
