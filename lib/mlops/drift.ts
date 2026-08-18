/**
 * P25 — drift detection.
 *
 * **What drifts here, and what does not.** There is no trained model in this
 * application — the embedding in lib/ai/embed.ts is a hashed bag-of-terms with
 * IDF weighting, and IDF is fitted to the corpus. So the thing that goes stale
 * is not model weights; it is the **relationship between the index and the
 * corpus it was built from**. Every project added, every post published, moves
 * the term distribution a little, and the IDF baked into the index at build
 * time drifts away from the one the live corpus would produce.
 *
 * That is a real failure and a quiet one: retrieval keeps working, gradually
 * worse, weighting terms by a document frequency that stopped being true months
 * ago. Nothing errors. The only way to notice is to measure the distance.
 *
 * PSI is the standard instrument and it is worth stating what it actually is: a
 * symmetric sum of `(actual − expected) × ln(actual / expected)` over bucketed
 * proportions. The conventional reading — under 0.1 stable, 0.1–0.25 moderate,
 * above 0.25 significant — comes from credit-risk modelling in the 1990s and is
 * a convention, not a theorem. It is used here because a shared convention that
 * everyone reads the same way beats a bespoke threshold nobody can calibrate.
 *
 * Pure, so the page, the tests and any future cron all compute the same number.
 */

export type Bucketed = Record<string, number>;

/** Convert counts into proportions that sum to 1. */
export function normalise(counts: Bucketed): Bucketed {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) return {};

  const out: Bucketed = {};
  for (const [key, value] of Object.entries(counts)) out[key] = value / total;
  return out;
}

/**
 * Floor applied to an empty bucket.
 *
 * PSI divides by the expected proportion and takes a logarithm, so a bucket
 * present in one distribution and absent from the other produces `Infinity` and
 * poisons the whole score. Substituting a small epsilon is the standard
 * treatment. It is also a real distortion — a genuinely new category is
 * *interesting*, and this reports it as merely large rather than infinite — so
 * `newBuckets` below surfaces it separately instead of letting it hide inside
 * the number.
 */
const EPSILON = 1e-4;

export interface DriftResult {
  psi: number;
  /** "stable" | "moderate" | "significant", by the conventional thresholds. */
  verdict: "stable" | "moderate" | "significant";
  /** Buckets contributing most, largest first. */
  contributors: { bucket: string; contribution: number; expected: number; actual: number }[];
  /** Present now, absent from the baseline. */
  newBuckets: string[];
  /** In the baseline, gone now. */
  lostBuckets: string[];
}

export function populationStabilityIndex(expected: Bucketed, actual: Bucketed): DriftResult {
  const expectedShare = normalise(expected);
  const actualShare = normalise(actual);
  const buckets = new Set([...Object.keys(expectedShare), ...Object.keys(actualShare)]);

  const contributors: DriftResult["contributors"] = [];
  let psi = 0;

  for (const bucket of buckets) {
    const e = expectedShare[bucket] ?? 0;
    const a = actualShare[bucket] ?? 0;
    const eSafe = Math.max(e, EPSILON);
    const aSafe = Math.max(a, EPSILON);

    const contribution = (aSafe - eSafe) * Math.log(aSafe / eSafe);
    psi += contribution;
    contributors.push({ bucket, contribution, expected: e, actual: a });
  }

  contributors.sort((left, right) => right.contribution - left.contribution);

  return {
    psi,
    verdict: psi < 0.1 ? "stable" : psi < 0.25 ? "moderate" : "significant",
    contributors: contributors.slice(0, 10),
    newBuckets: [...buckets].filter(
      (bucket) => !(bucket in expectedShare) && bucket in actualShare,
    ),
    lostBuckets: [...buckets].filter(
      (bucket) => bucket in expectedShare && !(bucket in actualShare),
    ),
  };
}

/**
 * Cosine distance between two distributions treated as vectors.
 *
 * Reported alongside PSI because the two answer different questions and are
 * both easy to over-read on their own. PSI is sensitive to a large relative
 * change in a rare bucket — a term going from 0.1% to 0.4% is a quadrupling and
 * PSI says so loudly. Cosine is dominated by the common buckets and barely
 * moves. When they disagree, the disagreement locates the change: PSI high and
 * cosine flat means the tail moved, which is usually new content rather than a
 * problem.
 */
export function cosineDistance(expected: Bucketed, actual: Bucketed): number {
  const a = normalise(expected);
  const b = normalise(actual);
  const buckets = new Set([...Object.keys(a), ...Object.keys(b)]);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const bucket of buckets) {
    const left = a[bucket] ?? 0;
    const right = b[bucket] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Bucket a corpus by term, keeping the head and pooling the tail.
 *
 * The tail is pooled rather than dropped. Dropping it would let a corpus grow a
 * thousand new rare terms without moving the score at all — the index would be
 * measurably stale and the drift metric would report stability, which is worse
 * than having no metric.
 */
export function termDistribution(documents: string[][], headSize = 60): Bucketed {
  const counts: Bucketed = {};
  for (const document of documents) {
    for (const term of document) counts[term] = (counts[term] ?? 0) + 1;
  }

  const sorted = Object.entries(counts).sort((left, right) => right[1] - left[1]);
  const head = sorted.slice(0, headSize);
  const tail = sorted.slice(headSize);

  const out: Bucketed = Object.fromEntries(head);
  if (tail.length > 0) {
    out["__tail__"] = tail.reduce((total, [, value]) => total + value, 0);
  }
  return out;
}
