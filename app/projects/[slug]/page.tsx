import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "../../../components/icons";
import { projectBySlug, projects } from "../../projects";

export function generateStaticParams() {
  return projects.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = projectBySlug(slug);
  if (!project) return { title: "Project — Shivam Patil" };
  return {
    title: `${project.title} — Shivam Patil`,
    description: project.summary,
    alternates: { canonical: `/projects/${project.slug}` },
    openGraph: { title: `${project.title} — Shivam Patil`, description: project.summary },
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = projectBySlug(slug);
  if (!project) notFound();
  const projectIndex = projects.findIndex((item) => item.slug === slug);
  const nextProject = projects[(projectIndex + 1) % projects.length];

  return (
    <>
      <section className={`project-hero project-${project.accent}`}>
        <div className="shell project-hero-inner">
          <Link href="/#work" className="back-link">
            ← All projects
          </Link>
          <div className="project-hero-meta">
            <span>{project.number} / 06</span>
            <span>{project.category}</span>
          </div>
          <h1>{project.title}</h1>
          <p>{project.summary}</p>
          <div className="project-tags">
            {project.stack.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="project-outcome">
            <span>Outcome</span>
            <strong>{project.outcome}</strong>
          </div>
        </div>
        <div className="hero-noise" aria-hidden="true" />
      </section>

      <section className="project-content shell">
        <div className="project-side-label">
          01 <span>Context</span>
        </div>
        <div className="project-main">
          <p className="eyebrow">Use case</p>
          <h2>The problem space.</h2>
          <p className="project-lede">{project.useCase}</p>
        </div>
      </section>

      <section className="project-content shell implementation-section">
        <div className="project-side-label">
          02 <span>Implementation</span>
        </div>
        <div className="project-main">
          <p className="eyebrow">What&apos;s implemented</p>
          <h2>
            Built with <em>intention.</em>
          </h2>
          <div className="implementation-list">
            {project.implemented.map(([title, description], index) => (
              <article key={title}>
                <span>0{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="architecture-section">
        <div className="shell">
          <div className="architecture-heading">
            <div>
              <p className="eyebrow">Architecture</p>
              <h2>
                Systems in <em>concert.</em>
              </h2>
            </div>
            <p>The primary request and data paths, presented as a compact operating model.</p>
          </div>
          <div
            className="architecture-flow"
            role="img"
            aria-label={`${project.title} architecture flow`}
          >
            {project.architecture.map((node, index) => (
              <div key={node.title} className="architecture-node-wrap">
                <div className={`architecture-node ${node.type}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{node.title}</strong>
                  <small>{node.detail}</small>
                </div>
                {index < project.architecture.length - 1 && (
                  <div className="architecture-connector">
                    <i />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="architecture-note">
            A conceptual architecture for communicating the system design and operational
            responsibilities.
          </p>
        </div>
      </section>

      <section className="project-content shell build-section">
        <div className="project-side-label">
          03 <span>Build guide</span>
        </div>
        <div className="project-main">
          <p className="eyebrow">Step by step</p>
          <h2>
            From zero to
            <br />
            <em>running.</em>
          </h2>
          <p className="guide-intro">
            Representative local-development commands that show the implementation path and
            operating sequence.
          </p>
          <ol className="build-steps">
            {project.steps.map(([title, description, command], index) => (
              <li key={title}>
                <div className="step-index">{String(index + 1).padStart(2, "0")}</div>
                <div className="step-copy">
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
                <pre>
                  <code>{command}</code>
                </pre>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="next-project shell">
        <p className="eyebrow">Continue exploring</p>
        <Link href={`/projects/${nextProject.slug}`}>
          <span>Next project</span>
          <h2>{nextProject.shortTitle}</h2>
          <ArrowUpRight />
        </Link>
      </section>
    </>
  );
}
