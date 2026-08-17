/**
 * P24 — the OpenAPI document.
 *
 * **Hand-written, and that is the honest trade rather than the lazy one.** The
 * alternative is generating it from the zod schemas in lib/validations, which
 * would guarantee the request bodies never drift. It is genuinely the better
 * answer for request shapes, and it is also where generated specs stop: nothing
 * derives a description, an example, a rate limit, or the reason an endpoint
 * returns 409. A generated spec is complete and says nothing.
 *
 * So the split is deliberate. Request bodies reference the zod schemas by name
 * in their descriptions, so a reader knows where the authority lives; the prose
 * is written. A test asserts that every documented path exists as a route file,
 * which catches the drift that actually happens — an endpoint renamed or
 * deleted while the document still advertises it.
 *
 * OpenAPI 3.1 rather than 3.0: 3.1 is a strict superset of JSON Schema, so the
 * schema objects here mean exactly what they mean everywhere else. 3.0's
 * near-JSON-Schema dialect is the source of most "why does my validator
 * disagree" questions.
 */

export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  servers: { url: string; description: string }[];
  paths: Record<string, unknown>;
  components: Record<string, unknown>;
  tags: { name: string; description: string }[];
}

const errorResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
});

/** Every path documented here must exist as a route file — see the P24 tests. */
export const DOCUMENTED_PATHS = [
  "/api/health",
  "/api/search",
  "/api/integrations/github",
  "/api/integrations/leetcode",
  "/api/graphql",
  "/api/rpc",
  "/api/contact",
  "/api/openapi",
] as const;

export function buildOpenApi(siteUrl: string): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: "shivamsfolio API",
      version: "1.0.0",
      description:
        "The public surface of a portfolio site: content queries, live coding statistics, a GraphQL subgraph and a protobuf RPC. Everything documented here is unauthenticated and rate limited. Endpoints that write — admin CRUD, payments, chat — are deliberately absent, because a public specification for an authenticated write surface is a map for someone else.",
      contact: { name: "Shivam Patil", url: `${siteUrl}/contact` },
      license: { name: "All rights reserved", identifier: "LicenseRef-Proprietary" },
    },
    servers: [{ url: siteUrl, description: "Production" }],
    tags: [
      { name: "Content", description: "Projects, search and the GraphQL subgraph." },
      { name: "Integrations", description: "Cached third-party statistics." },
      { name: "Operations", description: "Health and machine-readable specification." },
    ],
    paths: {
      "/api/health": {
        get: {
          tags: ["Operations"],
          summary: "Liveness and readiness",
          description:
            'Returns 200 when the service can serve and 503 when it cannot. The status code is the answer — a 200 carrying `{"status":"degraded"}` is read as healthy by every automated consumer there is. An authenticated admin additionally receives which integrations are configured, never their values.',
          responses: {
            200: {
              description: "Healthy.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Health" } },
              },
            },
            503: { description: "Degraded — do not route traffic here." },
            429: errorResponse("Rate limited. This endpoint runs a query, so it is metered."),
          },
        },
      },

      "/api/search": {
        get: {
          tags: ["Content"],
          summary: "Full-text search across projects and posts",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1 },
              description:
                "An empty or blank query returns an empty result set rather than an error.",
            },
          ],
          responses: {
            200: {
              description: "Matches, most relevant first.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      results: { type: "array", items: { $ref: "#/components/schemas/SearchHit" } },
                    },
                    required: ["results"],
                  },
                },
              },
            },
          },
        },
      },

      "/api/integrations/github": {
        get: {
          tags: ["Integrations"],
          summary: "GitHub statistics",
          description:
            "Served from a one-hour cache in Postgres and guarded by a circuit breaker. When the upstream is failing this returns the last good payload with `stale: true` rather than an error — a slightly old number beats an error state for a decorative panel. Returns 200 with a null payload when no username is configured.",
          responses: {
            200: {
              description: "Statistics, possibly stale.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/CachedStats" } },
              },
            },
          },
        },
      },

      "/api/integrations/leetcode": {
        get: {
          tags: ["Integrations"],
          summary: "LeetCode statistics",
          description:
            "As above. The upstream is unofficial and throttles serverless IPs often enough that the stale path is the ordinary path rather than the exception.",
          responses: {
            200: {
              description: "Statistics, possibly stale.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/CachedStats" } },
              },
            },
          },
        },
      },

      "/api/graphql": {
        get: {
          tags: ["Content"],
          summary: "Federation SDL",
          description:
            "Equivalent to POSTing `{ _service { sdl } }`. GET is supported for this and nothing else: a GET carrying an arbitrary query is one that gets cached, prefetched and logged in full by every intermediary in the path.",
          responses: { 200: { description: "The subgraph SDL." } },
        },
        post: {
          tags: ["Content"],
          summary: "Execute a query",
          description:
            "Read-only. Mutations, subscriptions, fragments, variables and directives are refused by name rather than ignored — a parser that silently drops a fragment returns a response missing fields the caller asked for, and the caller cannot tell that from data that is genuinely absent. Depth is capped at 6 and total selected fields at 60, checked before any resolver runs.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
                examples: {
                  projects: {
                    summary: "Projects with their stack",
                    value: { query: "{ projects(limit: 3) { title category stack } }" },
                  },
                  sdl: { summary: "Federation SDL", value: { query: "{ _service { sdl } }" } },
                },
              },
            },
          },
          responses: {
            200: {
              description:
                "Always 200 when the transport succeeded, including when fields failed. That is the GraphQL contract: the status describes the transport, the `errors` array describes the query.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/GraphQLResponse" } },
              },
            },
            400: errorResponse("The query could not be parsed, or used an unsupported construct."),
            429: errorResponse("Rate limited."),
          },
        },
      },

      "/api/rpc": {
        get: {
          tags: ["Content"],
          summary: "The .proto descriptor",
          responses: {
            200: { description: "proto3 source for the request and response messages." },
          },
        },
        post: {
          tags: ["Content"],
          summary: "Protobuf RPC",
          description:
            "A length-prefixed protobuf frame in, one out: a zero flag byte, a four-byte big-endian length, then the message. That is Connect's framing and gRPC-Web's, minus the trailer. It is not gRPC — gRPC needs HTTP/2 trailers this runtime does not expose — and the content type says `application/proto` rather than `application/grpc` so a real gRPC client fails at negotiation instead of deep inside its framing.",
          requestBody: {
            required: true,
            content: { "application/proto": { schema: { type: "string", format: "binary" } } },
          },
          responses: {
            200: {
              description: "A framed StatsResponse.",
              content: { "application/proto": { schema: { type: "string", format: "binary" } } },
            },
            400: errorResponse("The frame or the message could not be decoded."),
          },
        },
      },

      "/api/contact": {
        post: {
          tags: ["Content"],
          summary: "Send a message",
          description:
            "The one documented endpoint that writes. Validated by `contactFormSchema` in lib/validations/contact.ts, which is the authority on the shape — this document describes it, it does not define it. Requires a same-origin request: the CSRF check in proxy.ts rejects anything else with a bare 403.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ContactMessage" } },
            },
          },
          responses: {
            200: { description: "Accepted." },
            400: errorResponse("Validation failed."),
            403: errorResponse("Origin rejected. The reason is logged, never returned."),
            429: errorResponse("Rate limited."),
          },
        },
      },

      "/api/openapi": {
        get: {
          tags: ["Operations"],
          summary: "This document",
          responses: { 200: { description: "The OpenAPI 3.1 specification." } },
        },
      },
    },

    components: {
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "string",
              description:
                "Human-readable and deliberately unspecific on security paths — a rejection reason that names the failed check is free help to whoever tripped it.",
            },
          },
          required: ["error"],
        },
        Health: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "degraded"] },
            version: { type: "string", description: "Seven characters of the deployed commit." },
            environment: { type: "string" },
            region: { type: ["string", "null"] },
            checks: { type: "array", items: { type: "object" } },
            features: { type: "object" },
          },
          required: ["status", "version"],
        },
        SearchHit: {
          type: "object",
          properties: {
            title: { type: "string" },
            href: { type: "string" },
            kind: { type: "string" },
          },
        },
        CachedStats: {
          type: "object",
          properties: {
            data: { type: ["object", "null"] },
            fetchedAt: { type: "string", format: "date-time" },
            stale: {
              type: "boolean",
              description: "True when the upstream refresh failed and this is a last-good payload.",
            },
          },
        },
        GraphQLResponse: {
          type: "object",
          properties: {
            data: { type: "object" },
            errors: { type: "array", items: { type: "object" } },
            extensions: {
              type: "object",
              description: "Carries the measured depth and field count, and the limits in force.",
            },
          },
        },
        ContactMessage: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            message: { type: "string" },
            ref: { type: ["string", "null"], description: "Referral code, if one was captured." },
          },
          required: ["name", "email", "message"],
        },
      },
    },
  };
}
