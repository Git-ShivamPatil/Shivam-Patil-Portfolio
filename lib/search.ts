import { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";

export interface SearchResult {
  type: "project" | "blog";
  slug: string;
  title: string;
  excerpt: string;
  rank: number;
}

/**
 * Full-text search across published projects and blog posts using
 * Postgres's built-in tsvector/ts_rank — computed on the fly rather than a
 * persisted generated column, since the corpus here is a few dozen rows,
 * not a scale where indexing the vector would matter.
 */
export async function search(query: string): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];

  return prisma.$queryRaw<SearchResult[]>(Prisma.sql`
    SELECT * FROM (
      SELECT
        'project' AS type,
        slug,
        title,
        summary AS excerpt,
        ts_rank(
          to_tsvector('english', title || ' ' || summary || ' ' || "useCase" || ' ' || category),
          plainto_tsquery('english', ${q})
        ) AS rank
      FROM "Project"
      WHERE published = true
        AND to_tsvector('english', title || ' ' || summary || ' ' || "useCase" || ' ' || category)
          @@ plainto_tsquery('english', ${q})

      UNION ALL

      SELECT
        'blog' AS type,
        slug,
        title,
        excerpt,
        ts_rank(
          to_tsvector('english', title || ' ' || excerpt || ' ' || content),
          plainto_tsquery('english', ${q})
        ) AS rank
      FROM "BlogPost"
      WHERE published = true
        AND to_tsvector('english', title || ' ' || excerpt || ' ' || content)
          @@ plainto_tsquery('english', ${q})
    ) results
    ORDER BY rank DESC
    LIMIT 20
  `);
}
