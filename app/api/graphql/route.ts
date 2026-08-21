import { NextResponse } from "next/server";
import { meterApi } from "../../../lib/api-guards";
import { withRed } from "../../../lib/sre/red";
import {
  GraphQLError,
  MAX_DEPTH,
  MAX_FIELDS,
  countFields,
  depthOf,
  execute,
  parse,
  renderSdl,
} from "../../../lib/api/graphql";
import { buildSchema } from "../../../lib/api/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P24 — the GraphQL endpoint.
 *
 * POST a `{ query }` body. GET is supported for `_service { sdl }` only, so a
 * federation gateway can introspect without a POST — and for nothing else,
 * because a GET carrying an arbitrary query is a GET that gets cached,
 * prefetched and logged in full by every intermediary between here and the
 * caller.
 *
 * **Rate limited more tightly than the REST routes it sits beside.** One
 * GraphQL request can ask for strictly more work than one REST request by
 * design; that is the entire value proposition and also the reason a per-request
 * limit is a weaker guarantee here than elsewhere. The depth and field ceilings
 * in lib/api/graphql.ts are what actually bound the work — this only bounds how
 * often someone may ask.
 */

const SERVICE_QUERY = /^\s*(?:query\s*\w*\s*)?\{\s*_service\s*\{\s*sdl\s*\}\s*\}\s*$/;

/* P21 — measured. P24 — the endpoint. */
export const POST = withRed("/api/graphql", handlePOST);
export const GET = withRed("/api/graphql", handleGET);

function serviceResponse() {
  // The federation contract: a subgraph exposes its own SDL and the gateway
  // composes the supergraph from every subgraph's answer. Generated from the
  // live schema object rather than a checked-in file, so the two cannot drift.
  return NextResponse.json({
    data: { _service: { sdl: renderSdl(buildSchema(), "Query") } },
  });
}

async function handleGET() {
  return serviceResponse();
}

async function handlePOST(request: Request) {
  // P27 — metered, at this route's own existing limit for anonymous callers.
  const gate = await meterApi(request, "/api/graphql", { capacity: 20, refillPerSecond: 0.3 });
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query : null;

  if (!query) {
    return NextResponse.json(
      { errors: [{ message: 'Send a JSON body with a "query" string.' }] },
      { status: 400 },
    );
  }

  if (SERVICE_QUERY.test(query)) return serviceResponse();

  let selections;
  try {
    selections = parse(query);
  } catch (error) {
    // 400 with the parse message. Unlike an authentication failure there is
    // nothing to withhold here — the caller wrote the query, and telling them
    // which construct is unsupported is the entire difference between a usable
    // endpoint and a guessing game.
    return NextResponse.json(
      {
        errors: [
          { message: error instanceof GraphQLError ? error.message : "Could not parse the query." },
        ],
      },
      { status: 400 },
    );
  }

  const { data, errors } = await execute(selections, buildSchema());

  // A GraphQL response carrying field errors is still a served request — the
  // work was done. Only a refusal before execution goes unrecorded.
  gate.record();

  return NextResponse.json(
    {
      data,
      // Omitted entirely when empty. A response carrying `"errors": []` reads
      // as "there were errors" to plenty of client libraries, several of which
      // check for the key's presence rather than its length.
      ...(errors.length > 0 ? { errors: errors.map((message) => ({ message })) } : {}),
      extensions: {
        cost: { depth: depthOf(selections), fields: countFields(selections) },
        limits: { maxDepth: MAX_DEPTH, maxFields: MAX_FIELDS },
      },
    },
    {
      // Always 200, even with field errors. That is the GraphQL contract and it
      // surprises people: transport succeeded, so the status describes the
      // transport. The `errors` array describes the query.
      status: 200,
      headers: { ...gate.headers, "Cache-Control": "no-store" },
    },
  );
}
