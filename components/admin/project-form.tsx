"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormField } from "../auth/form-field";

const ACCENTS = ["cyan", "violet", "orange", "lime", "blue", "pink"] as const;
const ARCH_TYPES = ["input", "core", "store", "output"] as const;

interface ScalarValues {
  slug: string;
  number: string;
  category: string;
  title: string;
  shortTitle: string;
  summary: string;
  outcome: string;
  accent: (typeof ACCENTS)[number];
  useCase: string;
  published: boolean;
  order: number;
}

interface ImplementedRow {
  title: string;
  description: string;
}
interface ArchitectureRow {
  title: string;
  detail: string;
  type: (typeof ARCH_TYPES)[number];
}
interface StepRow {
  title: string;
  description: string;
  command: string;
}
interface ImageRow {
  url: string;
  alt: string;
}

export interface ProjectFormInitial extends ScalarValues {
  stack: string[];
  tags: string[];
  implemented: [string, string][];
  architecture: ArchitectureRow[];
  steps: [string, string, string][];
  images: ImageRow[];
}

function label(text: string) {
  return (
    <span className="text-app-muted mb-1 block text-xs font-semibold tracking-wide uppercase">
      {text}
    </span>
  );
}

const inputClass =
  "border-app-line bg-app-bg text-app-fg focus-visible:border-app-fg w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none";

export function ProjectForm({ id, initial }: { id?: string; initial?: ProjectFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(id);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ScalarValues>({
    defaultValues: initial ?? {
      slug: "",
      number: "",
      category: "",
      title: "",
      shortTitle: "",
      summary: "",
      outcome: "",
      accent: "cyan",
      useCase: "",
      published: true,
      order: 0,
    },
  });

  const [stackText, setStackText] = useState(initial?.stack.join(", ") ?? "");
  const [tagsText, setTagsText] = useState(initial?.tags.join(", ") ?? "");
  const [implemented, setImplemented] = useState<ImplementedRow[]>(
    initial?.implemented.map(([title, description]) => ({ title, description })) ?? [
      { title: "", description: "" },
    ],
  );
  const [architecture, setArchitecture] = useState<ArchitectureRow[]>(
    initial?.architecture ?? [{ title: "", detail: "", type: "core" }],
  );
  const [steps, setSteps] = useState<StepRow[]>(
    initial?.steps.map(([title, description, command]) => ({ title, description, command })) ?? [
      { title: "", description: "", command: "" },
    ],
  );
  const [images, setImages] = useState<ImageRow[]>(initial?.images ?? []);

  async function onSubmit(values: ScalarValues) {
    const payload = {
      ...values,
      stack: stackText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      tags: tagsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      implemented: implemented
        .filter((row) => row.title && row.description)
        .map((row) => [row.title, row.description]),
      architecture: architecture.filter((row) => row.title && row.detail),
      steps: steps
        .filter((row) => row.title && row.description && row.command)
        .map((row) => [row.title, row.description, row.command]),
      images: images.filter((row) => row.url),
    };

    const res = await fetch(isEdit ? `/api/admin/projects/${id}` : "/api/admin/projects", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't save project.");
      return;
    }
    toast.success(isEdit ? "Project updated." : "Project created.");
    router.push("/admin/projects");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8" noValidate>
      <section className="grid gap-4 sm:grid-cols-2">
        <FormField label="Slug" error={errors.slug?.message} {...register("slug")} />
        <FormField label="Number" error={errors.number?.message} {...register("number")} />
        <FormField label="Category" error={errors.category?.message} {...register("category")} />
        <FormField label="Outcome" error={errors.outcome?.message} {...register("outcome")} />
        <FormField label="Title" error={errors.title?.message} {...register("title")} />
        <FormField
          label="Short title"
          error={errors.shortTitle?.message}
          {...register("shortTitle")}
        />
        <label className="flex flex-col gap-1.5">
          {label("Accent")}
          <select {...register("accent")} className={inputClass}>
            {ACCENTS.map((accent) => (
              <option key={accent} value={accent}>
                {accent}
              </option>
            ))}
          </select>
        </label>
        <FormField
          label="Order"
          type="number"
          error={errors.order?.message}
          {...register("order", { valueAsNumber: true })}
        />
      </section>

      <label className="flex flex-col gap-1.5">
        {label("Summary")}
        <textarea rows={2} className={inputClass} {...register("summary")} />
      </label>
      <label className="flex flex-col gap-1.5">
        {label("Use case")}
        <textarea rows={3} className={inputClass} {...register("useCase")} />
      </label>

      <label className="flex flex-col gap-1.5">
        {label("Stack (comma-separated)")}
        <input
          className={inputClass}
          value={stackText}
          onChange={(event) => setStackText(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        {label("Tags (comma-separated, used for the homepage filter)")}
        <input
          className={inputClass}
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
        />
      </label>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" {...register("published")} className="h-4 w-4" />
        Published
      </label>

      <RepeatingSection
        title="What's implemented"
        rows={implemented}
        onChange={setImplemented}
        empty={{ title: "", description: "" }}
        fields={[
          { key: "title", placeholder: "Title" },
          { key: "description", placeholder: "Description", textarea: true },
        ]}
      />

      <RepeatingSection<ArchitectureRow>
        title="Architecture nodes"
        rows={architecture}
        onChange={setArchitecture}
        empty={{ title: "", detail: "", type: "core" }}
        fields={[
          { key: "title", placeholder: "Title" },
          { key: "detail", placeholder: "Detail" },
          { key: "type", placeholder: "Type", select: ARCH_TYPES },
        ]}
      />

      <RepeatingSection
        title="Build steps"
        rows={steps}
        onChange={setSteps}
        empty={{ title: "", description: "", command: "" }}
        fields={[
          { key: "title", placeholder: "Title" },
          { key: "description", placeholder: "Description" },
          { key: "command", placeholder: "Command", textarea: true },
        ]}
      />

      <RepeatingSection
        title="Gallery images"
        rows={images}
        onChange={setImages}
        empty={{ url: "", alt: "" }}
        fields={[
          { key: "url", placeholder: "Image URL" },
          { key: "alt", placeholder: "Alt text" },
        ]}
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-app-ink text-app-lime self-start rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create project"}
      </button>
    </form>
  );
}

interface FieldSpec<T> {
  key: keyof T;
  placeholder: string;
  textarea?: boolean;
  select?: readonly string[];
}

// Not constrained to Record<string, string> — TS requires an actual index
// signature to satisfy that as a generic constraint, which plain field
// interfaces like ArchitectureRow (title/detail/type) don't have even
// though every value happens to be string-typed. `object` plus the cast in
// updateRow is the pragmatic fix for this internal admin-only component.
function RepeatingSection<T extends object>({
  title,
  rows,
  onChange,
  empty,
  fields,
}: {
  title: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  empty: T;
  fields: FieldSpec<T>[];
}) {
  function updateRow(index: number, key: keyof T, value: string) {
    const next = rows.slice();
    next[index] = { ...next[index], [key]: value } as T;
    onChange(next);
  }
  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-app-fg text-sm font-bold">{title}</h2>
        <button
          type="button"
          onClick={() => onChange([...rows, empty])}
          className="border-app-line text-app-fg rounded-full border px-3 py-1 text-xs font-semibold"
        >
          + Add row
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div
            key={index}
            className="border-app-line grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
          >
            {fields.map((field) =>
              field.select ? (
                <select
                  key={String(field.key)}
                  value={String(row[field.key] ?? "")}
                  onChange={(event) => updateRow(index, field.key, event.target.value)}
                  className={inputClass}
                >
                  {field.select.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.textarea ? (
                <textarea
                  key={String(field.key)}
                  rows={2}
                  placeholder={field.placeholder}
                  value={String(row[field.key] ?? "")}
                  onChange={(event) => updateRow(index, field.key, event.target.value)}
                  className={inputClass}
                />
              ) : (
                <input
                  key={String(field.key)}
                  placeholder={field.placeholder}
                  value={String(row[field.key] ?? "")}
                  onChange={(event) => updateRow(index, field.key, event.target.value)}
                  className={inputClass}
                />
              ),
            )}
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="text-xs font-semibold text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-app-muted text-xs">No rows yet.</p>}
      </div>
    </section>
  );
}
