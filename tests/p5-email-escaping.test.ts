import { describe, it, expect } from "vitest";
import { escapeHtml } from "../lib/email/layout";
import { contactFormEmail } from "../lib/email/templates";

/**
 * P5 — HTML injection in transactional email.
 *
 * The contact form interpolates visitor-supplied name/email/message straight
 * into an HTML email. Anything unescaped there is stored XSS aimed at the site
 * owner's own inbox.
 */
describe("escapeHtml", () => {
  it("escapes every character that can break out of markup", () => {
    expect(escapeHtml(`<script>`)).toBe("&lt;script&gt;");
    expect(escapeHtml(`"`)).toBe("&quot;");
    expect(escapeHtml(`'`)).toBe("&#39;");
    expect(escapeHtml(`&`)).toBe("&amp;");
  });

  it("escapes the ampersand first so entities are not double-broken", () => {
    // If & were escaped last, "<" would become "&lt;" and then "&amp;lt;".
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("contactFormEmail", () => {
  const payload = {
    name: `Mallory<script>alert(1)</script>`,
    email: `evil"@example.com`,
    message: `<img src=x onerror="alert(document.cookie)">\nsecond line`,
  };

  it("does not emit raw attacker markup into the body", () => {
    const { html } = contactFormEmail(payload);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain(`onerror="alert`);
    expect(html).not.toContain("<img src=x");
  });

  it("escapes the injected markup instead", () => {
    const { html } = contactFormEmail(payload);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
  });

  it("still renders the message's line breaks", () => {
    const { html } = contactFormEmail(payload);
    expect(html).toContain("<br />");
  });

  it("puts the sender's name in the subject", () => {
    const { subject } = contactFormEmail({ ...payload, name: "Real Person" });
    expect(subject).toContain("Real Person");
  });
});
