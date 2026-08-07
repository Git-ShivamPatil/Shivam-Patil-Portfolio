import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { ChatConsole, type ConversationSummary } from "../../../components/admin/chat-console";

export const metadata: Metadata = {
  title: "Admin · Chat — Shivam Patil",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminChatPage() {
  await requireAdmin("/admin/chat");

  const conversations = await prisma.chatConversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
      // Unread here means "sent by the visitor and not yet acknowledged by
      // the owner" — the same predicate the read endpoint stamps.
      _count: { select: { messages: { where: { author: "VISITOR", readAt: null } } } },
    },
  });

  const summaries: ConversationSummary[] = conversations.map((conversation) => ({
    id: conversation.id,
    label:
      conversation.visitorName ??
      conversation.user?.name ??
      conversation.visitorEmail ??
      conversation.user?.email ??
      `Visitor ${conversation.id.slice(-6)}`,
    email: conversation.visitorEmail ?? conversation.user?.email ?? null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    unread: conversation._count.messages,
  }));

  const totalUnread = summaries.reduce((sum, conversation) => sum + conversation.unread, 0);

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Chat</h1>
        <p className="text-app-muted mt-2 text-sm">
          {summaries.length} conversation{summaries.length === 1 ? "" : "s"} · {totalUnread} unread
        </p>
      </div>

      <ChatConsole conversations={summaries} />
    </div>
  );
}
