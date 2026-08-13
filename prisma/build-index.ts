// Rebuild the P16 retrieval index.
//
//   pnpm ai:index
//
// Run it after content changes — a new project, an edited case study, a
// published post. It is a full rebuild every time, and deliberately so: IDF is
// a property of the whole corpus, so adding one document changes the weight of
// every term in every other document's vector. An incremental version would
// leave old vectors computed in one space and new ones in another, and the
// failure would be invisible.
//
// Also creates the pgvector extension and the HNSW index if they are missing,
// so a fresh database needs this one command and nothing else.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { rebuildIndex } = await import("../lib/ai/indexer");
  const { prisma } = await import("../lib/prisma");

  const started = Date.now();
  const result = await rebuildIndex();

  console.log(
    [
      `Indexed ${result.chunks} chunks from ${result.documents} passages`,
      result.removed > 0 ? `, removed ${result.removed} stale` : "",
      `, in ${Date.now() - started}ms.`,
    ].join(""),
  );
  console.log(
    result.vectorized
      ? "pgvector is active — retrieval is hybrid (dense + full-text)."
      : "pgvector is NOT available — retrieval is full-text only. Search still works, semantically-phrased questions will do worse.",
  );
  if (result.note) console.log(`Note: ${result.note}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Index build failed:", error);
  process.exit(1);
});
