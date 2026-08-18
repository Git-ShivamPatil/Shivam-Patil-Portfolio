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

/* `getSkillNames()` was removed here.
 *
 * It was a live `prisma.skill.findMany` behind readOrFallback, and its doc
 * comment said it fed "the homepage's animated skill marquee". That marquee is
 * gone — app/globals.css records `.capabilities`, `.skill-marquee` and
 * `@keyframes skill-marquee-scroll` leaving with the rest of the homepage's
 * duplicated sections — so the function had had no caller since. A grep for
 * the name across every tracked file returned the definition and its own
 * readOrFallback label, nothing else.
 *
 * Worth noting why it mattered more than an unused export usually does: the
 * comment named a consumer that no longer existed, so the next reader would
 * have concluded the homepage still renders a skill marquee.
 */
