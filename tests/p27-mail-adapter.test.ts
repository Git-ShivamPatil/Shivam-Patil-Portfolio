import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseFrom, sendgridAdapter } from "../lib/email/sendgrid-adapter";
import { availableMailProviders, mailAdapter, sendMail } from "../lib/email";

/**
 * P27 — the mail provider adapter.
 *
 * §56i is why this exists: Resend requires an MX record on a `send` subdomain,
 * Wix cannot create one, and Resend's own dashboard names Wix as unable to
 * verify. SendGrid's Automated Security authenticates on CNAME alone, so it is
 * the provider this domain can actually verify.
 *
 * Two things are worth defending with tests, because both fail silently:
 *
 * - **`EMAIL_FROM` parsing.** Resend accepts `Name <a@b>` as one string;
 *   SendGrid rejects it and wants `{ email, name }`. One environment variable
 *   feeds both, so a parsing bug means every message is refused with a 400 that
 *   only shows up in production.
 * - **Provider precedence.** Adding a SendGrid key is meant to be the entire
 *   switch. If the fallback order inverts, mail keeps going out through the
 *   provider that cannot be verified, and the symptom is spam placement —
 *   which looks identical to the problem this was supposed to fix.
 */

const ENV = { ...process.env };

beforeEach(() => {
  delete process.env.SENDGRID_API_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_PROVIDER;
});

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseFrom", () => {
  it("splits the RFC 5322 combined form", () => {
    expect(parseFrom("Shivam Patil <shivam@shivamsfolio.com>")).toEqual({
      email: "shivam@shivamsfolio.com",
      name: "Shivam Patil",
    });
  });

  it("passes a bare address through unchanged", () => {
    expect(parseFrom("shivam@shivamsfolio.com")).toEqual({ email: "shivam@shivamsfolio.com" });
  });

  it("strips quotes around a display name", () => {
    // `"Patil, Shivam" <a@b>` is legal and common — the quotes are required
    // there because of the comma, and passing them through puts literal
    // quote marks in the recipient's From line.
    expect(parseFrom('"Patil, Shivam" <a@b.com>')).toEqual({
      email: "a@b.com",
      name: "Patil, Shivam",
    });
  });

  it("tolerates surrounding and interior whitespace", () => {
    expect(parseFrom("  Shivam   < a@b.com >  ")).toEqual({ email: "a@b.com", name: "Shivam" });
  });

  it("omits the name rather than sending an empty one", () => {
    // SendGrid rejects `name: ""`. Omitting the key is the difference between
    // a delivered message and a 400.
    expect(parseFrom("<a@b.com>")).toEqual({ email: "a@b.com" });
    expect(parseFrom("<a@b.com>")).not.toHaveProperty("name");
  });

  it("never leaves angle brackets in the address", () => {
    // The failure this pins: a regex that captures the brackets produces an
    // address SendGrid refuses, and the refusal names the field but not why.
    for (const input of ["A <a@b.com>", "a@b.com", '"X" <x@y.z>', "  <q@r.s>  "]) {
      expect(parseFrom(input).email).not.toMatch(/[<>]/);
      expect(parseFrom(input).email.trim()).toBe(parseFrom(input).email);
    }
  });
});

describe("provider selection", () => {
  it("reports nothing available when no key is set", () => {
    expect(availableMailProviders()).toEqual([]);
    expect(mailAdapter()).toBeNull();
  });

  it("prefers SendGrid when both are configured", () => {
    // The whole point of the switch: adding a SendGrid key changes the
    // provider with no code change. If this inverts, mail keeps going out
    // through the one that cannot be domain-verified on this DNS.
    process.env.RESEND_API_KEY = "re_x";
    process.env.SENDGRID_API_KEY = "SG.x";
    expect(mailAdapter()?.name).toBe("SENDGRID");
  });

  it("falls back to Resend when only Resend is configured", () => {
    process.env.RESEND_API_KEY = "re_x";
    expect(mailAdapter()?.name).toBe("RESEND");
  });

  it("honours an explicit MAIL_PROVIDER override", () => {
    // This is the rollback path. If SendGrid misbehaves, setting this to
    // RESEND restores the previous behaviour without a deploy.
    process.env.RESEND_API_KEY = "re_x";
    process.env.SENDGRID_API_KEY = "SG.x";
    process.env.MAIL_PROVIDER = "RESEND";
    expect(mailAdapter()?.name).toBe("RESEND");
  });

  it("refuses to send when MAIL_PROVIDER names an unconfigured provider", () => {
    // Deliberately does NOT fall through to the other provider. Mail arriving
    // from an unexpected sender is harder to diagnose than mail not arriving.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.RESEND_API_KEY = "re_x";
    process.env.MAIL_PROVIDER = "SENDGRID";
    expect(mailAdapter()).toBeNull();
  });

  it("ignores an unrecognised MAIL_PROVIDER rather than crashing", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.MAIL_PROVIDER = "mailgun";
    expect(mailAdapter()?.name).toBe("RESEND");
  });
});

describe("sendMail", () => {
  it("returns false rather than throwing when nothing is configured", async () => {
    // The degraded path. Callers log what they would have sent -- including
    // the reset link a developer needs -- and continue.
    await expect(
      sendMail({ to: "a@b.com", subject: "s", html: "<p>h</p>" }, "x@y.z"),
    ).resolves.toBe(false);
  });
});

describe("sendgridAdapter.send", () => {
  function mockFetch(status: number, body = "") {
    const fetchMock = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the SendGrid v3 shape", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    const fetchMock = mockFetch(202);

    await sendgridAdapter.send(
      { to: "a@b.com", subject: "Hello", html: "<p>hi</p>", replyTo: "r@s.t" },
      "Shivam Patil <shivam@shivamsfolio.com>",
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");

    const body = JSON.parse(init.body as string);
    expect(body.from).toEqual({ email: "shivam@shivamsfolio.com", name: "Shivam Patil" });
    expect(body.personalizations[0].to).toEqual([{ email: "a@b.com" }]);
    // snake_case: SendGrid silently ignores an unknown `replyTo`, so a
    // camelCase slip would drop the reply address with no error at all.
    expect(body.reply_to).toEqual({ email: "r@s.t" });
    expect(body.content).toEqual([{ type: "text/html", value: "<p>hi</p>" }]);
  });

  it("treats 202 Accepted as success", async () => {
    // SendGrid queues rather than delivering synchronously. 202 is the normal
    // success code and an `ok`-only check that assumed 200 would reject it.
    process.env.SENDGRID_API_KEY = "SG.test";
    mockFetch(202);
    await expect(
      sendgridAdapter.send({ to: "a@b.com", subject: "s", html: "<p>h</p>" }, "x@y.z"),
    ).resolves.toBeUndefined();
  });

  it("puts custom headers on the personalization, not the top level", async () => {
    // RFC 8058 one-click unsubscribe, which Gmail and Yahoo require on bulk
    // mail. SendGrid's top-level `headers` field means something different,
    // so putting them there is a silent no-op.
    process.env.SENDGRID_API_KEY = "SG.test";
    const fetchMock = mockFetch(202);

    await sendgridAdapter.send(
      {
        to: "a@b.com",
        subject: "s",
        html: "<p>h</p>",
        headers: { "List-Unsubscribe": "<https://x/y>" },
      },
      "x@y.z",
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.personalizations[0].headers).toEqual({ "List-Unsubscribe": "<https://x/y>" });
  });

  it("omits reply_to entirely when there is no reply address", async () => {
    // `reply_to: undefined` serialises away, but `reply_to: {}` does not and
    // SendGrid rejects it.
    process.env.SENDGRID_API_KEY = "SG.test";
    const fetchMock = mockFetch(202);
    await sendgridAdapter.send({ to: "a@b.com", subject: "s", html: "<p>h</p>" }, "x@y.z");

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body).not.toHaveProperty("reply_to");
  });

  it("throws with the provider's own error detail", async () => {
    // The body names the offending field. Without it this is "SendGrid
    // returned 400", which is not debuggable.
    process.env.SENDGRID_API_KEY = "SG.test";
    mockFetch(400, JSON.stringify({ errors: [{ field: "from.email", message: "invalid" }] }));

    await expect(
      sendgridAdapter.send({ to: "a@b.com", subject: "s", html: "<p>h</p>" }, "bad"),
    ).rejects.toThrow(/400.*from\.email/s);
  });

  it("throws rather than silently no-opping when the key is missing", async () => {
    await expect(
      sendgridAdapter.send({ to: "a@b.com", subject: "s", html: "<p>h</p>" }, "x@y.z"),
    ).rejects.toThrow(/SENDGRID_API_KEY/);
  });

  it("reports unconfigured until the key exists", () => {
    expect(sendgridAdapter.isConfigured()).toBe(false);
    process.env.SENDGRID_API_KEY = "SG.test";
    expect(sendgridAdapter.isConfigured()).toBe(true);
  });
});
