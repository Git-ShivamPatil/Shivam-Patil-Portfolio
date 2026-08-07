import { z } from "zod";

export const bookingSchema = z.object({
  offeringSlug: z.string().min(1, "Choose a service."),
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.email("Enter a valid email address."),
  company: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** ISO timestamp of the chosen slot, when one was picked. */
  scheduledAt: z.iso.datetime().optional(),
  calBookingUid: z.string().max(120).optional(),
  provider: z.enum(["STRIPE", "RAZORPAY"]).optional(),
  ref: z.string().max(120).optional(),
  website: z.string().optional(),
});

export type BookingInput = z.infer<typeof bookingSchema>;
