import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { MessageStatusSelect } from "../../../components/admin/message-status-select";
import { DeleteButton } from "../../../components/admin/delete-button";

export const metadata: Metadata = {
  title: "Admin · Inbox",
  robots: { index: false, follow: false },
};

const INBOX_PAGE_SIZE = 100;

export default async function AdminInboxPage() {
  await requireAdmin("/admin/inbox");
  // Bounded: this page renders every row it loads, so an unbounded findMany
  // degrades linearly with inbox size — and a contact form is exactly the
  // sort of endpoint that gets spammed. The counts below are aggregates so
  // they stay accurate regardless of how many rows are actually shown.
  const [messages, totalCount, unreadCount] = await Promise.all([
    prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: INBOX_PAGE_SIZE }),
    prisma.contactMessage.count(),
    prisma.contactMessage.count({ where: { status: "UNREAD" } }),
  ]);

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Inbox</h1>
        <p className="text-app-muted mt-2 text-sm">
          {totalCount} total · {unreadCount} unread
          {totalCount > messages.length && ` · showing latest ${messages.length}`}
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
