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

/**
 * Every route reachable from the header, in the order the header lists them.
 *
 * This list was seven entries. The top bar now carries exactly four things —
 * System design, Search, the theme toggle and Contact — and everything else
 * moved into the drawer, so a seven-route header sweep would be asserting a
 * navigation that no longer exists.
 *
 * `.first()` at each call site is load-bearing now in a way it was not before:
 * both of these labels also appear inside the drawer. The drawer is portalled
 * to the end of <body>, so the header's copy is always first in DOM order.
 */
const NAV_ROUTES = [
  { name: "System design", path: "/system-design" },
  { name: "Contact", path: "/contact" },
];

/**
 * Routes that are now reachable ONLY by opening the drawer.
 *
 * The blank-page invariant this file exists for did not get smaller when the
 * links moved — it got a new door. These are sampled across all six drawer
 * groups rather than exhaustive: one static, one `ƒ` dynamic, one ISR, and one
 * of the three routes (/terminal, /compute, /data) that had no <Link> pointing
 * at them anywhere in the repo before the drawer was built.
 */
const DRAWER_ROUTES = [
  { name: "Projects", path: "/projects" },
  { name: "Live stats", path: "/stats" },
  { name: "Skills", path: "/skills" },
  { name: "Terminal", path: "/terminal" },
];

/** Opens the drawer and waits for it to actually be interactive. */
async function openDrawer(page: Page) {
  await page.locator("button.nav-trigger").click();
  // aria-expanded is the contract the assistive layer reads, so it is also the
  // right thing to wait on: `inert` is removed in the same commit, which means
  // a true here guarantees the links inside are reachable.
  await expect(page.locator("button.nav-trigger")).toHaveAttribute("aria-expanded", "true");
}

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
    // The wait is on the driver's own output rather than on a stopwatch. It was
    // a flat 120ms, and that raced: `block: "center"` cannot centre the LAST
    // section, because centring it would mean scrolling past the end of the
    // document, so the browser clamps to max scroll and the element gets
    // whatever settling time is left. When the homepage handed its project grid
    // and about section to /projects and /about it also lost ~2,000px of
    // height, the clamp tightened, and the IntersectionObserver callback began
    // landing after the sleep had already expired — at which point the scroll
    // back to the top took the element out of view and the reveal could never
    // fire at all. It surfaced as "the newsletter section is permanently
    // invisible", which is a real and serious bug, and was not what was
    // happening. Polling the attribute is both deterministic and faster.
    for (const element of document.querySelectorAll("[data-reveal]")) {
      element.scrollIntoView({ block: "center" });
      const deadline = performance.now() + 2000;
      while (element.getAttribute("data-revealed") !== "true" && performance.now() < deadline) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      }
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

  test("every drawer link renders a visible page, clicked not fetched", async ({ page }) => {
    // The same assertion as above, through the door the refactor added. A link
    // that moved from the footer into a portalled overlay is exactly the kind
    // of link that stops being tested by accident.
    await page.goto("/");

    for (const route of DRAWER_ROUTES) {
      await openDrawer(page);
      await page.getByRole("link", { name: route.name, exact: true }).first().click();
      await assertPageIsNotBlank(page, route.path);
    }
  });

  test("the drawer closes on navigation rather than following you", async ({ page }) => {
    // NavDrawer resets `open` as a render-phase adjustment keyed on pathname.
    // If that ever regresses to an effect, the panel stays open over the page
    // it just navigated to and the body scroll lock stays on with it.
    await page.goto("/");
    await openDrawer(page);
    await page.getByRole("link", { name: "Skills", exact: true }).first().click();

    await expect(page.locator("button.nav-trigger")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("aside#site-drawer")).toHaveAttribute("aria-hidden", "true");
    // The lock is released by restoring the PREVIOUS value, not by clearing to
    // "", so the assertion is that the page scrolls — not that the property is
    // any particular string.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
      .not.toBe("hidden");
  });

  test("survives navigating back and forward", async ({ page }) => {
    // The browser's own history navigation remounts the route without a fresh
    // document, which is the same trap by a different door.
    //
    // /about is now reached through the drawer rather than a header link, which
    // makes this a stronger test than it was: the forward navigation remounts a
    // route whose entry point was itself unmounted by the close-on-navigate.
    await page.goto("/");
    await openDrawer(page);
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
  test("a bare /projects is the project index", async ({ page }) => {
    // This asserted a 404 "by design" for as long as the homepage WAS the
    // project listing. That was the thing the IA work set out to undo: a
    // homepage carrying the hero, the full project grid, the about section and
    // the skills marquee is four pages wearing a trench coat, and the listing
    // had no address of its own to link to, sit in the sitemap, or rank.
    //
    // The 404 is kept in the suite as a 200 rather than deleted, because the
    // route's status is exactly what silently regressed the last time
    // app/projects/ changed shape — there was a [slug] directory and no
    // page.tsx, which reads as intentional in a file listing and as a broken
    // link everywhere else.
    const response = await page.goto("/projects");
    expect(response?.status()).toBe(200);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator('a[href^="/projects/"]').first()).toBeVisible();
  });

  test("a project page renders its case study", async ({ page }) => {
    // Starts at /projects, not at /. The homepage listed every project until
    // the IA work; it now points at the index instead of absorbing it, so `/`
    // has no `/projects/<slug>` link on it at all and this used to pass only
    // because the listing happened to live there.
    await page.goto("/projects");
    const projectLink = page.locator('a[href^="/projects/"]').first();
    await projectLink.click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+$/);
    await expect(page.locator("main h1").first()).toBeVisible();
  });
});

/**
 * Layout invariants — the two things the typography and flow work actually
 * promised, asserted at the widths where they broke.
 *
 * Neither of these had any coverage before. The suite could tell you a page
 * was not blank and that every section revealed; it could not tell you the
 * hero heading was 74px inside a 360px viewport, or that half the project
 * cards were sitting 52px down the page on top of the row beneath them.
 */
const WIDTHS = [
  { label: "small phone", width: 360, height: 720 },
  { label: "tablet", width: 768, height: 900 },
  { label: "desktop", width: 1440, height: 900 },
];

test.describe("layout invariants", () => {
  test("the hero heading scales fluidly instead of stepping", async ({ page }) => {
    // The defect this catches: `h1` was clamp(52px, 7.4vw, 108px) — a 52px
    // FLOOR — and a max-width:620px block overrode it with
    // clamp(51px, 16vw, 74px), which is *larger* than the base at the same
    // width. A stale fixed-size @media override winning at some breakpoint is
    // invisible to every other assertion in this file.
    const sizes: number[] = [];

    for (const { width, height } of WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const heading = page.locator("main h1").first();
      await expect(heading).toBeVisible();
      sizes.push(
        await heading.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      );
    }

    const [small, medium, large] = sizes;
    expect(small, `360px hero h1 was ${small}px — too large to wrap cleanly`).toBeLessThanOrEqual(
      56,
    );
    expect(small, `360px hero h1 was ${small}px — collapsed to body copy`).toBeGreaterThan(24);
    expect(medium, "768px must be larger than 360px").toBeGreaterThan(small);
    expect(large, "1440px must be larger than 768px").toBeGreaterThan(medium);
  });

  for (const { label, width, height } of WIDTHS) {
    test(`no overlap and no sideways scroll at ${width}px (${label})`, async ({ page }) => {
      await page.setViewportSize({ width, height });

      for (const path of ["/", "/projects"]) {
        await page.goto(path);
        await revealEverything(page);

        // A page that scrolls sideways is the general symptom of something
        // sitting outside the shell — a translated card, an absolutely
        // positioned label, a grid track wider than its container.
        const overflow = await page.evaluate(() => {
          const root = document.scrollingElement ?? document.documentElement;
          return root.scrollWidth - root.clientWidth;
        });
        expect(
          overflow,
          `${path} at ${width}px scrolls horizontally by ${overflow}px`,
        ).toBeLessThan(2);

        // The specific symptom: .offset-card pushed every odd card down 52px,
        // so rows overlapped whenever the cards were not all the same height.
        const collisions = await page.evaluate(() => {
          const cards = [...document.querySelectorAll(".project-card, .hub-card")];
          const hits: string[] = [];
          for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
              const a = cards[i].getBoundingClientRect();
              const b = cards[j].getBoundingClientRect();
              // 1px of tolerance: adjacent borders can share a subpixel edge
              // after the browser rounds a fractional grid track.
              const overlaps =
                a.left < b.right - 1 &&
                b.left < a.right - 1 &&
                a.top < b.bottom - 1 &&
                b.top < a.bottom - 1;
              if (overlaps) hits.push(`${i}×${j}`);
            }
          }
          return hits;
        });
        expect(collisions, `${path} at ${width}px has overlapping cards`).toEqual([]);
      }
    });
  }
});
