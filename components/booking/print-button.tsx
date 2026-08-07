"use client";

/**
 * Print / save-as-PDF trigger.
 *
 * Uses the browser's own print pipeline rather than generating a PDF
 * server-side: the invoice is already a styled HTML document, and every
 * browser's "Save as PDF" produces a better result than a hand-rolled
 * renderer would — with no extra dependency and nothing to keep in sync.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      className="button button-solid invoice-print"
      onClick={() => window.print()}
      data-ripple
    >
      Print / Save PDF
    </button>
  );
}
