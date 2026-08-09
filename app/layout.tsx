import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope, Playfair_Display, DM_Mono } from "next/font/google";
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

/**
 * Fonts are self-hosted via next/font rather than pulled from Google.
 *
 * globals.css used to open with an `@import url(fonts.googleapis.com/...)`,
 * which is the slowest possible way to load a webfont: an `@import` is not
 * discoverable by the preload scanner, so the browser only finds it *after*
 * parsing globals.css, and then has to make two more serial round trips — one
 * to fonts.googleapis.com for the @font-face CSS, another to fonts.gstatic.com
 * for the files — each paying its own DNS + TLS handshake to an origin the
 * page had not otherwise contacted.
 *
 * The visible cost was the LCP gap: production measured FCP at 396ms but LCP
 * at ~830ms, because the hero paragraph painted first in the fallback face and
 * then *repainted* when Manrope finally swapped in, which re-registers LCP at
 * the swap. The fonts were also invisible to our own performance timing
 * (`fontResources: []`) because they were declared in a cross-origin sheet.
 *
 * next/font downloads these at build time and serves them from our own origin,
 * so there is no third-party DNS, no serial CSS chain, and `adjustFontFallback`
 * generates a metric-matched fallback so the swap does not shift layout.
 *
 * Weights are pinned to exactly what the CSS asks for — shipping the full
 * family would waste bytes on faces nothing references.
 */
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

// Italic is included because `h1 em` / `h2 em` are the Playfair italics the
// design leans on; without it the browser would synthesise an oblique.
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
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
        <script
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
            <DeferredLayer />
            <Analytics />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
