"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { changePasswordSchema, type ChangePasswordInput } from "../../lib/validations/account";
import { FormField } from "../auth/form-field";

export function ChangePasswordForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  async function onSubmit(values: ChangePasswordInput) {
    const res = await fetch("/api/account/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't update password.");
      return;
    }
    toast.success("Password updated.");
    reset();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-sm flex-col gap-4" noValidate>
      <FormField
        label="Current password"
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...register("currentPassword")}
      />
      <FormField
        label="New password"
        type="password"
        autoComplete="new-password"
        error={errors.newPassword?.message}
        {...register("newPassword")}
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-app-ink text-app-lime self-start rounded-full px-4 py-2 text-sm font-bold disabled:opacity-60"
      >
        {isSubmitting ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
