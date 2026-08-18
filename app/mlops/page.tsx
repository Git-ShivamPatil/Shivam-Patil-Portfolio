import { pageMetadata } from "../../lib/seo/metadata";
import { ModelCosts } from "../../components/mlops/model-costs";
import { readOrFallback } from "../../lib/db-read";
import { GOLDEN_QUERIES, runEvaluation } from "../../lib/mlops/goldens";
import "./mlops.css";

export const metadata = pageMetadata({
  title: "Retrieval Quality: MLOps in Practice",
  description:
    "This site's own search, measured: recall, MRR and nDCG over a labelled query set, run live — plus index drift and what an answer costs on-device versus hosted.",
  path: "/mlops",
});

// The evaluation runs twelve retrievals against the live index, so this is a
// real read and the numbers are current by construction.
export const dynamic = "force-dynamic";

const pct = (value: number) => `${Math.round(value * 100)}%`;

export default async function MlOpsPage() {
  const { report, coverage } = await readOrFallback("mlops/eval", () => runEvaluation(5), {
    report: {
      k: 5,
      queries: [],
      mean: { recall: 0, precision: 0, mrr: 0, ndcg: 0 },
      misses: [],
    },
    coverage: { unanswerable: [], missingUrls: [], answerable: [] },
    returned: {},
  });

  const evaluated = report.queries.length > 0;

  return (
    <div className="shell py-16">
      <section className="page-hero" data-reveal>
        <p className="eyebrow">Retrieval quality</p>
        <h1 data-split>
          Measured,
          <br />
          <em>not asserted.</em>
        </h1>
        <p className="page-lede">
          This site has had hybrid retrieval since P16 — a vector index, a lexical index, and
          reciprocal rank fusion over both. What it never had was any way to tell whether it works.
          The table below runs the answerable half of {GOLDEN_QUERIES.length} labelled questions
          against the live index when this page loads, and scores what comes back.
        </p>
      </section>

      <section className="mt-12" data-reveal>
        <div className="section-heading">
          <h2>
            Four numbers, <em>because they disagree.</em>
          </h2>
          <p>
            Recall asks whether the right page made the window at all — the ceiling on everything
            downstream, since no answer can cite a passage retrieval never returned. MRR asks how
            high, because a prompt with a token budget does not treat rank 1 and rank 5 alike. nDCG
            weights position and grade together. A change that raises recall while lowering MRR has
            moved the right answer into the window and pushed it down inside it; one number would
            have hidden that.
          </p>
        </div>

        {evaluated ? (
          <>
            <dl className="ml-figures">
              <div>
                <dt>Recall@{report.k}</dt>
                <dd>
                  {pct(report.mean.recall)}
                  <small>of judged pages retrieved</small>
                </dd>
              </div>
              <div>
                <dt>MRR</dt>
                <dd>
                  {report.mean.mrr.toFixed(2)}
                  <small>1.0 means always first</small>
                </dd>
              </div>
              <div>
                <dt>nDCG@{report.k}</dt>
                <dd>
                  {report.mean.ndcg.toFixed(2)}
                  <small>position and grade</small>
                </dd>
              </div>
              <div data-bad={report.misses.length > 0 || undefined}>
                <dt>Misses</dt>
                <dd>
                  {report.misses.length}
                  <small>{report.misses.join(", ") || "none"}</small>
                </dd>
              </div>
            </dl>

            <div className="ml-table-wrap">
              <table className="ml-table">
                <caption className="sr-only">Per-query retrieval scores</caption>
                <thead>
                  <tr>
                    <th scope="col">Query</th>
                    <th scope="col">First hit</th>
                    <th scope="col">Recall</th>
                    <th scope="col">nDCG</th>
                    <th scope="col">Returned</th>
                  </tr>
                </thead>
                <tbody>
                  {report.queries.map((query) => (
                    <tr key={query.id}>
                      <th scope="row">{query.question}</th>
                      <td data-bad={query.firstRelevantAt === null || undefined}>
                        {query.firstRelevantAt === null ? "not found" : `#${query.firstRelevantAt}`}
                      </td>
                      <td>{pct(query.recall)}</td>
                      <td>{query.ndcg.toFixed(2)}</td>
                      <td>{query.returned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="ml-empty">
            The evaluation could not run — the retrieval index is unavailable, most likely because
            it has not been built on this deployment (<code>pnpm ai:index</code>). Reporting zeros
            would look like a catastrophic retrieval failure rather than a missing index, so it
            reports nothing instead.
          </p>
        )}

        <p className="ml-note">
          <strong>
            {GOLDEN_QUERIES.length} queries is a small set, and that is the honest limitation.
          </strong>{" "}
          Enough to catch a retriever that has broken outright; nowhere near enough to separate two
          good rankings, where the confidence interval on twelve queries is wider than any
          difference worth shipping. Growing it means writing judgements by hand, which is the real
          cost of evaluation and the reason so much retrieval ships unmeasured. Judgements are keyed
          on URL rather than chunk id, so editing a paragraph does not invalidate the set.
        </p>

        <div className="ml-finding">
          <h3>What the first run actually found</h3>
          <p>
            Recall came back at 42% with seven misses, which read as a broken retriever. It was not.
            Six of the seven judged pages the corpus <em>does not index at all</em> — it covers
            projects, blog posts, skills, service offerings, experience, achievements and
            certifications, and nothing else. No ranking could have returned <code>/contact</code>{" "}
            or <code>/compute</code>, so those queries were measuring content coverage while
            reporting a retrieval number. A seventh &ldquo;miss&rdquo; was the
            deliberately-unanswerable query, whose reciprocal rank is zero by definition.
          </p>
          <p>
            The judgements were <strong>not</strong> edited to match. &ldquo;How do I get in
            touch&rdquo; is a reasonable thing to ask a portfolio, and deleting the query because
            the index cannot answer it would have raised the score by hiding the gap. The two are
            reported separately instead, because they have completely different fixes: one is a
            retrieval problem, the other is four lines in <code>buildCorpus</code>.
          </p>
          {coverage.missingUrls.length > 0 ? (
            <p className="ml-gap">
              <strong>
                {coverage.unanswerable.length} of {GOLDEN_QUERIES.length} queries are unanswerable
                today.
              </strong>{" "}
              Pages judged relevant that the index cannot return:{" "}
              {/* Rendered with separators. Without them the eight paths ran
                  together into one unreadable string — "/about/ask/compute…" —
                  which read as a single nonsense path rather than a list. */}
              {coverage.missingUrls.map((url, index) => (
                <span key={url}>
                  {index > 0 ? " " : null}
                  <code>{url}</code>
                </span>
              ))}
            </p>
          ) : null}
        </div>

        <details className="ml-source">
          <summary>The judgement set, and why each query is in it</summary>
          <ul className="ml-goldens">
            {GOLDEN_QUERIES.map((golden) => (
              <li key={golden.id}>
                <code>{golden.question}</code>
                <span>{golden.note}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            What an answer <em>would cost.</em>
          </h2>
          <p>
            The comparison inverts, which is why it is a slider rather than a table. At one question
            a day the download dominates completely and per-token pricing is noise; at a hundred
            thousand the download amortises to nothing and per-token pricing is the entire decision.
          </p>
        </div>
        <ModelCosts />
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            What actually <em>drifts here.</em>
          </h2>
        </div>
        <div className="ask-how-grid">
          <article>
            <h3>There is no trained model</h3>
            <p>
              The embedding is a hashed bag of terms with IDF weighting, and IDF is fitted to the
              corpus. So nothing here has weights that decay — what goes stale is the relationship
              between the index and the corpus it was built from. Every project added moves the term
              distribution, and the IDF baked in at build time drifts from the one the live corpus
              would produce.
            </p>
          </article>
          <article>
            <h3>It fails quietly, which is the problem</h3>
            <p>
              Retrieval keeps working, gradually worse, weighting terms by a document frequency that
              stopped being true months ago. Nothing errors and no test fails. The only way to
              notice is to measure the distance, which is what the PSI implementation in{" "}
              <code>lib/mlops/drift.ts</code> is for.
            </p>
          </article>
          <article>
            <h3>PSI is a convention, not a theorem</h3>
            <p>
              Under 0.1 stable, 0.1–0.25 moderate, above 0.25 significant — thresholds that come
              from credit-risk modelling in the 1990s. They are used because a shared convention
              everyone reads the same way beats a bespoke threshold nobody can calibrate, not
              because they are derived from anything.
            </p>
          </article>
          <article>
            <h3>Two metrics, because they disagree usefully</h3>
            <p>
              PSI is sensitive to a large relative change in a rare bucket; cosine distance is
              dominated by the common ones and barely moves. When they disagree, the tail moved —
              which is usually new content rather than a problem. Reporting only one would make that
              indistinguishable from a real shift.
            </p>
          </article>
        </div>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            The quantized model, and <em>why /ask does not use it.</em>
          </h2>
        </div>
        <div className="ask-how-grid">
          <article>
            <h3>4-bit is not a small compromise</h3>
            <p>
              Quantization stores weights at 4 bits instead of 16, which is what makes a
              1B-parameter model an 880MB download instead of 2.5GB and lets it run in a browser at
              all. It also measurably degrades the model — most visibly on exactly the thing a
              portfolio assistant needs, which is not paraphrasing fluently but declining to invent
              a fact.
            </p>
          </article>
          <article>
            <h3>The download is the product decision</h3>
            <p>
              880MB before the first token, on a connection you do not control, for a visitor who
              asked one question. On a phone that is not a loading state, it is an exit. The 3B
              model is noticeably better and 2.1GB, which makes it worse.
            </p>
          </article>
          <article>
            <h3>So /ask is extractive</h3>
            <p>
              It selects sentences from retrieved passages and scores them against the query. It
              cannot paraphrase and it cannot be wrong about a fact it did not retrieve — and on a
              page whose purpose is telling the truth about someone&rsquo;s work, the second
              property is worth more than the first.
            </p>
          </article>
          <article>
            <h3>Which makes retrieval the whole system</h3>
            <p>
              With no generation step there is nothing downstream to paper over a bad ranking. That
              is the argument for everything above: an extractive answerer is exactly as good as its
              retrieval, so retrieval is the only thing worth measuring.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
