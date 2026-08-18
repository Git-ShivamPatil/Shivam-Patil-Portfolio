/**
 * P25 — retrieval evaluation.
 *
 * **The gap this fills is the one that matters.** P16 built hybrid retrieval —
 * a vector index in pgvector, a lexical index, and Reciprocal Rank Fusion over
 * both. What it never built was a way to tell whether any of it works. Without
 * measurement, "improving" retrieval means changing a constant and reading the
 * output of two queries you happen to remember, which is indistinguishable from
 * changing it at random.
 *
 * Every metric here is pure and takes ranked ids plus a relevance judgement, so
 * the same functions score the live index, a unit test, and any future
 * reranker. None of them touch a database.
 *
 * **Why several metrics rather than one.** They disagree, and the disagreement
 * is the information:
 *
 * - **recall@k** — did the right chunk make it into the window at all? This is
 *   the ceiling on everything downstream: an answer generator cannot cite a
 *   passage retrieval never returned.
 * - **MRR** — how high? Recall@5 treats position 1 and position 5 identically,
 *   and for a RAG prompt with a token budget they are not identical.
 * - **nDCG@k** — position-weighted and multi-grade, so "highly relevant at
 *   rank 3" and "marginally relevant at rank 1" can be compared.
 *
 * A change that raises recall while lowering MRR has moved the right answer
 * into the window and pushed it down inside it. One number would have hidden
 * that.
 */

/** Graded relevance: 0 irrelevant, 1 related, 2 exactly right. */
export type Relevance = Record<string, number>;

export interface GoldenQuery {
  id: string;
  question: string;
  /** Chunk or document ids, by grade. */
  relevance: Relevance;
  /** Why this query is in the set — an unexplained golden is unmaintainable. */
  note: string;
}

function gradeOf(relevance: Relevance, id: string): number {
  return relevance[id] ?? 0;
}

/**
 * Fraction of relevant documents that appear in the top k.
 *
 * Counts a document as relevant at grade ≥ 1. The denominator is the number of
 * *known* relevant documents, which is the honest limit of any offline
 * evaluation: a judgement set lists what someone thought to label, so an
 * unlabelled-but-perfect result scores as a miss. That biases every recall
 * figure here downward, which is the safe direction.
 */
export function recallAtK(ranked: string[], relevance: Relevance, k: number): number {
  const known = Object.values(relevance).filter((grade) => grade >= 1).length;
  if (known === 0) return 1;

  const found = ranked.slice(0, k).filter((id) => gradeOf(relevance, id) >= 1).length;
  return found / known;
}

/** Fraction of the top k that is relevant. */
export function precisionAtK(ranked: string[], relevance: Relevance, k: number): number {
  const window = ranked.slice(0, k);
  if (window.length === 0) return 0;
  return window.filter((id) => gradeOf(relevance, id) >= 1).length / window.length;
}

/**
 * Reciprocal rank of the first relevant result.
 *
 * 1 when the best answer is first, 0.5 when it is second, 0 when it is absent.
 * The steep drop-off is the point — it encodes that being second is genuinely
 * much worse than being first when only the top few results reach a prompt.
 */
export function reciprocalRank(ranked: string[], relevance: Relevance): number {
  for (let index = 0; index < ranked.length; index += 1) {
    if (gradeOf(relevance, ranked[index]) >= 1) return 1 / (index + 1);
  }
  return 0;
}

const discount = (rank: number) => 1 / Math.log2(rank + 2);

/**
 * Normalised discounted cumulative gain.
 *
 * Gain is `2^grade - 1`, which is the standard formulation and the reason
 * grades are worth having: it makes a grade-2 result worth three times a
 * grade-1 one rather than twice, so a metric cannot be gamed by returning
 * piles of marginally-related material.
 *
 * Normalised against the *ideal* ordering of the judged set, so a query with
 * one relevant document and a query with six are directly comparable.
 */
export function ndcgAtK(ranked: string[], relevance: Relevance, k: number): number {
  const dcg = ranked
    .slice(0, k)
    .reduce((total, id, index) => total + (2 ** gradeOf(relevance, id) - 1) * discount(index), 0);

  const ideal = Object.values(relevance)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((total, grade, index) => total + (2 ** grade - 1) * discount(index), 0);

  // No judged-relevant documents at all: nDCG is undefined rather than zero,
  // and reporting 0 would drag an average down for a query nobody labelled.
  return ideal === 0 ? 1 : dcg / ideal;
}

export interface QueryScore {
  id: string;
  question: string;
  recall: number;
  precision: number;
  mrr: number;
  ndcg: number;
  /** 1-based position of the first relevant result, or null. */
  firstRelevantAt: number | null;
  returned: number;
}

export interface EvalReport {
  k: number;
  queries: QueryScore[];
  mean: { recall: number; precision: number; mrr: number; ndcg: number };
  /** Queries where nothing relevant was retrieved at all. */
  misses: string[];
}

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

/**
 * Score a set of golden queries against whatever the retriever returned.
 *
 * `results` is a map from query id to ranked ids, so this function never
 * decides how retrieval happens — which is what lets it score the live index
 * and a fixture identically.
 */
export function scoreAll(
  goldens: GoldenQuery[],
  results: Record<string, string[]>,
  k = 5,
): EvalReport {
  const queries: QueryScore[] = goldens.map((golden) => {
    const ranked = results[golden.id] ?? [];
    const rank = ranked.findIndex((id) => gradeOf(golden.relevance, id) >= 1);

    return {
      id: golden.id,
      question: golden.question,
      recall: recallAtK(ranked, golden.relevance, k),
      precision: precisionAtK(ranked, golden.relevance, k),
      mrr: reciprocalRank(ranked, golden.relevance),
      ndcg: ndcgAtK(ranked, golden.relevance, k),
      firstRelevantAt: rank === -1 ? null : rank + 1,
      returned: ranked.length,
    };
  });

  return {
    k,
    queries,
    mean: {
      recall: mean(queries.map((query) => query.recall)),
      precision: mean(queries.map((query) => query.precision)),
      mrr: mean(queries.map((query) => query.mrr)),
      ndcg: mean(queries.map((query) => query.ndcg)),
    },
    // Listed by name rather than counted. An average that drifts from 0.82 to
    // 0.79 tells nobody what to fix; "these three questions return nothing
    // useful" is a task.
    //
    // A query with NO judged-relevant documents is excluded. Its reciprocal
    // rank is 0 by definition — there is nothing relevant to rank — and the
    // first live run duly reported the deliberately-unanswerable query as a
    // retrieval failure, which is the opposite of what it tests.
    misses: queries
      .filter((query) => {
        const golden = goldens.find((entry) => entry.id === query.id);
        const judged = Object.values(golden?.relevance ?? {}).some((grade) => grade >= 1);
        return judged && query.mrr === 0;
      })
      .map((query) => query.id),
  };
}

/**
 * Compare two runs.
 *
 * Reported per query as well as in aggregate, because the aggregate hides the
 * shape of a change: a tweak that helps eight queries slightly and destroys two
 * has the same mean delta as one that helps everything a little, and only the
 * first is a regression waiting to be noticed by a visitor.
 */
export interface Comparison {
  id: string;
  question: string;
  before: number;
  after: number;
  delta: number;
}

export function compare(
  before: EvalReport,
  after: EvalReport,
): {
  perQuery: Comparison[];
  regressions: Comparison[];
  meanDelta: number;
} {
  const byId = new Map(before.queries.map((query) => [query.id, query]));

  const perQuery: Comparison[] = after.queries.map((query) => {
    const previous = byId.get(query.id);
    return {
      id: query.id,
      question: query.question,
      before: previous?.ndcg ?? 0,
      after: query.ndcg,
      delta: query.ndcg - (previous?.ndcg ?? 0),
    };
  });

  return {
    perQuery,
    // A tolerance, not zero: nDCG moves by rounding when two results tie, and a
    // gate that fires on 1e-9 is a gate that gets switched off.
    regressions: perQuery.filter((entry) => entry.delta < -0.01),
    meanDelta: after.mean.ndcg - before.mean.ndcg,
  };
}
