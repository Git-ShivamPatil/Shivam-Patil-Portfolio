import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../lib/prisma", () => ({ prisma: {} }));

import {
  compare,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  scoreAll,
  type GoldenQuery,
} from "../lib/mlops/eval";
import {
  cosineDistance,
  normalise,
  populationStabilityIndex,
  termDistribution,
} from "../lib/mlops/drift";
import { MODELS, budgetFor, estimateCost, estimateTokens, fitPassages } from "../lib/mlops/tokens";
import { GOLDEN_QUERIES, coverage, isIndexed } from "../lib/mlops/goldens";
import { countTokens } from "../lib/ai/corpus";

/**
 * P25 — MLOps.
 *
 * The metric tests use hand-worked examples with the arithmetic in the comment,
 * because a metric implementation that is self-consistently wrong passes every
 * round-trip test anyone writes for it. nDCG in particular has several
 * plausible-looking formulations that disagree, and the only way to know which
 * one is implemented is to check it against a number computed by hand.
 */

const relevance = { a: 2, b: 1, c: 1 };

describe("P25 retrieval metrics", () => {
  it("computes recall against the known relevant set", () => {
    // Three known relevant; two in the top 3.
    expect(recallAtK(["a", "x", "b"], relevance, 3)).toBeCloseTo(2 / 3, 5);
    expect(recallAtK(["a", "b", "c"], relevance, 3)).toBe(1);
    expect(recallAtK(["x", "y", "z"], relevance, 3)).toBe(0);
  });

  it("treats an unjudged query as fully recalled rather than as a failure", () => {
    // Nothing was labelled, so there is nothing to miss. Scoring 0 would drag
    // an average down for a query nobody judged.
    expect(recallAtK(["x"], {}, 5)).toBe(1);
  });

  it("computes precision over the window, not the corpus", () => {
    expect(precisionAtK(["a", "x", "b", "y"], relevance, 4)).toBe(0.5);
    expect(precisionAtK([], relevance, 5)).toBe(0);
  });

  it("gives reciprocal rank its steep drop-off", () => {
    expect(reciprocalRank(["a"], relevance)).toBe(1);
    expect(reciprocalRank(["x", "a"], relevance)).toBe(0.5);
    expect(reciprocalRank(["x", "y", "a"], relevance)).toBeCloseTo(1 / 3, 5);
    expect(reciprocalRank(["x", "y"], relevance)).toBe(0);
  });

  it("computes nDCG against a hand-worked value", () => {
    // Ranked [a(2), b(1)]. Gains 2^2-1=3 and 2^1-1=1.
    // DCG  = 3/log2(2) + 1/log2(3) = 3 + 0.6309 = 3.6309
    // Ideal ordering is [2,1,1]:
    // IDCG = 3 + 1/log2(3) + 1/log2(4) = 3 + 0.6309 + 0.5 = 4.1309
    // nDCG = 3.6309 / 4.1309 = 0.8790
    expect(ndcgAtK(["a", "b"], relevance, 3)).toBeCloseTo(0.879, 3);
  });

  it("rewards the higher grade first, which is what grading is for", () => {
    // Same two documents, opposite order. A metric that ignored grades would
    // score these identically.
    const best = ndcgAtK(["a", "b"], relevance, 2);
    const worse = ndcgAtK(["b", "a"], relevance, 2);
    expect(best).toBeGreaterThan(worse);
  });

  it("cannot be gamed by returning piles of marginal results", () => {
    // 2^grade - 1 makes one grade-2 hit worth three grade-1 hits, not two.
    const oneGood = ndcgAtK(["a"], relevance, 5);
    const twoMarginal = ndcgAtK(["b", "c"], relevance, 5);
    expect(oneGood).toBeGreaterThan(twoMarginal);
  });

  it("is bounded in [0,1] and perfect for the ideal ranking", () => {
    expect(ndcgAtK(["a", "b", "c"], relevance, 3)).toBeCloseTo(1, 5);
    expect(ndcgAtK(["x", "y"], relevance, 3)).toBe(0);
  });

  it("names the misses rather than only counting them", () => {
    // An average drifting from 0.82 to 0.79 tells nobody what to fix.
    const goldens: GoldenQuery[] = [
      { id: "hit", question: "q", relevance: { a: 2 }, note: "" },
      { id: "miss", question: "q", relevance: { z: 2 }, note: "" },
    ];
    const report = scoreAll(goldens, { hit: ["a"], miss: ["x", "y"] }, 5);
    expect(report.misses).toEqual(["miss"]);
    expect(report.mean.mrr).toBeCloseTo(0.5, 5);
  });

  it("surfaces a per-query regression the mean would hide", () => {
    // The shape that matters: helps several queries and destroys one. Moving a
    // hit from rank 2 to rank 1 is worth +0.37 nDCG; losing one entirely is
    // worth -1.0. So five improvements outweigh one catastrophe on the mean
    // (+1.85 against -1.0) and the change is still a regression somebody's
    // search will notice.
    const ids = ["q1", "q2", "q3", "q4", "q5", "q6"];
    const goldens: GoldenQuery[] = ids.map((id) => ({
      id,
      question: id,
      relevance: { a: 2 },
      note: "",
    }));

    const improved = Object.fromEntries(ids.slice(0, 5).map((id) => [id, ["x", "a"]]));
    const before = scoreAll(goldens, { ...improved, q6: ["a"] }, 5);

    const promoted = Object.fromEntries(ids.slice(0, 5).map((id) => [id, ["a"]]));
    const after = scoreAll(goldens, { ...promoted, q6: ["x", "y", "z"] }, 5);

    const result = compare(before, after);
    expect(result.meanDelta).toBeGreaterThan(0);
    expect(result.regressions.map((entry) => entry.id)).toEqual(["q6"]);
  });
});

describe("P25 golden set", () => {
  it("gives every query a unique id and a stated reason", () => {
    const ids = GOLDEN_QUERIES.map((query) => query.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const query of GOLDEN_QUERIES) {
      // An unexplained golden is unmaintainable — nobody later knows whether a
      // failure means the retriever broke or the judgement was wrong.
      expect(query.note.length, query.id).toBeGreaterThan(20);
    }
  });

  it("judges by URL, so an edited paragraph does not invalidate it", () => {
    for (const query of GOLDEN_QUERIES) {
      for (const key of Object.keys(query.relevance)) {
        expect(key, `${query.id} judges "${key}"`).toMatch(/^\//);
      }
    }
  });

  it("does not count an unjudged query as a miss", () => {
    // The bug the first live run exposed. A query with no relevant documents
    // has a reciprocal rank of 0 by definition, and the deliberately
    // unanswerable golden was duly reported as a retrieval failure — the exact
    // opposite of what it tests.
    const goldens: GoldenQuery[] = [
      { id: "unanswerable", question: "q", relevance: {}, note: "" },
      { id: "genuine", question: "q", relevance: { a: 2 }, note: "" },
    ];
    const report = scoreAll(goldens, { unanswerable: ["x"], genuine: ["y"] }, 5);
    expect(report.misses).toEqual(["genuine"]);
  });

  it("separates a coverage gap from a ranking failure", () => {
    // The mechanism that found the gap, kept after closing it. Every judged
    // page is now reachable, so there should be nothing unanswerable — but the
    // split still runs, because it is what would catch the next page added as
    // JSX with no record behind it.
    const gaps = coverage();
    expect(gaps.unanswerable).toEqual([]);
    expect(gaps.missingUrls).toEqual([]);

    // Nothing judged as answerable may reference an unindexed page as its only
    // target, or the split has failed to do its job.
    for (const id of gaps.answerable) {
      const golden = GOLDEN_QUERIES.find((query) => query.id === id)!;
      const judged = Object.keys(golden.relevance);
      if (judged.length === 0) continue;
      expect(judged.some(isIndexed), id).toBe(true);
    }
  });

  it("knows which URL prefixes the corpus can actually emit", () => {
    expect(isIndexed("/projects/anything")).toBe(true);
    expect(isIndexed("/skills")).toBe(true);
    // These were the gap. They are now covered by SITE_PAGES in corpus.ts, and
    // asserting it here means removing one from the corpus breaks a test rather
    // than silently removing it from search.
    expect(isIndexed("/contact")).toBe(true);
    expect(isIndexed("/compute")).toBe(true);
    expect(isIndexed("/ask")).toBe(true);
    // Still genuinely absent — there is no such page.
    expect(isIndexed("/pricing")).toBe(false);
  });

  it("indexes every page the golden set judges", () => {
    // The invariant that closes the loop: if a judgement names a page, the
    // corpus has to be able to return it.
    for (const golden of GOLDEN_QUERIES) {
      for (const url of Object.keys(golden.relevance)) {
        expect(isIndexed(url), `${golden.id} judges ${url}, which is not indexed`).toBe(true);
      }
    }
  });

  it("includes an unanswerable query and a misspelled one", () => {
    // Both are load-bearing. The unanswerable one checks the retriever degrades
    // instead of confidently returning its nearest neighbour; the misspelled
    // one is the only query where lexical matching cannot help, so it measures
    // whether the vector half contributes anything at all.
    expect(GOLDEN_QUERIES.find((query) => query.id === "nonsense")?.relevance).toEqual({});
    expect(GOLDEN_QUERIES.find((query) => query.id === "typo")?.question).toMatch(/limitter/);
  });
});

describe("P25 hybrid retrieval is actually hybrid", () => {
  const source = readFileSync(join(process.cwd(), "lib", "ai", "retrieve.ts"), "utf8");

  it("falls back to OR when the strict AND query matches nothing", () => {
    // The bug this pins was invisible for two phases and cost roughly half the
    // retrieval quality on this site.
    //
    // `websearch_to_tsquery('english', 'token bucket redis')` compiles to
    // `'token' & 'bucket' & 'redi'` — every term required. No chunk contains
    // every word of a natural-language question, so the lexical retriever
    // returned an empty list for EVERY query, and RRF silently fused one list.
    // The tell was in the scores: every result was exactly 1/(60+rank).
    //
    // Nothing errored, /ask kept answering, and the codebase kept describing
    // itself as hybrid. Only measuring it found this.
    expect(source).toContain("to_tsquery");
    expect(source).toMatch(/strict\.length > 0/);
    expect(source).toContain('lexemes.join(" | ")');
  });

  it("keeps the strict pass first, so quoted phrases still work", () => {
    // websearch_to_tsquery is what supports "quoted phrases" and -exclusion.
    // Replacing it outright would have fixed recall by removing a documented
    // feature; running it first costs nothing when it matches.
    const strictAt = source.indexOf("websearch_to_tsquery");
    const orAt = source.indexOf('lexemes.join(" | ")');
    expect(strictAt).toBeGreaterThan(-1);
    expect(orAt).toBeGreaterThan(strictAt);
  });

  it("builds the OR query from stopword-stripped terms, not raw input", () => {
    // `terms()` emits alphanumeric tokens only, which is what makes it safe to
    // interpolate into to_tsquery — raw input would let a visitor inject
    // tsquery operators and throw a syntax error out of the search path.
    expect(source).toContain("const lexemes = terms(query)");
  });
});

describe("P25 drift", () => {
  it("reports zero for an identical distribution", () => {
    const distribution = { a: 10, b: 20, c: 30 };
    expect(populationStabilityIndex(distribution, distribution).psi).toBeCloseTo(0, 6);
    expect(cosineDistance(distribution, distribution)).toBeCloseTo(0, 6);
  });

  it("is insensitive to scale, because it compares proportions", () => {
    const small = { a: 1, b: 2 };
    const large = { a: 1000, b: 2000 };
    expect(populationStabilityIndex(small, large).psi).toBeCloseTo(0, 6);
  });

  it("crosses the conventional thresholds as a distribution moves", () => {
    const baseline = { a: 50, b: 30, c: 20 };
    expect(populationStabilityIndex(baseline, { a: 48, b: 31, c: 21 }).verdict).toBe("stable");
    expect(populationStabilityIndex(baseline, { a: 10, b: 20, c: 70 }).verdict).toBe("significant");
  });

  it("does not return Infinity for a brand-new bucket", () => {
    // PSI divides by the expected proportion and takes a log, so an absent
    // bucket is Infinity without the epsilon floor — one new category would
    // poison the entire score.
    const result = populationStabilityIndex({ a: 100 }, { a: 90, brandNew: 10 });
    expect(Number.isFinite(result.psi)).toBe(true);
    expect(result.newBuckets).toEqual(["brandNew"]);
  });

  it("reports lost buckets too", () => {
    expect(populationStabilityIndex({ a: 50, gone: 50 }, { a: 100 }).lostBuckets).toEqual(["gone"]);
  });

  it("ranks the buckets that moved most", () => {
    const result = populationStabilityIndex({ a: 50, b: 40, c: 10 }, { a: 10, b: 40, c: 50 });
    expect(result.contributors[0].bucket).not.toBe("b");
  });

  it("disagrees with cosine when the tail moves, which is the useful signal", () => {
    // PSI is sensitive to a large relative change in a rare bucket; cosine is
    // dominated by the common ones. When they disagree, the tail moved — which
    // is usually new content rather than a problem.
    const baseline = { common: 1000, rare: 1 };
    const shifted = { common: 1000, rare: 8 };
    expect(populationStabilityIndex(baseline, shifted).psi).toBeGreaterThan(
      cosineDistance(baseline, shifted),
    );
  });

  it("pools the tail instead of discarding it", () => {
    // Dropping the tail would let a corpus grow a thousand new rare terms
    // without moving the score — measurably stale, reported stable.
    // a:3, b:1, c:1, d:1, e:1 — seven term occurrences across four documents.
    // Head of 2 keeps a and one other; everything else must survive in __tail__
    // or the total stops matching.
    const documents = [["a", "a", "b"], ["a", "c"], ["d"], ["e"]];
    const distribution = termDistribution(documents, 2);
    expect(distribution).toHaveProperty("__tail__");
    const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(7);
  });

  it("normalises to proportions summing to one", () => {
    const shares = Object.values(normalise({ a: 1, b: 3 }));
    expect(shares.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
  });
});

describe("P25 token accounting", () => {
  it("produces more tokens than words, in the band BPE actually falls in", () => {
    // This test is why the doc comment on tokens.ts no longer claims agreement
    // with `countTokens`. An earlier version asserted the two matched within
    // 15%; they differ by about 2× because `countTokens` counts tokenizer
    // WORDS and BPE tokens are subword units. There is no local ground truth,
    // so what is checkable is the relationship, not a precision figure.
    const samples = [
      "The distributed rate limiter uses a token bucket stored in Redis, refilled lazily on read.",
      "Retrieval fuses a vector search over pgvector with a lexical index using reciprocal rank fusion.",
      "Shivam Patil is a software engineer working on backend systems and developer tooling.",
    ];

    for (const sample of samples) {
      const ratio = estimateTokens(sample) / countTokens(sample);
      expect(ratio, sample.slice(0, 40)).toBeGreaterThan(1.2);
      expect(ratio, sample.slice(0, 40)).toBeLessThan(2.5);
    }
  });

  it("grows monotonically with the text", () => {
    const short = "The rate limiter";
    expect(estimateTokens(short + " uses a token bucket")).toBeGreaterThan(estimateTokens(short));
    expect(estimateTokens("")).toBe(0);
  });

  it("counts code more densely than prose", () => {
    const prose = "this is an ordinary sentence of about the same length in characters";
    const code = "const x={a:1,b:[2,3]};f(x)=>{return x.a+x.b[0]*2};//!@#$%^&*()";
    expect(estimateTokens(code) / code.length).toBeGreaterThan(
      estimateTokens(prose) / prose.length,
    );
  });

  it("does not overcount indentation", () => {
    const flat = "a b c d e f g h";
    const indented = "a     b     c     d     e     f     g     h";
    expect(estimateTokens(indented)).toBeLessThanOrEqual(estimateTokens(flat) + 1);
  });

  it("costs nothing for the on-device models", () => {
    for (const model of MODELS.filter((entry) => entry.location === "device")) {
      expect(estimateCost(model, 100_000, 5_000).usd).toBe(0);
    }
  });

  it("prices a hosted call on both directions of tokens", () => {
    const hosted = MODELS.find((model) => model.id === "hosted-small")!;
    const estimate = estimateCost(hosted, 1_000_000, 1_000_000);
    expect(estimate.usd).toBeCloseTo(hosted.inputPerMillion + hosted.outputPerMillion, 6);
  });

  it("reserves answer space before deciding the prompt fits", () => {
    // The failure this prevents is not an error — it is a reply that stops
    // mid-sentence because the window was filled with context.
    const model = MODELS.find((entry) => entry.id === "webllm-q4")!;
    const budget = budgetFor(
      { system: "You answer from context.", passages: ["x".repeat(20_000)], question: "why?" },
      model,
    );
    expect(budget.fits).toBe(false);
    expect(budget.reservedForAnswer).toBe(512);
  });

  it("drops whole passages rather than truncating one", () => {
    // Half a passage is worse than no passage: a model asked to ground an
    // answer in a sentence that stops mid-clause will confidently finish it.
    const model = MODELS.find((entry) => entry.id === "webllm-q4")!;
    const passages = Array.from({ length: 20 }, (_, i) => `passage ${i} `.repeat(200));
    const result = fitPassages(passages, model, 200, 512);

    expect(result.dropped).toBeGreaterThan(0);
    expect(result.kept.every((passage) => passages.includes(passage))).toBe(true);
    expect(result.kept.length + result.dropped).toBe(passages.length);
  });

  it("keeps the highest-ranked passages when it drops", () => {
    const model = MODELS.find((entry) => entry.id === "webllm-q4")!;
    const passages = Array.from({ length: 20 }, (_, i) => `passage ${i} `.repeat(200));
    const result = fitPassages(passages, model, 200, 512);
    expect(result.kept[0]).toBe(passages[0]);
  });

  it("gives every model a note explaining its trade", () => {
    for (const model of MODELS) {
      expect(model.note.length, model.id).toBeGreaterThan(40);
      if (model.location === "device" && model.id !== "extractive") {
        // The download is the entire cost of an on-device model, so omitting it
        // would make the comparison meaningless.
        expect(model.downloadMb, model.id).toBeGreaterThan(0);
      }
    }
  });
});
