import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { contentSecurityPolicy, securityHeaders } from "../lib/security/headers";
import { allowedOriginsFor, checkCsrf, isCsrfExempt } from "../lib/security/csrf";
import { escapeHtml, jsonForScript } from "../lib/security/escape";
import { missingRequired, redact, scrub, secret, secretsReport } from "../lib/security/vault";

/**
 * P13 — security.
 *
 * Almost nothing here shows up in a build, a typecheck or a screenshot, which
 * is exactly why it is worth pinning. A CSP that is one directive too tight
 * breaks a page in a way only a visitor sees; one directive too loose breaks
 * nothing at all and protects nothing either.
 */

type Mode = "production" | "development";

/**
 * Both helpers default to the PRODUCTION policy, because that is the one that
 * ships. A test run is by definition not production, so asserting whatever the
 * ambient NODE_ENV happens to produce would only ever check the development
 * relaxations — the form of the policy no visitor is ever served.
 */
function headerMap(mode: Mode = "production"): Map<string, string> {
  return new Map(securityHeaders(mode).map((header) => [header.key.toLowerCase(), header.value]));
}

function csp(mode: Mode = "production"): Map<string, string> {
  return new Map(
    contentSecurityPolicy(mode)
      .split(";")
      .map((directive) => {
        const [name, ...values] = directive.trim().split(/\s+/);
        return [name, values.join(" ")];
      }),
  );
}

describe("security headers", () => {
  it("ships the full set", () => {
    const headers = headerMap();
    for (const key of [
      "content-security-policy",
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "permissions-policy",
      "cross-origin-opener-policy",
    ]) {
      expect(headers.has(key), `${key} is missing`).toBe(true);
    }
  });

  it("refuses to be framed, in both the old and the new spelling", () => {
    // Some browsers honour only one of the two.
    expect(headerMap().get("x-frame-options")).toBe("DENY");
    expect(csp().get("frame-ancestors")).toBe("'none'");
  });

  it("sends HSTS in production and never outside it", () => {
    // A browser told once to pin localhost to HTTPS keeps refusing plain http
    // for the whole max-age, and nothing server-side can undo that.
    expect(headerMap("production").get("strict-transport-security")).toContain("max-age=63072000");
    expect(headerMap("development").has("strict-transport-security")).toBe(false);
  });

  it("upgrades insecure requests in production only", () => {
    expect(contentSecurityPolicy("production")).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("development")).not.toContain("upgrade-insecure-requests");
  });
});

describe("the content security policy", () => {
  it("blocks exfiltration even though inline script is allowed", () => {
    const connectSrc = (csp().get("connect-src") ?? "").split(" ");

    // 'unsafe-inline' is unavoidable — the App Router inlines the RSC payload
    // into every page — so the directive carrying the weight is this one: an
    // injected inline script has almost nowhere to send what it steals.
    expect(connectSrc).toContain("'self'");
    expect(csp().get("default-src")).toBe("'self'");

    // P16 opened exactly the model repositories the in-browser model fetches
    // weights from, and nothing else. Asserted as an allowlist rather than a
    // count, so a future addition has to be named here to pass — which is the
    // point of pinning it at all.
    const allowed = new Set([
      "'self'",
      "https://huggingface.co",
      "https://cdn-lfs.huggingface.co",
      "https://cdn-lfs-us-1.hf.co",
      "https://raw.githubusercontent.com",
    ]);
    expect(connectSrc.filter((origin) => !allowed.has(origin))).toEqual([]);
  });

  it("adds only the websocket relaxation in development", () => {
    const development = csp("development").get("connect-src") ?? "";
    expect(development).toContain("ws:");
    expect(development).toContain("http://localhost:*");
    expect(csp("production").get("connect-src")).not.toContain("ws:");
  });

  it("permits WebAssembly compilation without permitting eval", () => {
    // 'wasm-unsafe-eval' allows compiling WebAssembly and nothing else — no
    // eval, no Function constructor, no string-to-JavaScript path. That
    // distinction is the whole reason the directive exists separately, and why
    // enabling it for the local model does not give back what 'unsafe-eval'
    // would.
    const scriptSrc = csp("production").get("script-src") ?? "";
    expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("lets the model run in a blob worker", () => {
    expect(csp().get("worker-src")).toBe("'self' blob:");
  });

  it("still refuses third-party script sources", () => {
    const scriptSrc = csp().get("script-src") ?? "";
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toMatch(/https?:\/\//);
    // No eval outside development.
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("serves fonts from our own origin only", () => {
    // True since P12 vendored them. It was not true before.
    expect(csp().get("font-src")).toBe("'self'");
  });

  it("permits the résumé object and the map frame, and nothing else", () => {
    // object-src 'none' would break the /resume preview, which the handoff
    // requires to point at the file directly.
    expect(csp().get("object-src")).toBe("'self'");
    expect(csp().get("frame-src")).toBe("'self' https://www.openstreetmap.org");
  });

  it("pins base-uri and form-action", () => {
    expect(csp().get("base-uri")).toBe("'none'");
    expect(csp().get("form-action")).toBe("'self'");
  });

  it("allows exactly the image hosts next.config.ts optimises", () => {
    // If these two lists drift apart, avatars either 404 or get blocked.
    const imgSrc = csp().get("img-src") ?? "";
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    for (const host of ["lh3.googleusercontent.com", "avatars.githubusercontent.com"]) {
      expect(imgSrc).toContain(host);
      expect(config).toContain(host);
    }
  });
});

describe("CSRF", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);
  const origins = ["https://www.shivamsfolio.com"];

  it("lets safe methods through untouched", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const verdict = checkCsrf(
        { method, headers: headers({ "sec-fetch-site": "cross-site" }), url: "https://x/api/a" },
        origins,
      );
      expect(verdict.ok, method).toBe(true);
    }
  });

  it("blocks a cross-site POST", () => {
    const verdict = checkCsrf(
      {
        method: "POST",
        headers: headers({ "sec-fetch-site": "cross-site" }),
        url: "https://www.shivamsfolio.com/api/account/password",
      },
      origins,
    );
    expect(verdict.ok).toBe(false);
  });

  it("blocks a same-site POST from a sibling subdomain", () => {
    // The gap SameSite=Lax leaves open.
    const verdict = checkCsrf(
      {
        method: "POST",
        headers: headers({ "sec-fetch-site": "same-site" }),
        url: "https://www.shivamsfolio.com/api/contact",
      },
      origins,
    );
    expect(verdict.ok).toBe(false);
  });

  it("allows a same-origin POST", () => {
    expect(
      checkCsrf(
        {
          method: "POST",
          headers: headers({ "sec-fetch-site": "same-origin" }),
          url: "https://www.shivamsfolio.com/api/contact",
        },
        origins,
      ).ok,
    ).toBe(true);
  });

  it("falls back to Origin when Sec-Fetch-Site is absent", () => {
    expect(
      checkCsrf(
        {
          method: "POST",
          headers: headers({ origin: "https://evil.example" }),
          url: "https://www.shivamsfolio.com/api/contact",
        },
        origins,
      ).ok,
    ).toBe(false);
    expect(
      checkCsrf(
        {
          method: "POST",
          headers: headers({ origin: "https://www.shivamsfolio.com" }),
          url: "https://www.shivamsfolio.com/api/contact",
        },
        origins,
      ).ok,
    ).toBe(true);
  });

  it("allows a request with neither header", () => {
    // curl, a health check, a server-to-server call. None of them carry an
    // ambient cookie, so none of them can be CSRF'd — refusing would break
    // legitimate tooling and close nothing.
    expect(
      checkCsrf(
        { method: "POST", headers: headers({}), url: "https://www.shivamsfolio.com/api/contact" },
        origins,
      ).ok,
    ).toBe(true);
  });

  it("exempts webhooks and the auth routes, and nothing else", () => {
    // Webhooks authenticate with a signature over the raw body, which is
    // stronger than any header check; Auth.js runs its own CSRF flow and its
    // OAuth callback is legitimately a cross-site navigation.
    expect(isCsrfExempt("/api/webhooks/razorpay")).toBe(true);
    expect(isCsrfExempt("/api/auth/callback/google")).toBe(true);
    expect(isCsrfExempt("/api/contact")).toBe(false);
    expect(isCsrfExempt("/api/account/password")).toBe(false);
    // Not a prefix match on a lookalike path.
    expect(isCsrfExempt("/api/webhooks-fake/x")).toBe(false);
  });

  it("trusts the forwarded host, so preview deploys keep working", () => {
    const origins = allowedOriginsFor({
      url: "https://internal.local/api/contact",
      headers: headers({ "x-forwarded-host": "preview-abc.vercel.app", "x-forwarded-proto": "https" }),
    });
    expect(origins).toContain("https://preview-abc.vercel.app");
  });
});

describe("no raw SQL escape hatches", () => {
  /** Every .ts/.tsx file we author, excluding generated output. */
  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".next", "generated", ".git"].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, found);
      else if (/\.tsx?$/.test(entry)) found.push(full);
    }
    return found;
  }

  it("never uses $queryRawUnsafe or $executeRawUnsafe", () => {
    // Prisma parameterises `$queryRaw` when it is used as a tagged template;
    // the Unsafe variants take a string and interpolate nothing, which is
    // precisely how a raw query becomes an injection. There is one raw query
    // in this codebase today (lib/search.ts) and P16 adds more, so this is a
    // guard that gets more valuable, not less.
    const offenders: string[] = [];
    for (const file of sourceFiles(process.cwd())) {
      const text = readFileSync(file, "utf8");
      if (/\$(?:query|execute)RawUnsafe/.test(text) && !file.includes("tests")) {
        offenders.push(file.replace(process.cwd(), ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("calls $queryRaw as a tagged template, never with a built string", () => {
    // `prisma.$queryRaw(someString)` compiles and is an injection; only the
    // tagged-template form parameterises.
    const offenders: string[] = [];
    for (const file of sourceFiles(process.cwd())) {
      if (file.includes("tests")) continue;
      const text = readFileSync(file, "utf8");
      // A call form: $queryRaw( ... ) where the argument is not Prisma.sql`…`
      for (const match of text.matchAll(/\$(?:query|execute)Raw(?:<[^>]*>)?\(\s*(\w+)/g)) {
        if (match[1] !== "Prisma") offenders.push(`${file.replace(process.cwd(), "")}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("escaping", () => {
  it("stops a JSON payload from ending its own script element", () => {
    // Valid JSON, and still an HTML injection: the parser ends <script> at the
    // literal characters "</script" regardless of what the JSON means.
    const payload = { bio: '</script><img src=x onerror=alert(1)>' };
    expect(JSON.stringify(payload)).toContain("</script>");
    expect(jsonForScript(payload)).not.toContain("</script>");
    expect(jsonForScript(payload)).toContain("\\u003c");
    // Still parses back to the original value.
    expect(JSON.parse(jsonForScript(payload))).toEqual(payload);
  });

  it("escapes the JS-illegal line separators JSON permits", () => {
    const ls = String.fromCharCode(0x2028);
    const ps = String.fromCharCode(0x2029);
    const encoded = jsonForScript({ a: ls + ps });

    // The property that matters is that no RAW separator survives into the
    // script element — each one would be a line terminator to the JS parser
    // and would turn the payload into a syntax error.
    expect(encoded.includes(ls)).toBe(false);
    expect(encoded.includes(ps)).toBe(false);
    // And the value still round-trips.
    expect(JSON.parse(encoded).a).toBe(ls + ps);
  });
  it("escapes the five HTML metacharacters, ampersand first", () => {
    // Ampersand must be replaced first or the other replacements get
    // double-escaped.
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("the vault", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("reads a plain env var", () => {
    process.env.GITHUB_TOKEN = "ghp_example_value_1234";
    expect(secret("GITHUB_TOKEN")).toBe("ghp_example_value_1234");
  });

  it("treats an empty string as unset", () => {
    // A blank value in a dashboard is how "configured" and "working" diverge.
    process.env.GITHUB_TOKEN = "";
    expect(secret("GITHUB_TOKEN")).toBeUndefined();
  });

  it("never reveals a value in the report", () => {
    process.env.AUTH_SECRET = "a-very-real-looking-secret-value";
    const report = secretsReport();
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain("a-very-real-looking-secret-value");
    expect(report.find((entry) => entry.name === "AUTH_SECRET")?.present).toBe(true);
    expect(report.find((entry) => entry.name === "AUTH_SECRET")?.source).toBe("env");
  });

  it("says what each missing secret disables", () => {
    delete process.env.RESEND_API_KEY;
    const entry = secretsReport().find((row) => row.name === "RESEND_API_KEY");
    expect(entry?.present).toBe(false);
    // Every integration here degrades rather than throws, which is right and
    // also means a missing key is otherwise completely silent.
    expect(entry?.disables).toContain("email");
  });

  it("reports missing required secrets and ignores optional ones", () => {
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_TOKEN;
    expect(missingRequired()).toContain("DATABASE_URL");
    expect(missingRequired()).not.toContain("GITHUB_TOKEN");
  });

  it("redacts short values completely and long ones partially", () => {
    expect(redact(undefined)).toBe("(unset)");
    expect(redact("short")).toBe("••••••••");
    expect(redact("abcdefghijklmnop")).toBe("ab…op (16 chars)");
  });

  it("scrubs known secret values out of text bound for a log", () => {
    process.env.DATABASE_URL = "postgresql://user:hunter2@db.example/neondb";
    const message = `connect failed: postgresql://user:hunter2@db.example/neondb timed out`;
    expect(scrub(message)).not.toContain("hunter2");
    expect(scrub(message)).toContain("[redacted:DATABASE_URL]");
  });

  it("does not scrub values too short to be distinctive", () => {
    // Replacing a 6-character secret everywhere it appears would mangle
    // unrelated output far more often than it would protect anything.
    process.env.CRON_SECRET = "abc123";
    expect(scrub("the abc123 in this sentence")).toBe("the abc123 in this sentence");
  });
});
