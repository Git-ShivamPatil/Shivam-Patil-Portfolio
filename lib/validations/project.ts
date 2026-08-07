import { z } from "zod";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const implementedItemSchema = z.tuple([
  z.string().min(1, "Title is required"),
  z.string().min(1, "Description is required"),
]);

const architectureNodeSchema = z.object({
  title: z.string().min(1, "Title is required"),
  detail: z.string().min(1, "Detail is required"),
  type: z.enum(["input", "core", "store", "output"]),
});

const stepSchema = z.tuple([
  z.string().min(1, "Title is required"),
  z.string().min(1, "Description is required"),
  z.string().min(1, "Command is required"),
]);

const imageSchema = z.object({
  url: z.string().min(1, "Image URL is required"),
  alt: z.string().default(""),
});

export const projectSchema = z.object({
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(100)
    .regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  number: z.string().min(1).max(10),
  category: z.string().min(1, "Category is required").max(80),
  title: z.string().min(1, "Title is required").max(160),
  shortTitle: z.string().min(1, "Short title is required").max(60),
  summary: z.string().min(1, "Summary is required").max(500),
  outcome: z.string().min(1, "Outcome is required").max(80),
  accent: z.enum(["cyan", "violet", "orange", "lime", "blue", "pink"]),
  stack: z.array(z.string().min(1)).min(1, "Add at least one stack item"),
  tags: z.array(z.string().min(1)).default([]),
  useCase: z.string().min(1, "Use case is required").max(1000),
  implemented: z.array(implementedItemSchema).min(1, "Add at least one implementation highlight"),
  architecture: z.array(architectureNodeSchema).min(1, "Add at least one architecture node"),
  steps: z.array(stepSchema).min(1, "Add at least one build step"),
  images: z.array(imageSchema).default([]),
  published: z.boolean().default(true),
  order: z.number().int().default(0),
});
export type ProjectInput = z.infer<typeof projectSchema>;
