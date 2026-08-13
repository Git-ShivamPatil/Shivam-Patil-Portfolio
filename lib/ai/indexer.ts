import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { buildCorpus, countTokens, hashContent } from "./corpus";
import { buildIdf, embed, toVectorLiteral, type IdfModel } from "./embed";

/**
 * P16 — building the index.
 *
 * **A full rebuild every time, not an incremental update.** That is not
 * laziness: IDF is a property of the whole corpus, so adding one document
 * changes the weight of every term in every other document's vector. An
 * incremental indexer would leave the index in a state where old vectors were
 * computed in one space and new ones in another, and the failure would be
 * invisible — the numbers would still come out, just subtly wrong.
 *
 * The corpus here is a few dozen passages. A full rebuild takes under a second
 * and is the only version that is correct.
 */

export interface IndexResult {
  chunks: number;
  documents: number;
  vectorized: boolean;
  removed: number;
  note?: string;
}

/**
 * Ensure pgvector exists and the column is there.
 *
 * Returns false rather than throwing when the extension cannot be created —
 * some managed Postgres tiers do not allow it, and the honest answer to that is
 * a lexical-only index, not a failed deploy. Neon does allow it, which is why
 * the vector path is the default rather than the fallback.
 */
export async function ensureVectorSupport(): Promise<boolean> {
  try {
    await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS vector`;
    return true;
  } catch (error) {
    console.warn(
      `[ai] pgvector unavailable, falling back to lexical-only retrieval: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Approximate-nearest-neighbour index over the embeddings.
 *
 * HNSW rather than IVFFlat: IVFFlat needs a populated table to pick its
 * cluster centroids, so building it before the rows exist produces a bad index
 * silently. `vector_cosine_ops` because the vectors are L2-normalised and
 * cosine is the metric everything else here uses.
 *
 * At this corpus size an index changes nothing measurable — a sequential scan
 * over a few dozen rows is instant. It exists so the query planner is doing the
 * same thing here that it would do at a thousand times the size, rather than
 * this being a design that quietly stops working when the blog grows.
 */
async function ensureVectorIndex(): Promise<void> {
  try {
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_idx"
      ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops)
    `;
  } catch (error) {
    // A missing ANN index costs latency, not correctness.
    console.warn(
      `[ai] could not create the vector index: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Write one chunk's embedding. Raw SQL because Prisma has no vector type. */
async function writeEmbedding(id: string, vector: Float32Array): Promise<void> {
  const literal = toVectorLiteral(vector);
  // A tagged template, so the literal is a bound parameter and not string
  // concatenation — the same rule lib/search.ts follows, and the one
  // tests/p13-security.test.ts enforces for the whole codebase.
  await prisma.$executeRaw`
    UPDATE "KnowledgeChunk" SET embedding = ${literal}::vector WHERE id = ${id}
  `;
}

export async function rebuildIndex(): Promise<IndexResult> {
  const chunks = await buildCorpus();
  if (chunks.length === 0) {
    return { chunks: 0, documents: 0, vectorized: false, removed: 0, note: "corpus is empty" };
  }

  const vectorized = await ensureVectorSupport();

  // IDF over the passages that will actually be searched, not over whole
  // documents: the retrieval unit and the statistics have to agree, or a term
  // common inside one long document looks rare to the query side.
  const model: IdfModel = buildIdf(chunks.map((chunk) => chunk.content));

  const keep = new Set<string>();

  for (const chunk of chunks) {
    const contentHash = hashContent(chunk.content);
    const row = await prisma.knowledgeChunk.upsert({
      where: {
        source_sourceId_heading: {
          source: chunk.source,
          sourceId: chunk.sourceId,
          heading: chunk.heading,
        },
      },
      create: {
        source: chunk.source,
        sourceId: chunk.sourceId,
        heading: chunk.heading,
        url: chunk.url,
        title: chunk.title,
        content: chunk.content,
        tokens: countTokens(chunk.content),
        contentHash,
      },
      update: {
        url: chunk.url,
        title: chunk.title,
        content: chunk.content,
        tokens: countTokens(chunk.content),
        contentHash,
      },
      select: { id: true },
    });
    keep.add(row.id);

    // Written even when the content is unchanged, because IDF may have moved.
    // Skipping unchanged rows is the incremental trap described above.
    if (vectorized) {
      await writeEmbedding(row.id, embed(chunk.content, model));
    }
  }

  // Anything the corpus no longer produces is gone: a deleted blog post or a
  // renamed heading must not stay answerable.
  const stale = await prisma.knowledgeChunk.findMany({
    where: { id: { notIn: [...keep] } },
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.knowledgeChunk.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }

  if (vectorized) await ensureVectorIndex();

  await prisma.knowledgeIndex.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      documentCount: model.documentCount,
      idf: model.documentFrequency as Prisma.InputJsonValue,
      chunkCount: keep.size,
      vectorized,
      builtAt: new Date(),
    },
    update: {
      documentCount: model.documentCount,
      idf: model.documentFrequency as Prisma.InputJsonValue,
      chunkCount: keep.size,
      vectorized,
      builtAt: new Date(),
    },
  });

  return {
    chunks: keep.size,
    documents: model.documentCount,
    vectorized,
    removed: stale.length,
  };
}

/**
 * The stored IDF snapshot, for embedding a query in the same space the index
 * was built in.
 *
 * Returns null when no index exists, which callers treat as "lexical search
 * only" rather than as an error — a site deployed before anyone ran the indexer
 * should still have a working search box.
 */
export async function loadIdf(): Promise<IdfModel | null> {
  const row = await prisma.knowledgeIndex.findUnique({ where: { id: "singleton" } });
  if (!row || !row.vectorized) return null;
  return {
    documentCount: row.documentCount,
    documentFrequency: (row.idf ?? {}) as Record<string, number>,
  };
}
