/**
 * P16 — embeddings, computed here rather than bought.
 *
 * **Why there is no embedding API call in this file.** Every hosted embedding
 * provider is metered, and "free tier only" is a standing constraint on this
 * project — the same one that removed Mapbox and chose R2 for its zero egress.
 * The alternatives were: run a transformer server-side (a ~500MB dependency and
 * a cold start on every serverless invocation), run one in the browser (then
 * the index and the query would have to be embedded by the *same* model, which
 * puts it back on the server), or build a deterministic embedding that costs
 * nothing and runs anywhere. This is the third.
 *
 * **What it actually is, stated plainly.** A hashed TF-IDF vector: tokens are
 * hashed into a fixed number of dimensions, weighted by sublinear term
 * frequency times inverse document frequency, and L2-normalised so cosine
 * similarity is a dot product. That is a *lexical* embedding. It does not know
 * that "Kubernetes" and "container orchestration" are related, and no amount of
 * tuning will teach it — that is what a trained model buys and this does not
 * have. What it does give is a real vector space with real neighbourhoods,
 * genuinely useful ranking over a corpus this size, and complete independence
 * from anyone's uptime or billing.
 *
 * **This is why retrieval is hybrid** (see retrieve.ts). Dense lexical vectors
 * and Postgres full-text search fail in different ways, so fusing them recovers
 * a good deal of what a semantic model would have given: bigrams and the
 * character-level fallback catch morphology and typos, while ts_rank catches
 * exact rare terms that hashing can collide.
 *
 * Nothing here imports anything server-only, because the query side runs in the
 * browser too — the same function must produce the same vector on both sides or
 * the whole index is meaningless.
 */

/** Vector width. */
export const EMBEDDING_DIMS = 256;

/**
 * Words carrying no retrieval signal in this corpus.
 *
 * Kept small on purpose. An aggressive stopword list is a way to accidentally
 * delete meaning — "no", "not" and "own" all change what a sentence claims, and
 * a portfolio full of "systems that hold up" would lose its own phrasing.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "did", "do", "does",
  "for", "from", "had", "has", "have", "he", "her", "his", "how", "i", "if", "in", "into", "is",
  "it", "its", "of", "on", "or", "our", "she", "so", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "to", "was", "we", "were", "what", "when", "where",
  "which", "who", "why", "will", "with", "you", "your",
]);

/**
 * A deliberately light suffix stripper.
 *
 * Not a Porter stemmer: full stemming conflates words that matter here
 * ("service" and "serving", "cache" and "caching" are fine to merge; "index"
 * and "indices" are not reachable by suffix rules anyway). This collapses the
 * inflections that actually cause misses — plurals and the common verb forms —
 * and leaves everything else alone. Short words are never stemmed, because
 * "sees" -> "se" is noise, not a root.
 */
function stem(word: string): string {
  if (word.length <= 4) return dropSilentE(word);

  for (const suffix of ["ings", "ing", "ies", "ied", "es", "ed", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      const root = word.slice(0, -suffix.length);
      // "ies" -> "y" keeps "queries"/"query" together.
      if (suffix === "ies" || suffix === "ied") return `${root}y`;
      return dropSilentE(root);
    }
  }
  return dropSilentE(word);
}

/**
 * Drop a trailing "e", which is what makes the suffix rules symmetric.
 *
 * Without it "caching" stems to "cach" while "cache" stays "cache", so the two
 * never match — and the same gap swallowed "service"/"services" and
 * "type"/"typing". English drops a silent "e" before "-ing", so stripping it
 * from both sides is what closes that.
 *
 * The output is not always a word: "service" becomes "servic". That is fine and
 * worth stating, because it looks wrong at a glance — these stems are hash
 * keys, not text anyone reads, so the only property that matters is that two
 * spellings of one idea produce the same key.
 *
 * **The length floor is 5, not 4, and that is a deliberate retreat.** At 4 the
 * rule also collapses "rate" to "rat", "site" to "sit" and "time" to "tim",
 * which collides distinct words for very little gain: the plural forms already
 * agree without it ("rates" strips its "s" to "rate"), so all 4 buys is the
 * "-ing" form of four-letter words, at the cost of real collisions in a hashed
 * space where a collision is invisible.
 */
function dropSilentE(word: string): string {
  return word.length > 4 && word.endsWith("e") ? word.slice(0, -1) : word;
}

/**
 * Text to terms.
 *
 * Diacritics are folded so "Kubernetes" and a pasted "Kubernetés" agree.
 * Numbers survive: "8080", "p99" and "2026" are all things someone searches a
 * portfolio for.
 */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length > 1 && token.length < 40 && !STOPWORDS.has(token))
    .map(stem);
}

/**
 * Unigrams plus adjacent bigrams.
 *
 * Bigrams are what let "rate limiter" outrank a document that mentions "rate"
 * and "limiter" in unrelated sentences. They are built from the *stopword-free*
 * stream on purpose: "the rate of the limiter" and "rate limiter" should
 * produce the same pair.
 */
export function terms(text: string): string[] {
  const tokens = tokenize(text);
  const output = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    output.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return output;
}

/**
 * FNV-1a, 32-bit.
 *
 * Chosen because it is tiny, has no dependencies, and is *stable across
 * runtimes and versions* — which is the only property that matters here. A hash
 * that changed between Node releases would silently invalidate every stored
 * vector while every test still passed.
 */
export function hashTerm(term: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < term.length; i++) {
    hash ^= term.charCodeAt(i);
    // The FNV prime, via shifts: a plain multiply overflows into a float.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** Document frequencies, plus the number of documents they were counted over. */
export interface IdfModel {
  documentCount: number;
  /** term -> number of documents containing it. */
  documentFrequency: Record<string, number>;
}

export const EMPTY_IDF: IdfModel = { documentCount: 0, documentFrequency: {} };

/**
 * Count document frequencies across the corpus.
 *
 * The IDF snapshot is stored alongside the index and reused for query
 * embedding, because a query vector weighted by different IDF values than the
 * documents is a query in a different space. That is also why reindexing always
 * rebuilds everything rather than updating a few rows: changing IDF changes
 * every vector.
 */
export function buildIdf(documents: string[]): IdfModel {
  const documentFrequency: Record<string, number> = {};
  for (const document of documents) {
    for (const term of new Set(terms(document))) {
      documentFrequency[term] = (documentFrequency[term] ?? 0) + 1;
    }
  }
  return { documentCount: documents.length, documentFrequency };
}

/**
 * Smoothed inverse document frequency.
 *
 * The +1s are not decoration. Without them a term appearing in every document
 * gets weight 0 and one appearing in none divides by zero — and the query side
 * regularly sees terms the corpus has never contained.
 */
function idfFor(term: string, model: IdfModel): number {
  const df = model.documentFrequency[term] ?? 0;
  return Math.log((model.documentCount + 1) / (df + 1)) + 1;
}

/**
 * Text to a unit vector.
 *
 * Sublinear term frequency (1 + log tf) rather than raw counts, because the
 * tenth mention of "Postgres" in a page about Postgres says much less than the
 * first. L2 normalisation at the end is what makes cosine similarity a plain
 * dot product — and what makes a long document comparable to a short query.
 *
 * The sign trick — hashing once more to decide whether a term adds or subtracts
 * — is the standard hashing-trick correction: collisions between two terms in
 * the same dimension then cancel on average instead of always reinforcing, so a
 * collision degrades a score rather than inventing a match.
 */
export function embed(text: string, model: IdfModel = EMPTY_IDF): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMS);
  const counts = new Map<string, number>();
  for (const term of terms(text)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  if (counts.size === 0) return vector;

  for (const [term, count] of counts) {
    const hash = hashTerm(term);
    const dimension = hash % EMBEDDING_DIMS;
    const sign = (hash >>> 31) & 1 ? -1 : 1;
    const tf = 1 + Math.log(count);
    vector[dimension] += sign * tf * idfFor(term, model);
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  // An all-zero vector stays all-zero: dividing by 0 would fill it with NaN,
  // and a NaN vector poisons every comparison it takes part in.
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIMS; i++) vector[i] /= norm;
  }
  return vector;
}

/** Cosine similarity. Both vectors are expected to be unit length. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i];
  return sum;
}

/** pgvector's literal syntax: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: Float32Array): string {
  // Six decimals is well inside float4's precision and keeps the literal short
  // enough that a 256-dimension insert is not mostly digits.
  return `[${Array.from(vector, (value) => value.toFixed(6)).join(",")}]`;
}
