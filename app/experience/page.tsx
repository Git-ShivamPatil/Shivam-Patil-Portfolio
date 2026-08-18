import { pageMetadata } from "../../lib/seo/metadata";
import { education, experience } from "../experience";

export const metadata = pageMetadata({
  title: "Experience & Work History",
  description:
    "Shivam Patil's roles as a Software Development Engineer, the systems shipped in each, and the education that led into them.",
  path: "/experience",
});

export default function ExperiencePage() {
  return (
    <>
      <section className="page-hero shell">
        <p className="eyebrow">Experience</p>
        <h1>
          Where the work
          <br />
          <em>happened.</em>
        </h1>
        <p>A timeline of roles, and the education that led into them.</p>
      </section>

      <div className="timeline shell">
        {experience.map((entry) => (
          <article key={`${entry.org}-${entry.role}`} className="timeline-item">
            <div className="timeline-meta">{entry.period}</div>
            <div>
              <h2>{entry.role}</h2>
              <p className="timeline-org">
                {entry.org} · {entry.location}
              </p>
              <ul className="timeline-highlights">
                {entry.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <div className="education-block shell">
        <h2>Education</h2>
        {education.map((entry) => (
          <div key={entry.degree} className="education-item">
            <div className="timeline-meta">{entry.period}</div>
            <div>
              <h3>{entry.degree}</h3>
              <p>
                {entry.org} · {entry.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
