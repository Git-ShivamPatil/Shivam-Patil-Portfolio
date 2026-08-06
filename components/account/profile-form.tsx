"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { updateProfileSchema, type UpdateProfileInput } from "../../lib/validations/account";
import { FormField } from "../auth/form-field";

export function ProfileForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: initialName },
  });

  async function onSubmit(values: UpdateProfileInput) {
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't update profile.");
      return;
    }
    toast.success("Profile updated.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-sm flex-col gap-4" noValidate>
      <FormField label="Name" error={errors.name?.message} {...register("name")} />
      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-app-ink text-app-lime self-start rounded-full px-4 py-2 text-sm font-bold disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
