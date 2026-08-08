import { prisma } from "../lib/prisma";
import { readOrFallback } from "../lib/db-read";

export interface SkillCategory {
  label: string;
  items: string[];
}

/** Skills grouped by category, in admin-defined order — used by /skills and the admin CRUD. */
export async function getSkillCategories(): Promise<SkillCategory[]> {
  // Sorted by `order` alone (not category-then-order): seed.ts assigns a
  // single counter across all categories, so this reproduces categories in
  // their original curated sequence — grouping by category name would sort
  // them alphabetically instead.
  return readOrFallback(
    "getSkillCategories",
    async () => {
      const rows = await prisma.skill.findMany({ orderBy: { order: "asc" } });

      const byCategory = new Map<string, string[]>();
      for (const row of rows) {
        const items = byCategory.get(row.category) ?? [];
        items.push(row.name);
        byCategory.set(row.category, items);
      }

      return Array.from(byCategory, ([label, items]) => ({ label, items }));
    },
    [],
  );
}

/** Flat name list — used by the homepage's animated skill marquee. */
export async function getSkillNames(): Promise<string[]> {
  return readOrFallback(
    "getSkillNames",
    async () => {
      const rows = await prisma.skill.findMany({
        select: { name: true },
        orderBy: { order: "asc" },
      });
      return rows.map((row) => row.name);
    },
    [],
  );
}
