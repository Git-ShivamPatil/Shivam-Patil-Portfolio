import { retrieve } from "../ai/retrieve";
import { scoreAll, type EvalReport, type GoldenQuery } from "./eval";

/**
 * P25 — the labelled relevance set.
 *
 * lib/ai/retrieve.ts says of Reciprocal Rank Fusion: *"It also needs no tuning,
 * which matters when there is no labelled relevance set to tune against."* That
 * was true and is the gap this file closes. RRF still needs no tuning — the
 * point is no longer to tune it, but to be able to tell whether replacing it
 * with something else would be an improvement or a regression.
 *
 * **Judged by URL, not by chunk id.** Chunk ids are derived from content
 * hashes, so they change every time a paragraph is edited and a judgement set
 * keyed on them would rot on contact with ordinary writing. A URL is the stable
 * identity of "the thing that should have been retrieved", and a query is
 * satisfied if any chunk of the right page comes back.
 *
 * **Twelve queries is a small set and its smallness is the honest limitation.**
 * Enough to catch a retriever that has broken outright; nowhere near enough to
 * distinguish two good rankings, where the confidence interval on twelve
 * queries is wider than any difference worth shipping. Growing it means writing
 * judgements by hand, which is the actual cost of evaluation and the reason so
 * much retrieval ships unmeasured.
 *
 * Grades: 2 is "this is the page the question is about", 1 is "genuinely
 * related and a reasonable thing to return", 0 is everything else.
 */
export const GOLDEN_QUERIES: GoldenQuery[] = [
  {
    id: "rate-limiter",
    question: "How does the distributed rate limiter work?",
    relevance: { "/projects/distributed-rate-limiter-api-gateway": 2, "/system-design": 1 },
    note: "Direct lookup by topic. If this fails, retrieval is broken outright.",
  },
  {
    id: "token-bucket",
    question: "token bucket algorithm redis",
    relevance: { "/projects/distributed-rate-limiter-api-gateway": 2, "/system-design": 1 },
    note: "Keyword-shaped rather than a question — the lexical half should carry this one.",
  },
  {
    id: "llm-inference",
    question: "What did you do to make LLM inference faster?",
    relevance: { "/projects/high-performance-llm-inference-server": 2 },
    note: "Natural language with no shared vocabulary beyond 'inference'.",
  },
  {
    id: "agentic",
    question: "agent orchestration tool calling",
    relevance: { "/projects/agentic-ai-orchestration-platform": 2 },
    note: "Three terms, all of which appear on exactly one page.",
  },
  {
    id: "experience",
    question: "Where has Shivam worked?",
    relevance: { "/experience": 2, "/about": 1, "/resume": 1 },
    note: "Several pages are legitimately relevant — tests that grading is used at all.",
  },
  {
    id: "skills",
    question: "What technologies does he know?",
    relevance: { "/skills": 2, "/experience": 1, "/projects": 1 },
    note: "Broad question with a clear best answer and several acceptable ones.",
  },
  {
    id: "contact",
    question: "How do I get in touch?",
    relevance: { "/contact": 2, "/reach-out": 2 },
    note: "Two pages equally correct. Either at rank 1 should score the same.",
  },
  {
    id: "hire",
    question: "Can I hire him for consulting?",
    relevance: { "/services": 2, "/contact": 1, "/reach-out": 1 },
    note: "Commercial intent phrased without any word on the target page's title.",
  },
  {
    id: "vector-search",
    question: "how does search on this site work",
    relevance: { "/ask": 2, "/system-design": 1 },
    note: "Self-referential. The corpus describes its own retrieval, so this should be easy — and it is a good canary for the index being stale.",
  },
  {
    id: "wasm",
    question: "WebAssembly and WebGPU benchmarks",
    relevance: { "/compute": 2 },
    note: "Terms that appear on one lab page and nowhere else.",
  },
  {
    id: "nonsense",
    question: "quantum blockchain synergy",
    relevance: {},
    note: "Deliberately unanswerable. An empty judgement set means recall and nDCG are 1 by definition; what this actually checks is that the retriever does not crash and that /ask degrades honestly rather than confidently returning the nearest thing it has.",
  },
  {
    id: "typo",
    question: "distrbuted rate limitter",
    relevance: { "/projects/distributed-rate-limiter-api-gateway": 2 },
    note: "Two misspellings. Lexical matching fails here by construction, so this measures whether the vector half is contributing anything at all.",
  },
];

/**
 * Every URL prefix `buildCorpus()` can actually emit.
 *
 * **This list exists because the first live evaluation reported 42% recall and
 * seven misses, and most of them were not retrieval failures at all.** The
 * corpus indexes projects, blog posts, skills, service offerings, experience,
 * achievements and certifications — and nothing else. `/contact`, `/ask`,
 * `/compute`, `/reach-out`, `/about` and `/resume` are not in it, so no
 * retriever could ever have returned them and judging them measured coverage
 * while pretending to measure ranking.
 *
 * The judgements are deliberately NOT edited to match. A query someone would
 * really ask — "how do I get in touch" — is a legitimate thing to want answered,
 * and quietly deleting it because the corpus cannot answer it would improve the
 * score by hiding the gap. Instead the gap is reported separately, and the
 * ranking metrics are computed over the queries the index could in principle
 * satisfy.
 *
 * Keep in step with `buildCorpus()` in lib/ai/corpus.ts.
 */
export const INDEXED_PREFIXES = [
  "/projects/",
  "/blog/",
  "/skills",
  "/services",
  "/experience",
  "/achievements",
  "/certifications",
] as const;

export function isIndexed(url: string): boolean {
  return INDEXED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export interface Coverage {
  /** Queries every judged page of which is outside the corpus. */
  unanswerable: { id: string; question: string; judged: string[] }[];
  /** Judged URLs the corpus can never return, deduplicated. */
  missingUrls: string[];
  /** Queries the index could in principle satisfy. */
  answerable: string[];
}

/**
 * Split the golden set by whether the corpus could answer it at all.
 *
 * This is the distinction that turns "retrieval scores 42%" — alarming and
 * unactionable — into two separate statements: how well ranking works on the
 * content that exists, and which content does not exist. They have completely
 * different fixes. The first is a retrieval problem; the second is four lines
 * in `buildCorpus`.
 */
export function coverage(goldens: GoldenQuery[] = GOLDEN_QUERIES): Coverage {
  const unanswerable: Coverage["unanswerable"] = [];
  const answerable: string[] = [];
  const missing = new Set<string>();

  for (const golden of goldens) {
    const judged = Object.keys(golden.relevance);
    // No judgements at all is the deliberately-unanswerable query. It is not a
    // coverage gap — it is a test that the retriever degrades honestly.
    if (judged.length === 0) {
      answerable.push(golden.id);
      continue;
    }

    const reachable = judged.filter(isIndexed);
    for (const url of judged.filter((url) => !isIndexed(url))) missing.add(url);

    if (reachable.length === 0)
      unanswerable.push({ id: golden.id, question: golden.question, judged });
    else answerable.push(golden.id);
  }

  return { unanswerable, missingUrls: [...missing].sort(), answerable };
}

/**
 * Run the golden set against the live index.
 *
 * Sequential rather than parallel, deliberately. Twelve concurrent retrievals
 * each running a pgvector query is a burst of load in service of a page nobody
 * is waiting on, and the whole evaluation still finishes in about a second.
 */
export interface Evaluation {
  /** Scored over the queries the corpus could satisfy. */
  report: EvalReport;
  coverage: Coverage;
}

export async function runEvaluation(k = 5): Promise<Evaluation> {
  const gaps = coverage();
  // Ranking is scored only over queries whose answer is in the corpus.
  // Including the rest would fold a content gap into a retrieval metric and
  // make both unreadable — which is exactly what the first run did.
  const scored = GOLDEN_QUERIES.filter((golden) => gaps.answerable.includes(golden.id));

  const results: Record<string, string[]> = {};

  for (const golden of scored) {
    try {
      const chunks = await retrieve(golden.question, { limit: k });
      // Deduplicated to page level, preserving rank. Three chunks of the right
      // page occupying the top three slots is one correct answer, not three,
      // and counting it as three would flatter precision enormously.
      const seen = new Set<string>();
      results[golden.id] = chunks
        .map((chunk) => chunk.url)
        .filter((url) => (seen.has(url) ? false : (seen.add(url), true)));
    } catch {
      // A failed retrieval scores as a miss rather than aborting the run. The
      // report is more useful with eleven queries and a visible gap than with
      // an exception.
      results[golden.id] = [];
    }
  }

  return { report: scoreAll(scored, results, k), coverage: gaps };
}
