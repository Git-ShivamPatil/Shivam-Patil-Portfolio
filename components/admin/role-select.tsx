"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function RoleSelect({
  userId,
  currentRole,
  disabled,
}: {
  userId: string;
  currentRole: "USER" | "ADMIN";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onChange(role: string) {
    setPending(true);
    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const data = await res.json().catch(() => null);
    setPending(false);

    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't update role.");
      return;
    }
    toast.success("Role updated.");
    router.refresh();
  }

  return (
    <select
      defaultValue={currentRole}
      disabled={disabled || pending}
      onChange={(e) => onChange(e.target.value)}
      className="border-app-line bg-app-bg text-app-fg rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
    >
      <option value="USER">USER</option>
      <option value="ADMIN">ADMIN</option>
    </select>
  );
}
