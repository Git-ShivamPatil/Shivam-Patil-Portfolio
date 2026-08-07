"use client";

import { useMemo, useState } from "react";
import { ProjectCard } from "./project-card";
import type { Project } from "../app/projects";

export function ProjectFilter({ projects }: { projects: Project[] }) {
  const categories = useMemo(
    () => Array.from(new Set(projects.map((project) => project.category))),
    [projects],
  );
  const [active, setActive] = useState<string | null>(null);
  const filtered = active ? projects.filter((project) => project.category === active) : projects;

  return (
    <>
      <div className="project-filter" role="group" aria-label="Filter projects by category">
        <button
          type="button"
          className={active === null ? "is-active" : undefined}
          onClick={() => setActive(null)}
        >
          All <span>{projects.length}</span>
        </button>
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={active === category ? "is-active" : undefined}
            onClick={() => setActive(category)}
          >
            {category}
            <span>{projects.filter((project) => project.category === category).length}</span>
          </button>
        ))}
      </div>
      <div className="project-list">
        {filtered.map((project, index) => (
          <ProjectCard key={project.slug} project={project} index={index} />
        ))}
      </div>
    </>
  );
}
