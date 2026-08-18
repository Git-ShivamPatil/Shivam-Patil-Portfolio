import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { tokenize } from "./embed";
import { experience, education } from "../../app/experience";
import { achievements } from "../../app/achievements";
import { certifications } from "../../app/certifications";
import { contactEmail, hasPhone } from "../site-contact";

/**
 * P16 — turning the site into passages worth retrieving.
 *
 * The corpus is the site's own database plus its static content files. There is
 * no scraping step and no separate content store: a project edited in the admin
 * CRUD is a project the index picks up on the next build, because both read the
 * same rows.
 *
 * **Chunking is by heading, not by character count.** A fixed-size window cuts
 * sentences in half and produces passages that begin mid-thought, which then
 * get quoted mid-thought in an answer. The content here already has structure —
 * a project has a summary, a use case, an implementation list, an architecture
 * — so the structure is the chunk boundary. Each passage is about one idea,
 * which is what makes a vector for it mean something, and it carries the
 * heading it came from so a citation can point at a section.
 */

export interface Chunk {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  /** Never null — see the schema comment on KnowledgeChunk.heading for why. */
  heading: string;
  content: string;
}

/** Below this a passage is a fragment: it ranks noisily and reads worse. */
const MIN_TOKENS = 8;

/**
 * Above this a passage is doing too many jobs for one vector. Long sections get
 * split on sentence boundaries rather than mid-word.
 */
const MAX_TOKENS = 220;

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function countTokens(content: string): number {
  return tokenize(content).length;
}

/** Collapse whitespace without joining two sentences into one. */
function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split an over-long passage on sentence boundaries.
 *
 * Greedy rather than balanced: the first chunk is as full as it can be. A
 * balanced split would produce two half-empty passages that each rank worse
 * than the whole would have.
 */
function splitLong(content: string): string[] {
  if (countTokens(content) <= MAX_TOKENS) return [content];

  const sentences = content.match(/[^.!?]+[.!?]*\s*/g) ?? [content];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current + sentence;
    if (current && countTokens(candidate) > MAX_TOKENS) {
      parts.push(clean(current));
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (clean(current)) parts.push(clean(current));
  return parts;
}

/** Emit a chunk per section, dropping anything too short to be useful. */
function sectionsToChunks(
  base: Omit<Chunk, "heading" | "content">,
  sections: { heading: string; content: string }[],
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const content = clean(section.content);
    if (!content || countTokens(content) < MIN_TOKENS) continue;

    const parts = splitLong(content);
    parts.forEach((part, index) => {
      chunks.push({
        ...base,
        // A split section's parts need distinct headings, since (source,
        // sourceId, heading) is the table's unique key.
        heading: parts.length > 1 ? `${section.heading} (${index + 1})` : section.heading,
        content: part,
      });
    });
  }
  return chunks;
}

/** JSON columns are `unknown` at the type level; read them defensively. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function buildCorpus(): Promise<Chunk[]> {
  const [projects, posts, skills, offerings] = await Promise.all([
    prisma.project.findMany({ where: { published: true }, orderBy: { order: "asc" } }),
    prisma.blogPost.findMany({ where: { published: true } }),
    prisma.skill.findMany({ orderBy: [{ category: "asc" }, { order: "asc" }] }),
    prisma.serviceOffering.findMany({ where: { active: true } }),
  ]);

  const chunks: Chunk[] = [];

  for (const project of projects) {
    const base = {
      source: "project",
      sourceId: project.id,
      url: `/projects/${project.slug}`,
      title: project.title,
    };

    // The tuple-shaped JSON columns are display content, so they are flattened
    // back into prose here rather than indexed as structure — a retrieved
    // passage has to read like something a person wrote.
    const implemented = asArray(project.implemented)
      .map((row) => (Array.isArray(row) ? `${row[0]}: ${row[1]}` : ""))
      .filter(Boolean)
      .join(" ");
    const architecture = asArray(project.architecture)
      .map((row) =>
        row && typeof row === "object" && "title" in row
          ? `${(row as { title: string }).title}: ${(row as { detail?: string }).detail ?? ""}`
          : "",
      )
      .filter(Boolean)
      .join(" ");

    chunks.push(
      ...sectionsToChunks(base, [
        {
          heading: "Summary",
          // The stack and tags ride along with the summary rather than becoming
          // their own chunk: a bare list of technologies has no sentences to
          // quote and would win searches it cannot answer.
          content: `${project.title}. ${project.summary} Outcome: ${project.outcome}. Built with ${project.stack.join(", ")}. Topics: ${project.tags.join(", ")}.`,
        },
        { heading: "Use case", content: project.useCase },
        { heading: "What was built", content: implemented },
        { heading: "Architecture", content: architecture },
      ]),
    );
  }

  for (const post of posts) {
    const base = {
      source: "blog",
      sourceId: post.id,
      url: `/blog/${post.slug}`,
      title: post.title,
    };
    // Blog content is authored as blank-line-separated paragraphs (see the blog
    // page), so paragraphs are the natural section here.
    const paragraphs = post.content.split(/\n{2,}/).filter(Boolean);
    chunks.push(
      ...sectionsToChunks(base, [
        { heading: "Summary", content: `${post.title}. ${post.excerpt}` },
        ...paragraphs.map((paragraph, index) => ({
          heading: `Section ${index + 1}`,
          content: paragraph,
        })),
      ]),
    );
  }

  // Skills are grouped into one passage per category. Indexed individually they
  // would be two-word documents that match everything weakly and nothing well.
  //
  // **The sentence frame is not decoration, and P25 proved it.** The passage
  // used to be exactly `"Backend: Go, Rust, PostgreSQL."` — correct data, and
  // it shares not one word with "what technologies does he know", which is how
  // the question is actually asked. That query returned five project pages and
  // never /skills at all. Every page written as prose ranked first for its own
  // question; every chunk formatted as a record missed. Naming the thing the
  // list *is* — technologies, tools, stack, works with — is what connects the
  // vocabulary of the question to the vocabulary of the answer.
  const byCategory = new Map<string, string[]>();
  for (const skill of skills) {
    byCategory.set(skill.category, [...(byCategory.get(skill.category) ?? []), skill.name]);
  }
  for (const [category, names] of byCategory) {
    chunks.push(
      ...sectionsToChunks(
        { source: "skill", sourceId: category, url: "/skills", title: `${category} skills` },
        [
          {
            heading: category,
            content: `Technologies and tools Shivam Patil works with. ${category} skills in his stack: ${names.join(", ")}.`,
          },
        ],
      ),
    );
  }

  for (const offering of offerings) {
    chunks.push(
      ...sectionsToChunks(
        {
          source: "page",
          sourceId: `service-${offering.id}`,
          url: "/services",
          title: offering.name,
        },
        [
          {
            // Same lesson as the skills passage: the offering row says what the
            // session *is* and never the words someone uses to look for it.
            // "Can I hire him for consulting" matched nothing here.
            heading: offering.name,
            content: `Hire Shivam Patil for consulting: ${offering.name}. ${offering.description} A paid engagement, booked through this site, running ${offering.durationMin} minutes.`,
          },
        ],
      ),
    );
  }

  chunks.push(...staticChunks());

  return chunks;
}

/**
 * Content that lives in TypeScript rather than in the database.
 *
 * Experience, education, achievements and certifications were never moved into
 * the CMS — they change once a year, and a CRUD screen for four rows is more
 * surface than it is worth. They are also exactly what someone asks a portfolio
 * about ("where has he worked", "what did he do there"), so leaving them out
 * would make the most common question the one the index cannot answer.
 */
function staticChunks(): Chunk[] {
  const chunks: Chunk[] = [];

  for (const role of experience) {
    chunks.push(
      ...sectionsToChunks(
        {
          source: "experience",
          sourceId: `${role.org}-${role.period}`,
          url: "/experience",
          title: `${role.role}, ${role.org}`,
        },
        [
          {
            // "Where has Shivam worked" returned /about and never /experience,
            // because the passage began with a job title and the question asks
            // about employment. One clause fixes the vocabulary mismatch.
            heading: role.org,
            content: `Where Shivam Patil has worked. ${role.role} at ${role.org}, ${role.period}, ${role.location}. ${role.highlights.join(" ")}`,
          },
        ],
      ),
    );
  }

  for (const entry of education) {
    chunks.push(
      ...sectionsToChunks(
        {
          source: "experience",
          sourceId: `education-${entry.org}`,
          url: "/experience",
          title: entry.degree,
        },
        [
          {
            heading: "Education",
            content: `${entry.degree}, ${entry.org}, ${entry.period}. ${entry.detail}`,
          },
        ],
      ),
    );
  }

  // One passage for all of them. Each achievement is a metric and a label —
  // six words — which is below the floor for a vector to mean anything.
  chunks.push(
    ...sectionsToChunks(
      { source: "page", sourceId: "achievements", url: "/achievements", title: "Achievements" },
      [
        {
          heading: "Achievements",
          content: achievements
            .map((item) => `${item.metric} — ${item.label} (${item.source}).`)
            .join(" "),
        },
      ],
    ),
  );

  chunks.push(
    ...sectionsToChunks(
      {
        source: "page",
        sourceId: "certifications",
        url: "/certifications",
        title: "Certifications",
      },
      [
        {
          heading: "Certifications",
          content: certifications
            .map(
              (item) =>
                `${item.name} from ${item.issuer}, ${item.year}${item.pending ? " (in progress)" : ""}.`,
            )
            .join(" "),
        },
      ],
    ),
  );

  for (const page of SITE_PAGES) {
    chunks.push(
      ...sectionsToChunks(
        { source: "page", sourceId: `page-${page.url}`, url: page.url, title: page.title },
        [{ heading: page.title, content: page.content }],
      ),
    );
  }

  return chunks;
}

/**
 * The pages that exist only as JSX, described in prose.
 *
 * **P25 found these missing by measuring, not by review.** The first run of the
 * retrieval evaluation reported 42% recall, and most of the shortfall was
 * queries whose answer lives on a page the corpus had never indexed. "How do I
 * get in touch" is close to the most common thing anyone asks a portfolio, and
 * it was the single question this index could not answer at all — along with
 * anything about the labs, the résumé, or the site's own architecture.
 *
 * They were missed because every other source here is a *record* — a row, a
 * post, an array of roles. These pages are hand-written components with no data
 * behind them, so nothing enumerated them and their absence was invisible.
 *
 * **Written as sentences, deliberately.** The obvious shortcut is a keyword list
 * per URL, and it would score well on exactly the queries used to write it and
 * badly on everything else — a bag of terms matches many questions weakly and
 * answers none, which is the reason skills are grouped by category above rather
 * than indexed one name at a time. `/ask` returns *sentences*, so a passage has
 * to read like something a person wrote or the answer it produces is unusable.
 */
const SITE_PAGES: { url: string; title: string; content: string }[] = [
  {
    url: "/contact",
    title: "Contact",
    content: `How to get in touch with Shivam Patil. Email ${contactEmail} for anything — work, questions, or a conversation about a role.${
      hasPhone ? " There is also a phone number and WhatsApp for anything time-sensitive." : ""
    } The contact form on this page reaches the same inbox and is the fastest route; a message written offline is queued in the browser and sent when the connection returns.`,
  },
  {
    url: "/reach-out",
    title: "Reach out",
    content:
      "Every channel Shivam Patil can be reached on, in one place: email, LinkedIn, GitHub, and a map of where he is based. Use this page rather than the contact form when you would rather message on a platform you already use.",
  },
  {
    url: "/about",
    title: "About",
    content:
      "Who Shivam Patil is: a software engineer working on backend systems, distributed infrastructure and developer tooling. This page covers his background, how he approaches building software, and what he is looking for in the work he takes on.",
  },
  {
    url: "/resume",
    title: "Résumé",
    content:
      "The résumé, as a PDF you can read in the browser or download. It covers work history, education, the technologies used in each role, and the outcomes each piece of work produced — the same material as the experience page, in the format a recruiter or hiring manager expects.",
  },
  {
    url: "/projects",
    title: "Projects",
    content:
      "The index of every project written up on this site, each with the problem it solved, the architecture behind it, and what the outcome was. Filterable by the technologies and topics involved.",
  },
  {
    url: "/ask",
    title: "Ask this site",
    content:
      "Ask a question about this work in plain English and get an answer drawn from the site's own content. Search here is hybrid retrieval: a vector index over embedded passages and a full-text lexical index, fused with reciprocal rank fusion so a result found by both ranks above one found by either alone. The answer is extractive — sentences are selected from the retrieved passages and scored against the question, so nothing is paraphrased and nothing can be invented.",
  },
  {
    url: "/compute",
    title: "Compute lab",
    content:
      "Real computation running in your browser: a numerical kernel compiled to WebAssembly, the same work spread across Web Workers with SharedArrayBuffer, and a WebGPU implementation where the hardware allows it. Each backend is benchmarked live against the others, and the benchmark argues against itself where the result is misleading.",
  },
  {
    url: "/data",
    title: "Data pipeline",
    content:
      "Where a page view goes after it is recorded: through the ingest, into two ledgers and two rolled-up aggregates, out to a warehouse export, and into a DuckDB instance compiled to WebAssembly running in your browser, where you can write your own SQL against it. Includes a validated lineage DAG and tumbling-window aggregation.",
  },
  {
    url: "/system-design",
    title: "System design",
    content:
      "How this site is actually built, and why each decision was made: the caching strategy, the write path through a command boundary with idempotency keys, the event outbox and its dead-letter queue, and the trade-offs accepted at each layer.",
  },
  {
    url: "/reliability",
    title: "Reliability",
    content:
      "The site's own RED metrics — rate, errors and duration — measured by the code that serves each request and aggregated in shared state so the numbers survive running on serverless functions. Also the circuit breakers guarding the GitHub and LeetCode integrations, distributed tracing, and a chaos experiment that drives the production breaker through a simulated outage in your browser.",
  },
  {
    url: "/security",
    title: "Security",
    content:
      "A tamper-evident audit ledger that recomputes its own hash chain on every page load, envelope encryption where rotating a key never touches the encrypted payload, a committed software bill of materials, a static analysis ruleset, and a SAML validator demonstrating the signature-wrapping attack that defeats an otherwise valid signature.",
  },
  {
    url: "/edge",
    title: "Edge and offline",
    content:
      "Request filtering that runs before the application does, sharing one ruleset between the live edge proxy and a deployable Cloudflare Worker. Also an offline-capable progressive web app: a cached shell, and a queue that holds a message written without signal and sends it when the connection returns.",
  },
  {
    url: "/api-lab",
    title: "API lab",
    content:
      "The same data served four ways: a hand-written OpenAPI 3.1 specification, a GraphQL subgraph with depth and complexity limits, protocol buffers encoded and decoded by hand on the wire, and a console that builds itself from the specification so the two cannot drift apart.",
  },
  {
    url: "/mlops",
    title: "Retrieval quality",
    content:
      "How well search on this site actually works, measured rather than asserted: recall, mean reciprocal rank and normalised discounted cumulative gain over a labelled set of questions, run live against the index. Also index drift detection, and what generating an answer would cost on a quantized model running on your device versus a hosted one.",
  },
  {
    url: "/terminal",
    title: "Terminal",
    content:
      "A working command-line interface to this site. Navigate, search, ask questions and change the theme without touching the mouse; the same command registry backs the Cmd+K palette.",
  },
];
