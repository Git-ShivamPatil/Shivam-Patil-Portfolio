/**
 * P21 — quantiles out of a cumulative histogram.
 *
 * Pure, dependency-free and separate from the recorder so it can be imported by
 * a client component and covered by unit tests without a database.
 *
 * **Why a histogram at all, when a sum and a count are cheaper.** Because the
 * mean is the one latency statistic that is never actionable. A route that
 * answers in 20ms for 99 requests and 4 seconds for the hundredth has a mean of
 * 60ms, which looks excellent and describes nobody's experience. Percentiles
 * need the distribution, and the distribution has to be summable across
 * instances — which is precisely what fixed cumulative buckets are and what a
 * list of raw durations is not.
 */

/**
 * Interpolate a quantile, using Prometheus' `histogram_quantile` algorithm.
 *
 * `cumulative` is bucket counts including the final +Inf, so it is one longer
 * than `boundaries`. Both must be ordered.
 *
 * **The approximation is real and worth naming.** Inside a bucket the algorithm
 * assumes values are spread evenly, which they are not — so a p99 read off
 * boundaries of 2500 and 5000 can be out by hundreds of milliseconds. The
 * result is exact only in that it names the right bucket. That is the trade a
 * summable histogram makes, and it is why the buckets in lib/sre/red.ts are
 * dense where this app's latencies actually sit.
 *
 * Returns null rather than 0 for "no data": a p95 of zero on an idle route
 * reads as impossibly fast rather than as absent, and a chart will happily draw
 * it.
 */
export function histogramQuantile(
  cumulative: readonly number[],
  boundaries: readonly number[],
  quantile: number,
): number | null {
  if (cumulative.length !== boundaries.length + 1) {
    throw new Error(
      `histogram: ${cumulative.length} counts for ${boundaries.length} boundaries — expected ${boundaries.length + 1}`,
    );
  }
  if (quantile < 0 || quantile > 1) throw new Error(`histogram: quantile ${quantile} out of range`);

  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return null;

  const rank = quantile * total;

  // The first bucket whose cumulative count reaches the rank.
  let index = 0;
  while (index < cumulative.length && cumulative[index] < rank) index += 1;

  // Landed in +Inf: the quantile is somewhere above the highest finite
  // boundary and there is no upper edge to interpolate towards. Reporting the
  // boundary itself is the honest floor — it is a "at least this" answer, and
  // Prometheus does the same.
  if (index >= boundaries.length) return boundaries[boundaries.length - 1];

  const lower = index === 0 ? 0 : boundaries[index - 1];
  const upper = boundaries[index];
  const countBelow = index === 0 ? 0 : cumulative[index - 1];
  const countInBucket = cumulative[index] - countBelow;

  if (countInBucket <= 0) return upper;

  return lower + (upper - lower) * ((rank - countBelow) / countInBucket);
}

/**
 * Round a quantile, and never let it exceed the slowest observation.
 *
 * Interpolation assumes an even spread inside a bucket, so a p99 drawn from the
 * 500–1000ms bucket can land at 980ms when the slowest request actually took
 * 935ms. Prometheus has the same artefact and cannot fix it, because it has no
 * maximum to check against. This does — the max is recorded exactly — and a
 * percentile above the observed maximum is not a conservative estimate, it is a
 * number no request produced, sitting in a table next to the column that
 * contradicts it.
 *
 * Clamping only ever lowers the figure towards a value that was really
 * measured, so it cannot make a slow route look fast.
 */
export function clampQuantile(value: number | null, observedMax: number): number | null {
  if (value === null) return null;
  const rounded = Math.round(value);
  return observedMax > 0 ? Math.min(rounded, observedMax) : rounded;
}

/**
 * Add two cumulative histograms.
 *
 * This is the operation that makes per-instance deltas meaningful: summing the
 * buckets of every row in a window is the same distribution as if one process
 * had observed every request. Nothing else about the recording pipeline gives
 * that property — it is the whole reason for storing buckets rather than
 * percentiles, which cannot be averaged.
 */
export function addHistograms(a: readonly number[], b: readonly number[]): number[] {
  if (a.length !== b.length) throw new Error("histogram: cannot add different bucket layouts");
  return a.map((value, index) => value + b[index]);
}
