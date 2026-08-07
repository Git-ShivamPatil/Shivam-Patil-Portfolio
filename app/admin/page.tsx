import type { Metadata } from "next";
import { requireAdmin } from "../../lib/auth-guards";
import { prisma } from "../../lib/prisma";
import { RoleSelect } from "../../components/admin/role-select";

export const metadata: Metadata = {
  title: "Admin — Shivam Patil",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const session = await requireAdmin("/admin");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return (
    <div className="shell py-16">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Users</h1>
        <p className="text-app-muted mt-2 text-sm">{users.length} registered</p>
      </div>

      <div className="border-app-line overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Joined</th>
              <th className="px-4 py-3 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-app-line border-b last:border-0">
                <td className="text-app-fg px-4 py-3">{user.name ?? "—"}</td>
                <td className="text-app-muted px-4 py-3">{user.email}</td>
                <td className="text-app-muted px-4 py-3">
                  {user.createdAt.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="px-4 py-3">
                  <RoleSelect
                    userId={user.id}
                    currentRole={user.role}
                    disabled={user.id === session.user.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
