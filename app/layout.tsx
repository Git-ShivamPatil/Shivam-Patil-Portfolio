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
import { EntryGate } from "../components/entry/entry-gate";
import { Analytics } from "@vercel/analytics/next";

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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shivamsfolio.com";
const title = "Shivam Patil — Software Engineer";
const description =
  "Portfolio of Shivam Patil, a software engineer building reliable distributed systems and AI products.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Shivam Patil",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body>
        {/* Marks the document as JS-capable before the below-the-fold content
            paints, which is what arms the [data-reveal] start state. Without
            this the reveal styles would apply even when JS never runs, and
            content would stay permanently invisible. */}
        {/* The audience stamp rides along with the reveal stamp because both
            must land before first paint and a second inline script is a second
            parser pause for no gain.

            Reading localStorage here rather than in the EntryGate component is
            what stops a returning visitor seeing a frame of the chooser: a
            React effect runs after paint, so the overlay would flash and then
            vanish on every single navigation to the homepage. The try/catch is
            not defensive dressing — localStorage *throws* on access in Safari's
            private mode rather than returning null, and an uncaught throw here
            would abort the script and take the reveal stamp down with it,
            leaving every [data-reveal] section invisible forever. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.setAttribute("data-reveal-ready","true");try{if(localStorage.getItem("sp:audience"))document.documentElement.setAttribute("data-audience-chosen","true")}catch(e){}`,
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
            {/* Decorative light field behind everything. Sits below the
                grid so the two textures layer rather than compete. */}
            <div className="ambient-backdrop" aria-hidden="true">
              <span className="ambient-blob ambient-blob-1" />
              <span className="ambient-blob ambient-blob-2" />
              <span className="ambient-blob ambient-blob-3" />
            </div>
            <div className="page-grid" aria-hidden="true" />
            <Header />
            <main id="main-content">
              <PageTransition>{children}</PageTransition>
            </main>
            <Footer />
            {/* Rendered after <main>, not before it. The overlay is
                position:fixed so paint order is decided by z-index rather than
                by document order, and keeping the real content first means a
                crawler — and a reader with JavaScript off, for whom the chooser
                never appears at all — meets the page rather than the gate. */}
            <EntryGate />
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
