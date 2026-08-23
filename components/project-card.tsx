import Link from "next/link";
import { ArrowUpRight, GridIcon, PulseIcon } from "./icons";
import type { Project } from "../app/projects";

export function ProjectCard({ project, index }: { project: Project; index: number }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className={`project-card project-${project.accent} reveal`}
      // `index` used to alternate an `offset-card` translateY, which pushed
      // every second card 52px out of flow and made the grid rows overlap on
      // any width where the cards were not the same height. It now feeds a
      // stagger custom property instead — the same `--i` the phase list on
      // /system-design uses to order its entrance — so the ordering
      // information survives without anything leaving normal flow.
      style={{ ["--i" as string]: index }}
      data-tilt
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
          {/* Keyed on slug, not accent, and that is a deliberate exception.

              Every other illustration below is chosen by `project.accent`,
              which works because there are exactly six accents and there were
              exactly six projects. The seventh has no accent left: the enum in
              schema.prisma holds six values and all are taken, so giving this
              one its own would mean an `ALTER TYPE` against the production
              database for what is a drawing.

              Since the monochrome rebuild the accents are six near-identical
              greys — #e1e1e1 to #d3d3d3 — so sharing `cyan` with the rate
              limiter costs nothing in colour. What it would have cost is the
              GRAPHIC, and the two would have sat adjacent in the list wearing
              the same one. Hence the override: a depth ladder, which is what
              this project is actually about.

              If a project ever needs both its own colour and its own drawing,
              that is the point to add the enum value. */}
          {project.slug === "low-latency-market-data-order-entry" ? (
            <div className="depth-graphic">
              <i />
              <i />
              <i />
              <b />
              <i />
              <i />
            </div>
          ) : (
            <>
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
            </>
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
