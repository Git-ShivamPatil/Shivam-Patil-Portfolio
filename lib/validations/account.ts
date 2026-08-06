import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateRoleSchema = z.object({
  role: z.enum(["USER", "ADMIN"]),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
