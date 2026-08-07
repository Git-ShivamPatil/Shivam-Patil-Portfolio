import { z } from "zod";

export const chatMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Type a message first.")
    .max(2000, "Keep it under 2000 characters."),
  // Owner-only: which visitor thread the reply belongs to. Ignored for
  // visitors, who can only ever write to their own conversation.
  conversationId: z.string().cuid().optional(),
  name: z.string().trim().max(80).optional(),
  email: z.email("Enter a valid email address.").optional().or(z.literal("")),
});

export const chatReadSchema = z.object({
  conversationId: z.string().cuid().optional(),
});

export const chatTypingSchema = z.object({
  conversationId: z.string().cuid().optional(),
});

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
