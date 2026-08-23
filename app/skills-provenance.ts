/**
 * Where each skill was actually earned.
 *
 * ### The problem this solves
 *
 * /skills listed twelve categories of technology — C++, Rust, Go, Python,
 * Kubernetes, React — as one flat inventory, with nothing to say which of them
 * had shipped to production and which had been built alone at a desk. A
 * recruiter reading that has two ways to be wrong about it, and both happen:
 *
 * - They credit production experience that does not exist. "Rust, C++, Go"
 *   beside "SDE at Tata Consultancy Services" reads as three languages used at
 *   work. None of them are; the production stack is Python and FastAPI.
 * - Or they discount the whole list. A page of thirty technologies with no
 *   provenance is indistinguishable from a page of thirty keywords, so the
 *   depth that IS there — an allocation-free feed handler at 1M+ msg/sec — gets
 *   read as padding along with everything else.
 *
 * The second failure is the expensive one, because it throws away the strongest
 * evidence on the site. Splitting the list is what makes the self-directed work
 * legible as work rather than as a list.
 *
 * ### The rules this file is held to
 *
 * These are binding, and they are the reason the format is worth the space:
 *
 * 1. **Every skill token traces to a line of evidence.** If a technology
 *    cannot be pointed at a shipped bullet or a built project, it does not go
 *    on the page. `evidence` is not a description — it is the receipt.
 * 2. **Never invent a number.** Every figure below already appears in
 *    app/experience.ts or in a published project. Nothing here is new.
 * 3. **AWS is not in this file, deliberately.** The AWS Developer Associate
 *    certification is real and is listed on /certifications. Every deployment
 *    actually performed has been Azure/AKS. Listing AWS as hands-on cloud
 *    experience would be exactly the conflation this file exists to prevent —
 *    and /skills used to do it, in the hero paragraph.
 * 4. **This mirrors the résumé.** The same two buckets, the same groupings, the
 *    same evidence lines. A candidate whose site and CV disagree about what he
 *    has done is worse off than one with neither.
 *
 * ### Why this is not in the database
 *
 * `prisma.skill` holds the flat inventory and the admin CRUD edits it; that
 * still drives the searchable list and the skill graph further down the page.
 * Provenance is a different kind of claim. It is an assertion about employment
 * history that has to match a PDF a recruiter may already be holding, and it
 * should change when the résumé changes — in a reviewed commit, not through a
 * form. Keeping it in the repository is what makes it diffable.
 */

export interface ProvenanceGroup {
  /** The skill tokens. Rendered as chips. */
  skills: string[];
  /**
   * The receipt. One line, and it must name something checkable — a metric
   * that appears elsewhere on this site, or an artifact that exists.
   */
  evidence: string;
}

export interface ProvenanceBucket {
  id: "work" | "self";
  /** The claim. */
  label: string;
  /** The qualifier that keeps the claim honest, shown beside the label. */
  qualifier: string;
  groups: ProvenanceGroup[];
}

export const skillProvenance: ProvenanceBucket[] = [
  {
    id: "work",
    label: "Proven in production at work",
    qualifier: "Shipped and operated at Tata Consultancy Services, Jan 2025 – Present",
    groups: [
      {
        skills: ["Python", "FastAPI", "REST"],
        evidence: "13+ APIs on a production system serving 10,000+ requests/day",
      },
      {
        skills: ["SQL", "Data pipelines", "AuthN/AuthZ"],
        evidence:
          "Query and pipeline optimization under production load; enterprise access-control standards",
      },
      {
        skills: ["RAG", "Vector search", "Evaluation"],
        evidence: "Relevance tuning plus the automated eval harness that measured it",
      },
    ],
  },
  {
    id: "self",
    label: "Proven outside work",
    /* This used to read "outside any employer" rather than naming the
       projects, because the Rust/C++ evidence below — the low-latency
       market-data and order-entry stack — was on the résumé and NOT published
       here, so pointing at /projects would have been an overclaim.

       It is published now (project 01), so the qualifier can say where to
       look. Every group below is evidenced by a case study on this site. */
    qualifier: "Designed, built and benchmarked end-to-end in the projects on this site",
    groups: [
      {
        skills: ["Rust", "C++"],
        evidence:
          "Allocation-free feed handler at 1M+ msg/sec, matching engine, FIX 4.4 session layer, pre-trade risk checks",
      },
      {
        skills: ["Go", "gRPC", "Redis", "PostgreSQL"],
        evidence: "Consistent hashing, Raft leader election, k6 load testing at 45,000 req/sec",
      },
      {
        skills: ["Docker", "Kubernetes (AKS)", "Prometheus", "Grafana"],
        evidence: "Containerized deploys, metrics, and operator dashboards",
      },
      {
        skills: ["TypeScript", "React", "Next.js"],
        evidence: "This site — designed, built and deployed solo",
      },
      {
        skills: ["Concurrency", "Systems"],
        evidence:
          "Lock-free and zero-allocation hot paths, binary wire protocols, distributed consensus",
      },
    ],
  },
];

/** Every token in a bucket, flattened — for JSON-LD and for counts. */
export function skillsIn(bucketId: ProvenanceBucket["id"]): string[] {
  const bucket = skillProvenance.find((b) => b.id === bucketId);
  return bucket ? bucket.groups.flatMap((g) => g.skills) : [];
}
