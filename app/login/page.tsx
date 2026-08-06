import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "../../components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — Shivam Patil",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="shell">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
