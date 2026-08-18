import { test, expect } from "@playwright/test";

/**
 * The four audience paths, offered inline on the homepage.
 *
 * This file replaces e2e/entry-gate.spec.ts, which tested the same four choices
 * when they were a full-viewport modal shown on every page load. The modal is
 * gone — see the note at the top of components/entry/audience-picker.tsx for
 * why — so the assertions that only made sense for an overlay went with it:
 * "the page underneath is rendered, not withheld", "Escape dismisses it and
 * body scroll is released", "a choice survives navigation but not a refresh".
 * There is no longer anything to dismiss, nothing locking scroll, and no state
 * to survive anything.
 *
 * What is worth keeping is the part that was always about the visitor rather
 * than about the overlay: all four paths are offered, and all four resolve.
 * Both are asserted below, plus the two properties the rewrite was *for* —
 * they are real links, and they do not block the page.
 */

test.describe("the audience picker", () => {
  test("offers all four paths on the homepage", async ({ page }) => {
    await page.goto("/");

    const picker = page.locator(".audience-picker");
    await expect(picker).toBeVisible();

    // Links, not buttons. That is the change: the overlay's options were
    // <button onClick={router.push}>, which could not be opened in a new tab,
    // showed no destination on hover, and were invisible to a crawler.
    await expect(picker.getByRole("link", { name: /hiring/i })).toBeVisible();
    await expect(picker.getByRole("link", { name: /another human being/i })).toBeVisible();
    await expect(picker.getByRole("link", { name: /an AI/i })).toBeVisible();
    await expect(picker.getByRole("link", { name: /theelderbrother/i })).toBeVisible();
  });

  test("nothing covers the page on arrival", async ({ page }) => {
    // The regression this guards. A first-time visitor used to meet a modal
    // over the whole viewport before seeing any of the site; the hero must now
    // be the first thing that is actually hittable.
    await page.goto("/");

    const heading = page.locator("main h1").first();
    await expect(heading).toBeVisible();

    // No fixed, full-viewport element is intercepting the centre of the screen.
    const size = page.viewportSize();
    const atCentre = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.className.toString() : "";
      },
      [Math.round((size?.width ?? 1280) / 2), Math.round((size?.height ?? 720) / 2)],
    );
    expect(atCentre).not.toContain("entry-gate");

    // And the page scrolls, which the overlay's body lock used to prevent.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  });

  test("each card navigates to its path", async ({ page }) => {
    await page.goto("/");
    await page
      .locator(".audience-picker")
      .getByRole("link", { name: /hiring/i })
      .click();

    await expect(page).toHaveURL(/\/for\/recruiter\/?$/);
    await expect(page.locator("main h1").first()).toBeVisible();
  });

  test("every path it offers actually resolves", async ({ page }) => {
    // A picker that routes to a 404 is worse than no picker.
    for (const path of ["/for/recruiter", "/for/human", "/for/ai", "/for/theelderbrother"]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} did not return 200`).toBe(200);
      await expect(page.locator("main h1").first()).toBeVisible();
    }
  });
});
