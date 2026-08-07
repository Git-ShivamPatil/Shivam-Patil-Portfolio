import { z } from "zod";

export const skillSchema = z.object({
  category: z.string().min(1, "Category is required").max(60),
  name: z.string().min(1, "Name is required").max(80),
  order: z.number().int().default(0),
});
export type SkillInput = z.infer<typeof skillSchema>;
