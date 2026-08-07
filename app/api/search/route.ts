import { NextResponse } from "next/server";
import { search } from "../../../lib/search";

export async function GET(request: Request) {
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
