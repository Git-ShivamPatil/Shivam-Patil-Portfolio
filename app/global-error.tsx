"use client";

// This file replaces the ENTIRE root layout (app/layout.tsx) when an error is
// thrown above it, so it must render its own <html>/<body> and cannot rely on
// <Header>/<Footer> from the normal layout.
import "./globals.css";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="page-grid" aria-hidden="true" />
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
