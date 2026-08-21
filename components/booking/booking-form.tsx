"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { readReferralCookie } from "../../lib/referral";

export interface OfferingOption {
  slug: string;
  name: string;
  priceLabel: string;
  durationMin: number;
  currency: string;
}

interface RazorpayOptions extends Record<string, unknown> {
  handler?: (response: Record<string, string>) => void;
}
interface RazorpayInstance {
  open: () => void;
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/** Load Razorpay's checkout script on demand, once. */
function loadRazorpay(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

/**
 * Mint an idempotency key, or reuse the one already issued for this exact body.
 *
 * The server keys `/api/bookings` on this header so a retry cannot create a
 * second booking and a second provider order. That only works if the client
 * sends the *same* key when it means "the same booking" and a *different* one
 * when it means a new one — sending a fresh key per attempt would defeat the
 * mechanism entirely, and sending one fixed key forever would make every later
 * booking a 422 conflict against the first.
 *
 * Keying on the serialised body gives exactly that: a double-click, a dropped
 * connection, or a failed-then-retried submit all reuse the key, while editing
 * any field mints a new one.
 */
function keyForBody(store: { key: string; body: string } | null, body: string): string {
  if (store && store.body === body) return store.key;
  // `randomUUID` needs a secure context, which every origin serving this form
  // is; the fallback keeps a http:// preview from throwing rather than
  // silently dropping replay protection.
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `bk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Paid-booking form.
 *
 * Creates the booking server-side, then hands off to whichever provider the
 * server picked: Stripe returns a hosted URL to redirect to, Razorpay returns
 * a config for its in-page modal. Nothing here decides that a booking is
 * paid — the success screen only reports what the visitor did, and the
 * booking is not CONFIRMED until a signature-verified webhook says so.
 */
export function BookingForm({
  offerings,
  providers,
}: {
  offerings: OfferingOption[];
  providers: string[];
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(offerings[0]?.slug ?? "");
  const [form, setForm] = useState({ name: "", email: "", company: "", notes: "", website: "" });
  const [busy, setBusy] = useState(false);
  const idempotency = useRef<{ key: string; body: string } | null>(null);

  const selected = offerings.find((offering) => offering.slug === slug);

  function update(field: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !slug) return;

    setBusy(true);
    try {
      const body = JSON.stringify({
        offeringSlug: slug,
        name: form.name,
        email: form.email,
        company: form.company || undefined,
        notes: form.notes || undefined,
        website: form.website,
        ref: readReferralCookie(),
      });

      const key = keyForBody(idempotency.current, body);
      idempotency.current = { key, body };

      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body,
      });

      const json = (await response.json()) as {
        error?: string;
        reference?: string;
        provider?: string;
        redirectUrl?: string | null;
        clientConfig?: Record<string, unknown> | null;
      };

      if (!response.ok) {
        toast.error(json.error ?? "Could not start checkout.");
        return;
      }

      if (json.redirectUrl) {
        // Stripe's hosted checkout is a different origin, so this is a real
        // navigation rather than a client-side route change.
        window.location.assign(json.redirectUrl);
        return;
      }

      if (json.provider === "RAZORPAY" && json.clientConfig) {
        const ready = await loadRazorpay();
        if (!ready || !window.Razorpay) {
          toast.error("Payment window failed to load. Please try again.");
          return;
        }
        const checkout = new window.Razorpay({
          ...json.clientConfig,
          handler: () => {
            // Advisory only. The webhook is what actually confirms the
            // booking; this just moves the visitor to a page that says so.
            router.push(`/booking/success?ref=${json.reference}`);
          },
        });
        checkout.open();
        return;
      }

      toast.error("No payment method is available right now.");
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (offerings.length === 0) {
    return <p className="booking-empty">No services are open for booking right now.</p>;
  }

  return (
    <form className="booking-form" onSubmit={submit}>
      <fieldset className="booking-offerings">
        <legend className="eyebrow">Choose a service</legend>
        {offerings.map((offering) => (
          <label
            key={offering.slug}
            className={offering.slug === slug ? "booking-offering is-selected" : "booking-offering"}
          >
            <input
              type="radio"
              name="offering"
              value={offering.slug}
              checked={offering.slug === slug}
              onChange={() => setSlug(offering.slug)}
            />
            <div>
              <strong>{offering.name}</strong>
              <span>{offering.durationMin} min</span>
            </div>
            <b>{offering.priceLabel}</b>
          </label>
        ))}
      </fieldset>

      <div className="contact-form-row">
        <div className="booking-field">
          <label htmlFor="booking-name">Name</label>
          <input id="booking-name" required value={form.name} onChange={update("name")} />
        </div>
        <div className="booking-field">
          <label htmlFor="booking-email">Email</label>
          <input
            id="booking-email"
            type="email"
            required
            value={form.email}
            onChange={update("email")}
            autoComplete="email"
          />
        </div>
      </div>

      <div className="booking-field">
        <label htmlFor="booking-company">Company (optional)</label>
        <input id="booking-company" value={form.company} onChange={update("company")} />
      </div>

      <div className="booking-field">
        <label htmlFor="booking-notes">What would you like to cover?</label>
        <textarea id="booking-notes" rows={4} value={form.notes} onChange={update("notes")} />
      </div>

      <div className="contact-form-honeypot" aria-hidden="true">
        <label htmlFor="booking-website">Website</label>
        <input
          id="booking-website"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={update("website")}
        />
      </div>

      <button type="submit" className="button button-solid" disabled={busy} data-magnetic>
        {busy ? "Opening checkout…" : `Pay ${selected?.priceLabel ?? ""} and book`}
      </button>

      <p className="booking-note">
        {providers.length > 0
          ? `Secure checkout via ${providers.map((p) => (p === "STRIPE" ? "Stripe" : "Razorpay")).join(" or ")}. Your card details never touch this site.`
          : "Payments aren't configured on this deployment yet — this form will report a 503."}
      </p>
    </form>
  );
}
