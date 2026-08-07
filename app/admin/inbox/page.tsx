import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { MessageStatusSelect } from "../../../components/admin/message-status-select";
import { DeleteButton } from "../../../components/admin/delete-button";

export const metadata: Metadata = {
  title: "Admin · Inbox — Shivam Patil",
  robots: { index: false, follow: false },
};

export default async function AdminInboxPage() {
  await requireAdmin("/admin/inbox");
  const messages = await prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" } });
  const unreadCount = messages.filter((message) => message.status === "UNREAD").length;

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Inbox</h1>
        <p className="text-app-muted mt-2 text-sm">
          {messages.length} total · {unreadCount} unread
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {messages.map((message) => (
          <article key={message.id} className="border-app-line rounded-2xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-app-fg font-semibold">
                  {message.name}{" "}
                  <span className="text-app-muted font-normal">— {message.email}</span>
                </p>
                <p className="text-app-muted mt-0.5 text-xs">
                  {message.createdAt.toLocaleString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {message.source}
                  {message.referralRef ? ` · ref: ${message.referralRef}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <MessageStatusSelect messageId={message.id} currentStatus={message.status} />
                <DeleteButton
                  endpoint={`/api/admin/messages/${message.id}`}
                  confirmText="Delete this message? This can't be undone."
                />
              </div>
            </div>
            <p className="text-app-fg mt-3 text-sm whitespace-pre-wrap">{message.message}</p>
          </article>
        ))}
        {messages.length === 0 && (
          <p className="text-app-muted border-app-line rounded-2xl border py-10 text-center">
            No messages yet.
          </p>
        )}
      </div>
    </div>
  );
}
