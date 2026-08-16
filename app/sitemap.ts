import type { MetadataRoute } from "next";
import { getProjects } from "./projects";
import { prisma } from "../lib/prisma";
import { readOrFallback } from "../lib/db-read";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shivamsfolio.com";

const staticRoutes = [
  "",
  "/projects",
  "/about",
  "/skills",
  "/experience",
  "/certifications",
  "/achievements",
  "/resume",
  "/contact",
  "/reach-out",
  "/blog",
  "/system-design",
  "/ask",
];

// /search is deliberately absent. app/search/page.tsx sets
// `robots: { index: false, follow: true }`, so listing it here asked crawlers
// to index a page the page itself tells them not to — the sitemap and the
// meta tag were contradicting each other. The route is still reachable (the
// header keeps its search link); it just no longer claims to be indexable.

// A hub has to outrank the leaves it lists. The per-project entries below are
// 0.8, so leaving /projects on the blanket 0.7 for non-home routes would tell
// a crawler that every individual case study matters more than the index that
// links to all of them. Both hubs also change whenever a project ships, which
// is a different cadence from the profile pages.
const HUB_ROUTES: Record<string, number> = { "": 1, "/projects": 0.9 };

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

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: now,
    changeFrequency: route in HUB_ROUTES ? "weekly" : "monthly",
    priority: HUB_ROUTES[route] ?? 0.7,
  }));
  const projectEntries: MetadataRoute.Sitemap = projects.map((project) => ({
    url: `${siteUrl}/projects/${project.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.8,
  }));
  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  return [...staticEntries, ...projectEntries, ...blogEntries];
}
