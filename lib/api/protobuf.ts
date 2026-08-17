/**
 * P24 — protocol buffers, on the wire.
 *
 * **What "gRPC" can and cannot mean here.** gRPC proper is HTTP/2 with trailers,
 * bidirectional streaming and a `application/grpc` framing that browsers cannot
 * originate and Vercel's function runtime does not expose. gRPC-Web exists
 * precisely because of that gap, and it needs a proxy (Envoy, or grpcwebproxy)
 * to translate — the blueprint's gateway, which is not here.
 *
 * What *is* portable is the part that carries the actual engineering: the
 * protobuf wire format. It is a small, completely specified binary encoding,
 * and this file implements it directly — varints, zigzag, length-delimited
 * fields, and the field-skipping rule that makes protobuf forward-compatible.
 * `app/api/rpc/route.ts` then serves it over plain HTTP POST with a
 * length-prefixed frame, which is what Connect's protocol does and what
 * gRPC-Web does minus the trailers.
 *
 * So: real encoding, honestly framed, and the page says which half is missing.
 *
 * No `.proto` compiler and no runtime dependency. The two messages here are
 * described by a small schema object, which is enough for this and would not be
 * enough for a service with fifty of them — at that point the generated code
 * from `protoc` is the correct answer and this becomes the wrong one.
 */

/** Wire types from the spec. Only the three this schema needs are handled. */
export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LENGTH_DELIMITED = 2;
export const WIRE_FIXED32 = 5;

export type FieldType = "int32" | "int64" | "sint32" | "bool" | "string" | "bytes" | "double";

export interface FieldSpec {
  name: string;
  number: number;
  type: FieldType;
  repeated?: boolean;
}

export type MessageSpec = FieldSpec[];

/* ------------------------------------------------------------- writing */

export class Writer {
  private readonly bytes: number[] = [];

  /**
   * Base-128 varint, seven bits per byte, low group first, high bit as the
   * continuation flag. This is the encoding that makes small numbers cheap and
   * is why field numbers 1–15 are worth reserving for hot fields: their tag
   * fits in a single byte.
   */
  varint(value: number): this {
    let remaining = value;
    // >>> 0 first: a negative int32 must be encoded as its two's-complement
    // 64-bit value, and JavaScript bitwise operators would sign-extend it into
    // an infinite loop here.
    if (remaining < 0) return this.varint64Negative(remaining);

    while (remaining > 127) {
      this.bytes.push((remaining & 0x7f) | 0x80);
      remaining = Math.floor(remaining / 128);
    }
    this.bytes.push(remaining & 0x7f);
    return this;
  }

  /**
   * A negative int32 occupies ten bytes as a varint.
   *
   * That is not a bug in the encoding — it is why `sint32` and zigzag exist. A
   * schema that stores negative numbers in an `int32` field silently pays ten
   * bytes for every one of them, which on a repeated field is the difference
   * between a small message and a large one.
   */
  private varint64Negative(value: number): this {
    let low = value >>> 0;
    let high = Math.floor(value / 0x100000000) >>> 0;
    // Two's complement across 64 bits.
    high = high === 0 ? 0xffffffff : high;

    for (let i = 0; i < 9; i += 1) {
      const byte = low & 0x7f;
      low = ((low >>> 7) | (high << 25)) >>> 0;
      high >>>= 7;
      if (low === 0 && high === 0) {
        this.bytes.push(byte);
        return this;
      }
      this.bytes.push(byte | 0x80);
    }
    this.bytes.push(1);
    return this;
  }

  /** Zigzag: maps signed to unsigned so small negatives stay small. */
  zigzag(value: number): this {
    return this.varint(value < 0 ? -2 * value - 1 : 2 * value);
  }

  tag(fieldNumber: number, wireType: number): this {
    return this.varint(fieldNumber * 8 + wireType);
  }

  raw(input: Uint8Array): this {
    for (const byte of input) this.bytes.push(byte);
    return this;
  }

  lengthDelimited(input: Uint8Array): this {
    this.varint(input.length);
    return this.raw(input);
  }

  double(value: number): this {
    const buffer = new ArrayBuffer(8);
    // Little-endian, which the spec mandates. Getting this backwards produces
    // numbers that decode without error and are wrong, which is far worse than
    // a parse failure.
    new DataView(buffer).setFloat64(0, value, true);
    return this.raw(new Uint8Array(buffer));
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMessage(spec: MessageSpec, value: Record<string, unknown>): Uint8Array {
  const writer = new Writer();

  for (const field of spec) {
    const raw = value[field.name];
    if (raw === undefined || raw === null) continue;

    const items = field.repeated ? (Array.isArray(raw) ? raw : [raw]) : [raw];

    for (const item of items) {
      switch (field.type) {
        case "bool":
          writer.tag(field.number, WIRE_VARINT).varint(item ? 1 : 0);
          break;
        case "int32":
        case "int64":
          writer.tag(field.number, WIRE_VARINT).varint(Number(item));
          break;
        case "sint32":
          writer.tag(field.number, WIRE_VARINT).zigzag(Number(item));
          break;
        case "double":
          writer.tag(field.number, WIRE_FIXED64).double(Number(item));
          break;
        case "string":
          writer
            .tag(field.number, WIRE_LENGTH_DELIMITED)
            .lengthDelimited(encoder.encode(String(item)));
          break;
        case "bytes":
          writer.tag(field.number, WIRE_LENGTH_DELIMITED).lengthDelimited(item as Uint8Array);
          break;
      }
    }
  }

  return writer.finish();
}

/* ------------------------------------------------------------- reading */

export class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  varint(): number {
    let result = 0;
    let shift = 1;
    for (let i = 0; i < 10; i += 1) {
      if (this.done) throw new Error("protobuf: truncated varint");
      const byte = this.bytes[this.offset++];
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return result;
      shift *= 128;
    }
    throw new Error("protobuf: varint longer than 10 bytes");
  }

  zigzag(): number {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  bytesOf(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error("protobuf: truncated field");
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  double(): number {
    const slice = this.bytesOf(8);
    return new DataView(slice.buffer, slice.byteOffset, 8).getFloat64(0, true);
  }

  /**
   * Skip a field this schema does not know.
   *
   * **This is the single most important function in the file.** It is what makes
   * protobuf forward-compatible: an old reader receiving a message from a newer
   * writer skips the fields it has never heard of and decodes the rest, instead
   * of failing. A decoder without it turns every additive schema change into a
   * coordinated deploy.
   */
  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.varint();
        return;
      case WIRE_FIXED64:
        this.bytesOf(8);
        return;
      case WIRE_LENGTH_DELIMITED:
        this.bytesOf(this.varint());
        return;
      case WIRE_FIXED32:
        this.bytesOf(4);
        return;
      default:
        // Wire types 3 and 4 are the deprecated group encoding. Refusing is
        // correct: skipping them requires tracking nesting depth, and guessing
        // would desynchronise the rest of the stream.
        throw new Error(`protobuf: unsupported wire type ${wireType}`);
    }
  }
}

export function decodeMessage(spec: MessageSpec, bytes: Uint8Array): Record<string, unknown> {
  const byNumber = new Map(spec.map((field) => [field.number, field]));
  const out: Record<string, unknown> = {};
  const reader = new Reader(bytes);

  for (const field of spec) {
    if (field.repeated) out[field.name] = [];
  }

  while (!reader.done) {
    const tag = reader.varint();
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag % 8;

    const field = byNumber.get(fieldNumber);
    if (!field) {
      reader.skip(wireType);
      continue;
    }

    let value: unknown;
    switch (field.type) {
      case "bool":
        value = reader.varint() !== 0;
        break;
      case "int32":
      case "int64":
        value = reader.varint();
        break;
      case "sint32":
        value = reader.zigzag();
        break;
      case "double":
        value = reader.double();
        break;
      case "string":
        value = decoder.decode(reader.bytesOf(reader.varint()));
        break;
      case "bytes":
        value = reader.bytesOf(reader.varint());
        break;
    }

    if (field.repeated) (out[field.name] as unknown[]).push(value);
    else out[field.name] = value;
  }

  return out;
}

/* -------------------------------------------------------------- schema */

/** The request: which stats to fetch, and how many repos to include. */
export const STATS_REQUEST: MessageSpec = [
  { name: "source", number: 1, type: "string" },
  { name: "limit", number: 2, type: "int32" },
];

/** The response. Field numbers are permanent; adding one is safe, reusing one is not. */
export const STATS_RESPONSE: MessageSpec = [
  { name: "source", number: 1, type: "string" },
  { name: "total", number: 2, type: "int32" },
  { name: "names", number: 3, type: "string", repeated: true },
  { name: "scores", number: 4, type: "int32", repeated: true },
  { name: "ratio", number: 5, type: "double" },
  { name: "stale", number: 6, type: "bool" },
];

/**
 * `.proto` source for the two messages above.
 *
 * Generated from the same specs the codec uses, so it cannot drift from what is
 * actually on the wire — a hand-maintained `.proto` next to a hand-written codec
 * is two sources of truth and one of them is always wrong.
 */
export function protoSource(): string {
  const render = (name: string, spec: MessageSpec) =>
    `message ${name} {\n` +
    spec
      .map(
        (field) =>
          `  ${field.repeated ? "repeated " : ""}${field.type} ${field.name} = ${field.number};`,
      )
      .join("\n") +
    "\n}";

  return [
    'syntax = "proto3";',
    "",
    "package shivamsfolio.stats.v1;",
    "",
    render("StatsRequest", STATS_REQUEST),
    "",
    render("StatsResponse", STATS_RESPONSE),
    "",
    "service Stats {",
    "  rpc Get(StatsRequest) returns (StatsResponse);",
    "}",
  ].join("\n");
}
