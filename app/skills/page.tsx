import type { Metadata } from "next";
import { getSkillCategories } from "../skills";
import { getProjects } from "../projects";
import { SkillGraph } from "../../components/devex/skill-graph";
import "../../components/devex/terminal.css";

export const metadata: Metadata = {
  title: "Skills — Shivam Patil",
  alternates: { canonical: "/skills" },
};

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
            Laid out by a force simulation run to completion on the server, so it ships as plain
            SVG and is identical for every visitor — no physics loop on your main thread.
          </p>
        </div>
        <SkillGraph input={graphInput} />
      </section>

      <div className="skill-groups shell">
        {skillCategories.map((category) => (
          <div key={category.label} className="skill-group">
            <h2>{category.label}</h2>
            <ul className="skill-chip-list">
              {category.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
