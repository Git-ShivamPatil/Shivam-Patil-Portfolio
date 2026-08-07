"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function DeleteButton({
  endpoint,
  confirmText,
  redirectTo,
  label = "Delete",
}: {
  endpoint: string;
  confirmText: string;
  redirectTo?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (typeof window !== "undefined" && !window.confirm(confirmText)) return;
    setPending(true);
    const res = await fetch(endpoint, { method: "DELETE" });
    setPending(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Couldn't delete.");
      return;
    }
    toast.success("Deleted.");
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
    >
      {pending ? "Deleting…" : label}
    </button>
  );
}
