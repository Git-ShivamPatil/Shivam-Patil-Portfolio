"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { resetPasswordSchema, type ResetPasswordInput } from "../../lib/validations/auth";
import { FormField } from "./form-field";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });

  async function onSubmit(values: ResetPasswordInput) {
    const res = await fetch("/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't reset your password.");
      return;
    }

    toast.success("Password updated — sign in with your new password.");
    router.push("/login");
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-24">
      <div>
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Reset password
        </p>
        <h1 className="text-app-fg text-4xl font-bold tracking-tight">Choose a new password.</h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <input type="hidden" {...register("token")} />
        <FormField
          label="New password"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-app-ink text-app-lime rounded-full px-4 py-2.5 text-sm font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
