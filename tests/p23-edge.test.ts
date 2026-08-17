import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canaryFor, evaluate, hashToUnit } from "../lib/edge/waf";
import manifest from "../app/manifest";

/**
 * P23 — edge and offline.
 *
 * The WAF tests are ordinary. The canary tests are the ones worth reading:
 * stability of assignment is the property that makes a canary usable, and it
 * is the property a `Math.random()` implementation silently lacks.
 *
 * The service worker is asserted against its source rather than executed. That
 * is a weaker test and an honest one — running it needs a full Service Worker
 * environment with Cache Storage and IndexedDB, which vitest does not provide
 * and jsdom does not implement. What these assertions catch is the class of
 * change that turns a worker into an outage: caching documents, caching POSTs,
 * or dropping the version from the cache name.
 */

function request(url: string, headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(url, { method, headers });
}

const ORIGIN = "https://www.shivamsfolio.com";

describe("P23 edge filtering", () => {
  it("allows an ordinary request", () => {
    expect(evaluate(request(`${ORIGIN}/api/search?q=react`)).action).toBe("allow");
  });

  it("blocks probe paths with a 404, not a 403", () => {
    // A 403 confirms something is filtering. A 404 is what a site that simply
    // lacks the file returns anyway, so it tells a scanner nothing.
    for (const path of ["/wp-admin/", "/wp-login.php", "/.env", "/.git/config", "/phpmyadmin/"]) {
      const verdict = evaluate(request(`${ORIGIN}${path}`));
      expect(verdict.action, path).toBe("block");
      expect(verdict.status, path).toBe(404);
    }
  });

  it("blocks percent-encoded traversal, which is the form that survives parsing", () => {
    expect(evaluate(request(`${ORIGIN}/api/x?f=%2e%2e%2fetc`)).rule).toBe("traversal");
    expect(evaluate(request(`${ORIGIN}/api/%2e%2e%2fadmin`)).rule).toBe("traversal");
  });

  it("documents that a literal ../ never reaches the filter at all", () => {
    // Not a gap in the rule — a fact about URL parsing that the rule cannot
    // change. Constructing a Request resolves dot segments during parsing, so
    // by the time `evaluate` reads pathname the original is gone. Asserting it
    // here means nobody later "fixes" the traversal rule by adding a pattern
    // that can never match, and nobody assumes the filter is what stops this.
    const normalised = new URL(`${ORIGIN}/api/x/../../etc/passwd`);
    expect(normalised.pathname).toBe("/etc/passwd");
    expect(evaluate(request(`${ORIGIN}/api/x/../../etc/passwd`)).action).toBe("allow");
  });

  it("blocks a null byte", () => {
    expect(evaluate(request(`${ORIGIN}/api/x?f=a%00b`)).rule).toBe("traversal");
  });

  it("blocks user agents that announce themselves as scanners", () => {
    expect(evaluate(request(`${ORIGIN}/`, { "user-agent": "sqlmap/1.7" })).rule).toBe(
      "hostile-agent",
    );
  });

  it("does not block an unusual but real browser", () => {
    // The rule matches self-declarations only. Blocking on a fingerprint is how
    // a filter starts refusing real visitors with privacy extensions, and a
    // portfolio that intermittently fails to load has traded a reader for a
    // scanner that would have found nothing.
    const agent =
      "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0 PrivacyBadger";
    expect(evaluate(request(`${ORIGIN}/`, { "user-agent": agent })).action).toBe("allow");
  });

  it("blocks oversized headers", () => {
    const verdict = evaluate(request(`${ORIGIN}/api/x`, { cookie: "a=".repeat(9000) }));
    expect(verdict.action).toBe("block");
    expect(verdict.status).toBe(431);
  });

  it("honours the skip pattern for static assets", () => {
    const skip = /^\/_next\/static/;
    // A hashed asset path could contain anything; it must never be filtered.
    expect(evaluate(request(`${ORIGIN}/_next/static/chunks/wp-admin.js`), { skip }).action).toBe(
      "allow",
    );
  });

  it("keeps the probe regex and the proxy matcher in step", () => {
    // A path in the regex but not in proxy.ts's matcher is a rule that never
    // runs. Verified live: those paths still return 404, because no route
    // exists to serve them — so the *outcome* is identical and only the log
    // line is lost. That is why `/.env` and `/.git/` are intentionally absent
    // from the matcher and absent from this list.
    const proxySource = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    for (const path of ["wp-admin", "wp-login.php", "xmlrpc.php", "phpmyadmin", "typo3"]) {
      expect(proxySource, `${path} is filtered but not matched`).toContain(path);
    }
  });
});

describe("P23 canary routing", () => {
  it("assigns nobody when the share is zero", () => {
    const decision = canaryFor(request(`${ORIGIN}/`), { share: 0 });
    expect(decision.canary).toBe(false);
    expect(decision.assign).toBe(false);
  });

  it("assigns everybody at 100%", () => {
    expect(canaryFor(request(`${ORIGIN}/`), { share: 1 }).canary).toBe(true);
  });

  it("is stable for the same identity", () => {
    // THE property. Random assignment per request puts one visitor on both
    // versions during a single page load — the document from one build and its
    // JavaScript chunks from another — which fails in a configuration that
    // exists on nobody's deployment.
    const first = canaryFor(request(`${ORIGIN}/a`), { share: 0.5 }, "visitor-1");
    const second = canaryFor(request(`${ORIGIN}/b`), { share: 0.5 }, "visitor-1");
    const third = canaryFor(request(`${ORIGIN}/c`), { share: 0.5 }, "visitor-1");
    expect(second.canary).toBe(first.canary);
    expect(third.canary).toBe(first.canary);
  });

  it("splits a population roughly at the requested share", () => {
    let onCanary = 0;
    const population = 4000;
    for (let i = 0; i < population; i += 1) {
      if (canaryFor(request(`${ORIGIN}/`), { share: 0.25 }, `visitor-${i}`).canary) onCanary += 1;
    }
    const share = onCanary / population;
    // Generous bounds: this asserts the hash distributes, not that it is a
    // cryptographic PRF.
    expect(share).toBeGreaterThan(0.21);
    expect(share).toBeLessThan(0.29);
  });

  it("lets an existing cookie override the share, in both directions", () => {
    // Re-evaluating every request means rolling a canary back moves people
    // mid-session, which is exactly when a half-loaded application breaks.
    const pinnedOn = canaryFor(request(`${ORIGIN}/`, { cookie: "sf_canary=on" }), { share: 0 });
    expect(pinnedOn.canary).toBe(true);
    expect(pinnedOn.assign).toBe(false);

    const pinnedOff = canaryFor(request(`${ORIGIN}/`, { cookie: "sf_canary=off" }), { share: 1 });
    expect(pinnedOff.canary).toBe(false);
  });

  it("hashes into the unit interval", () => {
    for (const value of ["", "a", "visitor-9999", "::1"]) {
      const unit = hashToUnit(value);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThanOrEqual(1);
    }
    expect(hashToUnit("a")).not.toBe(hashToUnit("b"));
  });
});

describe("P23 service worker", () => {
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

  it("never serves a navigation from cache", () => {
    // The rule the whole worker is built around. A cached document referencing
    // deleted JavaScript chunks is a white screen the visitor cannot report
    // and the author cannot fix, because the fix is served by the broken
    // worker. `caches.match` must appear in the navigation branch ONLY inside
    // the catch, as the offline fallback.
    const navigationBranch = source.slice(source.indexOf('request.mode === "navigate"'));
    const catchIndex = navigationBranch.indexOf("} catch {");
    const beforeCatch = navigationBranch.slice(0, catchIndex);
    expect(beforeCatch).not.toContain("caches.match");
  });

  it("only ever caches GET", () => {
    expect(source).toContain('request.method !== "GET"');
  });

  it("never intercepts the API", () => {
    expect(source).toContain('url.pathname.startsWith("/api/")');
  });

  it("versions its cache names so they can be dropped wholesale", () => {
    expect(source).toMatch(/const VERSION = "v\d+"/);
    expect(source).toContain("caches.delete(name)");
  });

  it("enables navigation preload", () => {
    // Without it, every navigation waits for worker startup — the usual way a
    // service worker makes a fast site slower.
    expect(source).toContain("navigationPreload");
  });

  it("only caches successful asset responses", () => {
    // Caching an opaque or errored response pins a failure for the lifetime of
    // the cache version.
    expect(source).toContain("response.ok && response.status === 200");
  });

  it("drops a queued request on a 4xx and keeps it on a 5xx", () => {
    // Retrying a payload the server has already read and rejected sends
    // identical bytes to an identical judgement forever, and the queue never
    // drains.
    expect(source).toContain("response.status >= 400 && response.status < 500");
  });
});

describe("P23 manifest", () => {
  // Asserted against the manifest the framework actually serves, not against
  // the source text. The first version of these tests grepped the file and
  // failed on its own comment explaining why the icon is not maskable — a
  // source-text assertion cannot tell code from prose about code, which is the
  // same mistake P22's scanner made on its first run.
  const built = manifest();

  it("does not append a tracking parameter to start_url", () => {
    // `?source=pwa` would make every installed launch a distinct URL from the
    // canonical one, splitting the analytics and the ISR cache entry for the
    // busiest page on the site.
    expect(built.start_url).toBe("/");
  });

  it("does not claim its icon is maskable", () => {
    // "any maskable" is a lie unless the icon carries the safe-zone padding,
    // and the lie makes Android crop the logo.
    for (const icon of built.icons ?? []) {
      expect(icon.purpose ?? "any").not.toContain("maskable");
    }
  });

  it("is installable — name, start_url, display and an icon are all required", () => {
    expect(built.name).toBeTruthy();
    expect(built.display).toBe("standalone");
    expect((built.icons ?? []).length).toBeGreaterThan(0);
  });

  it("points every shortcut at a real page", () => {
    for (const shortcut of built.shortcuts ?? []) {
      const path = shortcut.url.split("?")[0];
      const exists = (() => {
        try {
          readFileSync(join(process.cwd(), "app", path, "page.tsx"));
          return true;
        } catch {
          return false;
        }
      })();
      expect(exists, `${shortcut.url} has no page`).toBe(true);
    }
  });
});
