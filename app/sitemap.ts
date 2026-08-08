import type { MetadataRoute } from "next";
import { getProjects } from "./projects";
import { prisma } from "../lib/prisma";
import { readOrFallback } from "../lib/db-read";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shivamsfolio.com";

const staticRoutes = [
  "",
  "/about",
  "/skills",
  "/experience",
  "/certifications",
  "/achievements",
  "/resume",
  "/contact",
  "/reach-out",
  "/blog",
  "/search",
];

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
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
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
