import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "../../lib/auth-guards";

const tabs = [
  { href: "/admin", label: "Users" },
  { href: "/admin/projects", label: "Projects" },
  { href: "/admin/blogs", label: "Blogs" },
  { href: "/admin/skills", label: "Skills" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/chat", label: "Chat" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/links", label: "Growth" },
  { href: "/admin/media", label: "Media" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/live", label: "Live" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Defense in depth — every /admin/* page also guards itself, but a layout
  // guard means a future page can't accidentally ship without one.
  await requireAdmin("/admin");

  return (
    <>
      <nav className="shell border-app-line flex gap-1 overflow-x-auto border-b pt-10 pb-4 text-sm">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="text-app-muted hover:text-app-fg hover:bg-app-line/30 shrink-0 rounded-full px-3.5 py-1.5 font-medium transition-colors"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
