/**
 * P10 — the counted-download registry.
 *
 * A closed allowlist, not a path parameter. `/d/<slug>` must never be able to
 * redirect to an arbitrary location: an anonymous, un-authenticated endpoint
 * that forwards to whatever the URL says is an open redirect, and the fact
 * that it is "only for downloads" does not change what a phishing link would
 * do with it. Adding a tracked file means adding a line here.
 *
 * `file` is always site-relative, so what leaves this module cannot be an
 * off-site URL even by mistake.
 */
export interface TrackedDownload {
  slug: string;
  /** Site-relative path to the asset in /public. */
  file: string;
  /** Human label, shown in the admin counters table. */
  label: string;
}

export const TRACKED_DOWNLOADS: TrackedDownload[] = [
  {
    slug: "resume",
    file: "/Shivam-Patil-SDE-Resume.pdf",
    label: "Résumé (PDF)",
  },
];

const BY_SLUG = new Map(TRACKED_DOWNLOADS.map((download) => [download.slug, download]));

export function findDownload(slug: string): TrackedDownload | null {
  return BY_SLUG.get(slug.toLowerCase().trim()) ?? null;
}

/** The public URL for a tracked download — always route through the counter. */
export function downloadHref(slug: string): string {
  return `/d/${slug}`;
}
