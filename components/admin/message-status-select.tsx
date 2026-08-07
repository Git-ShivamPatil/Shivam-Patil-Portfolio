"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const STATUSES = ["UNREAD", "READ", "ARCHIVED"] as const;

export function MessageStatusSelect({
  messageId,
  currentStatus,
}: {
  messageId: string;
  currentStatus: (typeof STATUSES)[number];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onChange(status: string) {
    setPending(true);
    const res = await fetch(`/api/admin/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => null);
    setPending(false);

    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't update status.");
      return;
    }
    router.refresh();
  }

  return (
    <select
      defaultValue={currentStatus}
      disabled={pending}
      onChange={(event) => onChange(event.target.value)}
      className="border-app-line bg-app-bg text-app-fg rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
    >
      {STATUSES.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}
