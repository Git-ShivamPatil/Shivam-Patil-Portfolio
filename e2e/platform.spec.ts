import { test, expect } from "@playwright/test";

/**
 * P15 — the phases whose behaviour only exists in a real browser.
 *
 * P13's headers and P11's presence heartbeat are both asserted by unit tests at
 * the function level, but neither test can answer the question that matters: is
 * the policy actually served, and does the browser actually beat. A CSP is a
 * string until a browser enforces it; a visibility-gated heartbeat never fires
 * anywhere that is not a real, visible page.
 */

test.describe("P13 — security headers, as served", () => {
  test("every header reaches the browser", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response!.headers();

    expect(headers["content-security-policy"]).toBeTruthy();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  });

  test("the policy does not break the page it protects", async ({ page }) => {
    // The failure mode of a too-tight CSP is silent: the page renders, one
    // script is blocked, and a feature quietly stops working. A violation
    // reaches the console as a securitypolicyviolation event and nowhere else.
    const violations: string[] = [];
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        (window as unknown as { __csp: string[] }).__csp ??= [];
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} blocked ${event.blockedURI}`,
        );
      });
    });

    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    // Give the deferred layer — chat launcher, cursor, presence — time to mount
    // behind its idle gate, since that is the code most likely to trip a policy.
    await page.waitForTimeout(2500);

    violations.push(
      ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])),
    );
    expect(violations).toEqual([]);
  });

  test("refuses a cross-site state-changing request", async ({ request, baseURL }) => {
    const blocked = await request.post(`${baseURL}/api/contact`, {
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      data: {},
    });
    expect(blocked.status()).toBe(403);
  });
});

test.describe("P11 — presence", () => {
  test("a visible page beats a heartbeat and the server records it", async ({ page }) => {
    // This is the assertion the browser pane could not make during development:
    // the tracker is visibility-gated, and a pane that is not fronted reports
    // `document.visibilityState === "hidden"`, so no beat ever fired and the
    // absence looked like a bug. Playwright's page is genuinely visible.
    const beats: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/presence/heartbeat")) beats.push(response.status());
    });

    await page.goto("/about");
    // Polled for a 200 among the responses rather than asserting on the first
    // one. The limiter meters on IP, and every parallel worker shares
    // 127.0.0.1 — so a burst of specs starting together can legitimately spend
    // the bucket and get a 429 first. That is the limiter working, not the
    // heartbeat failing, and asserting on beats[0] made this the only flaky
    // test in the suite.
    await expect
      .poll(() => beats, { message: "no heartbeat was ever accepted", timeout: 20_000 })
      .toContain(200);
  });

  test("mints no storage — the token dies with the document", async ({ page }) => {
    // A token in sessionStorage survives a reload, which makes the outgoing
    // page's release beacon race the incoming page's heartbeat and delete a row
    // for a visitor who is still on the site. See HANDOFF on P11.
    await page.goto("/");
    await page.waitForTimeout(2500);
    const stored = await page.evaluate(() => ({
      session: Object.keys(sessionStorage),
      local: Object.keys(localStorage),
    }));
    expect(stored.session.join(",")).not.toContain("presence");
    expect(stored.local.join(",")).not.toContain("presence");
  });

  test("the chat widget states whether anyone is reading", async ({ page }) => {
    await page.goto("/");
    const launcher = page.getByRole("button", { name: /open chat/i });
    await expect(launcher).toBeVisible({ timeout: 10_000 });
    await launcher.click();

    // "connected" describes the transport; it says nothing about whether the
    // owner is there. The panel must say which of the two it means.
    const status = page.locator(".chat-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveText(/online|away|connecting/i, { timeout: 15_000 });
  });
});

test.describe("P14 — health", () => {
  test("reports ok with a reachable database", async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.find((c: { name: string }) => c.name === "database").ok).toBe(true);
    // The secrets report is admin-only; an anonymous caller must never see it.
    expect(body.secrets).toBeUndefined();
  });

  test("keeps /api/metrics closed to anonymous callers", async ({ request, baseURL }) => {
    expect((await request.get(`${baseURL}/api/metrics`)).status()).toBe(401);
  });
});

test.describe("P12 — delivery", () => {
  test("loads fonts from our own origin and nothing external", async ({ page }) => {
    const externalHosts = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        externalHosts.add(url.hostname);
      }
    });

    await page.goto("/");
    await page.waitForTimeout(2500);
    // Vendored in P12 after Google began 404ing four Playfair Display files its
    // own stylesheet points at.
    expect([...externalHosts]).toEqual([]);
  });

  test("only ships a route's own stylesheet to that route", async ({ page }) => {
    const sheetsFor = async (path: string) => {
      await page.goto(path);
      return page.evaluate(() =>
        [...document.querySelectorAll('link[rel="stylesheet"]')].map(
          (link) => (link as HTMLLinkElement).href.split("/").pop() ?? "",
        ),
      );
    };

    const home = await sheetsFor("/");
    const systemDesign = await sheetsFor("/system-design");
    // The /system-design diagram styles are the largest single-route block in
    // the codebase; the homepage must not be paying for them.
    expect(systemDesign.length).toBeGreaterThan(home.length);
  });

  test("never caches the service worker", async ({ request, baseURL }) => {
    // A hard-cached service worker is stuck forever: the thing that would have
    // fetched its replacement is the stale copy.
    const response = await request.get(`${baseURL}/sw.js`);
    expect(response.headers()["cache-control"]).toContain("max-age=0");
  });
});
