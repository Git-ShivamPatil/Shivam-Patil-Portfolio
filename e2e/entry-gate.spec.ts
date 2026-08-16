import { test, expect } from "@playwright/test";

/**
 * The audience chooser.
 *
 * Every other spec in this suite runs with the choice pre-seeded in
 * `playwright.config.ts`, because the gate covers the viewport and would
 * otherwise intercept every click in every file. This is the one place that
 * opts back out, so the gate is exercised rather than merely worked around.
 *
 * `storageState` is reset to empty for the whole file — that is what makes
 * these a first-visit test.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("the audience chooser", () => {
  test("greets a first-time visitor with four paths", async ({ page }) => {
    await page.goto("/");

    const gate = page.locator(".entry-gate");
    await expect(gate).toBeVisible();
    await expect(gate.getByRole("button", { name: /hiring/i })).toBeVisible();
    await expect(gate.getByRole("button", { name: /another human being/i })).toBeVisible();
    await expect(gate.getByRole("button", { name: /an AI/i })).toBeVisible();
    await expect(gate.getByRole("button", { name: /theelderbrother/i })).toBeVisible();
  });

  test("the page underneath is rendered, not withheld", async ({ page }) => {
    // The whole reason the gate is an overlay rather than an early return. A
    // crawler, and a reader with JavaScript disabled, must still meet the page
    // — and CLS stays 0 only because a fixed overlay participates in no layout.
    await page.goto("/");
    await expect(page.locator(".entry-gate")).toBeVisible();

    const heading = page.locator("main h1").first();
    await expect(heading).toHaveCount(1);
    expect((await heading.innerText()).trim().length).toBeGreaterThan(8);
  });

  test("choosing a path routes there and is remembered", async ({ page }) => {
    await page.goto("/");
    await page
      .locator(".entry-gate")
      .getByRole("button", { name: /hiring/i })
      .click();

    await expect(page).toHaveURL(/\/for\/recruiter\/?$/);
    await expect(page.locator(".entry-gate")).toHaveCount(0);
    await expect(page.locator("main h1").first()).toBeVisible();

    expect(await page.evaluate(() => localStorage.getItem("sp:audience"))).toBe("recruiter");

    // The point of persisting it: a second visit goes straight in.
    await page.goto("/");
    await expect(page.locator(".entry-gate")).toHaveCount(0);
  });

  test("skipping dismisses it without answering for next time", async ({ page }) => {
    // Skip is "not now", not "never ask again". Persisting it would retire the
    // chooser permanently on one stray Escape.
    await page.goto("/");
    await page.getByRole("button", { name: /just let me look around/i }).click();
    await expect(page.locator(".entry-gate")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("sp:audience"))).toBeNull();

    await page.goto("/");
    await expect(page.locator(".entry-gate")).toBeVisible();
  });

  test("Escape dismisses it and body scroll is released", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".entry-gate")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".entry-gate")).toHaveCount(0);

    // Released by restoring the previous value rather than clearing to "", so
    // the assertion is that the page scrolls — not that the property is any
    // particular string.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
      .not.toBe("hidden");
  });

  test("every path it offers actually resolves", async ({ page }) => {
    // A chooser that routes to a 404 is worse than no chooser.
    for (const path of ["/for/recruiter", "/for/human", "/for/ai", "/for/theelderbrother"]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} did not return 200`).toBe(200);
      await expect(page.locator("main h1").first()).toBeVisible();
    }
  });
});
