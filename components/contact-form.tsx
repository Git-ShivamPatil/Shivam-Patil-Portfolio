"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { contactFormSchema, type ContactFormInput } from "../lib/validations/contact";
import { readReferralCookie } from "../lib/referral";
import { enqueue } from "../lib/pwa/outbox";
import { FormField } from "./auth/form-field";

export function ContactForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<ContactFormInput>({ resolver: zodResolver(contactFormSchema) });

  async function onSubmit(values: ContactFormInput) {
    const ref = new URLSearchParams(window.location.search).get("ref") ?? readReferralCookie();
    const payload = { ...values, ref };

    let res: Response;
    try {
      res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // P23 — a throw from fetch means the request never reached a server, which
      // for a message someone has just written is the worst possible moment to
      // hand back an error they cannot act on: acting requires signal.
      //
      // Only this path queues. A server that answered and refused (below) has
      // made a decision, and re-sending identical bytes later would just
      // collect the same refusal.
      const queued = await enqueue("/api/contact", payload);
      if (queued) {
        toast.success("You're offline — the message is queued and will send when you reconnect.");
        reset();
      } else {
        toast.error("Couldn't send your message, and this browser can't queue it either.");
      }
      return;
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't send your message.");
      return;
    }
    toast.success("Message sent — I'll get back to you soon.");
    reset();
  }

  if (isSubmitSuccessful) {
    return (
      <div className="contact-form-success">
        <p className="eyebrow">Sent</p>
        <h3>Thanks — I&apos;ll be in touch.</h3>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="contact-form" noValidate>
      {/* Honeypot: hidden from real visitors via CSS, bots often fill it anyway. */}
      <div className="contact-form-honeypot" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>

      <div className="contact-form-row">
        <FormField label="Name" error={errors.name?.message} {...register("name")} />
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="message"
          className="text-app-muted text-xs font-semibold tracking-wide uppercase"
        >
          Message
        </label>
        <textarea
          id="message"
          rows={5}
          aria-invalid={!!errors.message}
          className="border-app-line bg-app-bg text-app-fg focus-visible:border-app-fg rounded-lg border px-3.5 py-2.5 text-sm outline-none"
          {...register("message")}
        />
        {errors.message ? (
          <p role="alert" className="text-xs text-red-500">
            {errors.message.message}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="button button-solid contact-form-submit"
      >
        {isSubmitting ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
