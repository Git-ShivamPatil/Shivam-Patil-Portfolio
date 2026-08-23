import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * One-off: publish the Low-Latency Market Data & Order Entry Stack, and shift
 * the six existing projects down one place to make room for it at the top.
 *
 * ### Why a script and not just `pnpm db:seed`
 *
 * The seed does half of this correctly on its own. Its upsert is
 * `update: {}` — insert-only — so the new slug WILL be created by a plain
 * `db:seed`, which is exactly what that behaviour is for.
 *
 * What it cannot do is the other half. Adding this project first means the six
 * that already exist move from 01-06 to 02-07, and `number` is a stored column
 * on rows the seed will not touch. Left alone the site would render two cards
 * numbered 01 and none numbered 07. `order` needs the same shift, since it is
 * what /projects sorts by.
 *
 * So: run the seed to insert, then run this to renumber. This script does both
 * halves itself so the two cannot be run out of sequence.
 *
 * ### Why this project leads
 *
 * It is the flagship on the résumé and the strongest evidence on the site — an
 * allocation-free feed handler at 1M+ msg/sec is the single hardest number
 * either document carries. It was also the one project the résumé lists that
 * the site did not, which meant /skills claimed Rust and C++ under "proven
 * outside work" with nothing here to point at.
 *
 * ### Provenance of the content
 *
 * Every claim in the seed entry is transcribed from the résumé's three bullets
 * for this project. No figure is new. The `architecture` nodes are derived from
 * the components those bullets name — gateway, risk service, matching engine,
 * snapshot/replay, feed handler — and the page renders that section under an
 * explicit "conceptual architecture" note. The `steps` are representative local
 * commands, which is what the build-guide section says it shows and how the
 * other six projects are already written.
 *
 *     pnpm tsx scripts/publish-market-data-project.mts            # dry run
 *     pnpm tsx scripts/publish-market-data-project.mts --apply
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example.");
}
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

const APPLY = process.argv.includes("--apply");
const NEW_SLUG = "low-latency-market-data-order-entry";

/** slug -> its position after the insert. The new project takes 0 / "01". */
const PLACEMENT: [string, number, string][] = [
  [NEW_SLUG, 0, "01"],
  ["distributed-rate-limiter-api-gateway", 1, "02"],
  ["agentic-ai-orchestration-platform", 2, "03"],
  ["high-performance-llm-inference-server", 3, "04"],
  ["secure-banking-system", 4, "05"],
  ["online-examination-system", 5, "06"],
  ["secure-rag-with-rbac-guardrails-monitoring", 6, "07"],
];

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");

  const rows = await prisma.project.findMany({
    select: { slug: true, number: true, order: true },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  if (!bySlug.has(NEW_SLUG)) {
    console.error(
      `"${NEW_SLUG}" is not in the database yet.\n` +
        "Run `pnpm db:seed` first — the seed's upsert is insert-only, so it creates\n" +
        "this row and leaves the existing six untouched. Then re-run this script.",
    );
    process.exitCode = 1;
    return;
  }

  // Every slug the placement names must exist, or the renumbering leaves a gap.
  const missing = PLACEMENT.filter(([slug]) => !bySlug.has(slug)).map(([slug]) => slug);
  if (missing.length) {
    console.error("No row for: " + missing.join(", "));
    process.exitCode = 1;
    return;
  }

  let changed = 0;
  for (const [slug, order, number] of PLACEMENT) {
    const current = bySlug.get(slug)!;
    if (current.order === order && current.number === number) {
      console.log(`= ${number} ${slug} — already correct`);
      continue;
    }
    changed++;
    console.log(
      `${APPLY ? "→" : "?"} ${slug}\n` +
        `      number ${current.number} -> ${number}, order ${current.order} -> ${order}`,
    );
    if (APPLY) {
      await prisma.project.update({ where: { slug }, data: { order, number } });
    }
  }

  console.log(`\n${changed} of ${PLACEMENT.length} projects ${APPLY ? "updated" : "would change"}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
