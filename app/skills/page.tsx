import { pageMetadata } from "../../lib/seo/metadata";
import { getSkillCategories } from "../skills";
import { skillProvenance } from "../skills-provenance";
import { getProjects } from "../projects";
import { SkillGraph } from "../../components/devex/skill-graph";
import { SkillSearch } from "../../components/skills/skill-search";
import { JsonLd } from "../../components/seo/json-ld";
import { breadcrumbJsonLd, itemListJsonLd } from "../../lib/seo/structured-data";
import "../../components/devex/terminal.css";

export const metadata = pageMetadata({
  title: "Skills: C++, Rust, Go, Python & AI",
  description:
    "What Shivam Patil shipped in production at TCS versus what he built self-directed — every skill listed with the work that evidences it.",
  path: "/skills",
});

/**
 * `revalidate` was missing, and its absence had a consequence beyond staleness.
 *
 * The build output listed /skills as `○ (Static)` with no revalidate window,
 * which means the skill list was frozen into HTML at build time. Every skill on
 * this page comes from the database through `getSkillCategories()`, which is
 * wrapped in `readOrFallback` — so a build that could not reach Neon would
 * prerender an **empty** page and serve it until the next deploy, with no
 * mechanism to recover. CI deliberately builds with no database to prove the
 * build survives that, so this is a state the project already produces on
 * purpose.
 *
 * That matters more here than on most routes: this is the only page whose
 * rendered text contains "C++", "Rust" and "Go", so an empty prerender takes
 * every one of those terms off the site.
 *
 * 3600 rather than the homepage's 300 — a skill list changes a few times a year,
 * and the window only has to be short enough to heal a bad build, not to track
 * edits.
 */
export const revalidate = 3600;

export default async function SkillsPage() {
  const [skillCategories, projects] = await Promise.all([getSkillCategories(), getProjects()]);

  // The graph draws real relationships: each edge is a technology the project
  // itself lists. Nothing is inferred, so a skill with no edges genuinely is
  // not evidenced by any published project.
  const graphInput = {
    projects: projects.map((project) => ({
      id: project.slug,
      label: project.shortTitle || project.title,
      skills: [...new Set([...project.stack, ...project.tags])].slice(0, 8),
    })),
  };
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Skills", href: "/skills" }]),
          // The skill names themselves, as an ItemList. `knowsAbout` on the
          // Person block already carries the curated vocabulary; this carries
          // what the database actually holds, which is the longer and more
          // specific list.
          itemListJsonLd(
            "Technical skills",
            skillCategories.flatMap((category) =>
              category.items.map((item) => ({ name: item, href: "/skills" })),
            ),
          ),
        ]}
      />
      <section className="page-hero shell">
        <p className="eyebrow">Skills</p>
        <h1>
          Tools I reach for
          <br />
          <em>under pressure.</em>
        </h1>
        {/* This paragraph used to read "C++, Rust, Go and Python, and the
            infrastructure around them — Kubernetes, Docker, PostgreSQL, AWS."
            Two things were wrong with it and both mattered.

            It put four languages beside a job title with nothing to say that
            only one of them is the production stack. And it listed AWS as
            infrastructure worked in, which is not true — the certification is
            real and is on /certifications, but every deployment has been
            Azure/AKS. See app/skills-provenance.ts. */}
        <p>
          Split by where it was earned: <strong>what has shipped to production at TCS</strong>, and{" "}
          <strong>what was built self-directed</strong>. Every line names the work that evidences
          it, so the two are not read as one.
        </p>
      </section>

      {/* The provenance split, first — before the graph and before the
          searchable inventory. It is the answer to the question a recruiter
          actually arrives with, and burying it under a force-directed diagram
          would be the same mistake the flat list made. */}
      <section className="shell provenance" data-reveal>
        {skillProvenance.map((bucket) => (
          <div key={bucket.id} className="provenance-bucket" data-bucket={bucket.id}>
            <div className="provenance-head">
              <h2>{bucket.label}</h2>
              <p>{bucket.qualifier}</p>
            </div>
            <dl className="provenance-list">
              {bucket.groups.map((group) => (
                <div key={group.skills.join("+")} className="provenance-row">
                  {/* <dt>/<dd> rather than two spans: this genuinely is a
                      description list — a set of terms and what each is backed
                      by — and the semantics carry to a screen reader, which
                      announces the pairing rather than eight loose strings. */}
                  <dt>
                    {group.skills.map((skill) => (
                      <span key={skill} className="provenance-chip">
                        {skill}
                      </span>
                    ))}
                  </dt>
                  <dd>{group.evidence}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </section>

      <section className="shell pb-6" data-reveal>
        <div className="section-heading">
          <h2>
            What connects to <em>what.</em>
          </h2>
          <p>
            Laid out by a force simulation run to completion on the server, so it ships as plain SVG
            and is identical for every visitor — no physics loop on your main thread.
          </p>
        </div>
        <SkillGraph input={graphInput} />
      </section>

      {/* The flat inventory, searchable and filterable.

          It sits BELOW the provenance split and is introduced as an inventory,
          not as a claim — that ordering is the whole point. On its own this
          list is the thing that reads as a keyword dump; underneath two labelled
          buckets it is what it actually is, a complete index of everything
          touched, with the provenance already established above it.

          Every skill is still server-rendered into the HTML — SkillSearch hides
          non-matches with `hidden` rather than rebuilding the list — because
          this page is the only place on the site whose rendered text contains
          "C++", "Rust" and "Go", and a client-built list would leave a crawler
          reading whatever the default filter produced. */}
      <div className="shell" data-reveal>
        <div className="section-heading">
          <h2>
            Everything, <em>indexed.</em>
          </h2>
          <p>
            The full inventory, including what is used lightly. Depth is the section above; this is
            coverage.
          </p>
        </div>
        <SkillSearch categories={skillCategories} />
      </div>
    </>
  );
}
