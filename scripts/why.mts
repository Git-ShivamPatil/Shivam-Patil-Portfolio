import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * P25 — inspect the index for one query.
 *
 * `pnpm mlops:eval --explain` says which pages came back. This says *why*: what
 * the query tokenises to, which chunks exist for a page, and which retriever
 * found each result. The evaluation tells you a query is failing; this is how
 * you find out whether the passage is missing, phrased differently, or simply
 * outranked.
 *
 *   pnpm mlops:why "what technologies does he know" /skills
 */

const [, , question, url] = process.argv;

if (!question) {
  console.error('Usage: pnpm mlops:why "<question>" [/url-to-inspect]');
  process.exit(1);
}

const { retrieve } = await import("../lib/ai/retrieve.ts");
const { terms } = await import("../lib/ai/embed.ts");
const { prisma } = await import("../lib/prisma.ts");

console.log(`\nQuery: ${question}`);
console.log(`Terms: ${terms(question).join(" · ")}\n`);

const results = await retrieve(question, { limit: 12 });
console.log("Retrieved:");
for (const [index, chunk] of results.entries()) {
  console.log(
    `  ${String(index + 1).padStart(2)}. ${chunk.url}  [${chunk.matchedBy.join("+")}]  score ${chunk.score.toFixed(4)}`,
  );
  console.log(`      ${chunk.content.slice(0, 110).replace(/\s+/g, " ")}…`);
}

if (url) {
  const rows = await prisma.knowledgeChunk.findMany({ where: { url }, select: { content: true } });
  console.log(`\nIndexed chunks for ${url}: ${rows.length}`);
  for (const row of rows) {
    console.log(`  • ${row.content.slice(0, 150).replace(/\s+/g, " ")}…`);
    // The overlap is the whole diagnosis: a passage sharing no terms with the
    // question cannot be retrieved lexically, however correct its content is.
    const overlap = terms(row.content).filter((term) => terms(question).includes(term));
    console.log(`    shared terms: ${overlap.length > 0 ? overlap.join(", ") : "NONE"}`);
  }
}

console.log("");
process.exit(0);
