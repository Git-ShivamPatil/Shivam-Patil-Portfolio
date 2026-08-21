import { NextResponse } from "next/server";
import { buildOpenApi } from "../../../lib/api/openapi";
import { withRed } from "../../../lib/sre/red";
import { siteUrl } from "../../../lib/seo/site";

export const runtime = "nodejs";

/* P21 — measured. P24 — the specification itself.

   Cached hard: the document is a pure function of the deployed code, so it
   cannot change between requests to the same build. `s-maxage` at the edge with
   a long `stale-while-revalidate` means a client polling it costs nothing. */
export const GET = withRed("/api/openapi", handleGET);

async function handleGET() {
  return NextResponse.json(buildOpenApi(siteUrl), {
    headers: {
      // The registered media type for OpenAPI 3.1. `application/json` also
      // works and tells a tool nothing about what it is receiving.
      "Content-Type": "application/vnd.oai.openapi+json; version=3.1",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
