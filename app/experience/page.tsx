import { pageMetadata } from "../../lib/seo/metadata";
import { education, experience } from "../experience";
import { JsonLd } from "../../components/seo/json-ld";
import { breadcrumbJsonLd } from "../../lib/seo/structured-data";

export const metadata = pageMetadata({
  title: "Experience & Work History",
  description:
    "Shivam Patil's roles as a Software Development Engineer, the systems shipped in each, and the education that led into them.",
  path: "/experience",
});

export default function ExperiencePage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Experience", href: "/experience" }])} />
      <section className="page-hero shell">
        <p className="eyebrow">Experience</p>
        <h1>
          Where the work
          <br />
          <em>happened.</em>
        </h1>
        <p>
          <strong>Software Development Engineer at Tata Consultancy Services</strong> since January
          2025 — 13+ production REST APIs serving 10,000+ requests a day, 33% lower response
          latency, and the RAG evaluation work behind a live RBI chatbot. The full timeline, and the
          degree that led into it.
        </p>
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
