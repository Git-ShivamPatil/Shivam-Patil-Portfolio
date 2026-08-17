import { NextResponse } from "next/server";
import { search } from "../../../lib/search";
import { withRed } from "../../../lib/sre/red";

/* P21 — measured. The route label is written by hand and is the route
   *pattern*; see lib/sre/red.ts for why that is not negotiable.

   `withRed` is applied to a hoisted function declaration, so the export can sit
   above the handler it wraps and the diff stays one contiguous block. */
export const GET = withRed("/api/search", handleGET);

async function handleGET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (!q.trim()) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await search(q);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("GET /api/search failed:", error);
    return NextResponse.json({ error: "Search failed. Please try again." }, { status: 500 });
  }
}
