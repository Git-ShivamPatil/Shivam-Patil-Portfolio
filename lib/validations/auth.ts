import { z } from "zod";

// zod v4: z.email() is a top-level helper, not z.string().email() (v3 style).
const email = z.email("Enter a valid email address");
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters"); // bcrypt truncates beyond 72 bytes

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email,
  password,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
