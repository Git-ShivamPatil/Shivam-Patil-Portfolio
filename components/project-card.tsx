import Link from "next/link";
import { ArrowUpRight, GridIcon, PulseIcon } from "./icons";
import type { Project } from "../app/projects";

export function ProjectCard({ project, index }: { project: Project; index: number }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className={`project-card project-${project.accent} reveal ${index % 2 ? "offset-card" : ""}`}
    >
      <div className="project-card-top">
        <span className="project-number">{project.number}</span>
        <span className="project-category">{project.category}</span>
        <span className="project-arrow">
          <ArrowUpRight />
        </span>
      </div>
      <div className="project-card-body">
        <div className="project-card-graphic" aria-hidden="true">
          {project.accent === "cyan" && (
            <>
              <GridIcon />
              <PulseIcon />
            </>
          )}
          {project.accent === "violet" && (
            <div className="agent-graphic">
              <b>Plan</b>
              <b>Find</b>
              <b>Act</b>
              <b>Check</b>
            </div>
          )}
          {project.accent === "orange" && (
            <div className="batch-graphic">
              <span />
              <span />
              <span />
              <span />
              <i />
            </div>
          )}
          {project.accent === "lime" && (
            <div className="ledger-graphic">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
          {project.accent === "blue" && (
            <div className="exam-graphic">
              <i>01</i>
              <i>02</i>
              <i>03</i>
              <b>✓</b>
            </div>
          )}
          {project.accent === "pink" && (
            <div className="rag-graphic">
              <span>?</span>
              <i />
              <i />
              <i />
              <b>✓</b>
            </div>
          )}
        </div>
        <h3>{project.shortTitle}</h3>
        <p>{project.summary}</p>
      </div>
      <div className="project-card-bottom">
        <span>{project.outcome}</span>
        <span>Case study →</span>
      </div>
    </Link>
  );
}
