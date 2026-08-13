import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { embed, toVectorLiteral } from "./embed";
import { loadIdf } from "./indexer";

/**
 * P16 — hybrid retrieval.
 *
 * **Two retrievers, because the embedding here is lexical and knows it.** The
 * hashed TF-IDF vectors in embed.ts give a real vector space with real
 * neighbourhoods, but they are not a trained semantic model: they cannot know
 * that "latency" and "p99" belong together. Postgres full-text search fails
 * differently — it is exact, so it nails a rare term like "Razorpay" and misses
 * anything phrased another way.
 *
 * Fusing them recovers much of what each lacks. That is not a workaround for
 * not having a paid embedding API; hybrid dense+sparse retrieval is what
 * production RAG systems do anyway, for exactly this reason.
 *
 * **Fused with Reciprocal Rank Fusion, not by adding scores.** The two
 * retrievers return numbers on incomparable scales — a cosine similarity of
 * 0.42 and a ts_rank of 0.0007 — so any weighted sum is really a decision about
 * which retriever wins, dressed up as arithmetic. RRF throws the magnitudes
 * away and keeps only the ranks, so a document both retrievers put near the top
 * beats one that either put first alone. It also needs no tuning, which matters
 * when there is no labelled relevance set to tune against.
 */

export interface RetrievedChunk {
  id: string;
  source: string;
  url: string;
  title: string;
  heading: string | null;
  content: string;
  /** Fused score. Comparable within one result set, not across queries. */
  score: number;
  /** Which retrievers found it — useful for explaining a result. */
  matchedBy: ("vector" | "text")[];
}

/**
 * RRF's smoothing constant. 60 is the value from the original paper and the
 * de-facto default; it decides how quickly rank advantage decays, and at this
 * corpus size anything from 20 to 100 orders the top few identically.
 */
const RRF_K = 60;

/** How deep each retriever goes before fusion. */
const CANDIDATES = 24;

interface Row {
  id: string;
  source: string;
  url: string;
  title: string;
  heading: string | null;
  content: string;
}

/**
 * Dense retrieval over pgvector.
 *
 * `<=>` is cosine *distance*, so smaller is better and the ordering is
 * ascending — the opposite of every other score in this file, which is exactly
 * the kind of detail that produces a silently reversed result list.
 *
 * Returns an empty list rather than throwing if the extension or column is
 * missing: the site must keep answering with lexical search alone.
 */
async function vectorSearch(query: string): Promise<Row[]> {
  const model = await loadIdf();
  if (!model) return [];

  const literal = toVectorLiteral(embed(query, model));

  try {
    return await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT id, source, url, title, heading, content
      FROM "KnowledgeChunk"
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${CANDIDATES}
    `);
  } catch (error) {
    console.error(
      `[ai] vector search unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * Sparse retrieval over the same chunks.
 *
 * `websearch_to_tsquery` rather than `plainto_tsquery`, which the older
 * lib/search.ts uses: it understands quoted phrases and `-exclusion`, so a
 * visitor who types like they would into a search engine gets what they meant.
 * It also never throws on odd punctuation, which `to_tsquery` does.
 */
async function textSearch(query: string): Promise<Row[]> {
  try {
    return await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT id, source, url, title, heading, content
      FROM "KnowledgeChunk"
      WHERE to_tsvector('english', title || ' ' || content)
            @@ websearch_to_tsquery('english', ${query})
      ORDER BY ts_rank(
        to_tsvector('english', title || ' ' || content),
        websearch_to_tsquery('english', ${query})
      ) DESC
      LIMIT ${CANDIDATES}
    `);
  } catch (error) {
    console.error(
      `[ai] text search failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/** Fuse ranked lists by reciprocal rank. */
export function fuse(lists: { name: "vector" | "text"; rows: Row[] }[], limit: number): RetrievedChunk[] {
  const scores = new Map<string, { row: Row; score: number; matchedBy: ("vector" | "text")[] }>();

  for (const list of lists) {
    list.rows.forEach((row, index) => {
      const existing = scores.get(row.id);
      // 1/(k + rank), with rank 1-based. The first result contributes 1/61, the
      // tenth 1/70 — a shallow curve, which is the point: it rewards appearing
      // in both lists more than it rewards topping one.
      const contribution = 1 / (RRF_K + index + 1);
      if (existing) {
        existing.score += contribution;
        existing.matchedBy.push(list.name);
      } else {
        scores.set(row.id, { row, score: contribution, matchedBy: [list.name] });
      }
    });
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.row, score: entry.score, matchedBy: entry.matchedBy }));
}

export interface RetrieveOptions {
  limit?: number;
}

export async function retrieve(
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim().slice(0, 400);
  if (trimmed.length < 2) return [];

  // Run both, always. Racing them or skipping the second when the first looks
  // good would make the result depend on latency.
  const [vector, text] = await Promise.all([vectorSearch(trimmed), textSearch(trimmed)]);

  return fuse(
    [
      { name: "vector", rows: vector },
      { name: "text", rows: text },
    ],
    options.limit ?? 6,
  );
}
