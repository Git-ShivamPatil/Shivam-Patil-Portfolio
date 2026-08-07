import { z } from "zod";

export const contactFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.email("Enter a valid email address"),
  message: z.string().min(10, "Message is a bit short").max(2000),
  // Honeypot — zod objects strip unknown keys by default, so this must be a
  // real (optional) field or react-hook-form's validated output would never
  // include it, silently defeating the check in app/api/contact/route.ts.
  website: z.string().optional(),
});
export type ContactFormInput = z.infer<typeof contactFormSchema>;
