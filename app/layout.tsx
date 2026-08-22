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
 * Fonts are vendored into the repo and loaded with `next/font/local`.
 *
 * The history matters, because two different things have been fixed here and
 * only the second one is visible in this file's imports.
 *
 * **First (10 Aug): the `@import` had to go.** globals.css used to open with
 * `@import url(fonts.googleapis.com/...)`, which is the slowest possible way to
 * load a webfont. An `@import` is invisible to the preload scanner, so the
 * browser only found it *after* parsing globals.css and then made two more
 * serial cross-origin round trips — googleapis for the `@font-face` CSS,
 * gstatic for the files — each paying its own DNS and TLS handshake. Production
 * measured FCP at 396ms and LCP at ~830ms, because the hero paragraph painted
 * in the fallback face and then *repainted* when Manrope swapped in, which
 * re-registers LCP at the swap.
 *
 * **Second (13 Aug): `next/font/google` had to go too.** It fixed the runtime
 * but kept a build-time dependency on Google, and that dependency broke: Google
 * began returning 404 for four of the Playfair Display files its own stylesheet
 * points at, and `next build` failed with "Module not found:
 * @vercel/turbopack-next/internal/font/google/font". Reproducible, not
 * transient — every build failed the same four faces while the equivalent URLs
 * fetched by hand returned 200. A build that cannot run because a third party
 * is having a bad day is the same class of problem CI's missing database was
 * built to rule out.
 *
 * So the files live in `app/fonts/` and the build touches no network at all.
 * Manrope and Playfair are variable fonts — one file covers the whole weight
 * range, which is why there is no file per weight — and only the latin subset
 * is vendored, since nothing on this site renders cyrillic or vietnamese.
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

// Italic is vendored because `h1 em` / `h2 em` are the Playfair italics the
// design leans on; without a real italic the browser synthesises an oblique.
const playfair = localFont({
  src: [
    { path: "./fonts/playfair-display-variable.woff2", weight: "600 700", style: "normal" },
    { path: "./fonts/playfair-display-variable-italic.woff2", weight: "600 700", style: "italic" },
  ],
  variable: "--font-playfair",
  display: "swap",
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "serif"],
});

// DM Mono is not a variable font, so it genuinely needs a file per weight.
const dmMono = localFont({
  src: [
    { path: "./fonts/dm-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-dm-mono",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["ui-monospace", "monospace"],
});

const fontVariables = `${manrope.variable} ${playfair.variable} ${dmMono.variable}`;

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
    <html lang="en" className={fontVariables} data-theme="dark" suppressHydrationWarning>
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
