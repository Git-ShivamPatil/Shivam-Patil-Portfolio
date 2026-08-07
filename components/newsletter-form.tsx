"use client";

import { useState } from "react";
import { readReferralCookie } from "../lib/referral";

/**
 * Double opt-in newsletter signup.
 *
 * The success copy says "check your inbox" rather than "you're subscribed",
 * because at this point nothing is confirmed — and the API deliberately gives
 * the same response for a new address, a pending one, and one that's already
 * on the list, so this component has no way to tell them apart either.
 */
export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "sending") return;

    setState("sending");
    try {
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website, ref: readReferralCookie() }),
      });
      const json = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        setState("error");
        setMessage(json.error ?? "Something went wrong.");
        return;
      }

      setState("sent");
      setMessage(json.message ?? "Check your inbox to confirm.");
      setEmail("");
    } catch {
      setState("error");
      setMessage("Network error — please try again.");
    }
  }

  if (state === "sent") {
    return (
      <div className="newsletter-done" role="status">
        <strong>Almost there.</strong>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <form className="newsletter-form" onSubmit={submit}>
      <label htmlFor="newsletter-email" className="chat-visually-hidden">
        Email address
      </label>
      <input
        id="newsletter-email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
        autoComplete="email"
      />
      {/* Honeypot — mirrors the contact form's approach. */}
      <div className="contact-form-honeypot" aria-hidden="true">
        <label htmlFor="newsletter-website">Website</label>
        <input
          id="newsletter-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <button type="submit" className="button button-solid" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Subscribe"}
      </button>
      {state === "error" && (
        <p className="newsletter-error" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}
