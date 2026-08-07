import { NextResponse } from "next/server";
import { sendContactFormEmail } from "../../../lib/mail";
import { contactFormSchema } from "../../../lib/validations/contact";

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

  try {
    await sendContactFormEmail(parsed.data);
    return NextResponse.json({ message: "Message sent." });
  } catch (error) {
    console.error("POST /api/contact failed:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again, or email directly." },
      { status: 500 },
    );
  }
}
