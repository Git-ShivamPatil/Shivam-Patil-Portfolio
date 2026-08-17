import { validateSamlResponse, type SamlResult } from "./saml";

/**
 * P22 — the fixtures /security renders.
 *
 * Kept out of the page component so the page stays readable, and out of the
 * test file so the thing a visitor sees is the same input the test suite
 * asserts on. A demo built from a different fixture than the tests is a demo
 * that can pass while the tested behaviour regresses.
 */

const ISSUER = "https://idp.example.com";
const AUDIENCE = "https://www.shivamsfolio.com/sp";

/** A pinned instant, so the demo does not start failing on its expiry date. */
export const DEMO_NOW = Date.parse("2026-08-17T12:00:00Z");

function response(options: { assertionId: string; referenceUri: string; extra?: string }): string {
  return `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  ${options.extra ?? ""}
  <saml:Assertion ID="${options.assertionId}">
    <saml:Issuer>${ISSUER}</saml:Issuer>
    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
      <ds:SignedInfo><ds:Reference URI="${options.referenceUri}"/></ds:SignedInfo>
    </ds:Signature>
    <saml:Subject>
      <saml:NameID>shivam@example.com</saml:NameID>
      <saml:SubjectConfirmation>
        <saml:SubjectConfirmationData InResponseTo="req-1" NotOnOrAfter="2026-08-17T12:30:00Z"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-08-17T11:55:00Z" NotOnOrAfter="2026-08-17T12:30:00Z">
      <saml:AudienceRestriction><saml:Audience>${AUDIENCE}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
  </saml:Assertion>
</samlp:Response>`;
}

/**
 * The forged assertion an attacker injects, unsigned and placed first.
 *
 * **Deliberately complete.** A lazy forgery — bare NameID, no Conditions, no
 * audience — is rejected by half a dozen ordinary checks, which makes for a
 * comfortable demo and a misleading one: it suggests the routine validation
 * would have saved you. A real attacker copies every field from the genuine
 * assertion and changes only the subject, so issuer, audience, validity window
 * and InResponseTo all pass. Then the *only* things standing between the site
 * and a full authentication bypass are the two structural checks, which is
 * exactly the claim this section makes.
 */
const FORGED = `<saml:Assertion ID="forged-1">
    <saml:Issuer>${ISSUER}</saml:Issuer>
    <saml:Subject>
      <saml:NameID>attacker@evil.test</saml:NameID>
      <saml:SubjectConfirmation>
        <saml:SubjectConfirmationData InResponseTo="req-1" NotOnOrAfter="2026-08-17T12:30:00Z"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-08-17T11:55:00Z" NotOnOrAfter="2026-08-17T12:30:00Z">
      <saml:AudienceRestriction><saml:Audience>${AUDIENCE}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
  </saml:Assertion>`;

const encode = (xml: string) => Buffer.from(xml, "utf8").toString("base64");

const OPTIONS = {
  expectedIssuer: ISSUER,
  expectedAudience: AUDIENCE,
  expectedInResponseTo: "req-1",
  now: DEMO_NOW,
};

export interface SamlDemo {
  id: string;
  title: string;
  blurb: string;
  result: SamlResult;
}

export function samlDemos(): SamlDemo[] {
  return [
    {
      id: "valid",
      title: "A legitimate response",
      blurb:
        "One assertion, signed, referencing itself, issued for us, inside its window, answering our request.",
      result: validateSamlResponse(
        encode(response({ assertionId: "a-1", referenceUri: "#a-1" })),
        OPTIONS,
      ),
    },
    {
      id: "wrapped",
      title: "Signature wrapping",
      blurb:
        "A forged assertion is placed ahead of the real one, complete in every respect — same issuer, same audience, same validity window, same request id — with only the subject changed. The signature still references the genuine assertion and would verify perfectly. Every ordinary check passes. Only the two structural checks fail, and they are the whole thing standing between this and a full authentication bypass.",
      result: validateSamlResponse(
        encode(response({ assertionId: "a-1", referenceUri: "#a-1", extra: FORGED })),
        OPTIONS,
      ),
    },
    {
      id: "xxe",
      title: "XXE via an inline DTD",
      blurb:
        "A SAML endpoint parses before it authenticates, which is why it is a classic place to find XML external entity injection. The parser refuses a DOCTYPE outright rather than relying on an entity-expansion flag staying switched off.",
      result: validateSamlResponse(
        encode(
          `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${response({ assertionId: "a-1", referenceUri: "#a-1" })}`,
        ),
        OPTIONS,
      ),
    },
    {
      id: "wrong-audience",
      title: "An assertion for somebody else",
      blurb:
        "Genuinely signed, genuinely issued, genuinely inside its window — and minted for a different service provider, one the attacker legitimately controls. Without an audience check it authenticates here.",
      result: validateSamlResponse(
        encode(
          response({ assertionId: "a-1", referenceUri: "#a-1" }).replace(
            AUDIENCE,
            "https://someone-elses-app.example",
          ),
        ),
        OPTIONS,
      ),
    },
  ];
}
