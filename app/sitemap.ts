import type { MetadataRoute } from "next";
import { getProjects } from "./projects";
import { prisma } from "../lib/prisma";
import { readOrFallback } from "../lib/db-read";
import { indexableRoutes } from "../lib/site-routes";
import { siteUrl } from "../lib/seo/site";

/**
 * The sitemap, generated from the route registry rather than from a second
 * hand-maintained list.
 *
 * **What this replaced, and why it mattered.** The previous version carried its
 * own `staticRoutes` array of seventeen paths. Diffed against the `page.tsx`
 * files actually on disk, ten public, indexable routes were missing from it:
 * /api-lab, /compute, /data, /edge, /mlops, /reliability, /security, /services,
 * /stats and /terminal. Every one of those is also reachable only through a
 * JavaScript-driven navigation drawer, so the sitemap was realistically their
 * only discovery path — and it did not mention them. They were, in effect,
 * unlisted.
 *
 * Reading from lib/site-routes.ts means a route added to the navigation is in
 * the sitemap by construction. There is no longer a second place to remember.
 *
 * `/search` stays absent, deliberately: app/search/page.tsx sets
 * `robots: { index: false, follow: true }`, and a sitemap entry for a page that
 * tells crawlers not to index it is the two signals contradicting each other.
 * It is excluded by not being in the registry at all.
 */

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [projects, blogPosts] = await Promise.all([
    getProjects(),
    readOrFallback(
      "sitemap/blogPosts",
      () =>
        prisma.blogPost.findMany({
          where: { published: true },
          select: { slug: true, updatedAt: true },
        }),
      [] as { slug: string; updatedAt: Date }[],
    ),
  ]);

  const staticEntries: MetadataRoute.Sitemap = indexableRoutes().map((route) => ({
    url: `${siteUrl}${route.href === "/" ? "" : route.href}`,
    lastModified: now,
    changeFrequency: route.changeFrequency ?? "monthly",
    // 0.6 rather than the old blanket 0.7: the registry gives the pages that
    // matter an explicit higher number, so the default is what is left over.
    priority: route.priority ?? 0.6,
  }));

  // Case studies sit just under /projects (0.95). They are the deepest content
  // on the site and the pages most likely to answer a specific technical query.
  const projectEntries: MetadataRoute.Sitemap = projects.map((project) => ({
    url: `${siteUrl}/projects/${project.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.85,
  }));

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    // The post's own updatedAt, not `now`. Stamping every entry with build time
    // tells a crawler the whole site changed on every deploy, which trains it
    // to stop believing lastModified at all.
    lastModified: post.updatedAt,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticEntries, ...projectEntries, ...blogEntries];
}
