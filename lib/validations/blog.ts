import { z } from "zod";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const blogPostSchema = z.object({
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(120)
    .regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  title: z.string().min(1, "Title is required").max(200),
  excerpt: z.string().min(1, "Excerpt is required").max(400),
  content: z.string().min(1, "Content is required"),
  tags: z.array(z.string().min(1)).default([]),
  coverImage: z.union([z.string().min(1), z.literal("")]).optional(),
  published: z.boolean().default(false),
});
export type BlogPostInput = z.infer<typeof blogPostSchema>;
