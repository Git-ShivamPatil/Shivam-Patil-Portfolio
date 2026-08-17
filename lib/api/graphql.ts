/**
 * P24 — a GraphQL executor for a documented subset.
 *
 * **Written rather than installed, and the subset is the honest part.** A full
 * GraphQL implementation is a lexer, a parser, a validator against a schema, a
 * type coercion layer, fragment resolution, variable handling and an execution
 * engine with field-level error propagation. `graphql-js` is ~500KB and does
 * all of it correctly. This does the part that carries the ideas — parse a
 * query, walk it against a schema, resolve fields, return data shaped like the
 * request — and refuses everything it has not implemented, loudly.
 *
 * Supported: queries, nested selection sets, aliases, scalar and enum
 * arguments, list fields, introspection of the SDL.
 * Not supported, and rejected with a named error rather than ignored: mutations,
 * subscriptions, fragments, variables, directives, interfaces, unions.
 *
 * Rejecting is the whole point. A parser that silently ignores a fragment
 * returns a response missing fields the caller asked for, and the caller has no
 * way to tell that from data that genuinely is not there.
 *
 * **Depth and complexity limits are not optional here.** GraphQL's defining
 * denial-of-service surface is that one small query can demand unbounded work —
 * `a { b { a { b { … } } } }` is a few hundred bytes and unbounded server cost.
 * Both limits are enforced before a single resolver runs.
 */

export const MAX_DEPTH = 6;
/** Selected fields across the whole query, counted before execution. */
export const MAX_FIELDS = 60;

export class GraphQLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphQLError";
  }
}

export type ArgumentValue = string | number | boolean | null;

export interface Selection {
  name: string;
  alias: string | null;
  args: Record<string, ArgumentValue>;
  selections: Selection[];
}

/* -------------------------------------------------------------- parser */

interface Cursor {
  source: string;
  index: number;
}

function error(cursor: Cursor, message: string): never {
  throw new GraphQLError(`${message} (at character ${cursor.index})`);
}

function skipSpace(cursor: Cursor): void {
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    // Commas are insignificant whitespace in GraphQL, which surprises people.
    if (char === " " || char === "\n" || char === "\r" || char === "\t" || char === ",") {
      cursor.index += 1;
    } else if (char === "#") {
      while (cursor.index < cursor.source.length && cursor.source[cursor.index] !== "\n") {
        cursor.index += 1;
      }
    } else {
      return;
    }
  }
}

function readName(cursor: Cursor): string {
  skipSpace(cursor);
  const match = /^[_A-Za-z][_0-9A-Za-z]*/.exec(cursor.source.slice(cursor.index));
  if (!match) error(cursor, "expected a name");
  cursor.index += match[0].length;
  return match[0];
}

function readValue(cursor: Cursor): ArgumentValue {
  skipSpace(cursor);
  const rest = cursor.source.slice(cursor.index);

  if (rest.startsWith('"')) {
    // Deliberately no escape handling beyond \" — block strings and unicode
    // escapes are not supported, and a half-implemented escape table is how a
    // parser starts disagreeing with its clients about what a string contains.
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
    if (!match) error(cursor, "unterminated string");
    cursor.index += match[0].length;
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  const number = /^-?\d+(?:\.\d+)?/.exec(rest);
  if (number) {
    cursor.index += number[0].length;
    return Number(number[0]);
  }

  const word = /^[_A-Za-z][_0-9A-Za-z]*/.exec(rest);
  if (word) {
    cursor.index += word[0].length;
    if (word[0] === "true") return true;
    if (word[0] === "false") return false;
    if (word[0] === "null") return null;
    // An enum value. Passed through as a string; the resolver validates it,
    // because this parser has no schema to check it against yet.
    return word[0];
  }

  if (rest.startsWith("$")) {
    error(cursor, "variables are not supported — inline the value");
  }

  return error(cursor, "expected a value");
}

function readArguments(cursor: Cursor): Record<string, ArgumentValue> {
  skipSpace(cursor);
  if (cursor.source[cursor.index] !== "(") return {};
  cursor.index += 1;

  const args: Record<string, ArgumentValue> = {};
  for (;;) {
    skipSpace(cursor);
    if (cursor.source[cursor.index] === ")") {
      cursor.index += 1;
      return args;
    }
    const name = readName(cursor);
    skipSpace(cursor);
    if (cursor.source[cursor.index] !== ":") error(cursor, `expected ':' after argument ${name}`);
    cursor.index += 1;
    args[name] = readValue(cursor);
  }
}

function readSelectionSet(cursor: Cursor, depth: number): Selection[] {
  if (depth > MAX_DEPTH) {
    throw new GraphQLError(
      `query is nested deeper than ${MAX_DEPTH} levels — the limit exists because a few hundred bytes of nesting can demand unbounded server work`,
    );
  }

  skipSpace(cursor);
  if (cursor.source[cursor.index] !== "{") error(cursor, "expected '{'");
  cursor.index += 1;

  const selections: Selection[] = [];
  for (;;) {
    skipSpace(cursor);
    const char = cursor.source[cursor.index];

    if (char === undefined) error(cursor, "unexpected end of query");
    if (char === "}") {
      cursor.index += 1;
      return selections;
    }
    if (char === ".") {
      throw new GraphQLError("fragments are not supported by this executor");
    }
    if (char === "@") {
      throw new GraphQLError("directives are not supported by this executor");
    }

    let alias: string | null = null;
    let name = readName(cursor);
    skipSpace(cursor);
    if (cursor.source[cursor.index] === ":") {
      cursor.index += 1;
      alias = name;
      name = readName(cursor);
    }

    const args = readArguments(cursor);
    skipSpace(cursor);

    const nested = cursor.source[cursor.index] === "{" ? readSelectionSet(cursor, depth + 1) : [];
    selections.push({ name, alias, args, selections: nested });
  }
}

export function parse(query: string): Selection[] {
  const cursor: Cursor = { source: query, index: 0 };
  skipSpace(cursor);

  // An optional `query` keyword and operation name. `mutation` and
  // `subscription` are recognised so they can be refused by name rather than
  // producing a confusing parse error three tokens later.
  const rest = cursor.source.slice(cursor.index);
  if (/^mutation\b/.test(rest)) {
    throw new GraphQLError("mutations are not supported — this endpoint is read-only");
  }
  if (/^subscription\b/.test(rest)) {
    throw new GraphQLError("subscriptions are not supported — there is no persistent connection");
  }
  if (/^query\b/.test(rest)) {
    cursor.index += "query".length;
    skipSpace(cursor);
    if (/^[_A-Za-z]/.test(cursor.source.slice(cursor.index))) readName(cursor);
    skipSpace(cursor);
    if (cursor.source[cursor.index] === "(") {
      throw new GraphQLError("variable definitions are not supported — inline the values");
    }
  }

  const selections = readSelectionSet(cursor, 1);

  skipSpace(cursor);
  if (cursor.index < cursor.source.length) {
    // Trailing content usually means a second operation, which needs an
    // operationName to disambiguate — unsupported, and silently running the
    // first would be the wrong guess.
    error(cursor, "unexpected content after the query");
  }

  const total = countFields(selections);
  if (total > MAX_FIELDS) {
    throw new GraphQLError(`query selects ${total} fields, above the limit of ${MAX_FIELDS}`);
  }

  return selections;
}

export function countFields(selections: Selection[]): number {
  return selections.reduce((total, selection) => total + 1 + countFields(selection.selections), 0);
}

export function depthOf(selections: Selection[]): number {
  if (selections.length === 0) return 0;
  return 1 + Math.max(...selections.map((selection) => depthOf(selection.selections)));
}

/* ------------------------------------------------------------ executor */

export type Resolver = (
  args: Record<string, ArgumentValue>,
  parent: unknown,
) => unknown | Promise<unknown>;

export interface SchemaField {
  /** SDL type, used for the `_service { sdl }` response. */
  type: string;
  description?: string;
  resolve?: Resolver;
  /** Fields of the object this returns, when it returns one. */
  fields?: Record<string, SchemaField>;
}

export type Schema = Record<string, SchemaField>;

/**
 * Walk a parsed query against the schema.
 *
 * Field-level errors are collected rather than thrown, and the field is set to
 * null — which is what the GraphQL spec requires for a nullable field, and the
 * behaviour that makes a partial response useful. Throwing on the first failing
 * resolver would discard every field that succeeded.
 */
export async function execute(
  selections: Selection[],
  schema: Schema,
  parent: unknown = null,
): Promise<{ data: Record<string, unknown>; errors: string[] }> {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const selection of selections) {
    const key = selection.alias ?? selection.name;
    const field = schema[selection.name];

    if (!field) {
      errors.push(`Cannot query field "${selection.name}"`);
      data[key] = null;
      continue;
    }

    try {
      const value = field.resolve ? await field.resolve(selection.args, parent) : parent;

      if (selection.selections.length === 0 || value === null || value === undefined) {
        data[key] = value ?? null;
        continue;
      }

      const childSchema = field.fields ?? {};

      if (Array.isArray(value)) {
        const rows = [];
        for (const item of value) {
          const result = await execute(selection.selections, childSchema, item);
          errors.push(...result.errors);
          rows.push(result.data);
        }
        data[key] = rows;
      } else {
        const result = await execute(selection.selections, childSchema, value);
        errors.push(...result.errors);
        data[key] = result.data;
      }
    } catch (caught) {
      errors.push(
        `${selection.name}: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
      data[key] = null;
    }
  }

  return { data, errors };
}

/**
 * Render the schema as SDL.
 *
 * Federation asks a subgraph for `_service { sdl }`, and a gateway composes the
 * supergraph from what every subgraph returns. Generating it from the same
 * schema object the executor uses means the two cannot disagree — which is the
 * failure mode of every hand-maintained SDL file sitting beside a hand-written
 * resolver map.
 */
export function renderSdl(schema: Schema, typeName = "Query"): string {
  const nested: string[] = [];

  const renderType = (name: string, fields: Record<string, SchemaField>): string => {
    const lines = Object.entries(fields).map(([fieldName, field]) => {
      if (field.fields) {
        const childName = field.type.replace(/[[\]!]/g, "");
        if (!nested.some((block) => block.startsWith(`type ${childName} `))) {
          nested.push(renderType(childName, field.fields));
        }
      }
      const doc = field.description ? `  """${field.description}"""\n` : "";
      return `${doc}  ${fieldName}: ${field.type}`;
    });
    return `type ${name} {\n${lines.join("\n")}\n}`;
  };

  const root = renderType(typeName, schema);
  return [root, ...nested].join("\n\n");
}
