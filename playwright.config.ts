import { defineConfig, devices } from "@playwright/test";

/**
 * P15 — the layer 185 unit tests structurally cannot be.
 *
 * This suite exists because of one specific bug. For days, **every internal
 * link on this site led to a blank page**: the content was in the DOM and
 * correct, and simply invisible. Every route returned 200 with complete HTML
 * the entire time. The unit tests passed, the build passed, and every route
 * audit up to that point had used `fetch()`, which tests server responses and
 * therefore could not see it. The only thing that could was clicking.
 *
 * So the specs here click. They assert *visibility* rather than presence, and
 * they navigate the way a visitor does rather than by calling `page.goto()` for
 * each route — a `goto` is a fresh document load, which is precisely the case
 * that always worked.
 *
 * **Chromium only.** The bugs this catches are navigation, reveal and contrast
 * bugs, not engine differences. Three browsers would triple the runtime to
 * re-answer a question the first one already answered.
 */

const PORT = Number(process.env.E2E_PORT ?? 3210);

/**
 * Point the suite at a deployment instead of a local build.
 *
 *   E2E_BASE_URL=https://www.shivamsfolio.com pnpm test:e2e
 *
 * The same specs then become a post-deploy smoke test, which is worth more than
 * a second suite written to do only that: the checks that matter after a deploy
 * are the ones that mattered before it. When it is set, no local server is
 * started — see `webServer` below.
 */
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Each spec file is independent; nothing shares state through the database.
  fullyParallel: true,
  // A `.only` left in a file is a whole suite silently not running.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker in CI: the app under test is a single Next server talking to one
  // Neon connection, so more workers means contention, not speed.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",

  use: {
    baseURL,
    // Do Not Track, on every request the suite makes.
    //
    // The analytics ingest honours it before it does anything else, so a run
    // against production cannot write synthetic page views into the owner's
    // real numbers. Synthetic traffic in a dashboard is worse than no smoke
    // test, because the figures then need a mental correction nobody remembers
    // to apply.
    extraHTTPHeaders: { dnt: "1" },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // The reveal drivers are gated on prefers-reduced-motion. Running with
    // motion enabled is the configuration real visitors get and the one the
    // blank-page bug lived in; the reduced-motion path is asserted explicitly
    // in its own test instead.
    //
    // Set through contextOptions rather than as a top-level `use` key: it is a
    // browser-context option in this version, and the top-level spelling type
    // errors under `pnpm typecheck`.
    contextOptions: { reducedMotion: "no-preference" },

    /*
     * The `sp:audience` seed that used to live here is gone with the thing it
     * worked around.
     *
     * EntryGate covered the viewport until a visitor picked a path, so with an
     * empty profile it intercepted every click, took focus and locked body
     * scroll on every route in every spec — twelve specs failed at once in CI
     * for that reason, while passing locally only because a developer's browser
     * had already answered it by hand. Seeding the key was the honest fix for
     * that, and it worked.
     *
     * The overlay itself has since been replaced by an inline section on the
     * homepage (components/entry/audience-picker.tsx), so there is no longer
     * anything covering the viewport and nothing to pre-answer. Keeping the
     * seed would mean every spec still writing a localStorage key that no code
     * on the site reads — a workaround outliving its problem, and the kind of
     * thing that later gets mistaken for a requirement.
     *
     * e2e/audience-picker.spec.ts asserts the replacement, including that
     * nothing covers the page on arrival.
     */
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Skipped entirely when E2E_BASE_URL points somewhere already running.
  webServer: externalBaseURL
    ? undefined
    : {
        // `next start`, not `next dev`. Dev compiles on demand and ships an
        // unminified bundle with different chunking, so a suite run against it
        // proves nothing about what deploys.
        command: `pnpm exec next start -p ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NODE_ENV: "production",
          // Whatever the developer has in .env.local; the suite reads no secrets of
          // its own and asserts nothing that depends on one being present.
          PORT: String(PORT),
        },
      },
});
