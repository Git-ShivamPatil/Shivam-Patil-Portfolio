import type { ReactNode } from "react";
import "./disclosure.css";

/**
 * Click-to-open sections, built on `<details>` / `<summary>`.
 *
 * **Why the native element rather than a React accordion.** Three of this
 * project's constraints all point at the same answer, and only the native
 * element satisfies all three:
 *
 * - **It is a server component.** An accordion built on `useState` would drag
 *   a `"use client"` boundary onto every page that wants one — /system-design,
 *   /security, /reliability, /experience, /skills — and each of those is
 *   currently rendered entirely on the server. `<details>` needs no JavaScript
 *   at all, so those pages stay server components and ship nothing new.
 *
 * - **The content stays in the DOM, open or closed.** A crawler reads a closed
 *   `<details>` the same way it reads an open one; content behind a
 *   `hidden`-toggled React panel is weaker. Since collapsing these pages is
 *   partly *for* search — a page a reader actually finishes is a page that
 *   ranks — hiding the text from the crawler to reveal it to the reader would
 *   defeat the point.
 *
 * - **The accessibility is the browser's, not ours.** `<summary>` is already a
 *   button, already focusable, already toggles on Enter and Space, and already
 *   announces its expanded state. Every hand-rolled accordion has to reimplement
 *   that, and most get the state announcement wrong.
 *
 * `name` groups several disclosures into an exclusive set — opening one closes
 * its siblings, the accordion behaviour, still with no JavaScript. It is left
 * undefined by default because independent sections are the more common want:
 * a reader comparing two failure modes should be able to hold both open.
 */
export function Disclosure({
  summary,
  hint,
  children,
  defaultOpen = false,
  name,
  tone = "default",
}: {
  /** The always-visible line. Keep it a real question or a claim, not a noun. */
  summary: string;
  /** Optional right-aligned metadata — a count, a duration, a verdict. */
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Shared name makes a group mutually exclusive (native accordion). */
  name?: string;
  tone?: "default" | "accent";
}) {
  return (
    <details className="disclosure" data-tone={tone} open={defaultOpen} name={name}>
      <summary className="disclosure-summary">
        <span className="disclosure-summary-text">{summary}</span>
        {hint ? <span className="disclosure-hint">{hint}</span> : null}
        {/* aria-hidden because <summary> already announces expanded/collapsed;
            without it a screen reader says the state twice. */}
        <span className="disclosure-chevron" aria-hidden="true" />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

/**
 * Wrapper that gives a run of disclosures one border and one rhythm, so eight
 * of them read as a single list rather than eight floating cards.
 */
export function DisclosureGroup({
  children,
  label,
}: {
  children: ReactNode;
  /** Announced to screen readers; the visible heading stays the caller's job. */
  label?: string;
}) {
  return (
    <div className="disclosure-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}
