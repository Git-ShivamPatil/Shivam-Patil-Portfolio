import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The job-description matcher's honesty property, pinned.
 *
 * **This regressed after being fixed once, and nothing noticed for weeks.**
 * `lib/ai/resume.ts` carries a comment saying "Deep knowledge of COBOL
 * mainframe migration" came back COVERED on the first live run and that
 * document frequency fixed it. It came back again. The only thing asserting
 * otherwise was one Playwright spec, and the E2E job had been blocked behind a
 * failing SBOM check since before that regression landed — so the guard existed
 * and was not running.
 *
 * These are unit tests for the same property, with the database and the
 * retriever mocked, so they run in the `build` job in milliseconds and cannot
 * be skipped by an unrelated step failing upstream.
 *
 * The measured cause is worth keeping in front of whoever changes this next: of
 * that requirement's terms, the only ones the corpus contained at all were
 * `deep` and `knowledg`. Both are rare enough to clear a document-frequency
 * gate — "knowledge" is concentrated in one RAG case study, which is exactly
 * what makes it look distinctive — so retrieval ran, returned that case study,
 * and a language the site has never touched was reported as proven. `cobol` and
 * `mainframe` matched nothing and contributed nothing.
 */

const chunk = (title: string, content: string) => ({ title, content });

/** A corpus shaped like the real one: a few case studies, each on its own topic. */
const CHUNKS = [
  chunk(
    "Distributed Rate Limiter",
    "A gateway in Go using Redis and PostgreSQL at high throughput.",
  ),
  chunk(
    "LLM Inference Server",
    "A Rust inference runtime with continuous batching and KV-cache discipline.",
  ),
  chunk(
    "Secure RAG with RBAC",
    "Give teams answers from private knowledge while ensuring deep authorisation checks.",
  ),
  chunk("Banking System", "Tamper-evident transaction processing with Kubernetes and Docker."),
];

const SKILLS = [{ name: "PostgreSQL" }, { name: "Kubernetes" }, { name: "Rust" }, { name: "Go" }];
const PROJECTS = [{ stack: ["Redis", "Docker"], tags: ["distributed-systems"] }];

vi.mock("../lib/prisma", () => ({
  prisma: {
    skill: { findMany: vi.fn(async () => SKILLS) },
    project: { findMany: vi.fn(async () => PROJECTS) },
    knowledgeChunk: { findMany: vi.fn(async () => CHUNKS) },
  },
}));

/**
 * `retrieve` is stubbed to always return something, which is the whole point.
 *
 * A retriever's job is to return its best effort for any query — it has no
 * notion of "nothing here matches". So the matcher cannot delegate the decision
 * to it, and a stub that always answers is the honest model of that. If the
 * matcher ever asks the retriever about COBOL, it will get an answer, and the
 * test will catch it treating that answer as proof.
 */
vi.mock("../lib/ai/retrieve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ai/retrieve")>();
  return {
    ...actual,
    retrieve: vi.fn(async () =>
      CHUNKS.map((c, index) => ({
        id: String(index),
        title: c.title,
        heading: null,
        url: "/projects/x",
        content: c.content,
        score: 1 - index * 0.1,
      })),
    ),
  };
});

const { analyseJobDescription } = await import("../lib/ai/resume");

const analyse = (lines: string[]) => analyseJobDescription(lines.map((l) => `- ${l}`).join("\n"));

beforeEach(() => vi.clearAllMocks());

describe("the job description matcher", () => {
  it("reports a technology the site has never touched as a gap", async () => {
    const result = await analyse(["Deep knowledge of COBOL mainframe migration"]);
    const [requirement] = result.requirements;

    expect(requirement.covered).toBe(false);
    expect(requirement.evidence).toBeNull();
    // The specific failure: `deep` and `knowledg` are in the corpus and are
    // rare, but neither names a technology, so neither may carry a requirement.
    expect(requirement.matchedTerms).toEqual([]);
  });

  it("does not let filler words prove anything on their own", async () => {
    // Every term here appears in the corpus and none of them is a technology.
    const result = await analyse(["Deep experience and strong knowledge"]);
    expect(result.requirements[0].covered).toBe(false);
  });

  it("still covers a requirement naming a skill the site claims", async () => {
    const result = await analyse(["Experience with Kubernetes and container orchestration"]);
    const [requirement] = result.requirements;
    expect(requirement.covered).toBe(true);
    expect(requirement.matchedTerms).toContain("kubernet");
  });

  it("counts a technology named only in a project's stack", async () => {
    // Redis is in a published project's stack and in no skills row. Before the
    // vocabulary was widened to read stacks and tags, `redi` was treated as an
    // ordinary English word and this requirement came back a gap — the matcher
    // was reading less of the site than a visitor does.
    const result = await analyse(["Strong experience with Redis at scale"]);
    expect(result.requirements[0].covered).toBe(true);
    expect(result.requirements[0].matchedTerms).toContain("redi");
  });

  it("reports coverage as a proportion, so one gap is visible in the number", async () => {
    const result = await analyse([
      "Experience with Kubernetes and container orchestration",
      "Deep knowledge of COBOL mainframe migration",
    ]);
    expect(result.parsed).toBe(2);
    expect(result.coverage).toBe(50);
  });

  it("never asks the retriever about a requirement naming nothing it knows", async () => {
    // Not merely an optimisation. `retrieve` always answers, so every call for a
    // requirement about nothing is an opportunity to mistake a passage for
    // proof. The cheapest way to not make that mistake is not to ask.
    const { retrieve } = await import("../lib/ai/retrieve");
    await analyse(["Fluency in Visual Basic 6 and Delphi"]);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
