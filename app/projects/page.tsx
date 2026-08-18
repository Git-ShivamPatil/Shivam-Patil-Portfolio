import { pageMetadata } from "../../lib/seo/metadata";
import { ProjectFilter } from "../../components/project-filter";
import { getProjects } from "../projects";
import { JsonLd } from "../../components/seo/json-ld";
import { breadcrumbJsonLd, itemListJsonLd } from "../../lib/seo/structured-data";
import "./projects.css";

// "../projects" is app/projects.ts, not this directory: TypeScript resolves a
// sibling .ts file before a directory of the same name, and there is no
// index.ts here to make it ambiguous. app/skills.ts and app/skills/page.tsx
// have coexisted the same way since P4.

export const metadata = pageMetadata({
  title: "Projects & Case Studies",
  description:
    "Six end-to-end builds by Shivam Patil in Rust, Go, C++ and Python — each with the architecture, the trade-offs it forced, and the commands to run it yourself.",
  path: "/projects",
});

// The list is read from the database behind a fallback, exactly as it was when
// it lived on the homepage. A build that cannot reach the database prerenders
// an empty grid, so this page has to be able to re-render rather than being
// frozen as static output.
export const revalidate = 300;

export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Projects", href: "/projects" }]),
          // An index page that only says "here are some things" ranks on its own
          // prose. The ItemList tells a crawler what this page is an index OF,
          // which is what lets /projects surface for a query about something on
          // it rather than only for the word "projects".
          itemListJsonLd(
            "Project case studies",
            projects.map((project) => ({
              name: project.title,
              href: `/projects/${project.slug}`,
              description: project.summary,
            })),
          ),
        ]}
      />
      <section className="page-hero shell">
        <p className="eyebrow">Selected projects</p>
        <h1 data-split>
          Technical work,
          <br />
          <em>made tangible.</em>
        </h1>
        <p>
          End-to-end system designs — from architecture and implementation decisions to commands for
          getting each project running.
        </p>
      </section>

      <section className="projects-index shell" data-reveal>
        {/* The filter is the whole point of this page, so it renders the full
            set rather than a featured slice; the homepage links here instead
            of carrying its own copy of the list. */}
        {projects.length === 0 ? (
          <p className="projects-empty">
            No projects to show right now — this list reads from the database and falls back to
            empty rather than failing.
          </p>
        ) : (
          <ProjectFilter projects={projects} />
        )}
      </section>
    </>
  );
}
