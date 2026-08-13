import { NextResponse } from "next/server";
import { clientIp, consume } from "../../../../lib/rate-limit";
import { MAX_JD_LENGTH, analyseJobDescription } from "../../../../lib/ai/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P16 — the résumé analyser.
 *
 * Metered harder than the ask endpoint, because one call fans out into a
 * retrieval per requirement line. Three at once with a slow refill is generous
 * for someone comparing a few roles and stops a caller turning one POST into
 * forty database queries on repeat.
 *
 * The pasted text is never stored. It is somebody's hiring document, we have no
 * use for it after the response, and a table of other people's job descriptions
 * is a liability with no upside.
 */
export async function POST(request: Request) {
  const budget = await consume(`ai-analyze:${clientIp(request)}`, 3, 1 / 20);
  if (!budget.ok) {
    return NextResponse.json(
      { error: "Analysing takes a moment — try again shortly." },
      { status: 429, headers: { "Retry-After": String(budget.retryAfter) } },
    );
  }

  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_JD_LENGTH + 1_000) {
    return NextResponse.json({ error: "That job description is too long." }, { status: 413 });
  }

  let body: { text?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  if (text.trim().length < 40) {
    return NextResponse.json(
      { error: "Paste a bit more of the job description." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await analyseJobDescription(text), {
      // Contains someone else's document reflected back; nothing about it
      // should be cached anywhere.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("POST /api/ai/analyze failed:", error);
    return NextResponse.json({ error: "Could not analyse that." }, { status: 503 });
  }
}
