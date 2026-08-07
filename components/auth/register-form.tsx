"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { registerSchema, type RegisterInput } from "../../lib/validations/auth";
import { FormField } from "./form-field";
import { OAuthButtons } from "./oauth-buttons";

export function RegisterForm() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(values: RegisterInput) {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? "Couldn't create your account.");
      return;
    }

    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (result?.error) {
      toast.success("Account created — please sign in.");
      router.push("/login");
      return;
    }

    toast.success("Account created.");
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-24">
      <div>
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Register
        </p>
        <h1 className="text-app-fg text-4xl font-bold tracking-tight">Create an account.</h1>
      </div>

      <OAuthButtons />

      <div className="text-app-muted flex items-center gap-3 text-xs">
        <span className="bg-app-line h-px flex-1" />
        or
        <span className="bg-app-line h-px flex-1" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField
          label="Name"
          autoComplete="name"
          error={errors.name?.message}
          {...register("name")}
        />
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <FormField
          label="Password"
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
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-app-muted text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-app-fg font-semibold">
          Sign in
        </Link>
      </p>
    </div>
  );
}
