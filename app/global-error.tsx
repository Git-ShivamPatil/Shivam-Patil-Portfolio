"use client";

// This file replaces the ENTIRE root layout (app/layout.tsx) when an error is
// thrown above it, so it must render its own <html>/<body> and cannot rely on
// <Header>/<Footer> from the normal layout.
import "./globals.css";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // P14. An error that takes out the root layout never reaches a server log —
  // it happened in the browser, after hydration. Reported through our own
  // origin rather than straight to Sentry, so the DSN stays server-side and the
  // CSP's connect-src can stay 'self'. Fire-and-forget: the page is already
  // showing an error screen, and a failed report must not produce a second one.
  useEffect(() => {
    void fetch("/api/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        path: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main>
          <section className="error-page shell">
            <p className="eyebrow">500</p>
            <h1>
              Something broke
              <br />
              on <em>my end.</em>
            </h1>
            <p>
              An unexpected error stopped this page from rendering. It&apos;s already logged — try
              again, or head back to the homepage.
            </p>
            <button type="button" onClick={() => reset()} className="button button-solid">
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
