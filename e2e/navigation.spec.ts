import { test, expect, type Page } from "@playwright/test";

/**
 * P15 — the blank-page regression suite.
 *
 * Read HANDOFF §2z before changing anything here. The bug this exists for:
 * `PageTransition` wraps routes in `<AnimatePresence mode="wait">`, so the
 * outgoing page stays mounted until its exit animation finishes and the
 * incoming page is not in the DOM yet — while `ScrollReveal` ran its effect on
 * `pathname`, which changes the moment navigation commits. The effect fired,
 * found only the *outgoing* page's `[data-reveal]` elements, and cleaned up.
 * Nothing was watching when the new subtree mounted, so every section kept its
 * `opacity: 0` start state forever.
 *
 * Two things make these assertions meaningful rather than decorative:
 *
 * 1. **They click.** A `page.goto()` per route is a fresh document load, which
 *    is exactly the case that always worked and would have passed throughout
 *    the outage.
 * 2. **They assert `data-revealed`, not computed opacity.** A pane that is not
 *    compositing frames produces no transitions, so `getComputedStyle` reports
 *    the pre-transition value and lies about a page that is visibly fine. The
 *    attribute is set by the driver: `null` means the driver never ran, which
 *    is the actual bug.
 */

/** Every route reachable from the header, in the order the header lists them. */
const NAV_ROUTES = [
  { name: "Services", path: "/services" },
  { name: "Stats", path: "/stats" },
  { name: "Blog", path: "/blog" },
  { name: "Ask", path: "/ask" },
  { name: "System design", path: "/system-design" },
  { name: "About", path: "/about" },
  { name: "Contact", path: "/contact" },
];

/**
 * Elements currently inside the viewport that the reveal driver has not armed.
 *
 * **This, and not "some element got armed", is the invariant.** Two facts make
 * the looser version wrong, and both were found by writing it that way first:
 *
 * - `/blog` has no `[data-reveal]` sections at all, so "at least one armed"
 *   can never be satisfied there and would fail a page that is perfectly fine.
 * - The homepage's four sections are all *below* the fold. HANDOFF §2a is
 *   explicit that below-fold sections sitting at `opacity: 0` before you scroll
 *   to them is the design working — waiting for them without scrolling is
 *   waiting for something that must not happen.
 *
 * What is a bug is an element the visitor can *see* that never revealed: space
 * on screen with no content in it. That is the shape of the second-order
 * `/reach-out` defect, where `.channel-list` settled just under the
 * immediate-reveal threshold and then fell through to an IntersectionObserver
 * ratio an element straddling the fold cannot meet.
 */
async function unrevealedInViewport(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // "Substantially on screen", not "intersecting by a pixel". The next
    // section peeking over the bottom edge is the design: it reveals as the
    // visitor scrolls to it, which is the entire point of the effect. Measured
    // on /services, three cards sit at top 674 in a 720px viewport — a 46px
    // sliver of a 300px card — and flagging those would make this assertion
    // fire on every page that has anything below the fold.
    //
    // The threshold is the *top edge*, because the failure being caught is an
    // element whose beginning the visitor is looking at and whose content is
    // not there. /reach-out's `.channel-list` settled at top 485 against a
    // 720px viewport when it broke, which this catches and the sliver rule
    // would have drowned in noise.
    const clearlyVisible = window.innerHeight * 0.75;
    return [...document.querySelectorAll("[data-reveal]")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const onScreen = box.top < clearlyVisible && box.bottom > 0 && box.height > 0;
        return onScreen && element.getAttribute("data-revealed") !== "true";
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 80));
  });
}

async function assertPageIsNotBlank(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}/?$`));

  // The h1 must be *visible*, not merely present. Presence is what the whole
  // outage had.
  const heading = page.locator("main h1").first();
  await expect(heading, `${path}: no visible <h1>`).toBeVisible();
  await expect(heading).not.toHaveText("");

  // Polled rather than checked once: the drivers re-scan on the frame after
  // each mutation batch, because measuring before layout settles (fonts not
  // applied, images without their space) reports a lower position and misses
  // the threshold.
  await expect
    .poll(() => unrevealedInViewport(page), {
      message: `${path}: content on screen that the reveal driver never armed`,
      timeout: 10_000,
    })
    .toEqual([]);
}

/**
 * Scroll the whole page so every reveal driver fires, then return to the top.
 *
 * Used where the assertion is about the *whole* document rather than the first
 * screen of it.
 */
async function revealEverything(page: Page) {
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
}

test.describe("client-side navigation", () => {
  test("every header link renders a visible page, clicked not fetched", async ({ page }) => {
    await page.goto("/");
    await assertPageIsNotBlank(page, "/");

    for (const route of NAV_ROUTES) {
      await page.getByRole("link", { name: route.name, exact: true }).first().click();
      await assertPageIsNotBlank(page, route.path);
    }
  });

  test("survives navigating back and forward", async ({ page }) => {
    // The browser's own history navigation remounts the route without a fresh
    // document, which is the same trap by a different door.
    await page.goto("/");
    await page.getByRole("link", { name: "About", exact: true }).first().click();
    await assertPageIsNotBlank(page, "/about");

    await page.goBack();
    await assertPageIsNotBlank(page, "/");

    await page.goForward();
    await assertPageIsNotBlank(page, "/about");
  });

  test("returning to a route a second time still reveals it", async ({ page }) => {
    // A driver that arms an element once and never re-arms it passes a
    // single-pass sweep and fails a real visit.
    await page.goto("/");
    for (let visit = 0; visit < 2; visit++) {
      await page.getByRole("link", { name: "Contact", exact: true }).first().click();
      await assertPageIsNotBlank(page, "/contact");
      await page.getByRole("link", { name: "Shivam Patil home" }).first().click();
      await assertPageIsNotBlank(page, "/");
    }
  });

  test("scrolling a route reveals every section it has", async ({ page }) => {
    // The complement of the viewport check above: nothing may be permanently
    // stranded further down the page either. Run on the homepage because its
    // four sections are all below the fold, which is exactly the case the
    // viewport assertion deliberately does not cover.
    await page.goto("/");
    await revealEverything(page);

    const stranded = await page.evaluate(() =>
      [...document.querySelectorAll("[data-reveal]")]
        .filter((element) => element.getAttribute("data-revealed") !== "true")
        .map((element) => element.className.slice(0, 60)),
    );
    expect(stranded, "sections that never revealed even after scrolling past them").toEqual([]);
  });

  test("the split-text heading resolves to readable characters", async ({ page }) => {
    await page.goto("/");
    // SplitText had the identical MutationObserver flaw. Its failure was
    // cosmetic — an unsplit heading is plain visible text — which meant the
    // signature reveal only ever played on a full page load and nobody noticed.
    const heading = page.locator("h1[data-split]").first();
    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute("data-split-revealed", "true", { timeout: 10_000 });
    // Whatever the animation is doing, the text has to be there for a screen
    // reader and for a visitor with the animation midway.
    expect((await heading.innerText()).replace(/\s+/g, " ").trim().length).toBeGreaterThan(8);
  });
});

test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("shows every section without waiting for an animation", async ({ page }) => {
    // The reduced-motion block blanket-cancels animations. HANDOFF records that
    // every `opacity: 0` base in the codebase is transition-driven rather than
    // animation-driven, precisely so nothing is stranded invisible here — this
    // is that claim, checked.
    await page.goto("/");
    const heading = page.locator("main h1").first();
    await expect(heading).toBeVisible();

    const invisible = await page.evaluate(() =>
      [...document.querySelectorAll("[data-reveal]")]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          if (box.top >= window.innerHeight || box.bottom <= 0) return false;
          return Number(getComputedStyle(element).opacity) < 0.9;
        })
        .map((element) => element.className.slice(0, 60)),
    );
    expect(invisible, "content stranded invisible under prefers-reduced-motion").toEqual([]);
  });
});

test.describe("routes that must keep behaving", () => {
  test("a bare /projects is a 404 by design, not a regression", async ({ page }) => {
    // There is no projects index page: the homepage is the project listing.
    const response = await page.goto("/projects");
    expect(response?.status()).toBe(404);
  });

  test("a project page renders its case study", async ({ page }) => {
    await page.goto("/");
    const projectLink = page.locator('a[href^="/projects/"]').first();
    await projectLink.click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+$/);
    await expect(page.locator("main h1").first()).toBeVisible();
  });
});
