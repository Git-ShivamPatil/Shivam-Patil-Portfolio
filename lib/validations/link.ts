import { z } from "zod";

/**
 * A destination is either a site-relative path or an absolute http(s) URL.
 *
 * The protocol allowlist is the point: without it, `javascript:` and `data:`
 * destinations would be accepted and then handed to a browser by the /r/[code]
 * redirect — turning our own domain into a laundering step for whatever the
 * link actually points at.
 */
const destinationSchema = z
  .string()
  .min(1, "Destination is required")
  .max(500)
  .refine(
    (value) => {
      if (value.startsWith("/")) return !value.startsWith("//");
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    },
    { message: "Use a path like /services or a full http(s) URL." },
  );

export const linkSchema = z.object({
  // Optional on create — the server mints one when it is left blank.
  code: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,31}$/, "Use 2–32 lowercase letters, numbers or hyphens.")
    .optional()
    .or(z.literal("")),
  label: z.string().min(1, "Label is required").max(80),
  destination: destinationSchema,
  campaign: z.string().max(60).optional().or(z.literal("")),
  active: z.boolean().default(true),
});

export type LinkInput = z.infer<typeof linkSchema>;
