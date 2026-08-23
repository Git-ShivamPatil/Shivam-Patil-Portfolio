import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * One-off: push the rewritten project copy from `prisma/seed.ts` into the rows
 * that already exist in Postgres.
 *
 * ### Why this is not just `pnpm db:seed`
 *
 * The seed's upsert is `update: {}`. That is deliberate and worth preserving:
 * once a project row exists, the admin CRUD at /admin/projects is its source of
 * truth, and a seed that overwrote on every run would silently discard anything
 * edited through the UI. The consequence is that the seed can only ever INSERT
 * — it has no effect at all on the six rows already in the database.
 *
 * So the copy rewrite in seed.ts is, on its own, a change to what a *fresh*
 * database would get and nothing else. This script is the other half: it
 * updates the three copy fields on the existing rows, and only those three.
 *
 * ### What it touches
 *
 * `summary`, `useCase`, `outcome`. Nothing else — not `implemented`, not
 * `architecture`, not `steps`, not `stack`, not `images`, not `order`. Those
 * were already dense and were left alone by the copy pass, and several of them
 * are plausible things to have edited in the admin UI.
 *
 * ### Reversibility
 *
 * A dry run is the default and prints the exact before/after for every field it
 * would change. `--apply` performs the writes and prints the previous values as
 * it goes, so the output of the run is itself the rollback record.
 *
 *     pnpm tsx scripts/backfill-project-copy.mts            # dry run
 *     pnpm tsx scripts/backfill-project-copy.mts --apply    # write
 *
 * Safe to delete once it has been run and the result is confirmed. It is
 * committed rather than run from a scratch directory because it changed
 * production data, and a data change with no record in the repository is the
 * kind of thing the next person cannot reconstruct.
 */

// Prisma 7 requires an explicit driver adapter — a bare `new PrismaClient()`
// throws at construction. Built the same way prisma/seed.ts and lib/prisma.ts
// build theirs, so this script talks to exactly the database they do.
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example.");
}
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

const APPLY = process.argv.includes("--apply");

/** Keyed by slug. Must stay identical to the same fields in prisma/seed.ts. */
const COPY: Record<string, { summary: string; useCase: string; outcome: string }> = {
  "distributed-rate-limiter-api-gateway": {
    summary:
      "Multi-tenant API gateway: token-bucket and sliding-window quotas across a consistent-hash shard ring, with Raft election covering shard failure.",
    useCase:
      "Keep per-tenant quotas accurate across replicas and regions while a noisy neighbour, a lost shard or a region blip is in progress.",
    outcome: "45K req/s · <8ms p99",
  },
  "agentic-ai-orchestration-platform": {
    summary:
      "Multi-agent runtime on a plan-retrieve-act-critique loop, emitting a full decision and tool-call trace on every run.",
    useCase:
      "Make knowledge-work requests repeatable and auditable — the reasoning trace and tool activity stay visible rather than collapsing into an answer.",
    outcome: "87% success · 150 eval cases",
  },
  "high-performance-llm-inference-server": {
    summary:
      "Rust inference runtime built on continuous batching and explicit KV-cache management, with live throughput and tail-latency signals.",
    useCase:
      "Serve concurrent LLM requests without the throughput collapse and p99 spikes that single-request inference hits under load.",
    outcome: "+230% throughput · −42% p99",
  },
  "secure-banking-system": {
    summary:
      "Banking platform on a Hyperledger Fabric ledger, with Kafka-decoupled transaction events and Vault-managed secrets behind OAuth2 Django APIs.",
    useCase:
      "Process financial operations against a verifiable ledger, with asynchronous enrichment that survives a downstream outage.",
    outcome: "Fabric ledger · Kafka · Vault",
  },
  "online-examination-system": {
    summary:
      "Assessment platform: NGINX across FastAPI workers, Redis-held session and scoring state, JWT-scoped endpoints, server-side validation throughout.",
    useCase:
      "Hold a consistent assessment session when hundreds of candidates start, autosave and submit inside the same few seconds.",
    outcome: "NGINX → FastAPI · Redis · JWT",
  },
  "secure-rag-with-rbac-guardrails-monitoring": {
    summary:
      "Enterprise RAG with RBAC metadata pushed into the vector-search filter, PII masking before generation, and Ragas scoring on every change.",
    useCase:
      "Answer from private corpora while guaranteeing a caller can retrieve only what their role permits — enforced at the retrieval filter, not the prompt.",
    outcome: "RBAC-filtered retrieval · Ragas",
  },
};

async function main() {
  console.log(APPLY ? "APPLYING copy updates\n" : "DRY RUN — pass --apply to write\n");

  const rows = await prisma.project.findMany({
    select: { slug: true, summary: true, useCase: true, outcome: true },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  // A slug in COPY with no row is a typo in this file, not an absent project —
  // report it rather than silently skipping, or the copy quietly never lands.
  const missing = Object.keys(COPY).filter((slug) => !bySlug.has(slug));
  if (missing.length) {
    console.error("No row for slug(s): " + missing.join(", "));
    console.error("Rows present: " + rows.map((r) => r.slug).join(", "));
    process.exitCode = 1;
    return;
  }

  let changed = 0;
  for (const [slug, next] of Object.entries(COPY)) {
    const current = bySlug.get(slug)!;
    const diffs = (["summary", "useCase", "outcome"] as const).filter(
      (field) => current[field] !== next[field],
    );
    if (diffs.length === 0) {
      console.log(`= ${slug} — already current`);
      continue;
    }
    changed++;
    console.log(`\n${APPLY ? "→" : "?"} ${slug}`);
    for (const field of diffs) {
      console.log(`    ${field}`);
      console.log(`      was: ${current[field]}`);
      console.log(`      now: ${next[field]}`);
    }
    if (APPLY) {
      await prisma.project.update({
        where: { slug },
        data: { summary: next.summary, useCase: next.useCase, outcome: next.outcome },
      });
    }
  }

  console.log(
    `\n${changed} of ${Object.keys(COPY).length} projects ${APPLY ? "updated" : "would change"}.`,
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
