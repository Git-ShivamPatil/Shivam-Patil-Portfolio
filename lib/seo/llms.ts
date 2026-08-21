import { siteUrl, person, coreTopics } from "./site";
import { ROUTE_GROUPS, indexableRoutes, type SiteRoute } from "../site-routes";

/**
 * P27 — `/llms.txt`, built from the route registry.
 *
 * ### What this is for
 *
 * An assistant asked "what has Shivam built?" does not crawl a site the way
 * Googlebot does. It fetches a page or two, and whatever it finds there is the
 * whole answer. This site is close to a worst case for that: the navigation is
 * a JavaScript drawer, so a fetch of `/` yields a hub with no route list, and
 * §55a records the consequence in Google's own words — twenty of thirty-three
 * URLs with `Last crawl: N/A`, including every project case study, the deepest
 * content here.
 *
 * `llms.txt` is the emerging convention for exactly that gap: one plain-text
 * document, linked from robots.txt, that says what a site contains and where.
 * It costs one route and it is the only artifact on this domain that answers
 * "what is here?" in a single request.
 *
 * ### Why it is generated, not written
 *
 * Because a fourth hand-maintained copy of the route map is how the first three
 * drifted. §48 found the drawer, the homepage hub and the sitemap each holding
 * their own list, disagreeing by ten routes. `lib/site-routes.ts` is now the one
 * list and this is another view onto it — a route added to the navigation
 * appears here by construction, and `tests/p26-seo.test.ts` already fails if a
 * page on disk is missing from the registry.
 *
 * ### There is deliberately no `<link rel="alternate">` pointing here
 *
 * Three ways were tried and measured in a real browser against a production
 * build, because the docs and the served HTML disagreed:
 *
 * 1. `alternates.types` in the root layout's `metadata` — **zero** `alternate`
 *    links in the output. Next 16 does not emit that field.
 * 2. The same, moved into `pageMetadata()` on the theory that a page's own
 *    `alternates` replaces the layout's (which §103 records as a genuine trap,
 *    so it was a reasonable hypothesis) — still absent.
 * 3. A literal `<link>` element in the layout body, relying on React 19 to
 *    hoist it into `<head>`. This one *works* — but only on dynamically
 *    rendered routes. On the prerendered static ones (`/`, `/about`,
 *    `/skills`) it does not appear at all.
 *
 * A tag that is present on `/system-design` and absent on `/` is a worse
 * artifact than no tag: it makes a claim about the site that is true on some
 * pages and false on others, and anything reconciling the two is guessing.
 *
 * So discovery rests on the two mechanisms that provably work, both verified
 * over HTTP: **the well-known path** (which is the actual convention — a
 * reader that knows about `llms.txt` fetches `/llms.txt`), and **`/for/ai`,
 * which links all three machine-readable documents as ordinary crawlable
 * anchors**. `robots.txt` is the third, and it is what a crawler reads first.
 *
 * ### The one thing it must not become
 *
 * A keyword dump. `llms.txt` is read by something that will quote it back to a
 * person, so every line here has to be true and has to be the same claim the
 * page itself makes. The blurbs are the registry's own, unedited, for that
 * reason: the alternative is a second set of descriptions that can disagree
 * with the first.
 */

/** `[label](url): blurb`, the line shape the convention uses. */
function link(route: SiteRoute): string {
  const technical =
    route.technicalLabel && route.technicalLabel !== route.label
      ? ` (${route.technicalLabel})`
      : "";
  return `- [${route.label}${technical}](${siteUrl}${route.href === "/" ? "/" : route.href}): ${route.blurb}`;
}

export interface LlmsContext {
  projects: { slug: string; title: string; summary: string }[];
  posts: { slug: string; title: string; excerpt: string }[];
}

/**
 * The index document.
 *
 * Deliberately short. Its job is to let a reader decide what to fetch next, and
 * a document that inlines everything is one nothing links out of — the full
 * text lives at `/llms-full.txt` for the caller that wants it.
 */
export function buildLlmsTxt(context: LlmsContext): string {
  const routes = indexableRoutes();
  const lines: string[] = [];

  lines.push(`# ${person.name} — ${person.jobTitle}`);
  lines.push("");
  lines.push(
    `> ${person.role} at ${person.employer}, in ${person.location.city}, ${person.location.country}. ` +
      `Backend platforms, distributed systems and AI infrastructure. This site is also the portfolio's ` +
      `own production system: every demo on it runs for real.`,
  );
  lines.push("");
  lines.push(
    `Works on: ${coreTopics.slice(0, 10).join(", ")}. ` +
      `Contact: ${person.email}. Source: ${person.github}. Profile: ${person.linkedin}.`,
  );
  lines.push("");

  /**
   * Stated up front because it is the single most useful thing this document
   * can tell a machine reader, and the one a crawler is least likely to infer:
   * there is a hand-written OpenAPI 3.1 description of this site's API, and it
   * is fetchable. robots.txt allows it explicitly for this reason.
   */
  lines.push("## Machine-readable");
  lines.push("");
  lines.push(
    `- [OpenAPI 3.1 description](${siteUrl}/api/openapi): every public endpoint on this site, hand-written, served as application/vnd.oai.openapi+json.`,
  );
  lines.push(`- [Sitemap](${siteUrl}/sitemap.xml): every indexable URL.`);
  lines.push(
    `- [Full text](${siteUrl}/llms-full.txt): the same corpus this site's own retrieval runs on.`,
  );
  lines.push("");

  for (const group of ROUTE_GROUPS) {
    const inGroup = routes.filter((route) => route.group === group.id);
    if (inGroup.length === 0) continue;

    lines.push(`## ${group.label}`);
    lines.push("");
    lines.push(`${group.blurb}`);
    lines.push("");
    for (const route of inGroup) lines.push(link(route));
    lines.push("");
  }

  if (context.projects.length > 0) {
    lines.push("## Project case studies");
    lines.push("");
    lines.push(
      "Long-form write-ups: the problem, the architecture, and what the constraints actually forced.",
    );
    lines.push("");
    for (const project of context.projects) {
      lines.push(`- [${project.title}](${siteUrl}/projects/${project.slug}): ${project.summary}`);
    }
    lines.push("");
  }

  if (context.posts.length > 0) {
    lines.push("## Writing");
    lines.push("");
    for (const post of context.posts) {
      lines.push(`- [${post.title}](${siteUrl}/blog/${post.slug}): ${post.excerpt}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * The full-text document.
 *
 * This is the retrieval corpus, serialised. Reusing `buildCorpus()` rather than
 * re-extracting the site's prose is the point: what a model reads here is
 * exactly what `/api/ai/ask` retrieves over, so an answer sourced from this
 * document and an answer from the site's own search cannot disagree.
 *
 * Chunks are grouped by URL and rendered under their headings, which restores
 * the document structure that chunking took apart.
 */
export function buildLlmsFullTxt(
  chunks: { url: string; title: string; heading: string; content: string }[],
): string {
  const byUrl = new Map<string, { title: string; sections: { heading: string; body: string }[] }>();

  for (const chunk of chunks) {
    const entry = byUrl.get(chunk.url) ?? { title: chunk.title, sections: [] };
    entry.sections.push({ heading: chunk.heading, body: chunk.content });
    byUrl.set(chunk.url, entry);
  }

  const lines: string[] = [
    `# ${person.name} — ${person.jobTitle}`,
    "",
    `> Full text of ${siteUrl}, as the site's own retrieval index holds it.`,
    `> Generated from the same corpus that serves ${siteUrl}/ask, so this and the site cannot disagree.`,
    "",
  ];

  for (const [url, entry] of byUrl) {
    lines.push(`## ${entry.title}`);
    lines.push("");
    lines.push(`Source: ${siteUrl}${url}`);
    lines.push("");

    let lastHeading = "";
    for (const section of entry.sections) {
      // Chunking splits one section into several passages, all carrying the
      // same heading. Printing it once per passage would read as a document
      // with the same subtitle a dozen times over.
      if (section.heading && section.heading !== lastHeading) {
        lines.push(`### ${section.heading}`);
        lines.push("");
        lastHeading = section.heading;
      }
      lines.push(section.body);
      lines.push("");
    }
  }

  return lines.join("\n");
}
