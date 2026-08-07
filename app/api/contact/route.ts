import { NextResponse } from "next/server";
import { sendContactFormEmail } from "../../../lib/mail";
import { contactFormSchema } from "../../../lib/validations/contact";
import { prisma } from "../../../lib/prisma";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  // Simple honeypot: a hidden field real visitors never see or fill in.
  // Bots that blindly fill every field will trip it; report success
  // without actually sending, so the bot gets no signal either way.
  if (body && typeof body === "object" && "website" in body && body.website) {
    return NextResponse.json({ message: "Message sent." });
  }

  const parsed = contactFormSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { name, email, message, ref } = parsed.data;

  try {
    // The database write is the source of truth (the admin Inbox) — a
    // Resend outage or missing RESEND_API_KEY shouldn't make a real
    // submission look like it failed to the visitor, so email is
    // best-effort below and never blocks the success response.
    await prisma.contactMessage.create({
      data: { name, email, message, source: "contact", referralRef: ref || null },
    });
  } catch (error) {
    console.error("POST /api/contact failed to persist message:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again, or email directly." },
      { status: 500 },
    );
  }

  try {
    await sendContactFormEmail({ name, email, message });
  } catch (error) {
    console.error("POST /api/contact: email notification failed (message was still saved):", error);
  }

  return NextResponse.json({ message: "Message sent." });
}
