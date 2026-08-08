import { describe, it, expect } from "vitest";
import { toMinor, toMajor, minorUnitFactor, formatMoney } from "../lib/money";

/**
 * P7 — money correctness.
 *
 * Every amount crossing a payment boundary is an integer in the currency's
 * minor unit. These tests exist because a rounding drift here means the
 * customer is charged one number and invoiced another.
 */
describe("money", () => {
  it("round-trips a decimal amount without drift", () => {
    // 4999.00 INR -> 499900 paise. The classic float trap: 49.99 * 100 is
    // 4998.999999999999 in IEEE 754, so a truncating implementation loses a
    // paisa here.
    expect(toMinor(4999, "INR")).toBe(499900);
    expect(toMinor(49.99, "INR")).toBe(4999);
    expect(toMajor(4999, "INR")).toBe(49.99);
  });

  it("treats zero-decimal currencies as whole units", () => {
    expect(minorUnitFactor("JPY")).toBe(1);
    expect(toMinor(1000, "JPY")).toBe(1000);
    expect(toMajor(1000, "JPY")).toBe(1000);
  });

  it("is case-insensitive about the currency code", () => {
    expect(minorUnitFactor("jpy")).toBe(1);
    expect(minorUnitFactor("inr")).toBe(100);
  });

  it("never produces a fractional minor unit", () => {
    for (const amount of [0.005, 1.005, 33.333, 99.999]) {
      expect(Number.isInteger(toMinor(amount, "INR"))).toBe(true);
    }
  });

  it("formats the seeded offering prices as expected", () => {
    // These are the exact values in prisma/seed-services.ts.
    expect(formatMoney(499900, "INR")).toContain("4,999");
    expect(formatMoney(999900, "INR")).toContain("9,999");
    expect(formatMoney(1499900, "INR")).toContain("14,999");
  });
});
