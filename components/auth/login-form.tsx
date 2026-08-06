"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { loginSchema, type LoginInput } from "../../lib/validations/auth";
import { FormField } from "./form-field";
import { OAuthButtons } from "./oauth-buttons";

// Auth.js redirects OAuth failures back to pages.error (this page) with an
// `error` query param naming the failure — surface it instead of failing
// silently. https://errors.authjs.dev
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  Configuration: "That sign-in method isn't configured yet — try email/password instead.",
  OAuthAccountNotLinked:
    "That email is already registered a different way. Try signing in with email/password.",
  AccessDenied: "Access was denied.",
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const oauthError = searchParams.get("error");

  useEffect(() => {
    if (oauthError) {
      toast.error(OAUTH_ERROR_MESSAGES[oauthError] ?? "Sign-in failed. Please try again.");
    }
    // Only meant to fire once per page load, on whatever error was present
    // when this page was reached — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    const result = await signIn("credentials", { ...values, redirect: false });
    if (result?.error) {
      toast.error("Incorrect email or password.");
      return;
    }
    toast.success("Signed in.");
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-24">
      <div>
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Sign in
        </p>
        <h1 className="text-app-fg text-4xl font-bold tracking-tight">Welcome back.</h1>
      </div>

      <OAuthButtons callbackUrl={callbackUrl} />

      <div className="text-app-muted flex items-center gap-3 text-xs">
        <span className="bg-app-line h-px flex-1" />
        or
        <span className="bg-app-line h-px flex-1" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
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
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-app-muted hover:text-app-fg text-xs font-semibold"
          >
            Forgot password?
          </Link>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-app-ink text-app-lime rounded-full px-4 py-2.5 text-sm font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-app-muted text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-app-fg font-semibold">
          Register
        </Link>
      </p>
    </div>
  );
}
