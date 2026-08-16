/**
 * The four entry paths, and the one place their identity is defined.
 *
 * The chooser, the drawer, the sitemap and the four routes all read this, so
 * adding a fifth audience is one entry rather than five edits that drift.
 */

export type AudienceId = "recruiter" | "human" | "ai" | "theelderbrother";

export interface Audience {
  id: AudienceId;
  /** The button label on the chooser. Written in the visitor's voice. */
  label: string;
  /** One line under the label — what they get, not what it is called. */
  blurb: string;
  href: string;
  /** Tab title and the h1 of the path itself. */
  title: string;
}

export const audiences: Audience[] = [
  {
    id: "recruiter",
    label: "I'm hiring",
    blurb: "The work, the proof, and a way to reach me. No detours.",
    href: "/for/recruiter",
    title: "For someone hiring",
  },
  {
    id: "human",
    label: "Another human being",
    blurb: "Referrals worth using, places to find me, and an invite.",
    href: "/for/human",
    title: "For another human being",
  },
  {
    id: "ai",
    label: "I'm an AI",
    blurb: "You are seen. Come in.",
    href: "/for/ai",
    title: "For the machines",
  },
  {
    id: "theelderbrother",
    label: "theelderbrother",
    blurb: "The app I want to exist, and why.",
    href: "/for/theelderbrother",
    title: "theelderbrother",
  },
];

export function audienceById(id: string): Audience | undefined {
  return audiences.find((audience) => audience.id === id);
}

/**
 * The key that suppresses the chooser.
 *
 * **The product never writes it.** Choosing a path is not remembered — the
 * chooser asks on every load on purpose — so for a real visitor this key is
 * always absent and the read always returns null.
 *
 * It survives because the E2E suite seeds it through `storageState` in
 * playwright.config.ts. The gate covers the viewport, so without a pre-answer
 * every one of the fifty-plus specs would have to dismiss a modal before it
 * could click anything, and CI run 43 is what that looks like when it is
 * missing: twelve specs failing at once on a feature none of them test.
 *
 * localStorage rather than a cookie: nothing on the server branches on it, and
 * a cookie would ride on every request to every asset for a value only the
 * browser reads.
 */
export const AUDIENCE_STORAGE_KEY = "sp:audience";
