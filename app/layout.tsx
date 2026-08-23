import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { Header } from "../components/header";
import { Footer } from "../components/footer";
import { ThemeProvider } from "../components/providers/theme-provider";
import { PageTransition } from "../components/providers/page-transition";
import { SessionProvider } from "../components/providers/session-provider";
import { ReferralCapture } from "../components/referral-capture";
import { AnalyticsTracker } from "../components/analytics-tracker";
import { ScrollReveal } from "../components/providers/scroll-reveal";
import { SplitText } from "../components/providers/split-text";
// Everything that isn't needed for the first frame — cursor, tilt, scroll
// progress, back-to-top, chat launcher, toaster — moved behind an idle gate.
// See the file for what stayed behind and why.
import { DeferredLayer } from "../components/providers/deferred-layer";
import { Analytics } from "@vercel/analytics/next";
import { person, siteUrl } from "../lib/seo/site";

/**
 * One font. Manrope, vendored, variable, latin-only.
 *
 * **This file used to load three families** — Manrope for body, Playfair
 * Display for the italic `<em>` in headings, DM Mono for every eyebrow, chip
 * and table cell. Four `.woff2` files, three `@font-face` blocks, three
 * fallback metrics to keep in sync. They are gone, and the reasoning is worth
 * keeping because it is not a taste argument:
 *
 * - **Playfair earned nothing.** It appeared in exactly five CSS rules, all of
 *   them `h1 em` / `h2 em`. A serif italic inside a geometric sans heading is
 *   a second voice competing with the first at the largest type size on the
 *   page. The contrast it was providing is now carried by weight (700 against
 *   400) and tracking (-0.055em against 0), which is contrast the reader
 *   parses as hierarchy rather than as a different typeface.
 *
 * - **DM Mono was doing a job a monospace should not do.** 114 `--font-dm-mono`
 *   references and 82 hardcoded `"DM Mono"` ones, and almost none of them were
 *   code — they were 8-to-12px uppercase labels where the monospace was
 *   standing in for letter-spacing. Uppercase at 10px with 0.1em tracking
 *   reads as a label in *any* family; it did not need its own download.
 *
 * The three fixes recorded below still hold and still matter, so the history
 * stays:
 *
 * **First (10 Aug): the `@import` had to go.** globals.css used to open with
 * `@import url(fonts.googleapis.com/...)`, the slowest possible way to load a
 * webfont. An `@import` is invisible to the preload scanner, so the browser
 * only found it *after* parsing globals.css and then made two more serial
 * cross-origin round trips — googleapis for the `@font-face` CSS, gstatic for
 * the files — each paying its own DNS and TLS handshake. Production measured
 * FCP at 396ms and LCP at ~830ms, because the hero paragraph painted in the
 * fallback face and then *repainted* when Manrope swapped in, which
 * re-registers LCP at the swap.
 *
 * **Second (13 Aug): `next/font/google` had to go too.** It fixed the runtime
 * but kept a build-time dependency on Google, and that dependency broke:
 * Google began returning 404 for four of the Playfair Display files its own
 * stylesheet points at, and `next build` failed with "Module not found:
 * @vercel/turbopack-next/internal/font/google/font". Reproducible, not
 * transient. A build that cannot run because a third party is having a bad day
 * is the same class of problem CI's missing database was built to rule out.
 *
 * **Third (this pass): two of the three files stopped being downloaded at
 * all.** Playfair (two faces, roman and italic) and DM Mono (two weights — it
 * is not variable, so it genuinely needed a file each) are deleted from
 * `app/fonts/`. What ships is one variable file covering 400-800.
 *
 * `adjustFontFallback` still generates a metric-matched fallback from the font
 * file's own metrics, which is what protects the existing CLS of 0.
 */
const manrope = localFont({
  src: [{ path: "./fonts/manrope-variable.woff2", weight: "400 800", style: "normal" }],
  variable: "--font-manrope",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["Arial", "sans-serif"],
});

/**
 * Site-wide metadata defaults.
 *
 * **`title` is a template now, and that is the change that made the rest of the
 * SEO pass possible.** It used to be a plain string, so every page that wanted
 * its own title had to write the suffix out by hand — "About — Shivam Patil",
 * "Skills — Shivam Patil", thirty times. Three consequences followed from that,
 * and all three were live:
 *
 * - A page that set only `title: "Compute"` would have rendered without the
 *   name at all, so nobody dared, so every page carried the duplication.
 * - The duplication drifted. "API — Shivam Patil" titled a page called "API
 *   lab"; "Retrieval quality — Shivam Patil" titled /mlops.
 * - `alternates`, `openGraph` and `robots` were NOT inherited in practice
 *   either, because a page that declares `openGraph` replaces the parent's
 *   whole object rather than merging into it — and no page below the root
 *   declared one. Every link to any page but the homepage unfurled with the
 *   homepage's title and description.
 *
 * With `template` here, a page passes "About" and gets "About — Shivam Patil".
 * `default` is what the homepage and any page without its own title fall back
 * to. lib/seo/metadata.ts builds the rest of the tags from the same two
 * strings, so the openGraph/twitter pair can no longer be silently omitted.
 *
 * The description here is the fallback only; every public route now sets its
 * own. A single site-wide description means thirty pages competing in search
 * results with identical copy, which is the one thing a description must not be.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${person.name} — ${person.jobTitle}`,
    template: `%s — ${person.name}`,
  },
  description:
    "Shivam Patil is a software engineer building high-throughput backend platforms, distributed systems and AI products in C++, Rust, Go and Python.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: person.name,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
  /**
   * Search Console ownership, from an environment variable.
   *
   * **There is no Search Console property for this domain.** Signing in and
   * opening Search Console lands on the "Add a website" welcome screen, and a
   * `site:shivamsfolio.com` query returns Google's own "Do you own
   * shivamsfolio.com?" promotion. So the sitemap has never been submitted, no
   * coverage report exists to explain which URLs are not indexed, and no
   * performance history is being recorded — that last one is not recoverable
   * later, because Search Console only reports from the day a property is
   * verified onward.
   *
   * Verifying needs an account action, which is the owner's to take. This field
   * removes the only part that would otherwise need a code change and a deploy:
   * paste the token into `GOOGLE_SITE_VERIFICATION` in the Vercel project's
   * environment variables and redeploy, and the meta tag appears.
   *
   * Undefined when unset, so nothing is rendered rather than an empty tag —
   * Google treats a `google-site-verification` with no content as a failed
   * verification rather than an absent one.
   */
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
  // Tells Google it may show the full description and a large image preview
  // rather than truncating to its own default. Absent, the preview length is
  // the crawler's guess.
  other: { "max-image-preview": "large" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `data-theme="dark"` is rendered by the SERVER, and that is the whole
    // point of it being here rather than only in the provider.
    //
    // next-themes sets this attribute from an inline script, which covers
    // everyone whose JavaScript runs. Without a server-rendered value, anyone
    // whose does not — a crawler, a text browser, a reader with scripting off,
    // or simply the frames before that script executes — gets a document with
    // no attribute at all, and the cascade falls through to the light `:root`
    // block. The default would then be dark for most people and light for the
    // rest, which is not a default.
    //
    // `suppressHydrationWarning` is what makes it safe: the script may rewrite
    // this to "light" for someone with a stored preference, so the server and
    // the first client render legitimately disagree about it.
    <html lang="en" className={manrope.variable} data-theme="dark" suppressHydrationWarning>
      <body>
        {/* Marks the document as JS-capable before the below-the-fold content
            paints, which is what arms the [data-reveal] start state. Without
            this the reveal styles would apply even when JS never runs, and
            content would stay permanently invisible.

            This used to carry a second statement: a localStorage read that
            stamped `data-audience-chosen` to suppress the entry-gate overlay
            before first paint. Both the overlay and the key it read are gone —
            the four audience paths are an inline section on the homepage now
            (components/entry/audience-picker.tsx) — so the read had nothing
            left to suppress. What remains is one attribute write, which is
            also why the try/catch went with it: `setAttribute` does not throw,
            and only the localStorage access ever could. */}
        <script
          // sast-ignore: dangerous-html — a compile-time constant with no interpolation of any kind, so there is no input to sanitise.
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.setAttribute("data-reveal-ready","true")`,
          }}
        />
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <ThemeProvider>
          <SessionProvider>
            <ReferralCapture />
            {/* P10. Sits beside ReferralCapture rather than replacing Vercel's
                <Analytics /> below: that one answers "how many views", this one
                answers "where did they click, how far did they read, and did
                they take the résumé" — questions no third party can see. */}
            <AnalyticsTracker />
            <ScrollReveal />
            <SplitText />
            {/* Two decorative backdrop layers used to sit here: three
                46vw blurred colour washes, and a 40px graph-paper grid over
                the whole viewport. Both are gone.

                They were the largest tinted surfaces on the site — the
                washes' own comment in theme-visuals.css records that they,
                not the accent tokens, were what actually decided each theme's
                cast — so a monochrome brief cannot leave them in any colour,
                and a grey wash behind a grey page is a blur filter running on
                every frame for nothing. The grid went with them under the
                same brief: it is texture with no meaning, and this design's
                ground is flat. */}
            <Header />
            <main id="main-content">
              <PageTransition>{children}</PageTransition>
            </main>
            <Footer />
            <DeferredLayer />
            {/* Rendered only on Vercel, because its script is served by Vercel's
                edge at /_vercel/insights/script.js and exists nowhere else. Off
                the platform — a local `next start`, the Docker image, CI — that
                path 404s and then fails strict MIME checking, so every page
                logged two console errors for a feature that could not work
                there anyway. Lighthouse counts those against best-practices,
                which is how a category pinned at 1.0 sat at 0.96 site-wide.

                Read on the server, so the flag is resolved at build time for
                static routes; `process.env.VERCEL` is set on every Vercel
                build and deployment, so production is unaffected. */}
            {process.env.VERCEL ? <Analytics /> : null}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
