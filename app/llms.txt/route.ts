import { buildLlmsTxt } from "../../lib/seo/llms";
import { prisma } from "../../lib/prisma";
import { readOrFallback } from "../../lib/db-read";
import { getProjects } from "../projects";
import { withRed } from "../../lib/sre/red";

export const runtime = "nodejs";

/**
 * P27 — `/llms.txt`.
 *
 * A directory literally named `llms.txt` is how the App Router serves a path
 * with a dot in it; there is no `public/llms.txt` to collide with.
 *
 * **Revalidated hourly rather than static.** The document lists published
 * projects and posts, so a build-time snapshot would go stale the moment
 * something is published through the admin panel — the same reason the sitemap
 * is not static. An hour is short enough that new content is discoverable the
 * same day and long enough that a crawler polling it costs nothing.
 */
export const revalidate = 3600;

export const GET = withRed("/llms.txt", handleGET);

async function handleGET() {
  const [projects, posts] = await Promise.all([
    getProjects(),
    readOrFallback(
      "llms/posts",
      () =>
        prisma.blogPost.findMany({
          where: { published: true },
          select: { slug: true, title: true, excerpt: true },
          orderBy: { publishedAt: "desc" },
        }),
      [] as { slug: string; title: string; excerpt: string }[],
    ),
  ]);

  const body = buildLlmsTxt({
    projects: projects.map((project) => ({
      slug: project.slug,
      title: project.title,
      summary: project.summary,
    })),
    posts,
  });

  return new Response(body, {
    headers: {
      // text/plain, not text/markdown: the convention is a plain-text file, and
      // a browser that downloads it instead of rendering it is a worse outcome
      // than one that shows the markup.
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
