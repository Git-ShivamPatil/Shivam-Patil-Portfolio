import { terms } from "./embed";
import type { RetrievedChunk } from "./retrieve";

/**
 * P16 — the answer, composed by extraction rather than generation.
 *
 * **This is the default because it cannot hallucinate.** Every sentence it
 * returns is a sentence that exists verbatim in the site's own content, chosen
 * for overlap with the question and shown with the passage it came from. On a
 * page whose job is to describe a real person's real work, a fluent invented
 * claim is not a smaller failure than an awkward true one — it is a much larger
 * one, and the visitor has no way to tell.
 *
 * Generation is available (the WebLLM path), it runs in the visitor's own
 * browser, and it is grounded on exactly these chunks. It is opt-in, and this
 * is what it is opt-in *from*.
 */

export interface AnswerSource {
  title: string;
  heading: string | null;
  url: string;
  source: string;
}

export interface ExtractiveAnswer {
  text: string;
  sentences: { text: string; url: string; title: string }[];
  sources: AnswerSource[];
  confidence: "high" | "low" | "none";
}

/** Sentence splitter that keeps abbreviations and decimals intact. */
export function splitSentences(text: string): string[] {
  return text
    // Split after . ! ? only when followed by whitespace and a capital or digit,
    // so "p99." and "45K req/s." do not become sentence boundaries.
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 25);
}

/**
 * How well a sentence answers the question.
 *
 * Overlap of query terms, normalised by sentence length so a long paragraph
 * cannot win by containing everything. The length normalisation is
 * deliberately gentle (square root, not linear): a fully linear penalty picks
 * terse fragments that happen to repeat a keyword, which read like a search
 * result rather than an answer.
 */
export function scoreSentence(sentence: string, queryTerms: Set<string>): number {
  return sentenceMatch(sentence, queryTerms).score;
}

export interface SentenceMatch {
  score: number;
  /** Distinct single-word query terms this sentence contains. */
  matchedUnigrams: string[];
}

/**
 * Score a sentence, and report *what* it matched.
 *
 * The matched terms come back alongside the score because confidence needs a
 * different question answered than ranking does. Ranking asks "which of these
 * sentences is best"; confidence asks "is the best one actually an answer", and
 * a score good enough to win a weak field is not evidence of that.
 */
export function sentenceMatch(sentence: string, queryTerms: Set<string>): SentenceMatch {
  const sentenceTerms = terms(sentence);
  if (sentenceTerms.length === 0) return { score: 0, matchedUnigrams: [] };

  let overlap = 0;
  const seen = new Set<string>();
  const matchedUnigrams: string[] = [];

  for (const term of sentenceTerms) {
    if (!queryTerms.has(term) || seen.has(term)) continue;
    seen.add(term);
    // Bigrams are worth more: matching "rate_limiter" is a stronger signal than
    // matching "rate" and "limiter" separately, which the unigrams already
    // counted. They are excluded from matchedUnigrams so confidence counts
    // distinct *concepts* rather than double-counting one phrase.
    if (term.includes("_")) overlap += 2;
    else {
      overlap += 1;
      matchedUnigrams.push(term);
    }
  }

  if (overlap === 0) return { score: 0, matchedUnigrams };
  return { score: overlap / Math.sqrt(sentenceTerms.length), matchedUnigrams };
}

/**
 * Preference for sentences from better-retrieved passages.
 *
 * Without it, ranking is blind to retrieval: measured on "how did he improve
 * RAG accuracy", the correct sentence (from the second-ranked chunk) beat a
 * wrong one from the first by 0.31 to 0.25, which is close enough that ordinary
 * variation would flip it. The decay is gentle on purpose — retrieval order is
 * evidence, not an answer, and a genuinely better sentence three chunks down
 * should still be able to win.
 */
function rankWeight(chunkRank: number): number {
  return 1 / (1 + chunkRank * 0.25);
}

/** How many sentences an answer may quote before it stops being an answer. */
const MAX_SENTENCES = 3;

export function composeAnswer(question: string, chunks: RetrievedChunk[]): ExtractiveAnswer {
  const queryTerms = new Set(terms(question));

  const scored: {
    text: string;
    url: string;
    title: string;
    score: number;
    matchedUnigrams: string[];
  }[] = [];

  chunks.forEach((chunk, chunkRank) => {
    for (const sentence of splitSentences(chunk.content)) {
      const match = sentenceMatch(sentence, queryTerms);
      if (match.score <= 0) continue;
      scored.push({
        text: sentence,
        url: chunk.url,
        title: chunk.title,
        score: match.score * rankWeight(chunkRank),
        matchedUnigrams: match.matchedUnigrams,
      });
    }
  });

  scored.sort((a, b) => b.score - a.score);

  // Near-duplicates are common: a project summary and its use case often say
  // the same thing twice. Quoting both wastes the whole answer.
  const chosen: typeof scored = [];
  for (const candidate of scored) {
    if (chosen.length >= MAX_SENTENCES) break;
    const candidateTerms = new Set(terms(candidate.text));
    const duplicate = chosen.some((existing) => {
      const existingTerms = terms(existing.text);
      const shared = existingTerms.filter((term) => candidateTerms.has(term)).length;
      return shared / Math.max(1, existingTerms.length) > 0.6;
    });
    if (!duplicate) chosen.push(candidate);
  }

  const sources: AnswerSource[] = [];
  const seenUrls = new Set<string>();
  for (const chunk of chunks) {
    const key = `${chunk.url}#${chunk.heading ?? ""}`;
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    sources.push({
      title: chunk.title,
      heading: chunk.heading,
      url: chunk.url,
      source: chunk.source,
    });
  }

  if (chosen.length === 0) {
    return {
      // Saying so is the correct answer. The alternative — returning the
      // best-ranked passage regardless of whether it addresses the question —
      // is how a retrieval system starts confidently answering things it was
      // never asked.
      text:
        chunks.length > 0
          ? "Nothing on the site directly answers that, but these pages are the closest match."
          : "Nothing on the site matches that yet.",
      sentences: [],
      sources,
      confidence: chunks.length > 0 ? "low" : "none",
    };
  }

  /**
   * Confidence, calibrated against measured scores rather than guessed.
   *
   * The first version required a raw score of 1.0, which turned out to be
   * unreachable: real answers on this corpus score 0.19 to 0.33, because the
   * score is divided by the square root of the sentence length. A confidence
   * signal that can never fire is worse than none — it reads as permanent
   * uncertainty about answers that are in fact correct.
   *
   * So it is expressed in terms that mean something instead:
   *
   * - **At least two distinct query words matched.** One is not enough, and the
   *   measured example is exactly why: "where does he work?" reduces to the
   *   single content word "work", which matched "knowledge-work" in an
   *   unrelated project and produced a confidently wrong answer. A question
   *   with one content word is genuinely ambiguous, and no scoring change
   *   fixes that.
   * - **Half the question's content words are covered.** "Found something
   *   related" and "answered what was asked" are different claims.
   * - **Some passage was found by both retrievers.** Dense and sparse retrieval
   *   fail differently, so agreement between them is independent evidence.
   */
  const queryUnigrams = [...queryTerms].filter((term) => !term.includes("_"));
  const matched = new Set(chosen.flatMap((sentence) => sentence.matchedUnigrams));
  const coverage = queryUnigrams.length === 0 ? 0 : matched.size / queryUnigrams.length;
  const bothRetrievers = chunks.some((chunk) => chunk.matchedBy.length > 1);

  return {
    text: chosen.map((sentence) => sentence.text).join(" "),
    sentences: chosen.map(({ text, url, title }) => ({ text, url, title })),
    sources,
    confidence: matched.size >= 2 && coverage >= 0.5 && bothRetrievers ? "high" : "low",
  };
}

/**
 * The prompt handed to the in-browser model.
 *
 * Built server-side so the grounding rules travel with the context rather than
 * being assembled by client code a visitor can edit. It cannot *enforce*
 * anything — a language model is not obliged to follow instructions — which is
 * exactly why the extractive answer above stays the default and this is opt-in.
 */
export function buildGroundedPrompt(question: string, chunks: RetrievedChunk[]): string {
  const context = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.title}${chunk.heading ? ` — ${chunk.heading}` : ""}\n${chunk.content}`,
    )
    .join("\n\n");

  return [
    "You are answering questions about Shivam Patil's portfolio using only the numbered context below.",
    "Rules:",
    "- Use only facts stated in the context. Do not add anything from your own knowledge.",
    "- If the context does not answer the question, say so plainly in one sentence.",
    "- Cite the passages you used as [1], [2].",
    "- Answer in at most four sentences.",
    "",
    "Context:",
    context,
    "",
    `Question: ${question}`,
  ].join("\n");
}
