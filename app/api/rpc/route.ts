import { NextResponse } from "next/server";
import { meterApi } from "../../../lib/api-guards";
import { withRed } from "../../../lib/sre/red";
import {
  decodeMessage,
  encodeMessage,
  STATS_REQUEST,
  STATS_RESPONSE,
} from "../../../lib/api/protobuf";
import { getProjects } from "../../projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P24 — protobuf over HTTP, framed the way Connect does it.
 *
 * **Not gRPC, and the difference is stated rather than blurred.** gRPC proper is
 * HTTP/2 with trailers and a five-byte framing that browsers cannot originate
 * and this runtime does not expose. gRPC-Web exists because of that gap and
 * needs a translating proxy — the blueprint's Envoy, which is not here.
 *
 * What is here is the part that carries the engineering: the protobuf wire
 * format, encoded and decoded by hand in lib/api/protobuf.ts, carried over an
 * ordinary POST. The frame is a one-byte flag and a four-byte big-endian
 * length, which is exactly Connect's and gRPC-Web's framing minus the trailer
 * message. A Connect client would very nearly speak to this unmodified.
 *
 * `application/proto` rather than `application/grpc`: claiming the gRPC content
 * type for something that is not gRPC would make a real gRPC client fail deep
 * inside its framing code instead of at content negotiation.
 */

/* P21 — measured. */
export const POST = withRed("/api/rpc", handlePOST);
export const GET = withRed("/api/rpc", handleGET);

/** The frame: 1 byte of flags, 4 bytes of big-endian length, then the message. */
function frame(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + message.length);
  out[0] = 0; // No compression. A compression flag we do not honour would be a lie.
  new DataView(out.buffer).setUint32(1, message.length, false);
  out.set(message, 5);
  return out;
}

function unframe(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 5) throw new Error("frame is shorter than its header");
  if (bytes[0] !== 0) throw new Error("compressed frames are not supported");

  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, false);
  // Checked rather than trusted. A length prefix larger than the body is the
  // oldest trick against a length-prefixed parser, and subarray would silently
  // return a short buffer that then decodes as truncated garbage.
  if (bytes.length - 5 < length) throw new Error("frame claims more bytes than it carries");
  return bytes.subarray(5, 5 + length);
}

async function handleGET() {
  // The descriptor, so a caller can see the contract without a .proto file.
  // Generated from the same specs the codec uses — a hand-maintained schema
  // beside a hand-written codec is two sources of truth, one always wrong.
  const { protoSource } = await import("../../../lib/api/protobuf");
  return new NextResponse(protoSource(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function handlePOST(request: Request) {
  // P27 — metered. The baseline is this route's own pre-existing limit, so an
  // anonymous caller is served exactly as before; a key multiplies it.
  const gate = await meterApi(request, "/api/rpc", { capacity: 30, refillPerSecond: 0.5 });
  if ("error" in gate) return gate.error;

  let message: Record<string, unknown>;
  try {
    const body = new Uint8Array(await request.arrayBuffer());
    message = decodeMessage(STATS_REQUEST, unframe(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not decode the request." },
      { status: 400 },
    );
  }

  const source = typeof message.source === "string" ? message.source : "projects";
  const limit = typeof message.limit === "number" && message.limit > 0 ? message.limit : 5;

  const projects = await getProjects();
  const chosen = projects.slice(0, Math.min(limit, 20));

  const response = encodeMessage(STATS_RESPONSE, {
    source,
    total: projects.length,
    names: chosen.map((project) => project.title),
    scores: chosen.map((project) => project.stack.length),
    ratio: projects.length === 0 ? 0 : chosen.length / projects.length,
    stale: false,
  });

  // Recorded here, not at the gate: metering a request that then throws would
  // bill a caller for an outage.
  gate.record();

  return new NextResponse(frame(response) as unknown as BodyInit, {
    headers: {
      ...gate.headers,
      "Content-Type": "application/proto",
      "Cache-Control": "no-store",
      // The decoded size, so a caller can sanity-check its own framing without
      // decoding — and so the sandbox can show the compression protobuf buys
      // over the equivalent JSON.
      "X-Proto-Length": String(response.length),
    },
  });
}
