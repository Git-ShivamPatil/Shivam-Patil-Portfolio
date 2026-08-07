// Plain `dotenv/config` only reads a file literally named `.env`; secrets for
// this project live in `.env.local` (matching prisma.config.ts and seed.ts).
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";

/**
 * Seeds the bookable service catalogue (Phase 7).
 *
 * Separate from prisma/seed.ts and written as upserts keyed on slug, so it is
 * safe to re-run against a live database — it will refresh copy and pricing
 * without touching any bookings that already reference these rows.
 *
 * Prices are in paise: ₹4,999 -> 499900.
 */
const offerings = [
  {
    slug: "systems-consult",
    name: "Systems consultation",
    description:
      "A focused hour on one hard problem — throughput ceilings, queue design, caching strategy, or a failure mode you can't reproduce. You get the whiteboard session plus a written summary of the decisions and trade-offs.",
    durationMin: 60,
    priceMinor: 499900,
    currency: "INR",
    order: 1,
  },
  {
    slug: "architecture-review",
    name: "Architecture review",
    description:
      "A deep read of an existing design or codebase, followed by 90 minutes together. Delivered as a written review: what will break first, what is over-built, and the three changes with the best return.",
    durationMin: 90,
    priceMinor: 999900,
    currency: "INR",
    order: 2,
  },
  {
    slug: "ai-systems-deep-dive",
    name: "AI systems deep-dive",
    description:
      "For RAG pipelines and agent runtimes: retrieval quality, evaluation harnesses, guardrails, and cost control. Two hours, plus an eval plan you can actually run against your own data.",
    durationMin: 120,
    priceMinor: 1499900,
    currency: "INR",
    order: 3,
  },
];

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL / DIRECT_URL is not set.");

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

  try {
    for (const offering of offerings) {
      await prisma.serviceOffering.upsert({
        where: { slug: offering.slug },
        create: offering,
        update: offering,
      });
      console.log(`  ✔ ${offering.slug}`);
    }
    console.log(`Seeded ${offerings.length} service offerings.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
