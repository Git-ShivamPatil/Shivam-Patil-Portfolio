import { NextResponse, after } from "next/server";
import { contactFormSchema } from "../../../lib/validations/contact";
import { runCommand } from "../../../lib/distsys/command";

/**
 * P18 — the first route through the command boundary.
 *
 * **What changed, and why it is not just moving code around.** Before, this
 * wrote the row and then sent the email in a second try/catch. That has four
 * outcomes and two of them are wrong: the row saved and the email vanished into
 * a logged warning, or — if the order had been the other way — an email sent
 * for a message nobody has. Wrapping both in try/catch does not fix it; it
 * picks which failure to have.
 *
 * Now the row and the *intent to email* commit in one transaction, and the
 * outbox worker turns the intent into an email afterwards with retries and a
 * dead-letter state. The visitor still gets an instant answer; the email
 * becomes eventually certain rather than immediately uncertain, and a Resend
 * outage no longer silently eats a lead — it shows up as queue depth.
 *
 * `Idempotency-Key` is honoured but optional: a visitor whose connection dropped
 * mid-submit and who pressed send again gets the original response instead of
 * two identical messages in the inbox.
 *
 * **The drain is kicked here, in `after()`, not left to the cron.** Vercel's
 * Hobby plan allows cron jobs only at daily granularity, and an outbox drained
 * once a day would deliver a contact email tomorrow — technically eventually
 * consistent, practically broken. Draining right after the response gives the
 * common case immediate delivery while keeping the write path atomic, and the
 * daily cron becomes what it should have been all along: the safety net that
 * retries whatever failed, not the primary delivery mechanism.
 *
 * It runs after the response is flushed, so the visitor never waits for it, and
 * the lease in lib/distsys/lock.ts means a concurrent cron run and this one
 * cannot both process the same event.
 */
export async function POST(request: Request) {
  // Read once, as text, because the command boundary hashes the raw body to
  // detect a reused idempotency key carrying different content.
  const raw = await request.text().catch(() => "");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  // Honeypot: a hidden field real visitors never see. Bots that fill every
  // field trip it. Report success without doing anything, so the bot gets no
  // signal either way — and crucially before the command runs, so a bot cannot
  // fill the outbox.
  if (body && typeof body === "object" && "website" in body && (body as { website?: unknown }).website) {
    return NextResponse.json({ message: "Message sent." });
  }

  const parsed = contactFormSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  return runCommand(
    {
      route: "contact.submit",
      async handler({ input, tx, emit }) {
        const { name, email, message, ref } = input;

        await tx.contactMessage.create({
          data: { name, email, message, source: "contact", referralRef: ref || null },
        });

        // Inside the same transaction as the row above. That is the entire
        // point: either both exist or neither does.
        await emit("contact.received", { name, email, message });

        // Queued for after the response is flushed. Deliberately not awaited
        // inside the transaction — holding a database transaction open while
        // waiting on Resend is how a connection pool dies, and the outbox
        // exists so it does not have to.
        after(async () => {
          try {
            const [{ drainOutbox }, { sendContactFormEmail }] = await Promise.all([
              import("../../../lib/distsys/outbox"),
              import("../../../lib/mail"),
            ]);
            await drainOutbox({
              "contact.received": async (payload) => {
                const contact = payload as { name: string; email: string; message: string };
                await sendContactFormEmail(contact);
              },
            });
          } catch (error) {
            // The event is still PENDING and still due. The cron picks it up.
            console.error("[contact] opportunistic drain failed:", error);
          }
        });

        return { status: 200, body: { message: "Message sent." } };
      },
    },
    parsed.data,
    { idempotencyKey: request.headers.get("idempotency-key"), rawBody: raw },
  );
}
