import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../lib/prisma", () => ({ prisma: {} }));

import {
  GraphQLError,
  MAX_DEPTH,
  MAX_FIELDS,
  countFields,
  depthOf,
  execute,
  parse,
  renderSdl,
} from "../lib/api/graphql";
import {
  Reader,
  Writer,
  STATS_REQUEST,
  STATS_RESPONSE,
  decodeMessage,
  encodeMessage,
  protoSource,
  WIRE_LENGTH_DELIMITED,
} from "../lib/api/protobuf";
import { FLAG_DEFAULTS, evaluate, type Flag } from "../lib/api/flags";
import { DOCUMENTED_PATHS, buildOpenApi } from "../lib/api/openapi";

/**
 * P24 — API infrastructure.
 *
 * The protobuf tests assert the *wire bytes*, not a round trip. A round trip
 * only proves the encoder and decoder agree with each other, which they would
 * even if both were wrong — and a codec that is self-consistently wrong is
 * exactly the one that fails the first time it meets a real protobuf library.
 */

/* ----------------------------------------------------------- protobuf */

describe("P24 protobuf wire format", () => {
  it("encodes a varint the way the spec says", () => {
    // 300 = 0b100101100 → 0xAC 0x02. This is the canonical example from
    // Google's own encoding documentation, so it is checkable against the spec
    // rather than against this implementation.
    expect([...new Writer().varint(300).finish()]).toEqual([0xac, 0x02]);
    expect([...new Writer().varint(0).finish()]).toEqual([0x00]);
    expect([...new Writer().varint(127).finish()]).toEqual([0x7f]);
    expect([...new Writer().varint(128).finish()]).toEqual([0x80, 0x01]);
  });

  it("builds a tag from the field number and wire type", () => {
    // Field 1, length-delimited → (1 << 3) | 2 = 0x0a, the byte that starts
    // almost every protobuf message anyone has ever hexdumped.
    expect([...new Writer().tag(1, WIRE_LENGTH_DELIMITED).finish()]).toEqual([0x0a]);
  });

  it("zigzags small negatives into small numbers", () => {
    // The whole reason sint32 exists: -1 as an int32 varint is ten bytes.
    expect([...new Writer().zigzag(0).finish()]).toEqual([0x00]);
    expect([...new Writer().zigzag(-1).finish()]).toEqual([0x01]);
    expect([...new Writer().zigzag(1).finish()]).toEqual([0x02]);
    expect([...new Writer().zigzag(-2).finish()]).toEqual([0x03]);
  });

  it("spends ten bytes on a negative int32, which is why sint32 exists", () => {
    expect(new Writer().varint(-1).finish().length).toBe(10);
    expect(new Writer().zigzag(-1).finish().length).toBe(1);
  });

  it("encodes a string field to exactly the expected bytes", () => {
    // Field 1, wire type 2, length 2, "hi".
    const bytes = encodeMessage([{ name: "s", number: 1, type: "string" }], { s: "hi" });
    expect([...bytes]).toEqual([0x0a, 0x02, 0x68, 0x69]);
  });

  it("round-trips the real messages", () => {
    const request = { source: "projects", limit: 3 };
    expect(decodeMessage(STATS_REQUEST, encodeMessage(STATS_REQUEST, request))).toMatchObject(
      request,
    );

    const response = {
      source: "projects",
      total: 6,
      names: ["a", "b"],
      scores: [1, 2],
      ratio: 0.5,
      stale: true,
    };
    const decoded = decodeMessage(STATS_RESPONSE, encodeMessage(STATS_RESPONSE, response));
    expect(decoded).toMatchObject(response);
  });

  it("omits absent fields entirely rather than encoding a default", () => {
    // proto3 semantics: an unset field costs zero bytes, which is why a message
    // of mostly-defaults is nearly empty on the wire.
    expect(encodeMessage(STATS_REQUEST, {}).length).toBe(0);
  });

  it("skips unknown fields, which is what makes protobuf forward-compatible", () => {
    // An old reader receiving a newer message. Written with a field the reader
    // has never heard of, plus one it has.
    const future = encodeMessage(
      [
        { name: "source", number: 1, type: "string" },
        { name: "somethingNew", number: 99, type: "string" },
      ],
      { source: "projects", somethingNew: "added next year" },
    );

    const decoded = decodeMessage(STATS_REQUEST, future);
    expect(decoded.source).toBe("projects");
    expect(decoded).not.toHaveProperty("somethingNew");
  });

  it("refuses a truncated varint rather than returning a wrong number", () => {
    expect(() => new Reader(Uint8Array.from([0x80])).varint()).toThrow(/truncated/);
  });

  it("refuses the deprecated group wire types instead of desynchronising", () => {
    // Skipping a group needs nesting depth. Guessing would misalign every
    // subsequent field, which decodes without error and is wrong.
    expect(() => new Reader(Uint8Array.from([0x00])).skip(3)).toThrow(/unsupported wire type/);
  });

  it("generates a .proto that matches the specs the codec uses", () => {
    const source = protoSource();
    expect(source).toContain('syntax = "proto3";');
    for (const field of STATS_RESPONSE) {
      expect(source).toContain(`${field.type} ${field.name} = ${field.number};`);
    }
    expect(source).toContain("repeated string names = 3;");
  });
});

/* ------------------------------------------------------------ graphql */

describe("P24 GraphQL parser", () => {
  it("parses a nested query with aliases and arguments", () => {
    const selections = parse('{ mine: projects(limit: 3, tag: "go") { title stack } }');
    expect(selections).toHaveLength(1);
    expect(selections[0].name).toBe("projects");
    expect(selections[0].alias).toBe("mine");
    expect(selections[0].args).toEqual({ limit: 3, tag: "go" });
    expect(selections[0].selections.map((s) => s.name)).toEqual(["title", "stack"]);
  });

  it("treats commas and comments as whitespace, because GraphQL does", () => {
    const selections = parse("{ # a comment\n projects { title, stack } }");
    expect(selections[0].selections).toHaveLength(2);
  });

  it("accepts an optional query keyword and operation name", () => {
    expect(parse("query Everything { tags }")[0].name).toBe("tags");
  });

  it("refuses unsupported constructs BY NAME rather than ignoring them", () => {
    // The important property. A parser that silently drops a fragment returns a
    // response missing fields the caller asked for, and the caller cannot tell
    // that from data that is genuinely absent.
    expect(() => parse("mutation { deleteEverything }")).toThrow(/mutations are not supported/);
    expect(() => parse("subscription { ticks }")).toThrow(/subscriptions are not supported/);
    expect(() => parse("{ ...someFragment }")).toThrow(/fragments are not supported/);
    expect(() => parse("{ projects @include(if: true) { title } }")).toThrow(
      /directives are not supported/,
    );
    expect(() => parse("query ($n: Int) { projects(limit: $n) { title } }")).toThrow(
      /variable definitions are not supported/,
    );
  });

  it("rejects a query nested past the depth limit", () => {
    // A few hundred bytes demanding unbounded work is GraphQL's defining DoS
    // surface, and the limit is enforced before any resolver runs.
    let query = "{ a";
    for (let i = 0; i < MAX_DEPTH + 2; i += 1) query += " { b";
    query += " }".repeat(MAX_DEPTH + 3);
    expect(() => parse(query)).toThrow(/nested deeper/);
  });

  it("rejects a query selecting too many fields", () => {
    const fields = Array.from({ length: MAX_FIELDS + 5 }, (_, i) => `f${i}`).join(" ");
    expect(() => parse(`{ ${fields} }`)).toThrow(/above the limit/);
  });

  it("refuses trailing content rather than running the first operation", () => {
    expect(() => parse("{ tags } { projects { title } }")).toThrow(GraphQLError);
  });

  it("counts depth and fields the way the limits do", () => {
    const selections = parse("{ a { b c } d }");
    expect(countFields(selections)).toBe(4);
    expect(depthOf(selections)).toBe(2);
  });
});

describe("P24 GraphQL executor", () => {
  const schema = {
    ok: { type: "String!", resolve: () => "yes" },
    broken: {
      type: "String",
      resolve: () => {
        throw new Error("resolver exploded");
      },
    },
    list: {
      type: "[Item!]!",
      resolve: () => [{ id: 1 }, { id: 2 }],
      fields: {
        id: {
          type: "Int!",
          resolve: (_a: unknown, parent: unknown) => (parent as { id: number }).id,
        },
      },
    },
  };

  it("shapes the response like the request, honouring aliases", async () => {
    const { data } = await execute(parse("{ first: ok }"), schema);
    expect(data).toEqual({ first: "yes" });
  });

  it("resolves a list by running the selection against each item", async () => {
    const { data } = await execute(parse("{ list { id } }"), schema);
    expect(data).toEqual({ list: [{ id: 1 }, { id: 2 }] });
  });

  it("collects a field error and keeps the fields that worked", async () => {
    // Throwing on the first failing resolver would discard everything that
    // succeeded, which is the opposite of what a partial response is for.
    const { data, errors } = await execute(parse("{ ok broken }"), schema);
    expect(data).toEqual({ ok: "yes", broken: null });
    expect(errors[0]).toMatch(/resolver exploded/);
  });

  it("reports an unknown field instead of silently omitting it", async () => {
    const { data, errors } = await execute(parse("{ nope }"), schema);
    expect(data).toEqual({ nope: null });
    expect(errors[0]).toMatch(/Cannot query field "nope"/);
  });

  it("renders SDL from the same schema the executor walks", () => {
    const sdl = renderSdl(schema);
    expect(sdl).toContain("type Query {");
    expect(sdl).toContain("ok: String!");
    expect(sdl).toContain("type Item {");
  });
});

/* -------------------------------------------------------------- flags */

describe("P24 feature flags", () => {
  const flag: Flag = {
    key: "test.flag",
    description: "",
    enabled: true,
    fallback: "off",
    rules: [{ attribute: "role", operator: "equals", value: "ADMIN", serve: "admin" }],
    rolloutPercent: 50,
    rolloutValue: "rolled",
  };

  it("serves the fallback when disabled, whatever the rules say", () => {
    const decision = evaluate(
      { ...flag, enabled: false },
      {
        subject: "u1",
        attributes: { role: "ADMIN" },
      },
    );
    expect(decision).toMatchObject({ value: "off", reason: "flag-disabled" });
  });

  it("lets a rule win over the rollout", () => {
    // A rule is a deliberate statement about a named population; a percentage
    // overriding it would mean an explicit targeting rule applying to only some
    // of the people it names.
    const decision = evaluate(flag, { subject: "u1", attributes: { role: "ADMIN" } });
    expect(decision).toMatchObject({ value: "admin", reason: "rule-match", ruleIndex: 0 });
  });

  it("never matches a rule on a missing attribute", () => {
    // Treating undefined as an empty string is how a flag meant for one country
    // ships to everyone whose geo lookup failed.
    const decision = evaluate(
      {
        ...flag,
        rules: [{ attribute: "country", operator: "equals", value: "", serve: "x" }],
        rolloutPercent: 0,
      },
      { subject: "u1", attributes: {} },
    );
    expect(decision.reason).toBe("no-rule-matched");
  });

  it("is stable for the same subject", () => {
    const first = evaluate(flag, { subject: "u9", attributes: {} });
    const second = evaluate(flag, { subject: "u9", attributes: {} });
    expect(second.value).toBe(first.value);
    expect(second.bucket).toBe(first.bucket);
  });

  it("splits roughly at the requested percentage", () => {
    let included = 0;
    for (let i = 0; i < 3000; i += 1) {
      if (evaluate(flag, { subject: `u${i}`, attributes: {} }).reason === "rollout-included") {
        included += 1;
      }
    }
    expect(included / 3000).toBeGreaterThan(0.45);
    expect(included / 3000).toBeLessThan(0.55);
  });

  it("does not select the same cohort for two different flags", () => {
    // Salted with the flag key. Without it every 10% experiment runs on the
    // same unlucky people and their interactions are impossible to untangle.
    const subjects = Array.from({ length: 400 }, (_, i) => `u${i}`);
    const a = new Set(
      subjects.filter(
        (s) =>
          evaluate({ ...flag, rules: [] }, { subject: s, attributes: {} }).reason ===
          "rollout-included",
      ),
    );
    const b = new Set(
      subjects.filter(
        (s) =>
          evaluate({ ...flag, key: "other.flag", rules: [] }, { subject: s, attributes: {} })
            .reason === "rollout-included",
      ),
    );
    const overlap = [...a].filter((s) => b.has(s)).length;
    // Independent 50% cohorts overlap around 25%, not 50%.
    expect(overlap / subjects.length).toBeLessThan(0.35);
  });

  it("keeps the sandbox write flag off for anonymous visitors", () => {
    const sandbox = FLAG_DEFAULTS.find((entry) => entry.key === "lab.sandbox-writes")!;
    expect(evaluate(sandbox, { subject: "anon", attributes: {} }).value).toBe(false);
    expect(evaluate(sandbox, { subject: "admin", attributes: { role: "ADMIN" } }).value).toBe(true);
  });

  it("gives every default flag a unique key and a description", () => {
    const keys = FLAG_DEFAULTS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of FLAG_DEFAULTS) expect(entry.description.length).toBeGreaterThan(10);
  });
});

/* ------------------------------------------------------------ openapi */

describe("P24 OpenAPI document", () => {
  const document = buildOpenApi("https://www.shivamsfolio.com");

  it("documents only paths that exist as routes", () => {
    // The drift that actually happens: an endpoint renamed or deleted while the
    // document still advertises it. Generating request shapes from zod would
    // not catch this; only checking the filesystem does.
    for (const path of Object.keys(document.paths)) {
      const route = join(process.cwd(), "app", `${path}`, "route.ts");
      expect(() => readFileSync(route), `${path} is documented but has no route`).not.toThrow();
    }
  });

  it("keeps DOCUMENTED_PATHS in step with the document itself", () => {
    expect(Object.keys(document.paths).sort()).toEqual([...DOCUMENTED_PATHS].sort());
  });

  it("is 3.1, so its schemas are real JSON Schema", () => {
    expect(document.openapi).toBe("3.1.0");
  });

  it("gives every operation a summary and at least one response", () => {
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, unknown>)) {
        const op = operation as { summary?: string; responses?: Record<string, unknown> };
        expect(op.summary, `${method} ${path} has no summary`).toBeTruthy();
        expect(Object.keys(op.responses ?? {}).length).toBeGreaterThan(0);
      }
    }
  });

  it("documents no authenticated write surface", () => {
    // A public specification for an authenticated write API is a map for
    // somebody else. /api/contact is the one write, and it is unauthenticated
    // by design.
    for (const path of Object.keys(document.paths)) {
      expect(path).not.toMatch(/^\/api\/(?:admin|account|auth|webhooks|cron)/);
    }
  });
});
