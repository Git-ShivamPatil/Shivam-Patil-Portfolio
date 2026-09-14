import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * One-off: correct two claims on the Low-Latency Market Data & Order Entry
 * Stack case study, so the page does not say more than the repository supports.
 *
 * ### Why this exists
 *
 * The repository's own audit — `docs/CLAIMS-MAP.md`, written at milestone 9 —
 * maps every claim on this page to a named test or a named document section.
 * Two of them did not survive that mapping. Neither is a fabrication; both are
 * a phrase that is wider than its evidence.
 *
 * **1. "A full session layer."** The repository's `docs/PROTOCOL.md` opens by
 * refusing exactly that word, and then enumerates eight session behaviours
 * deliberately left out — encryption, OnBehalfOfCompID routing, scheduled
 * session times, business-level rejects among them. The four behaviours the
 * bullet actually names are all implemented and all cross-checked against
 * QuickFIX, which is a stronger claim than "full" and happens to be true. So
 * the fix names the cross-check instead of reaching for the adjective.
 *
 * **2. "1M+ msg/s" with no room for the batch factor.** The measurement is real
 * and exceeds the claim — 2,782,874 msg/s — but only at 32 messages per
 * datagram. At one message per datagram the kernel UDP path caps out around
 * 300-600K packets/sec/core and the figure is unreachable without kernel
 * bypass. Batching is standard on real exchange feeds, so the number is
 * legitimate; the problem is that a reader who assumes one message per packet
 * is reading a much stronger claim than the one being made.
 *
 * CLAIMS-MAP.md proposed fixing the second one by linking the case study to
 * `bench/REPORT.md`, which states the caveat in its first paragraph. That is not
 * available: `app/projects/[slug]/page.tsx` renders each bullet as a bare
 * `<p>{description}</p>`, and the page has no outbound-link affordance at all.
 * So the qualifier goes into the bullet text itself, which is better than a
 * link anyway — the reader sees it without having to click.
 *
 * ### Why a script and not `pnpm db:seed`
 *
 * The seed's upsert is `update: {}` — insert-only — so editing `prisma/seed.ts`
 * changes what a FRESH database gets and nothing else. Once a row exists,
 * /admin/projects is its source of truth. This script is the other half, and it
 * is committed rather than run from a scratch directory for the same reason
 * `backfill-project-copy.mts` is: it changed production data, and a data change
 * with no record in the repository is the kind of thing the next person cannot
 * reconstruct.
 *
 * ### What it touches
 *
 * The `implemented` array on one slug, and only the two bullets named below.
 * It matches each bullet by title AND requires the current description to be
 * the exact string recorded here — so if either was edited through the admin UI
 * since, this refuses rather than silently discarding that edit.
 *
 *     pnpm tsx scripts/correct-market-data-claims.mts            # dry run
 *     pnpm tsx scripts/correct-market-data-claims.mts --apply    # write
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

/**
 * Keyed by bullet title. `from` must match the live value exactly or the
 * correction is refused for that bullet. Must stay identical to the same
 * strings in prisma/seed.ts.
 */
const CORRECTIONS: Record<string, { from: string; to: string; why: string }> = {
  "Allocation-free feed handler": {
    from:
      "A/B feed arbitration, sequence-gap detection and snapshot-based recovery into MBP/MBO order books — sustaining 1M+ messages/sec at ~100ns decode and ~200ns book update, with zero heap allocations per message verified by a counting allocator.",
    to:
      "A/B feed arbitration, sequence-gap detection and snapshot-based recovery into MBP/MBO order books — sustaining 1M+ messages/sec at ~100ns decode and ~200ns book update, with zero heap allocations per message verified by a counting allocator. Measured single-host over loopback, batched 32 messages to a datagram.",
    why: "states the batch factor the throughput figure depends on",
  },
  "FIX 4.4 order gateway": {
    from:
      "A full session layer — logon, heartbeats, resend/gap-fill, durable sequence persistence — reconciling order state across a hard process restart, plus a risk service enforcing pre-trade limits on an allocation-free path.",
    to:
      "A FIX 4.4 session layer — logon, heartbeats, resend/gap-fill, durable sequence persistence — cross-checked against QuickFIX as an independent counterparty, reconciling order state across a hard process restart, plus a risk service enforcing pre-trade limits on an allocation-free path.",
    why: 'drops "full", which docs/PROTOCOL.md explicitly refuses, and names the independent cross-check instead',
  },
};

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");

  const project = await prisma.project.findUnique({
    where: { slug: SLUG },
    select: { id: true, title: true, implemented: true },
  });

  if (!project) {
    throw new Error(
      `No project with slug "${SLUG}". Run \`pnpm db:seed\` and\n` +
        "`pnpm tsx scripts/publish-market-data-project.mts --apply` first.",
    );
  }

  const bullets = project.implemented as [string, string][];
  if (!Array.isArray(bullets)) {
    throw new Error("`implemented` is not an array — refusing to write.");
  }

  let changed = 0;
  let refused = 0;

  const next: [string, string][] = bullets.map(([title, description]) => {
    const correction = CORRECTIONS[title];
    if (!correction) return [title, description];

    if (description === correction.to) {
      console.log(`= ${title}\n  already corrected\n`);
      return [title, description];
    }

    if (description !== correction.from) {
      console.log(
        `! ${title}\n` +
          "  REFUSED — the live text is not the string this script expects, so it has\n" +
          "  been edited elsewhere (probably /admin/projects). Not overwriting.\n" +
          `  live: ${description}\n`,
      );
      refused += 1;
      return [title, description];
    }

    console.log(
      `${APPLY ? "→" : "?"} ${title}\n` +
        `  ${correction.why}\n` +
        `  before: ${correction.from}\n` +
        `  after:  ${correction.to}\n`,
    );
    changed += 1;
    return [title, correction.to];
  });

  const missing = Object.keys(CORRECTIONS).filter(
    (title) => !bullets.some(([t]) => t === title),
  );
  for (const title of missing) {
    console.log(`! "${title}" is not a bullet on this project — nothing to correct.\n`);
    refused += 1;
  }

  if (changed > 0 && APPLY) {
    await prisma.project.update({
      where: { id: project.id },
      data: { implemented: next },
    });
  }

  console.log(
    `${changed} bullet(s) ${APPLY ? "updated" : "would change"}` +
      (refused > 0 ? `, ${refused} refused` : "") +
      ".",
  );

  if (refused > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
