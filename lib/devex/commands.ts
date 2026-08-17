import type { Rankable } from "./fuzzy";

/**
 * P17 — one command registry, two front ends.
 *
 * The Cmd+K palette and the `/terminal` CLI are the same list of things a
 * visitor can do, presented two ways. Keeping the registry here rather than
 * inside either component is what stops them drifting into two different
 * answers to "what can I do on this site" — which is the usual fate of a
 * command palette bolted on beside an existing nav.
 *
 * Pure data plus pure functions: no React, no `window`, no fetch. The side
 * effects live in whichever component runs a command.
 */

export type CommandKind = "navigate" | "action" | "theme" | "external";

export interface Command extends Rankable {
  id: string;
  label: string;
  /** Extra searchable text: a path, a synonym, a description. */
  keywords?: string;
  kind: CommandKind;
  /** Where "navigate" and "external" commands go. */
  href?: string;
  /** Grouping header in the palette. */
  group: string;
  /** One-line help, shown by the terminal's `help`. */
  hint?: string;
}

/**
 * Every route a visitor can reach, in the order the site itself presents them.
 *
 * Deliberately hand-listed rather than derived from the filesystem. A generated
 * list would include `/admin/*`, `/login`, the invoice token routes and the API
 * — pages that either need a session or are not pages at all — and a palette
 * that offers a visitor a route they will be redirected away from is worse than
 * one that omits it.
 */
export const NAVIGATION_COMMANDS: Command[] = [
  {
    id: "nav-home",
    label: "Home",
    href: "/",
    kind: "navigate",
    group: "Go to",
    keywords: "start index landing",
  },
  // `/#work` until the project listing got an address of its own. The comment
  // above this list is explicit that a command offering a route the visitor is
  // redirected away from is worse than one that omits it — and a fragment that
  // no longer exists in the document is the same failure with no redirect to
  // soften it: the palette would scroll nowhere and leave them on the homepage.
  {
    id: "nav-work",
    label: "Projects",
    href: "/projects",
    kind: "navigate",
    group: "Go to",
    keywords: "projects portfolio case studies selected work",
  },
  {
    id: "nav-services",
    label: "Services",
    href: "/services",
    kind: "navigate",
    group: "Go to",
    keywords: "hire consulting booking rates",
  },
  {
    id: "nav-stats",
    label: "Live stats",
    href: "/stats",
    kind: "navigate",
    group: "Go to",
    keywords: "github leetcode metrics activity",
  },
  {
    id: "nav-blog",
    label: "Blog",
    href: "/blog",
    kind: "navigate",
    group: "Go to",
    keywords: "writing posts articles",
  },
  {
    id: "nav-ask",
    label: "Ask this site",
    href: "/ask",
    kind: "navigate",
    group: "Go to",
    keywords: "search rag retrieval ai question",
  },
  {
    id: "nav-terminal",
    label: "Terminal",
    href: "/terminal",
    kind: "navigate",
    group: "Go to",
    keywords: "cli shell console command line",
  },
  {
    id: "nav-compute",
    label: "Compute lab",
    href: "/compute",
    kind: "navigate",
    group: "Go to",
    keywords: "wasm webassembly webgpu workers benchmark parallel simd",
  },
  {
    id: "nav-data",
    label: "Data pipeline",
    href: "/data",
    kind: "navigate",
    group: "Go to",
    keywords: "duckdb olap sql warehouse etl elt lineage stream",
  },
  {
    id: "nav-reliability",
    label: "Reliability",
    href: "/reliability",
    kind: "navigate",
    group: "Go to",
    keywords:
      "sre red metrics prometheus latency p95 circuit breaker chaos otel tracing observability",
  },
  {
    id: "nav-security",
    label: "Security",
    href: "/security",
    kind: "navigate",
    group: "Go to",
    keywords:
      "audit ledger hash chain kms encryption rotation sbom sast saml sso mtls signing supply chain",
  },
  {
    id: "nav-edge",
    label: "Edge & offline",
    href: "/edge",
    kind: "navigate",
    group: "Go to",
    keywords:
      "pwa offline service worker background sync indexeddb waf cloudflare worker canary webusb usb install",
  },
  {
    id: "nav-api-lab",
    label: "API lab",
    href: "/api-lab",
    kind: "navigate",
    group: "Go to",
    keywords:
      "openapi swagger rest graphql subgraph federation sdl grpc protobuf proto rpc feature flags sandbox console",
  },
  {
    id: "nav-system",
    label: "System design",
    href: "/system-design",
    kind: "navigate",
    group: "Go to",
    keywords: "architecture diagrams decisions",
  },
  {
    id: "nav-skills",
    label: "Skills",
    href: "/skills",
    kind: "navigate",
    group: "Go to",
    keywords: "stack technologies graph",
  },
  {
    id: "nav-experience",
    label: "Experience",
    href: "/experience",
    kind: "navigate",
    group: "Go to",
    keywords: "work history roles education",
  },
  {
    id: "nav-achievements",
    label: "Achievements",
    href: "/achievements",
    kind: "navigate",
    group: "Go to",
    keywords: "metrics numbers outcomes",
  },
  {
    id: "nav-certifications",
    label: "Certifications",
    href: "/certifications",
    kind: "navigate",
    group: "Go to",
    keywords: "credentials courses",
  },
  {
    id: "nav-resume",
    label: "Résumé",
    href: "/resume",
    kind: "navigate",
    group: "Go to",
    keywords: "cv pdf download",
  },
  {
    id: "nav-about",
    label: "About",
    href: "/about",
    kind: "navigate",
    group: "Go to",
    keywords: "bio who profile",
  },
  {
    id: "nav-contact",
    label: "Contact",
    href: "/contact",
    kind: "navigate",
    group: "Go to",
    keywords: "email message get in touch",
  },
  {
    id: "nav-reach",
    label: "Reach out",
    href: "/reach-out",
    kind: "navigate",
    group: "Go to",
    keywords: "channels map location socials",
  },
  {
    id: "nav-search",
    label: "Search",
    href: "/search",
    kind: "navigate",
    group: "Go to",
    keywords: "find full text",
  },
];

export const ACTION_COMMANDS: Command[] = [
  {
    id: "action-theme-toggle",
    label: "Toggle theme",
    kind: "theme",
    group: "Actions",
    keywords: "dark light mode appearance switch",
    hint: "Switch between the pink/cream and neon/black palettes.",
  },
  {
    id: "action-theme-light",
    label: "Use light theme",
    kind: "theme",
    group: "Actions",
    keywords: "pink cream day",
  },
  {
    id: "action-theme-dark",
    label: "Use dark theme",
    kind: "theme",
    group: "Actions",
    keywords: "neon green black night",
  },
  {
    id: "action-customize",
    label: "Customise the theme",
    kind: "action",
    group: "Actions",
    keywords: "accent radius density personalise appearance",
    hint: "Adjust accent, corner radius and density. Stored in your browser only.",
  },
  {
    id: "action-download-resume",
    label: "Download the résumé",
    href: "/d/resume",
    kind: "external",
    group: "Actions",
    keywords: "cv pdf hire",
  },
  {
    id: "action-copy-email",
    label: "Copy email address",
    kind: "action",
    group: "Actions",
    keywords: "contact mail clipboard",
  },
];

/** Everything, in the order a palette with no query should show it. */
export function allCommands(): Command[] {
  return [...NAVIGATION_COMMANDS, ...ACTION_COMMANDS];
}

/**
 * Terminal commands.
 *
 * A separate surface from the palette because a CLI is a different interaction:
 * it takes arguments, it has output, and it is read top to bottom afterwards.
 * `ask` is the one that makes it more than a toy — it is the same retrieval
 * endpoint /ask uses, so the terminal can actually answer questions about the
 * site rather than only moving around it.
 */
export interface TerminalCommandSpec {
  name: string;
  usage: string;
  summary: string;
}

export const TERMINAL_COMMANDS: TerminalCommandSpec[] = [
  { name: "help", usage: "help", summary: "List every command." },
  { name: "ls", usage: "ls", summary: "List the pages on this site." },
  { name: "cd", usage: "cd <page>", summary: "Navigate to a page." },
  { name: "open", usage: "open <page>", summary: "Same as cd." },
  { name: "ask", usage: "ask <question>", summary: "Ask the retrieval index, with sources." },
  { name: "whoami", usage: "whoami", summary: "Who built this." },
  { name: "stack", usage: "stack", summary: "What this site runs on." },
  { name: "theme", usage: "theme [light|dark]", summary: "Read or set the theme." },
  { name: "resume", usage: "resume", summary: "Download the résumé." },
  { name: "clear", usage: "clear", summary: "Clear the screen." },
];

/**
 * Resolve a page argument to a route.
 *
 * Accepts what someone would actually type: "about", "/about", "About". The
 * navigation registry is the source of truth, so a page added there is
 * immediately reachable from the terminal without touching this.
 */
export function resolvePage(argument: string): Command | null {
  const query = argument.trim().toLowerCase().replace(/^\/+/, "");
  if (!query) return null;

  for (const command of NAVIGATION_COMMANDS) {
    const path = (command.href ?? "").replace(/^\/+/, "").replace(/#.*$/, "");
    if (path === query || command.label.toLowerCase() === query) return command;
  }
  // Fall back to a prefix match so "sys" reaches /system-design.
  return (
    NAVIGATION_COMMANDS.find((command) => {
      const path = (command.href ?? "").replace(/^\/+/, "");
      return path.startsWith(query) || command.label.toLowerCase().startsWith(query);
    }) ?? null
  );
}

/** Parse a raw terminal line into a command and its argument. */
export function parseLine(line: string): { name: string; argument: string } {
  const trimmed = line.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) return { name: trimmed.toLowerCase(), argument: "" };
  return {
    name: trimmed.slice(0, space).toLowerCase(),
    // Not lowercased: `ask` takes a question, and lowercasing it would change
    // what is being asked.
    argument: trimmed.slice(space + 1).trim(),
  };
}
