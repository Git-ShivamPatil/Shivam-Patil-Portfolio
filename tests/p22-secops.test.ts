import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// lib/secops/ledger.ts builds the Prisma client at import time for its `append`
// path. Everything tested here — canonicalisation, hashing, chain verification
// — is pure, and the split between the two exists precisely so this suite needs
// no database, which is the property CI depends on.
vi.mock("../lib/prisma", () => ({ prisma: {} }));

// Every module under test here is pure except the ledger's append path, which
// needs a database. The hashing and verification halves are separated from it
// precisely so this suite never needs one.
import {
  GENESIS_HASH,
  canonicalise,
  hashEntry,
  verifyChain,
  type LedgerRecord,
} from "../lib/secops/ledger";
import {
  availableKeyVersions,
  currentKeyVersion,
  decrypt,
  encrypt,
  isKmsConfigured,
  KmsError,
  needsRotation,
  rewrap,
  secretsMatch,
} from "../lib/secops/kms";
import { RULES, scanSource, summarise } from "../lib/secops/sast";
import {
  canonicalRequest,
  createNonceCache,
  signRequest,
  verifyRequest,
  CLOCK_SKEW_MS,
} from "../lib/secops/signing";
import { parseXml, findAll, validateSamlResponse } from "../lib/secops/saml";
import { generateKeyPairSync } from "node:crypto";

/**
 * P22 — security operations.
 *
 * The tests worth reading are the negative ones. A hash chain that accepts a
 * valid chain proves nothing; a hash chain that *detects an edited row and says
 * which one* is the whole feature. Same for the SAML suite: the interesting
 * assertion is that a signature-wrapped response is rejected even though every
 * individual element in it is well-formed and signed.
 */

/* --------------------------------------------------------------- ledger */

function entry(seq: number, prevHash: string, overrides: Partial<LedgerRecord> = {}) {
  const base: LedgerRecord = {
    seq,
    actor: "admin-1",
    action: "user.role.changed",
    target: `user:${seq}`,
    metadata: { from: "USER", to: "ADMIN" },
    prevHash,
    createdAt: new Date(1_700_000_000_000 + seq * 1000),
    ...overrides,
  };
  return { ...base, hash: hashEntry(base) };
}

function chain(length: number) {
  const entries: (LedgerRecord & { hash: string })[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= length; seq += 1) {
    const next = entry(seq, prev);
    entries.push(next);
    prev = next.hash;
  }
  return entries;
}

describe("P22 audit ledger", () => {
  it("verifies an untouched chain", () => {
    const result = verifyChain(chain(5));
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(5);
    expect(result.faults).toEqual([]);
  });

  it("detects an edited field, and names the row", () => {
    const entries = chain(5);
    // The attack: an admin quietly rewrites who was promoted.
    entries[2].metadata = { from: "USER", to: "USER" };

    const result = verifyChain(entries);
    expect(result.ok).toBe(false);
    expect(result.faults.some((f) => f.kind === "hash-mismatch" && f.seq === 3)).toBe(true);
  });

  it("detects a deleted row through the broken link", () => {
    const entries = chain(5);
    entries.splice(2, 1);

    const result = verifyChain(entries);
    expect(result.ok).toBe(false);
    // The row after the hole no longer points at its predecessor.
    expect(result.faults.some((f) => f.kind === "broken-link")).toBe(true);
    expect(result.faults.some((f) => f.kind === "sequence-gap")).toBe(true);
  });

  it("reports every fault, not just the first", () => {
    // A wholesale rewrite must not look like a single edit — the shape of the
    // fault list is the diagnosis.
    const entries = chain(6);
    entries[1].actor = "someone-else";
    entries[4].actor = "someone-else";

    const result = verifyChain(entries);
    expect(result.faults.filter((f) => f.kind === "hash-mismatch")).toHaveLength(2);
  });

  it("catches a re-hashed edit only through the sequence, which is the honest limit", () => {
    // Tamper-EVIDENT, not tamper-proof. An attacker who edits a row and then
    // recomputes every subsequent hash produces a chain that verifies. This
    // test exists to pin that as known and documented rather than discovered.
    const entries = chain(5);
    entries[2].actor = "attacker";
    let prev = entries[1].hash;
    for (let i = 2; i < entries.length; i += 1) {
      entries[i].prevHash = prev;
      entries[i].hash = hashEntry(entries[i]);
      prev = entries[i].hash;
    }

    expect(verifyChain(entries).ok).toBe(true);
  });

  it("cannot be fooled by moving content across field boundaries", () => {
    // Length-prefixed canonicalisation. With a delimiter-joined form, an actor
    // literally named "a|b" with action "c" hashes identically to actor "a"
    // with action "b|c" — so an attacker who controls one field can forge
    // another.
    const at = new Date(1_700_000_000_000);
    const left = canonicalise({
      seq: 1,
      actor: "a|b",
      action: "c",
      target: "",
      metadata: null,
      prevHash: GENESIS_HASH,
      createdAt: at,
    });
    const right = canonicalise({
      seq: 1,
      actor: "a",
      action: "b|c",
      target: "",
      metadata: null,
      prevHash: GENESIS_HASH,
      createdAt: at,
    });
    expect(left).not.toBe(right);
  });

  it("starts from the genesis hash", () => {
    const entries = chain(1);
    expect(entries[0].prevHash).toBe(GENESIS_HASH);
    // A chain whose first row points at something else is a chain with rows
    // deleted from the front.
    entries[0].prevHash = "f".repeat(64);
    entries[0].hash = hashEntry(entries[0]);
    expect(verifyChain(entries).faults.some((f) => f.kind === "broken-link")).toBe(true);
  });
});

/* ------------------------------------------------------------------ kms */

describe("P22 envelope encryption", () => {
  const KEY_1 = Buffer.alloc(32, 1).toString("base64");
  const KEY_2 = Buffer.alloc(32, 2).toString("base64");
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = { one: process.env.KMS_MASTER_KEY, two: process.env.KMS_MASTER_KEY_V2 };
    process.env.KMS_MASTER_KEY = KEY_1;
    delete process.env.KMS_MASTER_KEY_V2;
  });

  afterEach(() => {
    if (saved.one === undefined) delete process.env.KMS_MASTER_KEY;
    else process.env.KMS_MASTER_KEY = saved.one;
    if (saved.two === undefined) delete process.env.KMS_MASTER_KEY_V2;
    else process.env.KMS_MASTER_KEY_V2 = saved.two;
  });

  it("round-trips", () => {
    expect(isKmsConfigured()).toBe(true);
    const envelope = encrypt("hunter2");
    expect(decrypt(envelope)).toBe("hunter2");
  });

  it("never stores the plaintext or the data key in the envelope", () => {
    const envelope = encrypt("a-very-distinctive-secret");
    const serialised = JSON.stringify(envelope);
    expect(serialised).not.toContain("a-very-distinctive-secret");
    // The wrapped key is not the key: encrypting the same plaintext twice must
    // produce different wrapped keys, or the DEK is not random per record.
    expect(encrypt("x").key).not.toBe(encrypt("x").key);
  });

  it("produces a different ciphertext each time for the same plaintext", () => {
    // Deterministic ciphertext leaks equality — an attacker learns which rows
    // hold the same value without decrypting any of them.
    expect(encrypt("same").data).not.toBe(encrypt("same").data);
  });

  it("rejects a tampered payload rather than returning garbage", () => {
    const envelope = encrypt("authentic");
    const bytes = Buffer.from(envelope.data, "base64");
    bytes[0] ^= 0xff;
    expect(() => decrypt({ ...envelope, data: bytes.toString("base64") })).toThrow(KmsError);
  });

  it("rejects a tampered wrapped key", () => {
    const envelope = encrypt("authentic");
    const bytes = Buffer.from(envelope.key, "base64");
    bytes[bytes.length - 1] ^= 0xff;
    expect(() => decrypt({ ...envelope, key: bytes.toString("base64") })).toThrow(KmsError);
  });

  it("binds the ciphertext to its record through the AAD", () => {
    // Without this, an attacker with database write access swaps two users'
    // encrypted fields and both decrypt perfectly — confidentiality was never
    // the property that would have caught it.
    const envelope = encrypt("alice@example.com", "user:alice");
    expect(decrypt(envelope, "user:alice")).toBe("alice@example.com");
    expect(() => decrypt(envelope, "user:mallory")).toThrow(KmsError);
  });

  it("rotates without ever touching the payload", () => {
    const envelope = encrypt("long-lived-secret");
    expect(envelope.v).toBe(1);

    process.env.KMS_MASTER_KEY_V2 = KEY_2;
    expect(currentKeyVersion()).toBe(2);
    expect(needsRotation(envelope)).toBe(true);

    const { envelope: rotated, rotated: didRotate } = rewrap(envelope);
    expect(didRotate).toBe(true);
    expect(rotated.v).toBe(2);
    // The bulk ciphertext is byte-identical — only the wrapped key changed.
    // This is the entire reason envelope encryption exists.
    expect(rotated.data).toBe(envelope.data);
    expect(rotated.iv).toBe(envelope.iv);
    expect(rotated.key).not.toBe(envelope.key);
    expect(decrypt(rotated)).toBe("long-lived-secret");
  });

  it("is idempotent, so an interrupted rotation sweep can be re-run", () => {
    process.env.KMS_MASTER_KEY_V2 = KEY_2;
    const envelope = encrypt("x");
    const first = rewrap(envelope);
    expect(first.rotated).toBe(false);
    expect(first.envelope).toBe(envelope);
  });

  it("still decrypts under an old key version after rotation", () => {
    const old = encrypt("written-before-rotation");
    process.env.KMS_MASTER_KEY_V2 = KEY_2;
    // Removing the old key here would be the classic rotation outage.
    expect(availableKeyVersions()).toEqual([1, 2]);
    expect(decrypt(old)).toBe("written-before-rotation");
  });

  it("fails loudly when the key an envelope names has been removed", () => {
    process.env.KMS_MASTER_KEY_V2 = KEY_2;
    const envelope = encrypt("orphan");
    delete process.env.KMS_MASTER_KEY_V2;
    expect(() => decrypt(envelope)).toThrow(/no master key for version 2/);
  });

  it("ignores a master key of the wrong length rather than padding it", () => {
    process.env.KMS_MASTER_KEY = Buffer.alloc(16, 9).toString("base64");
    expect(isKmsConfigured()).toBe(false);
  });

  it("compares secrets without short-circuiting", () => {
    expect(secretsMatch("abcdef", "abcdef")).toBe(true);
    expect(secretsMatch("abcdef", "abcdeg")).toBe(false);
    // Different lengths must return false, not throw — timingSafeEqual does.
    expect(secretsMatch("abc", "abcdef")).toBe(false);
  });
});

/* ----------------------------------------------------------------- sast */

describe("P22 static analysis", () => {
  it("flags raw SQL interpolation", () => {
    const findings = scanSource("lib/x.ts", "prisma.$queryRawUnsafe(`SELECT ${input}`)");
    expect(findings.map((f) => f.ruleId)).toContain("raw-sql-interpolation");
  });

  it("does not flag the parameterised tagged template", () => {
    const findings = scanSource("lib/x.ts", "prisma.$queryRaw`SELECT * FROM t WHERE id = ${id}`");
    expect(findings.map((f) => f.ruleId)).not.toContain("raw-sql-interpolation");
  });

  it("ignores comment-only lines", () => {
    // The regression this pins: the scanner flagged the prose explaining why
    // dangerouslySetInnerHTML is dangerous — it was reporting the
    // documentation of the defence as the defect.
    const findings = scanSource(
      "lib/x.ts",
      "// never reach for dangerouslySetInnerHTML = here\n * eval( is also bad\n",
    );
    expect(findings).toEqual([]);
  });

  it("honours a rule-specific suppression and ignores an unrelated one", () => {
    const source = "// sast-ignore: eval — reviewed\nconst x = eval(input);";
    expect(scanSource("lib/x.ts", source)).toEqual([]);

    const wrongRule = "// sast-ignore: dangerous-html — reviewed\nconst x = eval(input);";
    // A suppression naming a different rule must not silence this one, or an
    // old comment silences rules written after it.
    expect(scanSource("lib/x.ts", wrongRule).map((f) => f.ruleId)).toContain("eval");
  });

  it("treats a documented example credential as an example", () => {
    const findings = scanSource("tests/x.test.ts", 'accessKeyId: "AKIAIOSFODNN7EXAMPLE",');
    expect(findings.map((f) => f.ruleId)).not.toContain("hardcoded-secret");
  });

  it("still flags a credential that is not an example", () => {
    const findings = scanSource("lib/x.ts", 'const key = "AKIAQWERTYUIOPASDFGH";');
    expect(findings.map((f) => f.ruleId)).toContain("hardcoded-secret");
  });

  it("does not flag Math.random in the test suites", () => {
    const inTests = scanSource(
      "tests/p6-rate-limit.test.ts",
      "const key = `burst-${Math.random()}`;",
    );
    expect(inTests.map((f) => f.ruleId)).not.toContain("weak-random-for-secrets");

    const inApp = scanSource("lib/token.ts", "const token = String(Math.random());");
    expect(inApp.map((f) => f.ruleId)).toContain("weak-random-for-secrets");
  });

  it("gives every rule a unique id and a rationale", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of RULES) {
      // A finding with no rationale is a finding nobody can act on.
      expect(rule.rationale.length).toBeGreaterThan(40);
    }
  });

  it("summarises by severity", () => {
    const findings = scanSource("lib/x.ts", 'eval(a);\nconst u = "http://evil.test";');
    const totals = summarise(findings);
    expect(totals.high).toBeGreaterThanOrEqual(1);
    expect(totals.low).toBeGreaterThanOrEqual(1);
  });
});

/* -------------------------------------------------------------- signing */

describe("P22 request signing", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const keys = new Map([["client-a", publicPem]]);
  const now = 1_700_000_000_000;
  const parts = {
    method: "POST",
    path: "/api/internal/sync",
    body: '{"op":"reindex"}',
    timestamp: now,
    nonce: "nonce-1",
    keyId: "client-a",
  };

  it("accepts a correctly signed request", () => {
    const signature = signRequest(parts, privatePem);
    expect(verifyRequest(parts, signature, { keys, now })).toMatchObject({
      ok: true,
      reason: "ok",
    });
  });

  it("rejects a request whose body was altered in flight", () => {
    // The property mTLS does not give you: mTLS authenticates the channel, so
    // anything an authenticated client sends down it is trusted.
    const signature = signRequest(parts, privatePem);
    const tampered = { ...parts, body: '{"op":"drop"}' };
    expect(verifyRequest(tampered, signature, { keys, now }).reason).toBe("bad-signature");
  });

  it("rejects a signature replayed against a different path", () => {
    const signature = signRequest(parts, privatePem);
    const moved = { ...parts, path: "/api/internal/delete" };
    expect(verifyRequest(moved, signature, { keys, now }).reason).toBe("bad-signature");
  });

  it("rejects an unknown key id", () => {
    const signature = signRequest(parts, privatePem);
    expect(verifyRequest({ ...parts, keyId: "client-b" }, signature, { keys, now }).reason).toBe(
      "unknown-key",
    );
  });

  it("rejects a stale request", () => {
    const signature = signRequest(parts, privatePem);
    expect(verifyRequest(parts, signature, { keys, now: now + CLOCK_SKEW_MS + 1 }).reason).toBe(
      "expired",
    );
  });

  it("rejects a future-dated request", () => {
    // Without this, a captured request signed hours ahead can be replayed
    // later and the validity window becomes attacker-chosen.
    const future = { ...parts, timestamp: now + CLOCK_SKEW_MS * 4 };
    const signature = signRequest(future, privatePem);
    expect(verifyRequest(future, signature, { keys, now }).reason).toBe("future-dated");
  });

  it("rejects a replayed nonce", () => {
    const seen = createNonceCache();
    const signature = signRequest(parts, privatePem);
    expect(verifyRequest(parts, signature, { keys, now, seenNonce: seen }).ok).toBe(true);
    expect(verifyRequest(parts, signature, { keys, now, seenNonce: seen }).reason).toBe("replayed");
  });

  it("cannot be fooled by moving content across field boundaries", () => {
    const a = canonicalRequest({ ...parts, path: "/a/b", nonce: "n" });
    const b = canonicalRequest({ ...parts, path: "/a", nonce: "b/n" });
    expect(a).not.toBe(b);
  });
});

/* ----------------------------------------------------------------- saml */

const encode = (xml: string) => Buffer.from(xml, "utf8").toString("base64");

const NOW = Date.parse("2026-08-17T12:00:00Z");

function samlResponse({
  assertionId = "a-1",
  referenceUri = "#a-1",
  audience = "https://shivamsfolio.com/sp",
  extraAssertion = "",
  notOnOrAfter = "2026-08-17T12:30:00Z",
}: Partial<{
  assertionId: string;
  referenceUri: string;
  audience: string;
  extraAssertion: string;
  notOnOrAfter: string;
}> = {}) {
  return `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  ${extraAssertion}
  <saml:Assertion ID="${assertionId}">
    <saml:Issuer>https://idp.example.com</saml:Issuer>
    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
      <ds:SignedInfo><ds:Reference URI="${referenceUri}"/></ds:SignedInfo>
    </ds:Signature>
    <saml:Subject>
      <saml:NameID>shivam@example.com</saml:NameID>
      <saml:SubjectConfirmation>
        <saml:SubjectConfirmationData InResponseTo="req-1" NotOnOrAfter="${notOnOrAfter}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-08-17T11:55:00Z" NotOnOrAfter="${notOnOrAfter}">
      <saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
  </saml:Assertion>
</samlp:Response>`;
}

const options = {
  expectedIssuer: "https://idp.example.com",
  expectedAudience: "https://shivamsfolio.com/sp",
  expectedInResponseTo: "req-1",
  now: NOW,
};

const check = (result: ReturnType<typeof validateSamlResponse>, id: string) =>
  result.checks.find((entry) => entry.id === id);

describe("P22 SAML validation", () => {
  it("parses a well-formed response and extracts the subject", () => {
    const result = validateSamlResponse(encode(samlResponse()), options);
    expect(result.ok).toBe(true);
    expect(result.subject).toBe("shivam@example.com");
  });

  it("refuses a DOCTYPE, which is the XXE vector", () => {
    // A SAML endpoint parses before it authenticates, which is exactly why it
    // is a classic place to find XXE.
    const hostile = `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${samlResponse()}`;
    const result = validateSamlResponse(encode(hostile), options);
    expect(result.ok).toBe(false);
    expect(check(result, "parse")?.status).toBe("fail");
    expect(check(result, "parse")?.detail).toMatch(/DOCTYPE/);
  });

  it("rejects signature wrapping — the attack that defeats a valid signature", () => {
    // The forgery is COMPLETE, and that is the point of the test. A lazy
    // forged assertion (bare NameID, no Conditions) is caught by half a dozen
    // ordinary checks, which would let this pass for the wrong reason and
    // suggest routine validation was enough. A real attacker copies every
    // field and changes only the subject.
    const forged = `<saml:Assertion ID="evil-1">
      <saml:Issuer>https://idp.example.com</saml:Issuer>
      <saml:Subject>
        <saml:NameID>attacker@evil.test</saml:NameID>
        <saml:SubjectConfirmation>
          <saml:SubjectConfirmationData InResponseTo="req-1" NotOnOrAfter="2026-08-17T12:30:00Z"/>
        </saml:SubjectConfirmation>
      </saml:Subject>
      <saml:Conditions NotBefore="2026-08-17T11:55:00Z" NotOnOrAfter="2026-08-17T12:30:00Z">
        <saml:AudienceRestriction><saml:Audience>https://shivamsfolio.com/sp</saml:Audience></saml:AudienceRestriction>
      </saml:Conditions>
    </saml:Assertion>`;
    const result = validateSamlResponse(
      encode(samlResponse({ extraAssertion: forged, referenceUri: "#a-1" })),
      options,
    );

    expect(result.ok).toBe(false);

    // The subject extracted is the ATTACKER's — the assertion a naive
    // validator would consume after its signature check passed.
    expect(result.subject).toBe("attacker@evil.test");

    // Exactly two checks fail, and they are the structural ones. Every
    // ordinary check passes, which is the entire claim: nothing cryptographic
    // and nothing routine catches this.
    const failed = result.checks.filter((entry) => entry.status === "fail").map((e) => e.id);
    expect(failed.sort()).toEqual(["reference-covers-assertion", "single-assertion"]);

    expect(check(result, "issuer")?.status).toBe("pass");
    expect(check(result, "audience")?.status).toBe("pass");
    expect(check(result, "window")?.status).toBe("pass");
    expect(check(result, "in-response-to")?.status).toBe("pass");
  });

  it("rejects a response whose signature references something other than the assertion used", () => {
    const result = validateSamlResponse(
      encode(samlResponse({ assertionId: "a-1", referenceUri: "#some-other-element" })),
      options,
    );
    expect(check(result, "reference-covers-assertion")?.status).toBe("fail");
    expect(result.ok).toBe(false);
  });

  it("rejects an assertion minted for a different service provider", () => {
    const result = validateSamlResponse(
      encode(samlResponse({ audience: "https://someone-elses-app.example" })),
      options,
    );
    expect(check(result, "audience")?.status).toBe("fail");
    expect(result.ok).toBe(false);
  });

  it("rejects an expired assertion", () => {
    const result = validateSamlResponse(encode(samlResponse()), {
      ...options,
      now: Date.parse("2026-08-17T14:00:00Z"),
    });
    expect(check(result, "window")?.status).toBe("fail");
  });

  it("rejects a replayed assertion", () => {
    const used = new Set(["a-1"]);
    const result = validateSamlResponse(encode(samlResponse()), {
      ...options,
      seenAssertionId: (id) => used.has(id),
    });
    expect(check(result, "replay")?.status).toBe("fail");
  });

  it("reports the cryptographic signature check as skipped rather than passed", () => {
    // The honesty requirement. A validator that silently omits signature
    // verification and returns ok:true is worse than one that refuses to run.
    const result = validateSamlResponse(encode(samlResponse()), options);
    expect(check(result, "signature-crypto")?.status).toBe("skipped");
  });

  it("marks unsupplied expectations as skipped, not passed", () => {
    // A caller who does not pass an audience has not validated the audience,
    // and counting that as a pass is how a validator reports security it never
    // performed.
    const result = validateSamlResponse(encode(samlResponse()), { now: NOW });
    expect(check(result, "audience")?.status).toBe("skipped");
    expect(check(result, "issuer")?.status).toBe("skipped");
  });
});

describe("P22 XML parser", () => {
  it("rejects mismatched tags", () => {
    expect(() => parseXml("<a><b></a></b>")).toThrow(/mismatched/);
  });

  it("rejects duplicate attributes, which are a wrapping primitive", () => {
    expect(() => parseXml('<a id="1" id="2"/>')).toThrow(/duplicate/);
  });

  it("rejects an unclosed element", () => {
    expect(() => parseXml("<a><b></b>")).toThrow(/unclosed/);
  });

  it("handles self-closing elements and CDATA", () => {
    const root = parseXml("<a><b/><c><![CDATA[<not a tag>]]></c></a>");
    expect(root.children).toHaveLength(2);
    expect(findAll(root, "c")[0].text).toBe("<not a tag>");
  });

  it("strips namespace prefixes for lookup but keeps the qualified name", () => {
    const root = parseXml('<samlp:Response xmlns:samlp="urn:x"><saml:Assertion/></samlp:Response>');
    expect(root.name).toBe("Response");
    expect(root.qname).toBe("samlp:Response");
    expect(findAll(root, "Assertion")).toHaveLength(1);
  });
});
