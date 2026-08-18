import { config } from "dotenv";

config({ path: ".env.local" });

// Dynamic, and it has to be. lib/prisma.ts builds its client at module scope
// and throws there when DATABASE_URL is unset, so a static import of the
// evaluation would run that throw *before* the dotenv call above. Same shape
// as prisma/build-index.ts, for the same reason.
const { runEvaluation } = await import("../lib/mlops/goldens.ts");

/**
 * P25 — run the retrieval evaluation from the command line.
 *
 * `/mlops` renders the same numbers, and a page is the wrong place to *gate* on
 * them: nobody blocks a merge on a figure they have to remember to go and look
 * at. This exits non-zero when the score falls below a floor, so the same
 * measurement can sit in CI.
 *
 * **The floor is deliberately loose.** Twelve queries cannot separate two good
 * rankings — the confidence interval is wider than any difference worth
 * shipping — so a tight threshold would fail on noise and be switched off
 * within a month, exactly like a SAST rule that cries wolf. What it catches is
 * a retriever that has broken *outright*: an index that failed to build, a
 * fusion change that inverted a comparator, a migration that dropped the
 * embedding column.
 *
 *   pnpm mlops:eval          report only
 *   pnpm mlops:eval --gate   exit non-zero if below the floor
 */

/** Below this, something is broken rather than merely worse. */
const NDCG_FLOOR = 0.4;
const RECALL_FLOOR = 0.4;

const { report, coverage: gaps, returned } = await runEvaluation(5);
const explain = process.argv.includes("--explain");

console.log(`\nRetrieval evaluation — ${report.queries.length} queries at k=${report.k}\n`);

const { GOLDEN_QUERIES } = await import("../lib/mlops/goldens.ts");

for (const query of report.queries) {
  const rank = query.firstRelevantAt === null ? "  —" : `#${String(query.firstRelevantAt).padEnd(2)}`;
  console.log(
    `  ${rank}  nDCG ${query.ndcg.toFixed(2)}  recall ${(query.recall * 100).toFixed(0).padStart(3)}%   ${query.question}`,
  );

  // `--explain` prints the ranking behind a score. A metric alone says a query
  // got worse; only the ranking says what displaced the right answer, which is
  // the difference between an alarm and a diagnosis.
  if (explain && (query.mrr < 1 || query.recall < 1)) {
    const judged = GOLDEN_QUERIES.find((entry) => entry.id === query.id)?.relevance ?? {};
    for (const [index, url] of (returned[query.id] ?? []).entries()) {
      const grade = judged[url];
      const mark = grade === undefined ? "   " : grade >= 2 ? " ✓✓" : "  ✓";
      console.log(`         ${mark} ${index + 1}. ${url}`);
    }
    const wanted = Object.entries(judged).filter(([url]) => !(returned[query.id] ?? []).includes(url));
    if (wanted.length > 0) {
      console.log(`          missing: ${wanted.map(([url, g]) => `${url}(${g})`).join(", ")}`);
    }
  }
}

console.log(
  `\n  mean: recall ${(report.mean.recall * 100).toFixed(0)}%  MRR ${report.mean.mrr.toFixed(2)}  nDCG ${report.mean.ndcg.toFixed(2)}`,
);

if (report.misses.length > 0) {
  console.log(`  misses: ${report.misses.join(", ")}`);
}

// Coverage is reported even when empty. A silent "0 gaps" and no line at all
// are indistinguishable, and the whole reason this split exists is that a
// content gap once masqueraded as a ranking failure.
const allGaps = gaps.unanswerable.length;
console.log(
  allGaps === 0
    ? `  coverage: every judged page is indexed`
    : `  coverage: ${allGaps} queries judge pages the corpus cannot return — ${gaps.missingUrls.join(", ")}`,
);
console.log("");

if (process.argv.includes("--gate")) {
  const failures: string[] = [];
  if (report.mean.ndcg < NDCG_FLOOR) {
    failures.push(`nDCG ${report.mean.ndcg.toFixed(2)} is below the floor of ${NDCG_FLOOR}`);
  }
  if (report.mean.recall < RECALL_FLOOR) {
    failures.push(`recall ${report.mean.recall.toFixed(2)} is below the floor of ${RECALL_FLOOR}`);
  }
  // A coverage gap is reported, never gated on. It is a content decision, and
  // failing a build because somebody has not written a page yet is how a gate
  // earns a reputation for being noise.
  if (failures.length > 0) {
    console.error(`Retrieval has regressed:\n  ${failures.join("\n  ")}\n`);
    process.exit(1);
  }
}

// `retrieve` holds a pool open; without this the process hangs after printing.
process.exit(0);
