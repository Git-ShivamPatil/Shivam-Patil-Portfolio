import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../lib/password";

/**
 * P2 — credential hashing.
 *
 * Slow by design (bcrypt cost 12), so this file is deliberately small — just
 * enough to catch a swapped algorithm, a dropped salt, or a comparison that
 * accidentally returns true.
 */
describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("Correct horse battery staple", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("salts — the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same-input"), hashPassword("same-input")]);
    expect(a).not.toBe(b);
    // ...but both still verify.
    await expect(verifyPassword("same-input", a)).resolves.toBe(true);
    await expect(verifyPassword("same-input", b)).resolves.toBe(true);
  });

  it("uses a cost factor of at least 12", async () => {
    // bcrypt hash format: $2<variant>$<cost>$<salt+digest>
    const cost = Number((await hashPassword("x")).split("$")[2]);
    expect(cost).toBeGreaterThanOrEqual(12);
  });

  it("never stores the plaintext", async () => {
    const secret = "a-very-distinctive-secret-value";
    expect(await hashPassword(secret)).not.toContain(secret);
  });
});
