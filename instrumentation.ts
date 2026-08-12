import { reportError } from "./lib/observability/sentry";

/**
 * P14 — the framework's own error hook.
 *
 * `onRequestError` is called by Next for every uncaught error thrown in a
 * server component, a route handler or the rendering pipeline. That is the
 * whole reason this file exists rather than a try/catch in every route: the
 * errors worth reporting are precisely the ones nobody remembered to catch.
 *
 * `register()` runs once per server start, which is where a boot-time check
 * belongs — a missing required secret should be visible in the first log line
 * of a deploy, not in the first 500 a visitor sees.
 */

export async function register() {
  // Next bundles this file for the Edge runtime as well as for Node, and
  // lib/security/vault.ts reads mounted secret files with node:fs. Branching on
  // NEXT_RUNTIME is the documented way to keep a Node-only import out of the
  // Edge bundle — without it the build warns about loading a module the Edge
  // runtime does not have, for a code path that can never run there anyway
  // (nothing mounts a secret file into an edge function).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadSecretFiles, missingRequired } = await import("./lib/security/vault");

  // Must happen before the check below, or a secret supplied as a mounted file
  // would be reported missing on every container start.
  await loadSecretFiles();

  const missing = missingRequired();
  if (missing.length > 0) {
    console.error(`[boot] missing required secrets: ${missing.join(", ")}`);
  }
}

export const onRequestError: (
  error: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routerKind?: string; routePath?: string; renderSource?: string },
) => Promise<void> = async (error, request, context) => {
  await reportError(error, {
    source: "route",
    // The route *pattern* ("/projects/[slug]"), not the resolved path, so
    // errors group by the code that threw rather than by which row was being
    // rendered.
    path: context.routePath ?? request.path,
    method: request.method,
    tags: {
      routerKind: context.routerKind,
      renderSource: context.renderSource,
    },
  });
};
