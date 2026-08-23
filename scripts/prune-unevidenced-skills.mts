import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * One-off: remove the two skill rows that no evidence on this site supports.
 *
 * ### Why these two
 *
 * The résumé's TECHNICAL SKILLS section is split into "proven in production at
 * work" and "proven outside work", and the rule behind that split is that every
 * token has to trace to a bullet or a built artifact. Two entries in the site's
 * skill inventory fail it, and both had already been cut from the résumé for
 * exactly this reason:
 *
 * - **MCP (Model Context Protocol)** — a grep across every `.ts`, `.tsx` and
 *   `.md` in the repository finds it in precisely one place: the seed array
 *   that puts it on the page. No project lists it, no experience bullet
 *   mentions it, nothing in the codebase implements it. It is a keyword.
 *
 * - **AWS** — the AWS Developer Associate certification is real and stays on
 *   /certifications. But every deployment actually performed is Azure/AKS, and
 *   the inventory listed AWS under "Cloud & DevOps" beside the AKS work, which
 *   reads as hands-on cloud experience. A certification is a different claim
 *   from operating something, and the page was not distinguishing them.
 *
 * ### What this deliberately does NOT touch
 *
 * Two project `stack` arrays name AWS — the exam platform and the secure RAG
 * build. Those stay. A stack entry is a specific claim about one project, made
 * by the person who built it, and there is no evidence here that either is
 * wrong; removing them would be this script deciding what someone else's
 * project ran on.
 *
 * The consequence is that AWS still appears in the skill graph on /skills,
 * reached from those two projects. That is the correct outcome rather than a
 * leak: the graph's entire premise is "which project evidences which
 * technology", so a term that two projects evidence belongs in it. What is gone
 * is the free-floating chip that asserted the skill with nothing behind it.
 *
 *     pnpm tsx scripts/prune-unevidenced-skills.mts            # dry run
 *     pnpm tsx scripts/prune-unevidenced-skills.mts --apply
 *
 * prisma/seed.ts has been updated to match, so a fresh database does not
 * reintroduce either row.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example.");
}
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

const APPLY = process.argv.includes("--apply");

/** Exact `name` values, matched with the category they sit in. */
const PRUNE = [
  { category: "Cloud & DevOps", name: "AWS" },
  { category: "Core CS", name: "MCP (Model Context Protocol)" },
];

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");

  let removed = 0;
  for (const target of PRUNE) {
    const row = await prisma.skill.findFirst({ where: target });
    if (!row) {
      console.log(`= ${target.name} — already absent`);
      continue;
    }
    removed++;
    console.log(
      `${APPLY ? "→" : "?"} remove "${row.name}" from "${row.category}" (order ${row.order})`,
    );
    if (APPLY) {
      await prisma.skill.delete({ where: { id: row.id } });
    }
  }

  const left = await prisma.skill.count();
  console.log(
    `\n${removed} row(s) ${APPLY ? "removed" : "would be removed"}; ${left} skills ${APPLY ? "remain" : "currently"}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
