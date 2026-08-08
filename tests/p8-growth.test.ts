import { describe, it, expect, vi } from "vitest";

// links.ts imports lib/prisma at module scope for the DB-backed helpers.
// The pure functions under test here don't touch it, but the import must
// still resolve without a database.
vi.mock("../lib/prisma", () => ({ prisma: {} }));

const { buildDestination, deviceFrom, visitorHashFor, isValidCode, generateCode } =
  await import("../lib/growth/links");
const { renderQrSvg } = await import("../lib/growth/qr");

/**
 * P8 — growth: short links, attribution, and QR rendering.
 *
 * The link tests concentrate on the redirect's contract, because that is the
 * one piece with a visitor on the other side of it: a wrong `ref` silently
 * breaks attribution, and a permissive destination turns our domain into an
 * open redirect.
 */
describe("buildDestination", () => {
  const origin = "https://shivamsfolio.com";

  it("resolves a relative destination and tags it", () => {
    expect(buildDestination("/services", "abc123", origin)).toBe(
      "https://shivamsfolio.com/services?ref=abc123",
    );
  });

  it("preserves an existing query string", () => {
    const result = new URL(buildDestination("/services?plan=pro", "abc123", origin));
    expect(result.searchParams.get("plan")).toBe("pro");
    expect(result.searchParams.get("ref")).toBe("abc123");
  });

  it("does not overwrite a ref the destination already carries", () => {
    // A hand-written destination with its own ref is a deliberate choice —
    // clobbering it would silently re-attribute someone else's campaign.
    const result = new URL(buildDestination("/services?ref=partner", "abc123", origin));
    expect(result.searchParams.get("ref")).toBe("partner");
  });

  it("keeps absolute destinations on their own origin", () => {
    const result = new URL(buildDestination("https://github.com/x", "abc123", origin));
    expect(result.hostname).toBe("github.com");
    expect(result.searchParams.get("ref")).toBe("abc123");
  });

  it("always returns a usable URL, whatever is stored in the row", () => {
    // The redirect handler has a visitor waiting on it, so the contract is
    // "never throw" rather than "handle these known inputs". Most of these
    // actually resolve against the base rather than failing — the point is
    // that the caller cannot tell the difference and never sees an exception.
    const hostile = ["", ":", "///", "http://", "not a url", "\\\\evil.com", "%%%"];
    for (const destination of hostile) {
      const result = buildDestination(destination, "abc123", origin);
      expect(() => new URL(result)).not.toThrow();
      expect(new URL(result).searchParams.get("ref")).toBe("abc123");
    }
  });

  it("keeps a relative-looking destination on our origin even with a tab, CR or LF", () => {
    // The WHATWG URL parser strips those three characters BEFORE parsing, so
    // "/\t/evil.com" does not start with "//" as far as String.startsWith is
    // concerned — it sails past a naive relative-path check and then resolves
    // to https://evil.com/. That was a live bypass in the first cut of this
    // function, not a hypothetical, which is why the protocol-relative test
    // has to happen AFTER stripping rather than on the raw string.
    for (const hostile of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\t\t//evil.com"]) {
      const result = new URL(buildDestination(hostile, "abc123", origin));
      expect(result.host).toBe("shivamsfolio.com");
    }
  });

  it("still allows a genuine off-site absolute destination", () => {
    // Linking out to GitHub or LinkedIn is the feature, not the bug — the
    // guard above must not be so broad that it breaks it. A destination is
    // only forced home when it *looks* relative but resolves elsewhere.
    expect(new URL(buildDestination("https://github.com/x", "abc123", origin)).host).toBe(
      "github.com",
    );
  });

  it("refuses to emit a non-http(s) scheme even if one is stored", () => {
    // A row written before the validation rule existed must not be handed to
    // a browser as javascript:/data:.
    for (const scheme of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"]) {
      const result = new URL(buildDestination(scheme, "abc123", origin));
      expect(["https:", "http:"]).toContain(result.protocol);
      expect(result.host).toBe("shivamsfolio.com");
    }
  });

  it("keeps a blank destination on our own origin", () => {
    // An empty string resolves to the base URL, not to somewhere else — this
    // pins that a half-filled row can't become an off-site redirect.
    expect(new URL(buildDestination("", "abc123", origin)).origin).toBe(origin);
  });
});

describe("isValidCode", () => {
  it("accepts ordinary codes", () => {
    expect(isValidCode("abc123")).toBe(true);
    expect(isValidCode("linkedin-bio")).toBe(true);
  });

  it("rejects reserved words that would shadow a route", () => {
    expect(isValidCode("api")).toBe(false);
    expect(isValidCode("admin")).toBe(false);
  });

  it("rejects uppercase, single characters, and path traversal", () => {
    expect(isValidCode("ABC")).toBe(false);
    expect(isValidCode("a")).toBe(false);
    expect(isValidCode("../etc")).toBe(false);
  });
});

describe("generateCode", () => {
  it("avoids visually ambiguous characters", () => {
    // Codes get scanned back out of a QR and read aloud, so 0/O and 1/l/I
    // must never appear.
    const sample = Array.from({ length: 60 }, () => generateCode()).join("");
    expect(sample).not.toMatch(/[01lIO]/);
    expect(sample).toMatch(/^[a-z2-9]+$/);
  });

  it("returns the requested length", () => {
    expect(generateCode(10)).toHaveLength(10);
  });
});

describe("deviceFrom", () => {
  it("classifies the common cases", () => {
    expect(deviceFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe("mobile");
    expect(deviceFrom("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBe("tablet");
    expect(deviceFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
    expect(deviceFrom("")).toBe("unknown");
  });

  it("classifies link-preview fetchers as bots, not people", () => {
    // These inflate click counts if counted as visitors — WhatsApp fetches a
    // preview the moment a link is pasted, before anyone taps it.
    expect(deviceFrom("WhatsApp/2.23")).toBe("bot");
    expect(deviceFrom("facebookexternalhit/1.1")).toBe("bot");
    expect(deviceFrom("Googlebot/2.1")).toBe("bot");
  });

  it("checks bot before mobile — a bot UA often also says Android", () => {
    expect(deviceFrom("Mozilla/5.0 (Linux; Android 10) WhatsApp/2.23")).toBe("bot");
  });
});

describe("visitorHashFor", () => {
  const day = new Date("2026-08-08T12:00:00Z");

  it("is stable for the same visitor within a day", () => {
    expect(visitorHashFor("1.2.3.4", "UA", day)).toBe(visitorHashFor("1.2.3.4", "UA", day));
  });

  it("separates different visitors", () => {
    expect(visitorHashFor("1.2.3.4", "UA", day)).not.toBe(visitorHashFor("5.6.7.8", "UA", day));
  });

  it("rotates daily, so yesterday cannot be joined to today", () => {
    // This is the property that keeps it a counter rather than a tracker.
    const nextDay = new Date("2026-08-09T12:00:00Z");
    expect(visitorHashFor("1.2.3.4", "UA", day)).not.toBe(visitorHashFor("1.2.3.4", "UA", nextDay));
  });

  it("never contains the raw address", () => {
    expect(visitorHashFor("1.2.3.4", "UA", day)).not.toContain("1.2.3.4");
  });
});

describe("renderQrSvg", () => {
  it("produces a square SVG with a viewBox matching modules plus quiet zone", () => {
    const svg = renderQrSvg("https://shivamsfolio.com/r/abc123");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');

    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(viewBox).not.toBeNull();
    expect(viewBox![1]).toBe(viewBox![2]);
    // Smallest QR is 21 modules; +8 for the mandatory 4-module quiet zone.
    expect(Number(viewBox![1])).toBeGreaterThanOrEqual(29);
  });

  it("always emits three finder patterns", () => {
    // Scanners lock onto these first — if styling ever drops one, the code
    // becomes unreadable while still looking plausible.
    const svg = renderQrSvg("hello");
    expect(svg.match(/stroke-width="1"/g)?.length).toBe(3);
  });

  it("never renders a quiet zone below the spec's 4-module minimum", () => {
    const svg = renderQrSvg("hello", { margin: 0 });
    const viewBox = Number(svg.match(/viewBox="0 0 (\d+)/)![1]);
    const plain = Number(renderQrSvg("hello").match(/viewBox="0 0 (\d+)/)![1]);
    expect(viewBox).toBe(plain);
  });

  it("grows the matrix as the payload grows", () => {
    const small = Number(renderQrSvg("hi").match(/viewBox="0 0 (\d+)/)![1]);
    const large = Number(renderQrSvg("x".repeat(400)).match(/viewBox="0 0 (\d+)/)![1]);
    expect(large).toBeGreaterThan(small);
  });

  it("escapes the logo text rather than interpolating markup", () => {
    const svg = renderQrSvg("hello", { logoText: "<>" });
    expect(svg).toContain("&lt;&gt;");
    expect(svg).not.toContain("<text><>");
  });

  it("switches module shape without touching the matrix", () => {
    expect(renderQrSvg("hello", { style: "dots" })).toContain("<circle");
    expect(renderQrSvg("hello", { style: "squares" })).not.toContain('<circle cx="');
  });

  it("emits a gradient only when an accent is given", () => {
    expect(renderQrSvg("hello", { accent: "#7fb800" })).toContain("linearGradient");
    expect(renderQrSvg("hello")).not.toContain("linearGradient");
  });

  it("encodes non-ASCII as UTF-8, not Latin-1", async () => {
    const { toUtf8ByteString } = await import("../lib/growth/qr");
    const qrcode = (await import("qrcode-generator")).default;

    // The encoder is Latin-1: charCodeAt(i) & 0xff. Feeding it the raw string
    // silently maps U+4E2D to 0x2D ('-') — a valid, scannable QR that decodes
    // to the wrong text, with no exception and nothing visibly wrong.
    expect(qrcode.stringToBytes("café 中")).toEqual([99, 97, 102, 233, 32, 45]);

    // Pre-encoding makes that same Latin-1 pass emit the real UTF-8 bytes.
    const bytes = qrcode.stringToBytes(toUtf8ByteString("café 中"));
    expect(Buffer.from(bytes).toString("utf8")).toBe("café 中");
  });

  it("round-trips emoji and CJK through the byte encoding", async () => {
    const { toUtf8ByteString } = await import("../lib/growth/qr");
    for (const value of ["café", "中文", "🚀 ship", "Ω≈ç√"]) {
      const bytes = Uint8Array.from(toUtf8ByteString(value), (c) => c.charCodeAt(0));
      expect(Buffer.from(bytes).toString("utf8")).toBe(value);
    }
  });

  it("leaves pure ASCII byte-identical", async () => {
    const { toUtf8ByteString } = await import("../lib/growth/qr");
    const ascii = "https://shivamsfolio.com/r/abc123";
    expect(toUtf8ByteString(ascii)).toBe(ascii);
  });

  it("stays small enough that one request cannot be an amplifier", () => {
    // Output grows fast with payload length at error correction level H, and
    // /api/qr is anonymous with an attacker-controlled cache key — so the
    // route's 200-character cap is a cost control, not a cosmetic limit.
    // Measured: 200 chars -> ~151KB, versus ~590KB at the original 900.
    const atCap = renderQrSvg("https://shivamsfolio.com/?q=" + "a".repeat(172));
    expect(atCap.length).toBeLessThan(160_000);

    // A realistic short link — the only payload this endpoint actually serves.
    expect(renderQrSvg("https://shivamsfolio.com/r/abc1234").length).toBeLessThan(40_000);
  });
});

/**
 * The check that actually decides whether these codes scan.
 *
 * Everything above tests the SVG's shape; this reconstructs the module matrix
 * back out of the rendered markup and compares it, module by module, against
 * the encoder's own. Styling is allowed to change how a module is *painted* —
 * never whether it is set. A single dropped module in the wrong place is
 * invisible to the eye and fatal to a scanner, and it is exactly the failure
 * a "looks fine to me" review misses.
 */
describe("renderQrSvg matrix fidelity", () => {
  const DATA = "https://shivamsfolio.com/r/test01";
  const QUIET = 4;

  /** Canonical finder pattern: dark outer ring, light gap, dark 3×3 core. */
  const isFinderModule = (row: number, col: number) =>
    row === 0 ||
    row === 6 ||
    col === 0 ||
    col === 6 ||
    (row >= 2 && row <= 4 && col >= 2 && col <= 4);

  function paintedModules(svg: string, style: "dots" | "squares", count: number): Set<string> {
    const painted = new Set<string>();

    if (style === "dots") {
      for (const match of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="0\.46"/g)) {
        painted.add(`${Math.floor(+match[2] - QUIET)},${Math.floor(+match[1] - QUIET)}`);
      }
    } else {
      for (const match of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"/g)) {
        painted.add(`${+match[2] - QUIET},${+match[1] - QUIET}`);
      }
    }

    // Finders are drawn as continuous frames rather than per-module, so their
    // modules are added back from the canonical layout.
    for (const [fc, fr] of [
      [0, 0],
      [count - 7, 0],
      [0, count - 7],
    ]) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
          if (isFinderModule(row, col)) painted.add(`${fr + row},${fc + col}`);
        }
      }
    }
    return painted;
  }

  it.each(["dots", "squares"] as const)(
    "reproduces the encoder's matrix exactly in %s style",
    async (style) => {
      const qrcode = (await import("qrcode-generator")).default;
      const qr = qrcode(0, "H");
      qr.addData(DATA);
      qr.make();
      const count = qr.getModuleCount();

      const painted = paintedModules(renderQrSvg(DATA, { style }), style, count);

      const missing: string[] = [];
      const extra: string[] = [];
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          const dark = qr.isDark(row, col);
          const drawn = painted.has(`${row},${col}`);
          if (dark && !drawn) missing.push(`${row},${col}`);
          if (!dark && drawn) extra.push(`${row},${col}`);
        }
      }

      expect({ missing: missing.slice(0, 5), extra: extra.slice(0, 5) }).toEqual({
        missing: [],
        extra: [],
      });
    },
  );

  it("keeps the logo cut-out inside error correction level H's budget", async () => {
    // Level H recovers ~30% of the symbol. The cut-out must stay well under
    // that or the code stops being readable once anything else degrades it —
    // a fold, a reflection, a low-res camera.
    const qrcode = (await import("qrcode-generator")).default;
    const qr = qrcode(0, "H");
    qr.addData(DATA);
    qr.make();
    const count = qr.getModuleCount();

    // Mirrors the box sizing in renderQrSvg.
    const box = Math.max(5, Math.round(count * 0.22));
    expect((box * box) / (count * count)).toBeLessThan(0.1);
  });
});
