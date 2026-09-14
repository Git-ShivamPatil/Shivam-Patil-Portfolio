import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * One-off: replace the Low-Latency Market Data & Order Entry Stack's outcome
 * chip with what was actually measured, now that the project is finished.
 *
 * ### Why
 *
 * The chip has read `1M+ msg/s · ~100ns decode` since the project was first
 * published. That is the **target** — the figure the build was aimed at, and the
 * one the résumé carries. It was never a measurement, and while the project was
 * in flight that was the honest thing to show.
 *
 * The project is now tagged `v1.0.0` and the numbers exist:
 *
 *     2,782,874 msg/s   sustained receiver-side over 60s, three runs within 0.7%
 *     8.20 ns/message   to decode
 *     38.9 ns/message   to decode and apply a book update
 *     0                 heap operations per message
 *
 * Measured on four pinned ARM cores of a free GitHub runner, behind a host gate
 * that refuses to write a report when the core topology, the invariant counter
 * or the build profile do not hold. Every figure has a row in the repository's
 * CLAIMS.md naming the commit and the host.
 *
 * ### The caveat, and where it lives
 *
 * 2.78M msg/s is a **single-host, loopback** figure at **32 messages per
 * datagram**. At one message per datagram the kernel UDP path caps an order of
 * magnitude lower, so a reader who assumes one message per packet is reading a
 * much stronger claim than the one being made.
 *
 * That qualifier is already on the page: `scripts/correct-market-data-claims.mts`
 * put it in the "Allocation-free feed handler" bullet, which renders directly
 * under the chip. It is deliberately NOT in the chip — the chip has no room, and
 * the six other projects' chips are all short. Raising the number without that
 * bullet in place would be the dishonest version of this change; the bullet went
 * first, and this is second.
 *
 * ### Why the résumé still agrees
 *
 * It says `1M+ msg/s`. 2.78M is 1M+, so nothing contradicts — the page is simply
 * more specific than the résumé, which is the right direction for the two to
 * differ.
 *
 * ### Why a script and not `pnpm db:seed`
 *
 * The seed's upsert is `update: {}` — insert-only — so editing prisma/seed.ts
 * changes what a FRESH database gets and nothing else. Once a row exists,
 * /admin/projects is its source of truth. Committed rather than run from a
 * scratch directory because it changed production data.
 *
 *     pnpm tsx scripts/record-market-data-result.mts            # dry run
 *     pnpm tsx scripts/record-market-data-result.mts --apply    # write
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example.");
}
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

const APPLY = process.argv.includes("--apply");
const SLUG = "low-latency-market-data-order-entry";

/** Must match the same field in prisma/seed.ts. */
const FROM = "1M+ msg/s · ~100ns decode";
const TO = "2.78M msg/s · 8.2ns decode";

/**
 * The bullet that carries the caveat. Checked, not assumed: raising the headline
 * number while the qualifier is missing is the one outcome this change must not
 * produce, so it refuses rather than trusting that the earlier script ran.
 */
const CAVEAT = "batched 32 messages to a datagram";

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");

  const project = await prisma.project.findUnique({
    where: { slug: SLUG },
    select: { id: true, outcome: true, implemented: true },
  });

  if (!project) {
    throw new Error(`No project with slug "${SLUG}".`);
  }

  const bullets = project.implemented as [string, string][];
  const hasCaveat =
    Array.isArray(bullets) && bullets.some(([, body]) => body.includes(CAVEAT));

  if (!hasCaveat) {
    console.error(
      "REFUSED — the batch-factor caveat is not on the page.\n" +
        "  The chip has no room for it, so it lives in the 'Allocation-free feed\n" +
        "  handler' bullet. Raising the headline number without it would be a\n" +
        "  stronger claim than the measurement supports.\n" +
        "  Run scripts/correct-market-data-claims.mts --apply first.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`= the batch-factor caveat is present in the bullet below the chip\n`);

  if (project.outcome === TO) {
    console.log("= outcome\n  already recorded\n");
    console.log("0 fields would change.");
    return;
  }
  if (project.outcome !== FROM) {
    console.error(
      `! REFUSED — the live outcome is not the string this script expects.\n` +
        `  live: ${project.outcome}\n` +
        `  It has been edited elsewhere, probably /admin/projects. Not overwriting.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${APPLY ? "→" : "?"} outcome\n` +
      `  the target becomes the measurement, now that there is one\n` +
      `  before: ${FROM}\n` +
      `  after:  ${TO}\n`,
  );

  if (APPLY) {
    await prisma.project.update({
      where: { id: project.id },
      data: { outcome: TO },
    });
  }

  console.log(`1 field ${APPLY ? "updated" : "would change"}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
