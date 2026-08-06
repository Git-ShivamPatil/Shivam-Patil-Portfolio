import type { Metadata } from "next";
import { ForgotPasswordForm } from "../../components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password — Shivam Patil",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="shell">
      <ForgotPasswordForm />
    </div>
  );
}
