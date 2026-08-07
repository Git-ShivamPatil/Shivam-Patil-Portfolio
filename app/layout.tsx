import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Header } from "../components/header";
import { Footer } from "../components/footer";
import { ThemeProvider } from "../components/providers/theme-provider";
import { PageTransition } from "../components/providers/page-transition";
import { SessionProvider } from "../components/providers/session-provider";
import { BackToTop } from "../components/back-to-top";
import { ReferralCapture } from "../components/referral-capture";
import { ScrollReveal } from "../components/providers/scroll-reveal";
import { InteractionLayer } from "../components/providers/interaction-layer";
import { ScrollProgress } from "../components/scroll-progress";
import { ChatWidget } from "../components/chat/chat-widget";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";

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
    <html lang="en" suppressHydrationWarning>
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
            <ScrollReveal />
            <InteractionLayer />
            <ScrollProgress />
            <div className="page-grid" aria-hidden="true" />
            <Header />
            <main id="main-content">
              <PageTransition>{children}</PageTransition>
            </main>
            <Footer />
            <BackToTop />
            <ChatWidget />
            <Toaster
              position="bottom-right"
              // Lifted clear of the chat launcher, which occupies the same
              // corner — otherwise a toast lands on top of it.
              offset="92px"
              toastOptions={{
                style: {
                  background: "var(--bg)",
                  color: "var(--fg)",
                  border: "1px solid var(--line)",
                },
              }}
            />
            <Analytics />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
