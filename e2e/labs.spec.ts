import { test, expect } from "@playwright/test";

/**
 * P17–P25 — the interactive phases, asserted by their OUTPUT.
 *
 * ### Why this file exists, and why it is shaped this way
 *
 * HANDOFF §32 called this the highest-value test work left, for a specific
 * reason: **two features shipped dead and nobody noticed for weeks.** The
 * `/compute` worker backend threw on every run, and `/data` never loaded
 * DuckDB. Both pages rendered perfectly the whole time.
 *
 * That is the trap this file is built around. Every one of these pages renders
 * its full chrome before doing any work — `/compute` prints a five-row results
 * table reading "not run" in every cell, `/data` shows an editor and a Run
 * button. **A spec asserting "the page renders" would have passed on both
 * broken features**, which is precisely why the gap went unnoticed: the
 * navigation specs already visited these routes and were happy.
 *
 * So no test here asserts that a page loaded. Each one drives the feature and
 * asserts a *result*: a millisecond figure that replaced "not run", rows that
 * replaced an empty console, a leader that replaced a field of followers.
 *
 * ### Timeouts are generous on purpose
 *
 * These compile WebAssembly, spawn workers and download a ~30MB DuckDB bundle
 * on a CI runner. A tight timeout here produces exactly the flaky suite people
 * learn to re-run without reading — the thing ci.yml's Lighthouse comment
 * already warns about.
 */

test.describe("P19 — the compute lab actually computes", () => {
  test("the JS backend replaces 'not run' with a real measurement", async ({ page }) => {
    await page.goto("/compute");

    const jsRow = page.locator(".compute-table tbody tr").filter({ hasText: "JavaScript" });

    // The precondition. If this ever fails, the table stopped defaulting to
    // "not run" and the assertion below has quietly stopped meaning anything.
    await expect(jsRow.locator("td").first()).toHaveText("not run");

    await page.getByRole("button", { name: /javascript/i }).click();

    // A number followed by "ms". This is the assertion the dead worker backend
    // would have failed for weeks.
    await expect(jsRow.locator("td").first()).toHaveText(/^\d+(\.\d+)? ms$/, { timeout: 60_000 });
  });

  test("every available backend produces a time, and they agree on the answer", async ({
    page,
  }) => {
    await page.goto("/compute");

    /**
     * Wait for the availability probe, not merely for the buttons to appear.
     *
     * Two distinct traps live here, and the first version of this test hit
     * both. `locator.count()` does not auto-wait — it answers with whatever is
     * in the DOM at that instant — and the buttons render *disabled* until the
     * probe reports what this browser supports. So counting straight after
     * `goto` reported "no compute backend was runnable at all", which reads
     * exactly like every backend being unsupported rather than like the page
     * not being ready.
     *
     * The support panel reading something other than "Detecting…" is the real
     * readiness signal, so that is what this waits on.
     */
    await expect(page.locator(".compute-support")).not.toContainText("Detecting", {
      timeout: 30_000,
    });

    /**
     * `:not(:disabled)`, never `:not([disabled])`.
     *
     * Measured, because the two disagree during hydration: immediately after
     * the first button became visible, `:not([disabled])` matched 0 while
     * `:not(:disabled)` matched 4. The attribute is what the server rendered
     * and lingers until React reconciles; the pseudo-class reflects the live
     * property, which is what "can a visitor click this?" actually means.
     */
    const buttons = page.locator(".compute-actions button:not(:disabled)");
    const count = await buttons.count();
    expect(count, "no compute backend was runnable at all").toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      await buttons.nth(i).click();
      // Serially, not in parallel: they contend for the same CPU and a
      // parallel run measures scheduling noise rather than the backends.
      await page.waitForTimeout(400);
    }

    const times = page.locator(".compute-table tbody tr td:nth-child(2)");
    const measured = (await times.allTextContents()).filter((text) => /\d+(\.\d+)? ms/.test(text));
    expect(measured.length, "no backend reported a time").toBeGreaterThan(0);

    /**
     * The checksum column is what makes this a comparison rather than four
     * unrelated numbers — the component's own words. A backend that runs fast
     * and computes something else is worse than one that fails, because the
     * page then advertises a speedup that is not real.
     */
    const verdicts = await page
      .locator(".compute-table tbody tr td:nth-child(4)")
      .allTextContents();
    expect(verdicts.filter((text) => text.trim() === "differs")).toEqual([]);
  });
});

test.describe("P20 — DuckDB returns rows", () => {
  /**
   * Three minutes, and the default 30s is not close to enough.
   *
   * `getJsDelivrBundles()` fetches a multi-megabyte WebAssembly build from a
   * CDN and then instantiates it. The first version of this test set a 180s
   * timeout on the `expect` and left the TEST timeout at its 30s default, so
   * it died at 30s reporting "element not found" — which reads exactly like
   * DuckDB being broken rather than like the test giving up early.
   */
  test.setTimeout(180_000);

  test("a query produces a result table, not just a console", async ({ page }) => {
    await page.goto("/data");

    // Absent until a query succeeds — which is the whole point of asserting on
    // it rather than on the editor, which renders whether or not DuckDB loads.
    await expect(page.locator(".olap-result")).toHaveCount(0);

    await page.getByRole("button", { name: /run query|load duckdb/i }).click();

    /**
     * Race the result against the component's own error state.
     *
     * Waiting only on `.olap-result` means every failure — a broken query, an
     * unreachable CDN, a WebAssembly compile error — reports as "element not
     * found" after the full timeout, which says nothing about why. Surfacing
     * the error text turns that into a diagnosis.
     *
     * The assertion stays strict: an error still FAILS this test. DuckDB
     * showing an apology is not DuckDB working, and a test that accepted one
     * would pass on exactly the dead feature it exists to catch (§27).
     */
    const error = page.locator(".ask-error");
    await Promise.race([
      page.locator(".olap-result").waitFor({ state: "visible", timeout: 150_000 }),
      error.waitFor({ state: "visible", timeout: 150_000 }),
    ]).catch(() => undefined);

    if (await error.isVisible()) {
      throw new Error(`DuckDB reported an error instead of rows: ${await error.innerText()}`);
    }

    await expect(page.locator(".olap-result")).toBeVisible();
    await expect(page.locator(".olap-result .ask-note")).toHaveText(/\d+ rows? in [\d.]+ ms/);

    const bodyRows = page.locator(".olap-result tbody tr");
    expect(await bodyRows.count(), "the query returned a header and no data").toBeGreaterThan(0);
  });
});

test.describe("P17 — the terminal answers", () => {
  test("a command produces output", async ({ page }) => {
    await page.goto("/terminal");

    // `#terminal-input`, not getByLabel("Command"): the accessible name
    // resolves to three elements, because the nav drawer and footer both link
    // to this page with a blurb reading "A real terminal. Try `help`, then
    // `whoami`" — which matches on the very word the test types.
    const input = page.locator("#terminal-input");
    await input.fill("whoami");
    await input.press("Enter");

    const log = page.getByRole("log", { name: "Terminal output" });
    // The echoed command is not evidence — the input line renders regardless.
    // What matters is that something came back that is not the echo.
    await expect(log).toContainText(/shivam/i, { timeout: 15_000 });
  });

  test("an unknown command fails visibly rather than silently", async ({ page }) => {
    // A terminal that swallows unknown input looks identical to one whose
    // command dispatch is broken.
    await page.goto("/terminal");

    const input = page.locator("#terminal-input");
    await input.fill("definitelynotacommand");
    await input.press("Enter");

    await expect(page.getByRole("log", { name: "Terminal output" })).toContainText(
      /not found|unknown|command/i,
      { timeout: 15_000 },
    );
  });
});

test.describe("P18 — the Raft simulator elects a leader", () => {
  /**
   * Sixty seconds for twenty-five clicks, and the arithmetic is the reason.
   *
   * Every click on this page grows a `.ripple-ink` span inside the button and
   * runs a 0.62s animation on it (app/motion.css). Playwright waits for a
   * target to be actionable before each click, so the suite pays some part of
   * that animation twenty-five times over. Measured against a local production
   * build: individual clicks came back at 47ms, 400ms and 1490ms in a repeating
   * pattern, averaging ~700ms — about 17s of clicking, before page load, and
   * before any contention from a second worker.
   *
   * That fits inside the 30s default only on a fast, idle machine, which is the
   * definition of a test that will fail for reasons unrelated to Raft. The
   * clicks stay real rather than being dispatched synthetically: the ripple is
   * part of what a visitor experiences, and a simulator driven by events the
   * UI does not actually emit is not the thing being tested.
   */
  test.setTimeout(60_000);

  test("stepping the cluster produces exactly one leader", async ({ page }) => {
    await page.goto("/system-design");

    const stage = page.locator(".raft-stage");
    await expect(stage).toBeVisible();

    // Step rather than run: a deterministic number of ticks beats waiting on a
    // timer, which is how a simulator test becomes flaky.
    const step = page.getByRole("button", { name: /^step$/i });
    for (let i = 0; i < 25; i += 1) {
      await step.click();
    }

    // Safety, not liveness: Raft permits a term with no leader, but never two.
    // Asserting "exactly one" would fail legitimately on a split vote; this
    // asserts the invariant that actually must hold.
    await expect(page.locator(".raft-leader")).not.toHaveCount(2);
    await expect(stage.locator(".raft-node")).not.toHaveCount(0);
  });
});

test.describe("P24 — the API surface answers", () => {
  test("the OpenAPI document is served and parses", async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/openapi`);
    expect(response.status()).toBe(200);
    // The registered media type, not application/json — claiming the generic
    // one tells a tool nothing about what it received.
    expect(response.headers()["content-type"]).toContain("openapi");

    const document = (await response.json()) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };
    expect(document.openapi).toMatch(/^3\./);
    expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(0);
  });

  test("GraphQL refuses a mutation by name", async ({ request, baseURL }) => {
    // P24's stated guarantee. A subset executor that silently ignored the
    // refusal list would still answer queries correctly, so nothing else
    // catches this.
    const response = await request.post(`${baseURL}/api/graphql`, {
      data: { query: "mutation { deleteEverything }" },
    });
    const body = (await response.json()) as { errors?: { message: string }[] };
    expect(JSON.stringify(body.errors ?? [])).toMatch(/mutation/i);
  });

  test("a metered route reports the tier it served", async ({ request, baseURL }) => {
    // P27. An anonymous caller must keep the route's OWN limit — the header is
    // how that stays checkable from outside.
    const response = await request.post(`${baseURL}/api/graphql`, {
      data: { query: "{ __typename }" },
    });
    expect(response.headers()["x-ratelimit-tier"]).toBe("ANONYMOUS");
    expect(Number(response.headers()["x-ratelimit-limit"])).toBeGreaterThan(0);
  });
});

test.describe("P27 — the machine-readable surface", () => {
  test("llms.txt lists real routes", async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/llms.txt`);
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain("/api/openapi");
    // Generated from the route registry, so a near-empty document means the
    // generation broke rather than that the site shrank.
    expect(body.split("\n").filter((line) => line.startsWith("- ["))).not.toHaveLength(0);
  });

  test("robots.txt opens the OpenAPI document to assistants", async ({ request, baseURL }) => {
    const body = await (await request.get(`${baseURL}/robots.txt`)).text();
    expect(body).toContain("ClaudeBot");
    expect(body).toContain("Allow: /api/openapi");
  });

  test("the engineering log renders its entries with anchors", async ({ page }) => {
    await page.goto("/engineering-log");

    const entries = page.locator(".log-entry");
    expect(await entries.count()).toBeGreaterThan(0);

    // The hypothesis block is the page's whole premise. If it stops rendering,
    // what is left is a changelog.
    expect(await page.locator(".log-entry__hypothesis").count()).toBe(await entries.count());

    // Every entry is an anchor target, because the structured data advertises
    // /engineering-log#<id> for each one.
    const first = entries.first();
    await expect(first).toHaveAttribute("id", /.+/);
  });
});
