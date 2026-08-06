import type { Metadata } from "next";
import { ResetPasswordForm } from "../../../components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Reset password — Shivam Patil",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="shell">
      <ResetPasswordForm token={token} />
    </div>
  );
}
