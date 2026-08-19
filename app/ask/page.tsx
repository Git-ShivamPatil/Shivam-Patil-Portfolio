import { pageMetadata } from "../../lib/seo/metadata";
import { AskConsole } from "../../components/ai/ask-console";
import { JdMatch } from "../../components/ai/jd-match";
import { readOrFallback } from "../../lib/db-read";
import { prisma } from "../../lib/prisma";
import "./ask.css";

export const metadata = pageMetadata({
  title: "Ask This Site Anything",
  description:
    "Retrieval-augmented search over this portfolio: hybrid vector and full-text retrieval, answers quoted back with sources, and an optional in-browser model.",
  path: "/ask",
});

// The page shell is static; the index status below is a cheap read that should
// not freeze into the build. Same pairing every other content page uses: a
// fallback plus a revalidate window, so a build that could not reach the
// database heals rather than serving a wrong number forever.
export const revalidate = 600;

export default async function AskPage() {
  const index = await readOrFallback(
    "ask/index-status",
    () => prisma.knowledgeIndex.findUnique({ where: { id: "singleton" } }),
    null,
  );

  return (
    <div className="ask-page">
      <section className="page-hero shell" data-reveal>
        <p className="eyebrow">Retrieval</p>
        <h1 data-split>
          Ask this site
          <br />
          <em>anything.</em>
        </h1>
        <p className="page-lede">
          Hybrid retrieval over everything published here — dense vectors in pgvector fused with
          Postgres full-text search — answered by quoting the site back to you, with links to where
          each sentence came from. A language model is available too, and it runs on your own
          machine rather than on anyone&apos;s API key.
        </p>
      </section>

      <section className="shell ask-section" data-reveal>
        <AskConsole />
      </section>

      <section className="shell ask-section" data-reveal>
        <div className="section-heading">
          <h2>
            Match a <em>job description.</em>
          </h2>
          <p>
            Paste the requirements and get back what this portfolio can actually evidence, with the
            passage that proves each one — and, just as plainly, what it cannot.
          </p>
        </div>
        <JdMatch />
      </section>

      <section className="shell ask-section ask-how" data-reveal>
        <div className="section-heading">
          <h2>
            How it <em>works.</em>
          </h2>
        </div>
        <div className="ask-how-grid">
          <article>
            <h3>Embeddings, computed not bought</h3>
            <p>
              Every hosted embedding API is metered, and this project runs on free tiers only. So
              the vectors are hashed TF-IDF: terms hashed into 256 dimensions, weighted by sublinear
              term frequency times inverse document frequency, L2-normalised. That is a lexical
              embedding — it does not know that &ldquo;Kubernetes&rdquo; and &ldquo;container
              orchestration&rdquo; are related, and no tuning will teach it.
            </p>
          </article>
          <article>
            <h3>Which is why retrieval is hybrid</h3>
            <p>
              Dense lexical vectors and full-text search fail differently: one handles morphology
              and near-misses, the other nails a rare exact term. Both run on every query and the
              results are fused by reciprocal rank, which throws away two incomparable score scales
              and keeps only the ranks — so a passage both retrievers like beats one that either
              ranked first alone.
            </p>
          </article>
          <article>
            <h3>Extractive first, generated second</h3>
            <p>
              The answer above the fold is sentences taken verbatim from these pages, chosen by
              overlap with your question. It cannot hallucinate, because it cannot write. The model
              is opt-in, downloads once, runs on your GPU, and is handed the same passages as
              context.
            </p>
          </article>
          <article>
            <h3>What is in the index</h3>
            <p>
              {index
                ? `${index.chunkCount} passages, ${index.vectorized ? "with vector search active" : "full-text only"}, last rebuilt ${index.builtAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}.`
                : "The index has not been built yet — search falls back to full-text until it is."}{" "}
              Projects, posts, skills, experience and services are chunked by heading rather than by
              character count, so each passage is about one idea and can be cited as a section.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
