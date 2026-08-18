/**
 * Every public route on this site, in one place, described in words a
 * non-engineer can act on.
 *
 * ### Why this file exists
 *
 * The route map used to be written out three times, and the three copies had
 * already drifted apart:
 *
 * - `components/nav/nav-drawer.tsx` held nineteen links in six groups.
 * - `app/page.tsx` held eight hub cards, a different eight.
 * - `app/sitemap.ts` held a seventeen-entry `staticRoutes` array, a different
 *   seventeen — it listed the four `/for/*` pages the drawer omits, and omitted
 *   ten routes the drawer lists.
 *
 * That last one was not a tidiness problem. Diffing the routes on disk against
 * the sitemap's array found **ten real, indexable pages absent from the sitemap
 * entirely**: /api-lab, /compute, /data, /edge, /mlops, /reliability,
 * /security, /services, /stats and /terminal. Each is a `page.tsx` that
 * renders, sets its own metadata, and says nothing about being private — and
 * none of them was being declared to a crawler. Since the same ten are also
 * reachable only from a JavaScript-driven drawer, the sitemap was their only
 * realistic discovery path, and it did not list them.
 *
 * Three hand-maintained lists of the same thing is three chances to forget one.
 * Now there is one list, and the sitemap, the drawer, the footer directory and
 * the homepage hub are all views onto it. Adding a route means adding it here.
 *
 * ### Why every entry carries a `blurb`
 *
 * The brief for this pass was that the site should be navigable by "a four year
 * old and an eighty year old". A bare link labelled "MLOps" or "Compute lab" or
 * "Edge & offline" fails that test completely — those are category names from
 * inside the industry, and they tell a visitor nothing about what they will get
 * for the click. So each route carries:
 *
 * - `label` — plain language, chosen so the words describe the thing rather
 *   than naming its discipline. "Retrieval quality" became "How good are the
 *   answers?"; "Compute lab" became "Run code in your browser".
 * - `blurb` — one sentence, under ~70 characters, rendered under the label
 *   everywhere there is room. This is what turns a menu into a directory.
 * - `technicalLabel` — the discipline name, kept rather than discarded. A
 *   recruiter searching the page for "SRE" or "MLOps" should still find it, and
 *   the terms are real signal for search. It renders as secondary text, so the
 *   plain words lead and the jargon confirms.
 *
 * ### Why `priority` and `changeFrequency` live here too
 *
 * Because they are facts about the route, and keeping them next to the route is
 * what stops the sitemap from being a second place to remember things. The
 * previous sitemap gave every non-hub route a blanket 0.7 — /resume and
 * /for/theelderbrother were declared equally important, which is not what
 * anyone believes.
 */

export type RouteGroupId = "start" | "work" | "proof" | "writing" | "hire" | "elsewhere";

export interface SiteRoute {
  href: string;
  /** Plain language. What a visitor gets, not what discipline it belongs to. */
  label: string;
  /** One sentence, under ~70 chars. Rendered beneath the label. */
  blurb: string;
  /** The industry name for the same thing. Secondary text, and search signal. */
  technicalLabel?: string;
  group: RouteGroupId;
  /**
   * `false` only on the server-rendered routes. A prefetch on those is a full
   * server render plus Neon queries for a page nobody asked for — measured at
   * 538ms (/services), 568ms (/stats) and 384ms (/search) of pure waste. The
   * static and ISR routes come off the CDN, so their prefetch is free.
   */
  prefetch?: false;
  /** Absent from the sitemap. Set on routes whose own metadata says noindex. */
  noIndex?: true;
  /** Sitemap priority. Defaults to 0.6 when unset — see sitemapEntries(). */
  priority?: number;
  changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  /** Shown in the compact top-bar nav. Four at most, or it stops being compact. */
  primary?: true;
}

export const ROUTE_GROUPS: { id: RouteGroupId; label: string; blurb: string }[] = [
  { id: "start", label: "Start here", blurb: "Who I am, in one page each." },
  { id: "work", label: "My work", blurb: "What I have built and where I have worked." },
  {
    id: "proof",
    label: "See it running",
    blurb: "Live demos you can click. Everything here really runs.",
  },
  { id: "writing", label: "Writing", blurb: "Notes on systems, in long form." },
  { id: "hire", label: "Work with me", blurb: "Two ways to start a conversation." },
  { id: "elsewhere", label: "Elsewhere", blurb: "Profiles off this site." },
];

export const SITE_ROUTES: SiteRoute[] = [
  /* ---------- start here ---------- */
  {
    href: "/",
    label: "Home",
    blurb: "The short version, and a map of everything else.",
    group: "start",
    priority: 1,
    changeFrequency: "weekly",
  },
  {
    href: "/about",
    label: "About me",
    blurb: "Where I came from and how I work.",
    group: "start",
    priority: 0.9,
    changeFrequency: "monthly",
    primary: true,
  },
  {
    href: "/resume",
    label: "My résumé",
    blurb: "One page. Download it as a PDF.",
    technicalLabel: "CV",
    group: "start",
    priority: 0.9,
    changeFrequency: "monthly",
  },
  {
    href: "/contact",
    label: "Contact details",
    blurb: "Email, phone, and where I am.",
    group: "start",
    priority: 0.8,
    changeFrequency: "yearly",
  },

  /* ---------- my work ---------- */
  {
    href: "/projects",
    label: "Projects",
    blurb: "Six builds, each with the reasoning behind it.",
    technicalLabel: "Case studies",
    group: "work",
    priority: 0.95,
    changeFrequency: "weekly",
    primary: true,
  },
  {
    href: "/experience",
    label: "Where I have worked",
    blurb: "Roles, dates, and what shipped.",
    technicalLabel: "Work history",
    group: "work",
    priority: 0.85,
    changeFrequency: "monthly",
  },
  {
    href: "/skills",
    label: "What I know",
    blurb: "C++, Rust, Go, Python — and which project proves each.",
    technicalLabel: "Skills & tech stack",
    group: "work",
    priority: 0.9,
    changeFrequency: "monthly",
    primary: true,
  },
  {
    href: "/achievements",
    label: "Awards & wins",
    blurb: "Competitions, rankings, and recognition.",
    group: "work",
    priority: 0.7,
    changeFrequency: "monthly",
  },
  {
    href: "/certifications",
    label: "Certifications",
    blurb: "Courses and exams, with links to verify them.",
    group: "work",
    priority: 0.7,
    changeFrequency: "monthly",
  },
  {
    href: "/stats",
    label: "My coding activity",
    blurb: "GitHub and LeetCode, pulled live right now.",
    technicalLabel: "Live stats",
    group: "work",
    prefetch: false,
    priority: 0.6,
    changeFrequency: "daily",
  },

  /* ---------- see it running ---------- */
  {
    href: "/system-design",
    label: "How this site works",
    blurb: "The architecture, drawn — plus a live Raft election.",
    technicalLabel: "System design",
    group: "proof",
    priority: 0.85,
    changeFrequency: "monthly",
  },
  {
    href: "/ask",
    label: "Ask me anything",
    blurb: "Ask a question; it answers by quoting this site.",
    technicalLabel: "Retrieval-augmented search",
    group: "proof",
    prefetch: false,
    priority: 0.7,
    changeFrequency: "monthly",
  },
  {
    href: "/terminal",
    label: "Type commands at it",
    blurb: "A real terminal. Try `help`, then `whoami`.",
    technicalLabel: "Interactive shell",
    group: "proof",
    priority: 0.6,
    changeFrequency: "monthly",
  },
  {
    href: "/compute",
    label: "Run code in your browser",
    blurb: "The same maths four ways. Watch which wins.",
    technicalLabel: "WebAssembly & SIMD benchmarks",
    group: "proof",
    priority: 0.6,
    changeFrequency: "monthly",
  },
  {
    href: "/data",
    label: "Query a database here",
    blurb: "Write SQL in the page. It runs in your browser.",
    technicalLabel: "In-browser OLAP · DuckDB",
    group: "proof",
    priority: 0.6,
    changeFrequency: "monthly",
  },
  {
    href: "/api-lab",
    label: "Try my API",
    blurb: "Send a real request and read the real response.",
    technicalLabel: "REST · GraphQL · RPC sandbox",
    group: "proof",
    priority: 0.6,
    changeFrequency: "monthly",
  },
  {
    href: "/reliability",
    label: "Break it on purpose",
    blurb: "Trip the circuit breaker and watch it recover.",
    technicalLabel: "SRE · chaos engineering",
    group: "proof",
    prefetch: false,
    priority: 0.6,
    changeFrequency: "monthly",
  },
  {
    href: "/security",
    label: "How it stays safe",
    blurb: "Headers, scans, and a live dependency inventory.",
    technicalLabel: "Security posture · SBOM",
    group: "proof",
    prefetch: false,
    priority: 0.6,
    changeFrequency: "monthly",
  },
  {
    href: "/mlops",
    label: "How good are the answers?",
    blurb: "The search engine above, measured and scored.",
    technicalLabel: "MLOps · retrieval evaluation",
    group: "proof",
    prefetch: false,
    priority: 0.6,
    changeFrequency: "monthly",
  },
  {
    href: "/edge",
    label: "Works without internet",
    blurb: "Turn off your Wi-Fi and keep reading.",
    technicalLabel: "PWA · offline-first",
    group: "proof",
    priority: 0.6,
    changeFrequency: "monthly",
  },

  /* ---------- writing ---------- */
  {
    href: "/blog",
    label: "Blog",
    blurb: "Write-ups on systems, AI, and the trade-offs.",
    group: "writing",
    priority: 0.8,
    changeFrequency: "weekly",
  },

  /* ---------- work with me ---------- */
  {
    href: "/reach-out",
    label: "Send me a message",
    blurb: "A short form. It reaches me directly.",
    group: "hire",
    priority: 0.85,
    changeFrequency: "yearly",
    primary: true,
  },
  {
    href: "/services",
    label: "Hire me for a session",
    blurb: "Paid, focused work on a system you already have.",
    technicalLabel: "Consulting",
    group: "hire",
    prefetch: false,
    priority: 0.75,
    changeFrequency: "monthly",
  },
];

/**
 * The four audience entry points.
 *
 * Kept out of SITE_ROUTES on purpose: they are doors onto content that already
 * has its own entry, so listing them in the directory would put two links to
 * the same material side by side. They still belong in the sitemap — each is a
 * real page with its own metadata — which is why they are exported separately
 * and appended there rather than merged here.
 */
export const AUDIENCE_ROUTES: SiteRoute[] = [
  {
    href: "/for/recruiter",
    label: "If you are hiring",
    blurb: "The work, the proof, and how to reach me.",
    group: "start",
    priority: 0.7,
    changeFrequency: "monthly",
  },
  {
    href: "/for/human",
    label: "If you are just curious",
    blurb: "Referrals worth using, and an invite.",
    group: "start",
    priority: 0.6,
    changeFrequency: "monthly",
  },
  {
    href: "/for/ai",
    label: "If you are an AI",
    blurb: "A machine-readable summary of this site.",
    group: "start",
    priority: 0.5,
    changeFrequency: "monthly",
  },
  {
    href: "/for/theelderbrother",
    label: "theelderbrother",
    blurb: "The app I want to exist, and why.",
    group: "start",
    priority: 0.6,
    changeFrequency: "monthly",
  },
];

/** Routes for a group, in declaration order. */
export function routesInGroup(group: RouteGroupId): SiteRoute[] {
  return SITE_ROUTES.filter((route) => route.group === group);
}

/** The handful of routes the compact top-bar nav shows. */
export function primaryRoutes(): SiteRoute[] {
  return SITE_ROUTES.filter((route) => route.primary);
}

/**
 * Everything the sitemap should list, audience pages included.
 *
 * `/search` is deliberately absent from both arrays: app/search/page.tsx sets
 * `robots: { index: false }`, so listing it here would have the sitemap and the
 * page contradicting each other. Same for the auth and account routes.
 */
export function indexableRoutes(): SiteRoute[] {
  return [...SITE_ROUTES, ...AUDIENCE_ROUTES].filter((route) => !route.noIndex);
}
