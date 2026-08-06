import type { Metadata } from "next";
import { skillCategories } from "../skills";

export const metadata: Metadata = {
  title: "Skills — Shivam Patil",
  alternates: { canonical: "/skills" },
};

export default function SkillsPage() {
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
