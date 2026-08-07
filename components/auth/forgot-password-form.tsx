"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema, type ForgotPasswordInput } from "../../lib/validations/auth";
import { FormField } from "./form-field";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordInput) {
    // The API always responds the same way regardless of whether the email
    // exists — the UI mirrors that by always showing the same "sent" state.
    await fetch("/api/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    }).catch(() => null);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 py-24 text-center">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Check your inbox
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">
          If an account exists for that email, we&apos;ve sent instructions.
        </h1>
        <Link href="/login" className="text-app-fg mt-4 text-sm font-semibold">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-24">
      <div>
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Forgot password
        </p>
        <h1 className="text-app-fg text-4xl font-bold tracking-tight">Reset your password.</h1>
        <p className="text-app-muted mt-3 text-sm">
          Enter your email and we&apos;ll send you a link to reset it.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-app-ink text-app-lime rounded-full px-4 py-2.5 text-sm font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="text-app-muted text-center text-sm">
        <Link href="/login" className="text-app-fg font-semibold">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
