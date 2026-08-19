import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "../../../lib/seo/og-image";
import { getProjectBySlug } from "../../projects";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Project case study";

/**
 * A card per case study.
 *
 * These are the pages most likely to be pasted into a message — a recruiter
 * thread, an application, a DM — and until now every one of them unfurled with
 * the site-wide card, so six different projects looked identical in the place
 * where the difference mattered most.
 *
 * Falls back to the generic card rather than 404ing when the slug is unknown or
 * the database is unreachable: an unfurl with no image is worse than an unfurl
 * with a general one, and `getProjectBySlug` is behind `readOrFallback`, so an
 * outage returns undefined rather than throwing.
 */
export default async function ProjectOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project) {
    return renderOgImage({ eyebrow: "Case study", title: "Project" });
  }
  return renderOgImage({
    eyebrow: project.category,
    title: project.title,
    subtitle: project.summary,
  });
}
