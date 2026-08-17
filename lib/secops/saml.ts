/**
 * P22 — SAML response validation, and an honest account of its limits.
 *
 * **What this does not do: verify the XML signature.** That needs exclusive
 * canonicalisation (XML-C14N), and hand-rolling c14n is how SAML libraries earn
 * CVEs — the algorithm has to agree byte-for-byte with the IdP's on namespace
 * inheritance, attribute ordering and whitespace, and a subtle disagreement
 * produces a verifier that rejects valid assertions or, far worse, accepts
 * modified ones. Writing it for a portfolio would be the wrong kind of
 * impressive. In production this belongs to the IdP SDK or the gateway.
 *
 * **What this does do is the part that libraries get wrong.** Nearly every
 * historical SAML bypass is not a broken signature check — it is a signature
 * that verifies correctly over an element the application then *does not use*.
 * That is XML Signature Wrapping: the attacker keeps the legitimately signed
 * assertion somewhere the verifier finds it, and adds a second, forged
 * assertion somewhere the consumer reads. Both steps succeed and the
 * authentication is fully bypassed with a valid signature.
 *
 * The defence is structural and needs no crypto: the element the signature
 * references must be the *same element* the application consumes, there must be
 * exactly one assertion, and the document must not be allowed to define
 * entities. All three are implemented below and all three are testable.
 *
 * The parser is deliberately strict and refuses anything it cannot read
 * unambiguously. For a security decision that is the correct posture — a
 * lenient parser is a parser that disagrees with the IdP's about what the
 * document says, which is the entire attack surface.
 */

export interface XmlElement {
  /** Local name with any namespace prefix stripped. */
  name: string;
  /** Name as written, prefix included. */
  qname: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
  depth: number;
}

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

const localName = (qname: string) => {
  const colon = qname.indexOf(":");
  return colon === -1 ? qname : qname.slice(colon + 1);
};

/**
 * Parse the subset of XML a SAML response is allowed to be.
 *
 * Rejects, rather than ignores:
 *
 * - **`<!DOCTYPE`** — an inline DTD can define entities, and an entity can
 *   reference a local file or a URL. That is XXE, and SAML endpoints are a
 *   classic place to find it because the parser runs before authentication.
 *   Refusing the declaration outright is stronger than disabling entity
 *   expansion, because it does not depend on a parser flag staying set.
 * - **Processing instructions other than the XML declaration**, for the same
 *   reason: they are parser instructions from an untrusted source.
 * - **Mismatched or unclosed tags** — an unbalanced document is one where two
 *   parsers can disagree about the tree, which is precisely the disagreement
 *   wrapping attacks live in.
 */
export function parseXml(source: string): XmlElement {
  if (/<!DOCTYPE/i.test(source)) {
    throw new XmlParseError("DOCTYPE is not permitted — an inline DTD can declare entities (XXE)");
  }
  if (/<!ENTITY/i.test(source)) {
    throw new XmlParseError("entity declarations are not permitted");
  }

  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open === -1) break;

    // Text between tags belongs to whatever element is currently open.
    if (open > index && stack.length > 0) {
      stack[stack.length - 1].text += source.slice(index, open);
    }

    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open);
      if (end === -1) throw new XmlParseError("unterminated comment");
      index = end + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open);
      if (end === -1) throw new XmlParseError("unterminated CDATA");
      if (stack.length > 0) stack[stack.length - 1].text += source.slice(open + 9, end);
      index = end + 3;
      continue;
    }

    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open);
      if (end === -1) throw new XmlParseError("unterminated processing instruction");
      const target = source.slice(open + 2, end).trim();
      if (!/^xml\s/i.test(target) && target.toLowerCase() !== "xml") {
        throw new XmlParseError("processing instructions are not permitted");
      }
      index = end + 2;
      continue;
    }

    const close = source.indexOf(">", open);
    if (close === -1) throw new XmlParseError("unterminated tag");
    const raw = source.slice(open + 1, close);

    if (raw.startsWith("/")) {
      const closing = raw.slice(1).trim();
      const current = stack.pop();
      if (!current || current.qname !== closing) {
        throw new XmlParseError(
          `mismatched closing tag </${closing}> — expected </${current?.qname ?? "nothing"}>`,
        );
      }
      index = close + 1;
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;

    const nameMatch = /^([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)/.exec(body);
    if (!nameMatch) throw new XmlParseError(`unreadable tag name in <${body.slice(0, 40)}>`);
    const qname = nameMatch[1];

    const attributes: Record<string, string> = {};
    const attributePattern =
      /([A-Za-z_][\w.\-:]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w.\-:]*)\s*=\s*'([^']*)'/g;
    let attribute: RegExpExecArray | null;
    const attributeSource = body.slice(qname.length);
    while ((attribute = attributePattern.exec(attributeSource)) !== null) {
      const key = attribute[1] ?? attribute[3];
      const value = attribute[2] ?? attribute[4];
      // A repeated attribute is ambiguous — two parsers may pick different
      // ones, which is a wrapping primitive.
      if (key in attributes) throw new XmlParseError(`duplicate attribute ${key}`);
      attributes[key] = decodeEntities(value);
    }

    const element: XmlElement = {
      name: localName(qname),
      qname,
      attributes,
      children: [],
      text: "",
      depth: stack.length,
    };

    if (stack.length === 0) {
      if (root) throw new XmlParseError("more than one root element");
      root = element;
    } else {
      stack[stack.length - 1].children.push(element);
    }

    if (!selfClosing) stack.push(element);
    index = close + 1;
  }

  if (stack.length > 0) throw new XmlParseError(`unclosed <${stack[stack.length - 1].qname}>`);
  if (!root) throw new XmlParseError("no root element");
  return root;
}

/** Only the five predefined entities. Anything else is left alone rather than guessed at. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Every descendant with this local name, document order, root included. */
export function findAll(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    if (node.name === name) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(element);
  return found;
}

export type CheckStatus = "pass" | "fail" | "skipped";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SamlOptions {
  /** The entityID we expect the assertion to be issued by. */
  expectedIssuer?: string;
  /** Our own entityID, which must appear as the audience. */
  expectedAudience?: string;
  /** The AuthnRequest ID this is answering, if this is not IdP-initiated. */
  expectedInResponseTo?: string;
  now?: number;
  /** Permitted clock difference against the IdP. */
  skewMs?: number;
  /** Returns true if this assertion ID has already been consumed. */
  seenAssertionId?: (id: string) => boolean;
}

export interface SamlResult {
  ok: boolean;
  checks: Check[];
  subject: string | null;
  attributes: Record<string, string[]>;
}

function parseInstant(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validate a SAML Response.
 *
 * Returns every check with its own verdict rather than a single boolean,
 * because "authentication failed" is useless to whoever has to fix a broken
 * federation, and because the checks that were *skipped* are as important as
 * the ones that passed — a caller who does not pass `expectedAudience` has not
 * validated the audience, and this makes that visible instead of quietly
 * counting it as success.
 */
export function validateSamlResponse(base64: string, options: SamlOptions = {}): SamlResult {
  const now = options.now ?? Date.now();
  const skew = options.skewMs ?? 3 * 60_000;
  const checks: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) =>
    checks.push({ id, label, status, detail });

  let root: XmlElement;
  try {
    const xml = Buffer.from(base64.trim(), "base64").toString("utf8");
    if (!xml.includes("<")) throw new XmlParseError("decoded payload is not XML");
    root = parseXml(xml);
    add("parse", "Parses as XML, with no DTD", "pass", "No DOCTYPE or entity declarations.");
  } catch (error) {
    add(
      "parse",
      "Parses as XML, with no DTD",
      "fail",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, checks, subject: null, attributes: {} };
  }

  if (root.name !== "Response") {
    add("root", "Root element is a Response", "fail", `Root is <${root.qname}>.`);
    return { ok: false, checks, subject: null, attributes: {} };
  }
  add("root", "Root element is a Response", "pass", `<${root.qname}>`);

  const status = findAll(root, "StatusCode")[0]?.attributes.Value ?? "";
  if (status.endsWith(":Success")) {
    add("status", "IdP reported success", "pass", status);
  } else {
    add("status", "IdP reported success", "fail", status || "No StatusCode present.");
  }

  // ---- the wrapping defences -------------------------------------------

  const assertions = findAll(root, "Assertion");
  if (assertions.length === 1) {
    add("single-assertion", "Exactly one assertion", "pass", "One <Assertion> in the document.");
  } else {
    add(
      "single-assertion",
      "Exactly one assertion",
      "fail",
      assertions.length === 0
        ? "No assertion found."
        : `${assertions.length} assertions found — the classic wrapping shape, where the signed one is not the one consumed.`,
    );
  }

  const assertion = assertions[0] ?? null;
  const assertionId = assertion?.attributes.ID ?? null;

  const signatures = findAll(root, "Signature");
  const references = signatures.flatMap((signature) => findAll(signature, "Reference"));
  const referencedIds = references.map((reference) =>
    (reference.attributes.URI ?? "").replace(/^#/, ""),
  );

  if (signatures.length === 0) {
    add("signed", "Response or assertion is signed", "fail", "No <Signature> element.");
  } else {
    add(
      "signed",
      "Response or assertion is signed",
      "pass",
      `${signatures.length} signature(s), referencing ${referencedIds.join(", ") || "nothing"}.`,
    );
  }

  // THE check. A signature that verifies over an element nobody reads is the
  // entire XSW attack class, and it is defeated structurally rather than
  // cryptographically.
  if (!assertionId) {
    add(
      "reference-covers-assertion",
      "The signature covers the assertion being consumed",
      "skipped",
      "No assertion ID to compare against.",
    );
  } else if (referencedIds.includes(assertionId)) {
    add(
      "reference-covers-assertion",
      "The signature covers the assertion being consumed",
      "pass",
      `Reference URI #${assertionId} is the assertion this result reads.`,
    );
  } else {
    add(
      "reference-covers-assertion",
      "The signature covers the assertion being consumed",
      "fail",
      `Signature references ${referencedIds.map((id) => `#${id}`).join(", ") || "nothing"}, but the assertion consumed is #${assertionId}. This is signature wrapping: the signature would verify and the authentication would still be forged.`,
    );
  }

  add(
    "signature-crypto",
    "Signature verified cryptographically",
    "skipped",
    "Not implemented here. Verifying an XML signature requires exclusive canonicalisation, and a hand-rolled c14n that disagrees with the IdP's by one byte either rejects valid logins or accepts modified ones. This belongs to the IdP SDK or the gateway.",
  );

  // ---- ordinary validation ---------------------------------------------

  const issuer = assertion ? findAll(assertion, "Issuer")[0]?.text.trim() : undefined;
  if (!options.expectedIssuer) {
    add("issuer", "Issuer is the expected IdP", "skipped", "No expected issuer supplied.");
  } else if (issuer === options.expectedIssuer) {
    add("issuer", "Issuer is the expected IdP", "pass", issuer);
  } else {
    add("issuer", "Issuer is the expected IdP", "fail", `Got ${issuer ?? "nothing"}.`);
  }

  const audiences = assertion ? findAll(assertion, "Audience").map((node) => node.text.trim()) : [];
  if (!options.expectedAudience) {
    add("audience", "We are the intended audience", "skipped", "No expected audience supplied.");
  } else if (audiences.includes(options.expectedAudience)) {
    add("audience", "We are the intended audience", "pass", options.expectedAudience);
  } else {
    // Without this, an assertion minted for a different service provider — one
    // the attacker legitimately controls — is accepted here.
    add(
      "audience",
      "We are the intended audience",
      "fail",
      `Assertion is for ${audiences.join(", ") || "no stated audience"}. An assertion issued for another service provider must never authenticate here.`,
    );
  }

  const conditions = assertion ? findAll(assertion, "Conditions")[0] : undefined;
  const notBefore = parseInstant(conditions?.attributes.NotBefore);
  const notOnOrAfter = parseInstant(conditions?.attributes.NotOnOrAfter);

  if (notBefore === null && notOnOrAfter === null) {
    add(
      "window",
      "Assertion is inside its validity window",
      "fail",
      "No Conditions window — an assertion with no expiry is a permanent credential.",
    );
  } else if (notBefore !== null && now + skew < notBefore) {
    add(
      "window",
      "Assertion is inside its validity window",
      "fail",
      `Not valid until ${new Date(notBefore).toISOString()}.`,
    );
  } else if (notOnOrAfter !== null && now - skew >= notOnOrAfter) {
    add(
      "window",
      "Assertion is inside its validity window",
      "fail",
      `Expired at ${new Date(notOnOrAfter).toISOString()}.`,
    );
  } else {
    add(
      "window",
      "Assertion is inside its validity window",
      "pass",
      `Valid until ${notOnOrAfter ? new Date(notOnOrAfter).toISOString() : "unstated"}.`,
    );
  }

  const confirmation = assertion ? findAll(assertion, "SubjectConfirmationData")[0] : undefined;
  const inResponseTo = confirmation?.attributes.InResponseTo;
  if (!options.expectedInResponseTo) {
    add(
      "in-response-to",
      "Answers our AuthnRequest",
      "skipped",
      "No request ID supplied — treat as IdP-initiated, which cannot be bound to a request.",
    );
  } else if (inResponseTo === options.expectedInResponseTo) {
    add("in-response-to", "Answers our AuthnRequest", "pass", inResponseTo);
  } else {
    add(
      "in-response-to",
      "Answers our AuthnRequest",
      "fail",
      `Got ${inResponseTo ?? "nothing"} — an assertion not bound to our request can be replayed from another login.`,
    );
  }

  if (!assertionId) {
    add("replay", "Assertion has not been used before", "skipped", "No assertion ID.");
  } else if (!options.seenAssertionId) {
    add("replay", "Assertion has not been used before", "skipped", "No replay store supplied.");
  } else if (options.seenAssertionId(assertionId)) {
    add(
      "replay",
      "Assertion has not been used before",
      "fail",
      `#${assertionId} was already consumed.`,
    );
  } else {
    add("replay", "Assertion has not been used before", "pass", `#${assertionId} is new.`);
  }

  const subject = assertion ? (findAll(assertion, "NameID")[0]?.text.trim() ?? null) : null;

  const attributes: Record<string, string[]> = {};
  if (assertion) {
    for (const node of findAll(assertion, "Attribute")) {
      const name = node.attributes.Name ?? node.attributes.FriendlyName;
      if (!name) continue;
      attributes[name] = findAll(node, "AttributeValue").map((value) => value.text.trim());
    }
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    subject,
    attributes,
  };
}
