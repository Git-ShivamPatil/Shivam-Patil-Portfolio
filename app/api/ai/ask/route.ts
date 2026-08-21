import { NextResponse } from "next/server";
import { meterApi } from "../../../../lib/api-guards";
import { retrieve } from "../../../../lib/ai/retrieve";
import { buildGroundedPrompt, composeAnswer } from "../../../../lib/ai/answer";
import { withRed } from "../../../../lib/sre/red";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P16 — retrieval and the extractive answer.
 *
 * Returns three things, and the split is the design:
 *
 * - `answer` — sentences taken verbatim from the site, with their sources. This
 *   is what renders immediately and it cannot state anything the site does not.
 * - `chunks` — the retrieved passages, so the opt-in in-browser model has
 *   something to be grounded on without a second round trip.
 * - `prompt` — assembled here rather than in the browser, so the grounding
 *   rules travel with the context instead of being built by client code.
 *
 * No model runs on this server and none is called from it. The only generation
 * this feature offers happens in the visitor's own browser, on their own GPU,
 * after they explicitly ask for it.
 */

const MAX_QUESTION = 400;

/* P21 — measured. Retrieval runs a pgvector query, which makes this the
   slowest route on the site and the one whose p95 is worth watching. */
export const POST = withRed("/api/ai/ask", handlePOST);

async function handlePOST(request: Request) {
  // Retrieval is two database queries plus an embedding, so it is metered like
  // the other anonymous endpoints that do real work. 12 burst at 1 every 3s
  // covers someone genuinely exploring and stops a scripted crawl of the index.
  //
  // P27 — those same numbers are now the baseline a tier multiplies, so this
  // route's behaviour for an anonymous visitor is unchanged.
  const gate = await meterApi(request, "/api/ai/ask", { capacity: 12, refillPerSecond: 1 / 3 });
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";

  if (question.length < 2) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION) {
    return NextResponse.json({ error: "That question is too long." }, { status: 413 });
  }

  try {
    const chunks = await retrieve(question, { limit: 6 });
    const answer = composeAnswer(question, chunks);

    // After retrieval succeeded. The 503 path below records nothing.
    gate.record();

    return NextResponse.json(
      {
        answer,
        chunks: chunks.map((chunk) => ({
          title: chunk.title,
          heading: chunk.heading,
          url: chunk.url,
          content: chunk.content,
          matchedBy: chunk.matchedBy,
        })),
        prompt: buildGroundedPrompt(question, chunks),
      },
      { headers: gate.headers },
    );
  } catch (error) {
    console.error("POST /api/ai/ask failed:", error);
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 503 });
  }
}
