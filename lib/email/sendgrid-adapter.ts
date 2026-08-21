import type { MailAdapter, MailMessage } from "./types";

/**
 * SendGrid, over `fetch`.
 *
 * ### Why no `@sendgrid/mail`
 *
 * The v3 send API is one POST with a JSON body. The official SDK wraps that in
 * a dependency tree, and this project's standing preference is to add a package
 * only when it buys something the platform does not already provide — the same
 * reasoning that produced a hand-written protobuf codec and a hand-written
 * OpenAPI document rather than pulling in generators for either.
 *
 * It also keeps the runtime honest: `fetch` is available in both the Node and
 * Edge runtimes, so nothing here constrains where a route can run.
 *
 * ### Why SendGrid at all
 *
 * §56i: Resend requires an MX record on a `send` subdomain and Wix cannot
 * create one, so this domain cannot be verified with Resend at all. SendGrid's
 * **Automated Security** authenticates on CNAME records only — the CNAME
 * delegates a subdomain into SendGrid's zone, and SendGrid generates the SPF
 * and MX records *inside that zone*. Nothing MX-shaped is ever entered at Wix,
 * which is exactly the constraint that blocked Resend.
 *
 * That is a DNS-shaped reason, not a claim that this API is better.
 */

/** The v3 mail send endpoint. */
const ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

/**
 * Ten seconds.
 *
 * Every caller in lib/mail.ts is on a request path a person is waiting on —
 * a contact form, a password reset, a booking confirmation. Without a timeout,
 * a provider that accepts the connection and then stalls holds the whole
 * request open until the platform kills it, and the visitor sees a hang rather
 * than a slow success.
 */
const TIMEOUT_MS = 10_000;

/**
 * Split `Name <address@host>` into the shape SendGrid wants.
 *
 * Resend accepts the RFC 5322 combined form directly; SendGrid requires
 * `{ email, name }` as separate fields and rejects an address with a display
 * name embedded in it. `EMAIL_FROM` is a single environment variable shared by
 * both adapters, so the parsing has to live here rather than forcing two
 * variables with different formats on whoever configures this.
 */
export function parseFrom(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(from);
  if (!match) return { email: from.trim() };

  const name = match[1].replace(/^"(.*)"$/, "$1").trim();
  return name ? { email: match[2], name } : { email: match[2] };
}

export const sendgridAdapter: MailAdapter = {
  name: "SENDGRID",

  isConfigured: () => Boolean(process.env.SENDGRID_API_KEY),

  async send(message: MailMessage, from: string): Promise<void> {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) throw new Error("SENDGRID_API_KEY is not set");

    const body = {
      personalizations: [
        {
          to: [{ email: message.to }],
          // Per-personalization rather than top-level. SendGrid applies these
          // only to this recipient, which is what "custom headers on this
          // message" means, and the top-level `headers` field is reserved for
          // ones that apply to every personalization.
          ...(message.headers ? { headers: message.headers } : {}),
        },
      ],
      from: parseFrom(from),
      ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
      subject: message.subject,
      content: [{ type: "text/html", value: message.html }],
    };

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // 202 Accepted is the success case — SendGrid queues rather than delivering
    // synchronously, so a 2xx means "we have it", never "it arrived".
    if (response.ok) return;

    // The error body names the offending field, which is the difference
    // between a debuggable failure and "SendGrid returned 400". Truncated
    // because it lands in logs and an unbounded provider string does not
    // belong there unbounded.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `SendGrid refused the message (${response.status}): ${detail.slice(0, 300) || "no body"}`,
    );
  },
};
