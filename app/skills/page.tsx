import { pageMetadata } from "../../lib/seo/metadata";
import { getSkillCategories } from "../skills";
import { getProjects } from "../projects";
import { SkillGraph } from "../../components/devex/skill-graph";
import { SkillSearch } from "../../components/skills/skill-search";
import { JsonLd } from "../../components/seo/json-ld";
import { breadcrumbJsonLd, itemListJsonLd } from "../../lib/seo/structured-data";
import "../../components/devex/terminal.css";

export const metadata = pageMetadata({
  title: "Skills: C++, Rust, Go, Python & AI",
  description:
    "The languages, frameworks and infrastructure Shivam Patil works in — C++, Rust, Go, Python, Kubernetes — with a graph of which project evidences which skill.",
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
        <p>
          The languages, frameworks, and infrastructure I use to take a system from a design sketch
          to something running reliably in production.
        </p>
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

      {/* The flat list of twelve chip groups is now searchable and filterable.
          Every skill is still server-rendered into the HTML — SkillSearch hides
          non-matches with `hidden` rather than rebuilding the list — because
          this page is the only place on the site whose rendered text contains
          "C++", "Rust" and "Go", and a client-built list would leave a crawler
          reading whatever the default filter produced. */}
      <div className="shell">
        <SkillSearch categories={skillCategories} />
      </div>
    </>
  );
}
