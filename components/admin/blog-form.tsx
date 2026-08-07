"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { BlogPostInput } from "../../lib/validations/blog";
import { FormField } from "../auth/form-field";

const inputClass =
  "border-app-line bg-app-bg text-app-fg focus-visible:border-app-fg w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none";

type ScalarValues = Omit<BlogPostInput, "tags">;

export function BlogForm({
  id,
  initial,
}: {
  id?: string;
  initial?: ScalarValues & { tags: string[] };
}) {
  const router = useRouter();
  const isEdit = Boolean(id);
  const [tagsText, setTagsText] = useState(initial?.tags.join(", ") ?? "");

  // No zodResolver here (unlike the account/auth forms) — the schema's
  // z.output type (with defaults applied) doesn't line up with the
  // z.input type react-hook-form needs for optional fields like
  // `published`. The server route re-validates with the full schema
  // regardless, so this form's job is just basic required-field UX.
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ScalarValues>({
    defaultValues: initial ?? {
      slug: "",
      title: "",
      excerpt: "",
      content: "",
      coverImage: "",
      published: false,
    },
  });

  async function onSubmit(values: Omit<BlogPostInput, "tags">) {
    const payload = {
      ...values,
      tags: tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    const res = await fetch(isEdit ? `/api/admin/blogs/${id}` : "/api/admin/blogs", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't save post.");
      return;
    }
    toast.success(isEdit ? "Post updated." : "Post created.");
    router.push("/admin/blogs");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Slug" error={errors.slug?.message} {...register("slug")} />
        <FormField label="Title" error={errors.title?.message} {...register("title")} />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
          Excerpt
        </span>
        <textarea rows={2} className={inputClass} {...register("excerpt")} />
        {errors.excerpt && <p className="text-xs text-red-500">{errors.excerpt.message}</p>}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
          Content (paragraphs separated by a blank line)
        </span>
        <textarea rows={12} className={inputClass} {...register("content")} />
        {errors.content && <p className="text-xs text-red-500">{errors.content.message}</p>}
      </label>
      <FormField label="Cover image URL (optional)" {...register("coverImage")} />
      <label className="flex flex-col gap-1.5">
        <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
          Tags (comma-separated)
        </span>
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
      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-app-ink text-app-lime self-start rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create post"}
      </button>
    </form>
  );
}
