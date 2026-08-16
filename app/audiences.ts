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
 * Where the visitor's choice is remembered.
 *
 * localStorage rather than a cookie: nothing on the server needs to branch on
 * it, and a cookie would be sent on every request to every asset for a value
 * only the chooser reads. It is also not personal data under any reading,
 * which keeps the first-party analytics promise in §P10 intact — no consent
 * banner is owed for a key that stores the string "recruiter".
 */
export const AUDIENCE_STORAGE_KEY = "sp:audience";
