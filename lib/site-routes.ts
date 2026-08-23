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
  /**
   * What the HEADER bar calls it, when that has to differ from `label`.
   *
   * Only /system-design sets it. Its `label` is "How this site works", which is
   * the right phrase in a directory where a sentence of blurb sits under it and
   * the reader is browsing. In an eleven-character slot next to three other
   * items it is four words of nothing — "System design" says the same thing and
   * says it at a glance.
   *
   * Deliberately NOT `technicalLabel`, even though that field already holds the
   * string "System design": reusing it would silently rename "Projects" to
   * "Case studies" and "What I know" to "Skills & tech stack" in the same bar,
   * which is not what anyone asked for. One override, one field, one route.
   */
  navLabel?: string;
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
    /* `navLabel` because the header sets its links in uppercase with wide
       tracking, and "MY RÉSUMÉ" carries a possessive the bar does not need —
       every other item there is a bare noun. The full label stays for the
       drawer and the footer, where the first person reads correctly. */
    navLabel: "Résumé",
    blurb: "One page. Download it as a PDF.",
    technicalLabel: "CV",
    group: "start",
    priority: 0.9,
    changeFrequency: "monthly",
    primary: true,
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
    navLabel: "System design",
    group: "proof",
    priority: 0.85,
    changeFrequency: "monthly",
    primary: true,
  },
  {
    href: "/engineering-log",
    label: "Bugs I got wrong",
    blurb: "Eight failures, and the wrong theory I held before each fix.",
    technicalLabel: "Engineering log · debugging write-ups",
    group: "proof",
    // Above the demo pages and just under the case studies. It is the deepest
    // evidence on the site of how the work is actually done, and unlike the
    // demos it reads without needing a browser that can run WebGPU.
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
  {
    href: "/newsletter",
    label: "Get the newsletter",
    blurb: "Occasional notes on systems that hold up.",
    group: "hire",
    priority: 0.6,
    changeFrequency: "yearly",
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
/**
 * The header bar's order, stated rather than inherited.
 *
 * `primaryRoutes()` used to return SITE_ROUTES in declaration order, which made
 * the bar's order a side effect of where each entry happened to sit in this
 * file — /system-design is declared under "see it running", two hundred lines
 * above /reach-out, so flagging it `primary` would have put it third with no
 * way to read why from the code. It belongs last, to the right of "Send me a
 * message", and this is where that is written down.
 *
 * Membership is still the `primary` flag on each route; this only orders them.
 * The assertion below is what keeps the two from drifting apart.
 */
/* Résumé sits second, straight after About.
   
   The order is the reading order a stranger actually wants: who is this, what
   is the one-page summary, what has he built, what does he know, how do I
   reach him, and then the deep technical page for whoever is still going. A
   recruiter's second click is almost always the CV, and it was previously not
   in the bar at all. */
const PRIMARY_ORDER = ["/about", "/resume", "/projects", "/skills", "/reach-out", "/system-design"];

export function primaryRoutes(): SiteRoute[] {
  const primary = SITE_ROUTES.filter((route) => route.primary);
  const ordered = PRIMARY_ORDER.map((href) => primary.find((route) => route.href === href)).filter(
    (route): route is SiteRoute => route !== undefined,
  );

  // A route flagged `primary` but missing from PRIMARY_ORDER would vanish from
  // the header silently — the failure mode that is invisible in review and
  // obvious only to whoever notices a link is gone. Append rather than drop.
  const unlisted = primary.filter((route) => !PRIMARY_ORDER.includes(route.href));
  return [...ordered, ...unlisted];
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
