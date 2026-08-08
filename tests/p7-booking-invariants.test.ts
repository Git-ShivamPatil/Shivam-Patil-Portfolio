import { describe, it, expect, vi } from "vitest";

// lib/bookings.ts pulls in prisma/mail/push at module scope; stub them so the
// pure helpers can be tested without a database or network.
vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../lib/mail", () => ({ sendBookingConfirmation: vi.fn() }));
vi.mock("../lib/push/notify", () => ({ notifyOwnerOfBooking: vi.fn() }));

const { generateReference, checkoutIdempotencyKey, invoiceAccessToken } =
  await import("../lib/bookings");

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
  it("matches the documented BK-YYMM-XXXXXX shape", () => {
    expect(generateReference()).toMatch(/^BK-\d{4}-[0-9A-F]{6}$/);
  });

  it("fits Razorpay's 40-character receipt limit", () => {
    expect(generateReference().length).toBeLessThanOrEqual(40);
  });

  it("does not collide across a realistic burst", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateReference()));
    expect(seen.size).toBe(2000);
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
