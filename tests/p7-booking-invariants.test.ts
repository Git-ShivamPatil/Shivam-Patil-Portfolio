import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// lib/bookings.ts pulls in prisma/mail/push at module scope; stub them so the
// pure helpers can be tested without a database or network.
vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../lib/mail", () => ({ sendBookingConfirmation: vi.fn() }));
vi.mock("../lib/push/notify", () => ({ notifyOwnerOfBooking: vi.fn() }));

const {
  generateReference,
  checkoutIdempotencyKey,
  invoiceAccessToken,
  createBookingWithReference,
} = await import("../lib/bookings");
const { isUniqueConstraintOn } = await import("../lib/prisma-errors");

/**
 * P7 — booking identifiers.
 *
 * The idempotency key is what stops a double-clicked "Pay" button from
 * creating two orders and charging twice, so its determinism is a correctness
 * property, not a style choice.
 */
describe("checkoutIdempotencyKey", () => {
  it("is stable for the same booking and provider", () => {
    const a = checkoutIdempotencyKey("booking_1", "RAZORPAY");
    const b = checkoutIdempotencyKey("booking_1", "RAZORPAY");
    expect(a).toBe(b);
  });

  it("differs across bookings", () => {
    expect(checkoutIdempotencyKey("booking_1", "RAZORPAY")).not.toBe(
      checkoutIdempotencyKey("booking_2", "RAZORPAY"),
    );
  });

  it("differs across providers for the same booking", () => {
    expect(checkoutIdempotencyKey("booking_1", "RAZORPAY")).not.toBe(
      checkoutIdempotencyKey("booking_1", "STRIPE"),
    );
  });

  it("stays within Razorpay's key length limit", () => {
    expect(checkoutIdempotencyKey("booking_1", "RAZORPAY").length).toBeLessThanOrEqual(48);
  });
});

describe("generateReference", () => {
  it("matches the documented BK-YYMM-XXXXXXXXXX shape", () => {
    expect(generateReference()).toMatch(/^BK-\d{4}-[0-9A-F]{10}$/);
  });

  it("fits Razorpay's 40-character receipt limit", () => {
    expect(generateReference().length).toBeLessThanOrEqual(40);
  });

  it("does not collide across a realistic burst", () => {
    // This assertion is only honest because the suffix is 40 bits wide. At the
    // original 24 bits the birthday bound put the collision probability here at
    // ~11%, so the test failed about one run in nine — and because
    // app/api/bookings/route.ts creates the row with no retry, each of those
    // failures represented a real 500 a paying customer could have hit. The
    // test was not flaky so much as it was correctly reporting a defect.
    //
    // At 40 bits the same burst collides with probability ~1.8e-6, so a
    // failure here now means the generator genuinely regressed.
    const seen = new Set(Array.from({ length: 2000 }, () => generateReference()));
    expect(seen.size).toBe(2000);
  });

  it("uses the full random width, not a truncated or constant suffix", () => {
    // Guards the actual regression risk: someone shortening the suffix again,
    // or a refactor that accidentally makes it deterministic. The shape test
    // above would still pass for a constant suffix.
    const suffixes = Array.from({ length: 200 }, () => generateReference().split("-")[2]);
    expect(new Set(suffixes).size).toBe(200);
    expect(suffixes.every((s) => s.length === 10)).toBe(true);
  });
});

describe("invoiceAccessToken", () => {
  it("is long enough to resist enumeration", () => {
    // 24 random bytes, base64url -> 32 chars, ~192 bits of entropy.
    const token = invoiceAccessToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("is URL-safe", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(invoiceAccessToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => invoiceAccessToken()));
    expect(seen.size).toBe(1000);
  });
});

/**
 * A Prisma unique-constraint failure, shaped the way the client actually
 * reports one. `meta.target` is what makes the retry field-specific, so a test
 * that omitted it would pass against a blind retry too.
 */
function uniqueViolation(target: string[] | string | undefined) {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });
}

/** A client whose `booking.create` fails `failures` times, then succeeds. */
function flakyClient(failures: number, error: unknown = uniqueViolation(["reference"])) {
  const attempts: string[] = [];
  return {
    attempts,
    client: {
      booking: {
        create: vi.fn(async ({ data }: { data: { reference: string } }) => {
          attempts.push(data.reference);
          if (attempts.length <= failures) throw error;
          return { id: `booking_${attempts.length}`, ...data };
        }),
      },
    },
  };
}

describe("isUniqueConstraintOn", () => {
  it("matches the named column in a PostgreSQL string[] target", () => {
    expect(isUniqueConstraintOn(uniqueViolation(["reference"]), "reference")).toBe(true);
  });

  it("does not match a violation on a different column", () => {
    expect(isUniqueConstraintOn(uniqueViolation(["email"]), "reference")).toBe(false);
  });

  it("matches a bare-string target, including the constraint-name form", () => {
    expect(isUniqueConstraintOn(uniqueViolation("reference"), "reference")).toBe(true);
    expect(isUniqueConstraintOn(uniqueViolation("Booking_reference_key"), "reference")).toBe(true);
  });

  it("assumes a match when no target is reported, rather than swallowing it", () => {
    // The safer branch: a caller that retries is better than one that reports a
    // collision as a 500 because the connector declined to name the column.
    expect(isUniqueConstraintOn(uniqueViolation(undefined), "reference")).toBe(true);
  });

  it("is false for errors that are not P2002 at all", () => {
    expect(isUniqueConstraintOn(new Error("connection reset"), "reference")).toBe(false);
    expect(isUniqueConstraintOn({ code: "P2025" }, "reference")).toBe(false);
  });
});

/**
 * P7/P18 — the oldest open defect in the repo.
 *
 * `Booking.reference` is `@unique` and the route used to create the row with a
 * single unretried `create()`, so a collision was a 500 for a customer at the
 * exact moment they were trying to pay. These assert the retry actually
 * retries, that it regenerates rather than resubmitting the same value, and
 * that it stays narrow enough not to mask an unrelated constraint failure.
 */
describe("createBookingWithReference", () => {
  const row = {
    offeringId: "offering_1",
    name: "Ada",
    email: "ada@example.com",
    company: null,
    notes: null,
    scheduledAt: null,
    calBookingUid: null,
    referralRef: null,
  };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds on the first attempt when nothing collides", async () => {
    const { client, attempts } = flakyClient(0);
    await expect(createBookingWithReference(row, client as never)).resolves.toMatchObject({
      id: "booking_1",
    });
    expect(attempts).toHaveLength(1);
  });

  it("recovers from a collision instead of surfacing a 500", async () => {
    const { client, attempts } = flakyClient(1);
    const booking = await createBookingWithReference(row, client as never);
    expect(attempts).toHaveLength(2);
    expect(booking.reference).toBe(attempts[1]);
  });

  it("generates a NEW reference on each attempt", async () => {
    // The failure this guards against is a retry loop that resubmits the value
    // that just collided — which cannot ever succeed, and would turn a rare
    // 500 into a guaranteed one that takes three round trips to report.
    const { client, attempts } = flakyClient(2);
    await createBookingWithReference(row, client as never);
    expect(new Set(attempts).size).toBe(attempts.length);
  });

  it("gives up after three attempts rather than looping", async () => {
    const { client, attempts } = flakyClient(Number.POSITIVE_INFINITY);
    await expect(createBookingWithReference(row, client as never)).rejects.toMatchObject({
      code: "P2002",
    });
    expect(attempts).toHaveLength(3);
  });

  it("re-throws a unique violation on a different column without retrying", async () => {
    const { client, attempts } = flakyClient(
      Number.POSITIVE_INFINITY,
      uniqueViolation(["calBookingUid"]),
    );
    await expect(createBookingWithReference(row, client as never)).rejects.toMatchObject({
      code: "P2002",
    });
    // One attempt, not three: regenerating a reference cannot fix a collision
    // on another column, so retrying would only delay the error.
    expect(attempts).toHaveLength(1);
  });

  it("re-throws a non-constraint error immediately", async () => {
    const { client, attempts } = flakyClient(
      Number.POSITIVE_INFINITY,
      new Error("connection reset"),
    );
    await expect(createBookingWithReference(row, client as never)).rejects.toThrow(
      "connection reset",
    );
    expect(attempts).toHaveLength(1);
  });
});
