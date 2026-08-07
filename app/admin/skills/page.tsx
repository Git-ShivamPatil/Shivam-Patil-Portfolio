import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { SkillManager } from "../../../components/admin/skill-manager";

export const metadata: Metadata = {
  title: "Admin · Skills — Shivam Patil",
  robots: { index: false, follow: false },
};

export default async function AdminSkillsPage() {
  await requireAdmin("/admin/skills");
  const skills = await prisma.skill.findMany({ orderBy: [{ category: "asc" }, { order: "asc" }] });

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Skills</h1>
        <p className="text-app-muted mt-2 text-sm">{skills.length} total</p>
      </div>
      <SkillManager initialSkills={skills} />
    </div>
  );
}
