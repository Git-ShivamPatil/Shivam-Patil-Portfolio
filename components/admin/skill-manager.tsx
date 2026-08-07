"use client";

import { useState } from "react";
import { toast } from "sonner";

interface Skill {
  id: string;
  category: string;
  name: string;
  order: number;
}

const inputClass =
  "border-app-line bg-app-bg text-app-fg focus-visible:border-app-fg rounded-lg border px-3 py-2 text-sm outline-none";

export function SkillManager({ initialSkills }: { initialSkills: Skill[] }) {
  const [skills, setSkills] = useState(initialSkills);
  const [draft, setDraft] = useState({ category: "", name: "", order: 0 });
  const [adding, setAdding] = useState(false);

  async function addSkill() {
    if (!draft.category.trim() || !draft.name.trim()) {
      toast.error("Category and name are required.");
      return;
    }
    setAdding(true);
    const res = await fetch("/api/admin/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => null);
    setAdding(false);
    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't add skill.");
      return;
    }
    setSkills((prev) => [...prev, data.skill]);
    setDraft({ category: draft.category, name: "", order: 0 });
    toast.success("Skill added.");
  }

  async function saveSkill(skill: Skill) {
    const res = await fetch(`/api/admin/skills/${skill.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: skill.category, name: skill.name, order: skill.order }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't save skill.");
      return;
    }
    toast.success("Saved.");
  }

  async function deleteSkill(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this skill?")) return;
    const res = await fetch(`/api/admin/skills/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Couldn't delete skill.");
      return;
    }
    setSkills((prev) => prev.filter((skill) => skill.id !== id));
    toast.success("Deleted.");
  }

  function updateLocal(id: string, patch: Partial<Skill>) {
    setSkills((prev) => prev.map((skill) => (skill.id === id ? { ...skill, ...patch } : skill)));
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="border-app-line flex flex-wrap items-end gap-3 rounded-2xl border p-4">
        <label className="flex flex-col gap-1">
          <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
            Category
          </span>
          <input
            className={inputClass}
            value={draft.category}
            onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))}
            placeholder="e.g. Languages"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">Name</span>
          <input
            className={inputClass}
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="e.g. TypeScript"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
            Order
          </span>
          <input
            type="number"
            className={`${inputClass} w-20`}
            value={draft.order}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, order: Number(event.target.value) }))
            }
          />
        </label>
        <button
          type="button"
          onClick={addSkill}
          disabled={adding}
          className="bg-app-ink text-app-lime rounded-full px-4 py-2 text-sm font-bold disabled:opacity-60"
        >
          {adding ? "Adding…" : "Add skill"}
        </button>
      </section>

      <div className="border-app-line overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {skills
              .slice()
              .sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order)
              .map((skill) => (
                <tr key={skill.id} className="border-app-line border-b last:border-0">
                  <td className="px-4 py-2">
                    <input
                      className={inputClass}
                      value={skill.category}
                      onChange={(event) => updateLocal(skill.id, { category: event.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      className={inputClass}
                      value={skill.name}
                      onChange={(event) => updateLocal(skill.id, { name: event.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      className={`${inputClass} w-20`}
                      value={skill.order}
                      onChange={(event) =>
                        updateLocal(skill.id, { order: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => saveSkill(skill)}
                        className="text-app-fg text-xs font-semibold hover:underline"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSkill(skill.id)}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            {skills.length === 0 && (
              <tr>
                <td colSpan={4} className="text-app-muted px-4 py-8 text-center">
                  No skills yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
