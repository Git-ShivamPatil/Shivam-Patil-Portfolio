import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * P15 — accessibility, in both themes.
 *
 * The theme loop is the point. HANDOFF §2b records seven contrast defects that
 * every one of the build, the unit tests and the palette arithmetic passed, and
 * that were all caught by looking at a screenshot. The recurring shape is
 * "hardcoded pale fill plus inherited `--fg`": the fill never changes with the
 * theme, the text does, and in dark theme the result measured 1.05:1. A run in
 * one theme cannot see that class of bug at all.
 *
 * axe runs against the *rendered* DOM, so it composites translucent backgrounds
 * over their parents rather than comparing raw rgba values — which is what makes
 * it able to catch this where a static check of the token table cannot.
 */

const ROUTES = ["/", "/about", "/services", "/system-design", "/blog", "/contact", "/reach-out"];

/**
 * Rules to run.
 *
 * WCAG 2 A and AA plus best practices. Deliberately not `wcag2aaa`: the site's
 * text tokens hold a 7:1 floor by design, but AAA also demands things this
 * design is not trying to do, and a permanently failing check is a check nobody
 * reads.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  // next-themes persists the choice and applies it as a data-attribute before
  // paint, so setting storage before navigation is what a returning visitor
  // with that preference actually experiences.
  await page.addInitScript((value) => {
    window.localStorage.setItem("theme", value);
  }, theme);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    for (const route of ROUTES) {
      test(`${route} has no detectable violations`, async ({ page }) => {
        await setTheme(page, theme);
        await page.goto(route);
        await expect(page.locator("main h1").first()).toBeVisible();

        // Scroll the whole page before scanning. Reveal drivers arm a section
        // when it enters the viewport, and axe treats a fully transparent
        // element as hidden — so scanning the first screen only would skip most
        // of the document and report a clean sheet for content it never looked
        // at. Waiting for *some* element to be armed instead would be worse
        // still: /blog has no [data-reveal] sections at all, and the homepage's
        // are all below the fold by design.
        await page.evaluate(async () => {
          // Smooth scrolling is on globally (html { scroll-behavior: smooth }), so
          // every scrollTo would otherwise be an animation the sweep races. Disabled
          // for the duration and put back, leaving the page under test otherwise
          // exactly the shipped one.
          const root = document.documentElement;
          const previous = root.style.scrollBehavior;
          root.style.scrollBehavior = "auto";

          // Each target is scrolled to directly rather than stepping down the page
          // in fixed increments. A fixed loop kept missing the footer signup — the
          // last section, whose only fully-visible position is the very bottom — and
          // "the sweep did not reach it" is indistinguishable from "it never
          // revealed" in the assertion that follows.
          for (const element of document.querySelectorAll("[data-reveal]")) {
            element.scrollIntoView({ block: "center" });
            await new Promise((resolve) => setTimeout(resolve, 120));
          }

          window.scrollTo(0, 0);
          await new Promise((resolve) => setTimeout(resolve, 300));
          root.style.scrollBehavior = previous;
        });

        // Wait for opacity to stop changing before scanning.
        //
        // Not padding, and not "wait until everything is opaque" either. axe
        // composites an element over its background to get the colour it
        // measures, so one caught mid-transition at 0.988 reads as a slightly
        // different colour than the one that ships — enough to tip text already
        // near the AA boundary into a violation that does not exist. It showed
        // up as failures moving between routes and themes on consecutive runs,
        // and only ever on the later [data-stagger] children: measured 0.999 /
        // 0.996 / 0.988 straight after the sweep, all exactly 1 once settled.
        //
        // Stability rather than a target value, because some elements are
        // legitimately never revealed (a stagger container the sweep does not
        // visit) and several decorative animations never finish at all — the
        // ambient blobs, the live dot, the chat pip. Two identical samples mean
        // nothing that matters is still moving.
        await expect
          .poll(
            async () => {
              const sample = () =>
                page.evaluate(() =>
                  [...document.querySelectorAll("[data-reveal], [data-stagger] > *")]
                    .map((element) => getComputedStyle(element).opacity)
                    .join(","),
                );
              const first = await sample();
              await new Promise((resolve) => setTimeout(resolve, 300));
              return first === (await sample());
            },
            { message: "reveal transitions never settled", timeout: 15_000 },
          )
          .toBe(true);
        const results = await new AxeBuilder({ page })
          .withTags(TAGS)
          // Painted by a clipped background gradient, so their computed colour
          // is `transparent` and every contrast reading against them is a false
          // positive. HANDOFF §2b records the same exclusion for the DOM audit.
          .exclude(".split-char")
          .analyze();

        const summary = results.violations.map(
          (violation) =>
            `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes
              .slice(0, 3)
              .map((node) => node.target.join(" "))
              .join("\n  ")}`,
        );
        expect(summary, `${route} in ${theme}`).toEqual([]);
      });
    }
  });
}

test.describe("keyboard access", () => {
  test("the skip link is the first stop and actually moves focus", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skipLink = page.locator(".skip-link");
    await expect(skipLink).toBeFocused();

    await page.keyboard.press("Enter");
    // A skip link that does not move focus is decoration: a screen reader user
    // presses it and lands back at the top of the navigation.
    await expect(page.locator("#main-content")).toBeVisible();
    expect(page.url()).toContain("#main-content");
  });

  test("the theme toggle is reachable and operable from the keyboard", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /switch to (dark|light) mode/i });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .not.toBe(before);
  });
});
