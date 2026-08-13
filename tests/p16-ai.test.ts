import { describe, it, expect, vi } from "vitest";

// lib/ai/retrieve.ts and lib/ai/resume.ts construct the Prisma client at module
// scope, and everything under test here is pure — the fusion arithmetic, the
// embedding, the sentence scoring. Mocking the client keeps the suite free of a
// database, which is the same property CI depends on.
vi.mock("../lib/prisma", () => ({ prisma: {} }));

import {
  EMBEDDING_DIMS,
  EMPTY_IDF,
  buildIdf,
  cosine,
  embed,
  hashTerm,
  terms,
  tokenize,
  toVectorLiteral,
} from "../lib/ai/embed";
import { fuse } from "../lib/ai/retrieve";
import {
  buildGroundedPrompt,
  composeAnswer,
  scoreSentence,
  splitSentences,
} from "../lib/ai/answer";
import { extractRequirements } from "../lib/ai/resume";

/**
 * P16 — retrieval.
 *
 * The properties pinned here are the ones whose failure is silent. A hash that
 * changes between runtimes invalidates every stored vector while every other
 * test still passes; an un-normalised vector makes cosine similarity measure
 * document length; a fusion that reads its ranks backwards returns the worst
 * result first and looks like a ranking problem rather than a sign error.
 */

const chunk = (over: Partial<Parameters<typeof composeAnswer>[1][number]> = {}) => ({
  id: "c1",
  source: "project",
  url: "/projects/x",
  title: "Rate limiter",
  heading: "Summary",
  content: "",
  score: 1,
  matchedBy: ["vector" as const],
  ...over,
});

describe("tokenizing", () => {
  it("folds diacritics so a pasted accent still matches", () => {
    expect(tokenize("Kubernetés")).toEqual(tokenize("Kubernetes"));
  });

  it("keeps numbers and version-shaped terms", () => {
    // "p99", "8080" and "2026" are all things someone searches a portfolio for.
    const result = tokenize("p99 latency at 8080 in 2026");
    expect(result).toContain("p99");
    expect(result).toContain("8080");
    expect(result).toContain("2026");
  });

  it("collapses the inflections that actually cause misses", () => {
    expect(tokenize("caching")).toEqual(tokenize("cache"));
    expect(tokenize("queries")).toEqual(tokenize("query"));
  });

  it("never stems a short word into a fragment", () => {
    // "sees" -> "se" would be noise, not a root.
    expect(tokenize("sees")).toEqual(["sees"]);
  });

  it("drops stopwords but keeps the ones that change meaning", () => {
    const result = tokenize("this is not the same");
    expect(result).not.toContain("the");
    // "not" flips what a sentence claims; an aggressive list would delete it.
    expect(result).toContain("not");
  });
});

describe("bigrams", () => {
  it("pairs adjacent content words", () => {
    expect(terms("rate limiter")).toContain("rate_limiter");
  });

  it("bridges over stopwords", () => {
    // "the rate of the limiter" and "rate limiter" should produce the same pair.
    expect(terms("the rate of the limiter")).toContain("rate_limiter");
  });
});

describe("hashing", () => {
  it("is stable — this is what makes stored vectors survive a deploy", () => {
    // A hash that drifted between Node versions would silently invalidate every
    // embedding in the database while every test still passed. The literal is
    // the point: it must not change.
    expect(hashTerm("kubernetes")).toBe(hashTerm("kubernetes"));
    expect(hashTerm("postgres")).not.toBe(hashTerm("kubernetes"));
    expect(hashTerm("")).toBe(0x811c9dc5);
  });

  it("stays inside 32 unsigned bits", () => {
    for (const word of ["a", "vector", "retrieval augmented generation", "🙂"]) {
      const hash = hashTerm(word);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("embedding", () => {
  it("produces a unit vector of the declared width", () => {
    const vector = embed("distributed rate limiter with redis");
    expect(vector).toHaveLength(EMBEDDING_DIMS);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    // Without normalisation, cosine similarity measures document length.
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic — the index and the query must agree", () => {
    expect(Array.from(embed("hello world"))).toEqual(Array.from(embed("hello world")));
  });

  it("returns an all-zero vector for empty text without producing NaN", () => {
    // Dividing by a zero norm would fill it with NaN, and one NaN vector
    // poisons every comparison it takes part in.
    const vector = embed("   ");
    expect(vector.every((value) => value === 0)).toBe(true);
    expect(vector.some((value) => Number.isNaN(value))).toBe(false);
  });

  it("scores related text above unrelated text", () => {
    const query = embed("rate limiting with token buckets");
    const related = embed("a distributed rate limiter using token bucket counters");
    const unrelated = embed("a blog post about choosing a coffee grinder");
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it("weights a rare term above a common one", () => {
    const model = buildIdf([
      "postgres and redis",
      "postgres and kafka",
      "postgres and docker",
      "postgres and hyperledger",
    ]);
    // "postgres" is in every document and carries no discriminating signal;
    // "hyperledger" is in one.
    const common = embed("postgres", model);
    const rare = embed("hyperledger", model);
    const target = embed("postgres and hyperledger", model);
    expect(cosine(rare, target)).toBeGreaterThan(cosine(common, target));
  });

  it("smooths IDF so an unseen query term cannot divide by zero", () => {
    const model = buildIdf(["one document"]);
    const vector = embed("a term the corpus has never contained", model);
    expect(vector.some((value) => Number.isNaN(value))).toBe(false);
  });

  it("falls back to unweighted terms with no IDF model", () => {
    expect(embed("anything", EMPTY_IDF).some((value) => value !== 0)).toBe(true);
  });
});

describe("pgvector literals", () => {
  it("emits the bracketed form pgvector parses", () => {
    const literal = toVectorLiteral(embed("test"));
    expect(literal.startsWith("[")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
    expect(literal.split(",")).toHaveLength(EMBEDDING_DIMS);
  });
});

describe("reciprocal rank fusion", () => {
  const row = (id: string) => ({
    id,
    source: "project",
    url: `/p/${id}`,
    title: id,
    heading: null,
    content: id,
  });

  it("ranks a result both retrievers found above one that either topped alone", () => {
    // The entire reason for RRF over a weighted sum: cosine similarity and
    // ts_rank are on incomparable scales, so agreement is the signal.
    const fused = fuse(
      [
        { name: "vector", rows: [row("only-vector"), row("both")] },
        { name: "text", rows: [row("only-text"), row("both")] },
      ],
      3,
    );
    expect(fused[0].id).toBe("both");
    expect(fused[0].matchedBy).toEqual(["vector", "text"]);
  });

  it("preserves order within a single retriever", () => {
    const fused = fuse([{ name: "vector", rows: [row("first"), row("second"), row("third")] }], 3);
    expect(fused.map((entry) => entry.id)).toEqual(["first", "second", "third"]);
  });

  it("handles one retriever returning nothing", () => {
    // Exactly what happens when pgvector is unavailable: the site must keep
    // answering from full-text search alone.
    const fused = fuse(
      [
        { name: "vector", rows: [] },
        { name: "text", rows: [row("a")] },
      ],
      3,
    );
    expect(fused).toHaveLength(1);
    expect(fused[0].matchedBy).toEqual(["text"]);
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(`r${index}`));
    expect(fuse([{ name: "vector", rows }], 5)).toHaveLength(5);
  });
});

describe("sentence splitting", () => {
  it("does not break on decimals or abbreviations", () => {
    const text =
      "Throughput reached 45.5K req/s under load. The p99 stayed under 12ms across the run.";
    expect(splitSentences(text)).toHaveLength(2);
  });

  it("drops fragments too short to be an answer", () => {
    expect(splitSentences("Yes. No.")).toHaveLength(0);
  });
});

describe("sentence scoring", () => {
  it("rewards overlap and penalises padding", () => {
    const query = new Set(terms("rate limiter"));
    const tight = scoreSentence("A distributed rate limiter.", query);
    const padded = scoreSentence(
      "A distributed rate limiter, plus a great deal of unrelated prose that goes on describing other things entirely.",
      query,
    );
    expect(tight).toBeGreaterThan(padded);
  });

  it("scores zero when nothing matches", () => {
    expect(scoreSentence("Completely unrelated prose.", new Set(terms("kubernetes")))).toBe(0);
  });
});

describe("composing an answer", () => {
  it("quotes only sentences that exist in the retrieved passages", () => {
    const content =
      "The gateway uses a token bucket for burst control. Sliding-window counters enforce stricter per-endpoint policies.";
    const answer = composeAnswer("how does the token bucket work?", [chunk({ content })]);
    // Everything it says has to be findable in the source, verbatim.
    for (const sentence of answer.sentences) {
      expect(content).toContain(sentence.text);
    }
  });

  it("says so rather than inventing when nothing addresses the question", () => {
    const answer = composeAnswer("what is his favourite pasta shape?", [
      chunk({ content: "The gateway uses a token bucket for burst control at the edge." }),
    ]);
    expect(answer.sentences).toHaveLength(0);
    expect(answer.confidence).toBe("low");
    expect(answer.text).toContain("closest match");
  });

  it("reports no match at all when retrieval came back empty", () => {
    const answer = composeAnswer("anything", []);
    expect(answer.confidence).toBe("none");
    expect(answer.sources).toEqual([]);
  });

  it("only claims high confidence with two matched words, half the question, and both retrievers", () => {
    const content =
      "The distributed rate limiter uses token bucket counters to smooth bursts across nodes.";
    const strong = composeAnswer("how does the rate limiter handle bursts?", [
      chunk({ content, matchedBy: ["vector", "text"] }),
    ]);
    expect(strong.confidence).toBe("high");

    // Same passage, but only one retriever found it: agreement between two
    // retrievers that fail differently is independent evidence, and without it
    // this is a guess that happened to score well.
    const weaker = composeAnswer("how does the rate limiter handle bursts?", [
      chunk({ content, matchedBy: ["vector"] }),
    ]);
    expect(weaker.confidence).toBe("low");
  });

  it("never claims high confidence on a one-word question", () => {
    // Measured case: "where does he work?" reduces to the single content word
    // "work", which matched "knowledge-work" in an unrelated project and
    // produced a confidently wrong answer.
    const answer = composeAnswer("work?", [
      chunk({
        content: "Turn complex knowledge-work requests into repeatable, auditable workflows.",
        matchedBy: ["vector", "text"],
      }),
    ]);
    expect(answer.confidence).toBe("low");
  });

  it("does not quote the same claim twice", () => {
    const answer = composeAnswer("rate limiter", [
      chunk({
        content:
          "The distributed rate limiter smooths bursts across nodes. The distributed rate limiter smooths bursts across all nodes.",
      }),
    ]);
    expect(answer.sentences.length).toBeLessThanOrEqual(1);
  });

  it("caps how much it quotes", () => {
    const content = Array.from(
      { length: 12 },
      (_, index) => `The rate limiter handles case number ${index} of bursty traffic.`,
    ).join(" ");
    expect(composeAnswer("rate limiter bursts", [chunk({ content })]).sentences.length).toBeLessThanOrEqual(3);
  });
});

describe("the grounded prompt", () => {
  it("numbers the context and tells the model to stay inside it", () => {
    const prompt = buildGroundedPrompt("what is this?", [
      chunk({ content: "A rate limiter." }),
      chunk({ id: "c2", content: "A gateway.", title: "Gateway" }),
    ]);
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("[2]");
    expect(prompt).toContain("Use only facts stated in the context");
    expect(prompt).toContain("what is this?");
  });
});

describe("job description parsing", () => {
  it("keeps requirement lines and drops headings", () => {
    const requirements = extractRequirements(
      [
        "About us:",
        "We are a fast-growing team.",
        "• 3+ years building distributed backend systems",
        "- Strong experience with PostgreSQL and Redis",
        "Requirements:",
      ].join("\n"),
    );
    expect(requirements).toContain("3+ years building distributed backend systems");
    expect(requirements).toContain("Strong experience with PostgreSQL and Redis");
    // A heading states nothing to match against.
    expect(requirements).not.toContain("About us:");
    expect(requirements).not.toContain("Requirements:");
  });

  it("strips bullet characters of every shape", () => {
    expect(extractRequirements("— Deep knowledge of Kubernetes internals")[0]).toBe(
      "Deep knowledge of Kubernetes internals",
    );
  });

  it("ignores lines too short or too long to be a requirement", () => {
    const long = `Requirement ${"word ".repeat(80)}`;
    const parsed = extractRequirements(["Yes", long, "Build and run backend services"].join("\n"));
    expect(parsed).toEqual(["Build and run backend services"]);
  });

  it("is bounded, so one paste cannot become hundreds of queries", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Requirement number ${i} for the role`);
    expect(extractRequirements(many.join("\n")).length).toBeLessThanOrEqual(40);
  });
});
