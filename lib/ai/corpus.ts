import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { tokenize } from "./embed";
import { experience, education } from "../../app/experience";
import { achievements } from "../../app/achievements";
import { certifications } from "../../app/certifications";

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
    const base = { source: "blog", sourceId: post.id, url: `/blog/${post.slug}`, title: post.title };
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
  const byCategory = new Map<string, string[]>();
  for (const skill of skills) {
    byCategory.set(skill.category, [...(byCategory.get(skill.category) ?? []), skill.name]);
  }
  for (const [category, names] of byCategory) {
    chunks.push(
      ...sectionsToChunks(
        { source: "skill", sourceId: category, url: "/skills", title: `${category} skills` },
        [{ heading: category, content: `${category}: ${names.join(", ")}.` }],
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
            heading: offering.name,
            content: `${offering.name}. ${offering.description} Runs ${offering.durationMin} minutes.`,
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
            heading: role.org,
            content: `${role.role} at ${role.org}, ${role.period}, ${role.location}. ${role.highlights.join(" ")}`,
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

  return chunks;
}
