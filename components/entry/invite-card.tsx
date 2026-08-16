"use client";

import { useState, type FormEvent } from "react";
import { inviteMessage, whatsappHref } from "../../lib/site-contact";

/**
 * "Want me to invite you somewhere?" — a name, and a WhatsApp deep link.
 *
 * A `<form>` with `onSubmit` rather than a button with `onClick`, so Enter in
 * the field works the way every visitor expects it to without a keydown
 * handler of its own.
 *
 * The redirect is `window.location.assign`, not the client router: wa.me is a
 * different origin, and handing an external URL to Next's router is a no-op
 * that looks like a broken button.
 */
export function InviteCard() {
  const [name, setName] = useState("");
  const configured = whatsappHref() !== null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const href = whatsappHref(inviteMessage(name));
    if (href) window.location.assign(href);
  };

  return (
    <div className="invite-card">
      <h3>Want me to invite you somewhere?</h3>
      <p>
        Tell me who you are and it opens a WhatsApp message already written. You still get to read
        it before it sends.
      </p>

      {configured ? (
        <form className="invite-form" onSubmit={submit}>
          <label className="chat-visually-hidden" htmlFor="invite-name">
            Your name
          </label>
          <input
            id="invite-name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            autoComplete="name"
            maxLength={60}
          />
          <button type="submit" className="button button-solid">
            Open WhatsApp <span aria-hidden="true">↗</span>
          </button>
        </form>
      ) : (
        // Same rule the header follows: no phone configured, no dead link. A
        // wa.me URL missing its number resolves to WhatsApp's own error page,
        // which reads as "his site is broken" rather than "not set up yet".
        <p className="link-row-pending">
          The WhatsApp invite switches on once a contact number is configured.
        </p>
      )}
    </div>
  );
}
