import Link from "next/link";
import { ArrowUpRight, GridIcon, PulseIcon } from "../components/icons";
import { projects, type Project } from "./projects";

const skills = [
  "Go",
  "Python",
  "Rust",
  "React",
  "Next.js",
  "Distributed systems",
  "gRPC",
  "Kubernetes",
  "Generative AI",
];

export default function Home() {
  return (
    <>
      <section className="hero shell">
        <div className="hero-copy reveal">
          <p className="eyebrow">
            <span className="live-dot" />
            Available for impactful engineering work
          </p>
          <h1>
            Build systems
            <br />
            that <em>hold up.</em>
          </h1>
          <p className="hero-intro">
            I&apos;m Shivam Patil — a software engineer focused on high-throughput backend
            platforms, distributed systems, and thoughtful AI products.
          </p>
          <div className="hero-actions">
            <Link href="/#work" className="button button-solid">
              Explore my work <ArrowUpRight />
            </Link>
            <Link href="/reach-out" className="button button-text">
              Start a conversation <span>→</span>
            </Link>
          </div>
        </div>
        <div
          className="hero-visual reveal reveal-delay"
          aria-label="An abstract diagram representing a resilient distributed system"
        >
          <div className="orbital-field">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="center-core">
              <span>SP</span>
              <i />
            </div>
            <div className="signal-node node-one">
              <i />
              API
            </div>
            <div className="signal-node node-two">
              <i />
              AI
            </div>
            <div className="signal-node node-three">
              <i />
              SYS
            </div>
            <span className="star star-one" />
            <span className="star star-two" />
            <span className="star star-three" />
            <span className="star star-four" />
          </div>
          <div className="visual-caption">
            <span>01 / 06</span>
            <span>reliable by design</span>
          </div>
        </div>
      </section>

      <section className="proof-strip">
        <div className="shell proof-grid">
          <p>
            Engineering with
            <br />
            <strong>signal, not noise.</strong>
          </p>
          <div>
            <strong>45K</strong>
            <span>requests / second</span>
          </div>
          <div>
            <strong>8ms</strong>
            <span>p99 latency</span>
          </div>
          <div>
            <strong>87%</strong>
            <span>agent task success</span>
          </div>
        </div>
      </section>

      <section id="work" className="section shell work-section">
        <div className="section-heading reveal">
          <p className="eyebrow">
            Selected projects <span>06</span>
          </p>
          <h2>
            Technical work,
            <br />
            <em>made tangible.</em>
          </h2>
          <p>
            Six end-to-end system designs — from architecture and implementation decisions to
            commands for getting each project running.
          </p>
        </div>
        <div className="project-list">
          {projects.map((project, index) => (
            <ProjectCard key={project.slug} project={project} index={index} />
          ))}
        </div>
      </section>

      <section id="about" className="section shell about-section">
        <div className="about-statement reveal">
          <p className="eyebrow">The approach</p>
          <h2>
            I like the kind of
            <br />
            problems that get <em>clearer</em>
            <br />
            as you go deeper.
          </h2>
        </div>
        <div className="about-details">
          <p>
            At the intersection of systems engineering and AI, I work from the fundamentals: a
            useful contract, a dependable path through failure, and enough observability to tell
            what&apos;s real.
          </p>
          <div className="principles">
            <div>
              <span>01</span>
              <strong>Build for the edge cases</strong>
              <p>Graceful failures are part of the product.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Make it observable</strong>
              <p>Measure the behaviour that matters.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Keep the interface human</strong>
              <p>Complex systems deserve calm UX.</p>
            </div>
          </div>
          <Link href="/about" className="button button-text">
            Read the full story <span>→</span>
          </Link>
        </div>
      </section>

      <section className="capabilities">
        <div className="shell capabilities-inner">
          <p className="eyebrow">Working set</p>
          <div className="skill-marquee" aria-label="Technical skills">
            {[...skills, ...skills].map((skill, index) => (
              <span key={`${skill}-${index}`}>
                {skill}
                <i>✦</i>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="contact-banner shell">
        <div className="contact-banner-grid">
          <div>
            <p className="eyebrow">Let&apos;s build</p>
            <h2>
              Have a system
              <br />
              worth <em>solving?</em>
            </h2>
          </div>
          <div className="contact-banner-copy">
            <p>
              I&apos;m open to software engineering roles and collaborations where sound engineering
              makes a measurable difference.
            </p>
            <Link href="/reach-out" className="button button-light">
              Reach out <ArrowUpRight />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function ProjectCard({ project, index }: { project: Project; index: number }) {
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
