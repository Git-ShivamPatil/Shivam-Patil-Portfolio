import { test, expect } from "@playwright/test";

/**
 * How a visitor gets anywhere from the homepage.
 *
 * ### This file has now been rewritten twice, for the same reason both times
 *
 * It began as `entry-gate.spec.ts`, testing four audience choices offered as a
 * full-viewport modal on every page load. It became `audience-picker.spec.ts`
 * when that modal turned into four inline links on the homepage. It is this
 * when the homepage became one screen — a name, a role, a line, and an
 * invitation to press ctrl K — and the picker went with everything else that
 * was on it.
 *
 * The lesson each rewrite taught is the same one, so this version is written to
 * survive the next redesign: **assert the visitor's outcome, not the widget.**
 * The widget has been a modal, a card grid and now a command palette. What has
 * never changed is that a person arriving at `/` must be able to reach the rest
 * of the site, and that the four `/for/*` paths must resolve. Those are what is
 * asserted below.
 *
 * `components/entry/audience-picker.tsx` still exists and still works; nothing
 * renders it. It was left in place rather than deleted because the four paths
 * it offers are still live routes, and putting the picker back on a page is an
 * import rather than a rebuild.
 */

test.describe("getting off the homepage", () => {
  test("the palette hint opens the palette, on a device with no keyboard", async ({ page }) => {
    // The regression this guards is specific and was real for one commit: the
    // homepage's only navigation affordance is the line reading "Press ctrl K
    // to start", and on a phone there is no ctrl key to press. If that line is
    // not a real button, a touch visitor arrives at a page they cannot leave.
    await page.goto("/");

    await expect(page.locator(".palette")).toHaveCount(0);
    await page.getByRole("button", { name: /to start/i }).click();

    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    // Focus lands in the input, not merely somewhere inside the dialog —
    // otherwise the first thing typed goes nowhere.
    await expect(palette.getByRole("combobox")).toBeFocused();
  });

  test("the palette actually navigates", async ({ page }) => {
    // A palette that opens and lists routes but does not route is the exact
    // shape of the dead features §32 was written about: it renders perfectly.
    await page.goto("/");
    await page.getByRole("button", { name: /to start/i }).click();

    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("projects");
    await palette.getByRole("combobox").press("Enter");

    await expect(page).toHaveURL(/\/projects\/?$/);
    await expect(page.locator("main h1").first()).toBeVisible();
  });

  test("the header offers the primary routes without JavaScript running", async ({ page }) => {
    // The header nav is server-rendered, and it is now the ONLY server-rendered
    // navigation on the site: the footer directory was removed at the owner's
    // request, and the nav drawer portals into <body> after mount so it
    // contributes nothing to the HTML.
    //
    // This asserts the five that survive, deliberately and narrowly. It used to
    // also assert /engineering-log as a stand-in for "the long tail has inbound
    // links" — that is no longer true by design, and leaving the assertion in
    // as something that happens to pass would misreport what this file checks.
    // The long tail's reachability is sitemap.xml and /llms.txt now, which
    // e2e/labs.spec.ts covers.
    const response = await page.goto("/");
    const html = (await response?.text()) ?? "";

    for (const href of ["/about", "/projects", "/skills", "/reach-out", "/system-design"]) {
      expect(html, `${href} is not in the server HTML`).toContain(`href="${href}"`);
    }
  });

  test("the header puts System design last, after Send me a message", async ({ page }) => {
    // Order is the ask, so order is what is asserted. PRIMARY_ORDER in
    // lib/site-routes.ts is what makes this hold; without it the bar inherits
    // the order entries happen to sit in that file, which put /system-design
    // third because it is declared two hundred lines above /reach-out.
    await page.goto("/");

    const labels = await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link")
      .allTextContents();

    expect(labels.map((text) => text.trim())).toEqual([
      "About me",
      "Projects",
      "What I know",
      "Send me a message",
      "System design",
    ]);
  });

  test("nothing covers the page on arrival", async ({ page }) => {
    // Kept verbatim from the modal era, because the regression it guards is
    // permanent: a first-time visitor used to meet an overlay over the whole
    // viewport before seeing any of the site.
    await page.goto("/");

    const heading = page.locator("main h1").first();
    await expect(heading).toBeVisible();

    const size = page.viewportSize();
    const atCentre = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.className.toString() : "";
      },
      [Math.round((size?.width ?? 1280) / 2), Math.round((size?.height ?? 720) / 2)],
    );
    expect(atCentre).not.toContain("entry-gate");
    expect(atCentre).not.toContain("palette-backdrop");

    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  });

  test("every audience path still resolves", async ({ page }) => {
    // These four routes outlived the widget that used to point at them. They
    // are still in the sitemap, the footer directory and the palette, so a
    // 404 on any of them is a broken promise made in three places.
    for (const path of ["/for/recruiter", "/for/human", "/for/ai", "/for/theelderbrother"]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} did not return 200`).toBe(200);
      await expect(page.locator("main h1").first()).toBeVisible();
    }
  });
});
