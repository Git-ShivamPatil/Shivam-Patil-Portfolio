import { NextResponse } from "next/server";
import { renderQrSvg, type QrStyle } from "../../../lib/growth/qr";
import { clientIp, takeToken } from "../../../lib/rate-limit";

export const runtime = "nodejs";

/**
 * P8 — dynamic QR endpoint: `/api/qr?data=…`.
 *
 * Public, but deliberately *not* a general-purpose QR minter. Two constraints
 * below exist because this is an anonymous compute endpoint on a metered
 * account:
 *
 * 1. `data` must point at this site. The only caller is the admin link
 *    manager, rendering codes for our own /r/ short links. Left open, anyone
 *    could mint a QR for their own payment page, served from this domain with
 *    this site's logo cut-out and pinned in the edge cache for a day — the
 *    image and its URL would both borrow the site's reputation. Restricting
 *    the payload costs nothing we use and removes that entirely.
 *
 * 2. Length is capped hard. Cost here is quadratic in payload: at error
 *    correction level H a 900-character payload picks a ~153-module matrix,
 *    which is ~11,700 `<circle>` elements and well over half a megabyte of
 *    SVG per request. `size` does not bound this — it only sets the width and
 *    height attributes on a viewBox, so it changes the display size and not
 *    one byte of the work. The Cache-Control below does not bound it either:
 *    the CDN key is the full URL, so appending a counter to ?data= misses the
 *    cache every time and reaches the function every time.
 */

/**
 * Enough for an absolute URL to any page on this site, and no more.
 *
 * Measured output at level H: 100 chars -> 81KB, 200 -> 151KB, 300 -> 204KB,
 * and the original 900-char ceiling -> ~590KB. A real payload here is a short
 * link (~35 chars, under 30KB), so 200 is already generous.
 */
const MAX_DATA_LENGTH = 200;

// Hex, rgb()/rgba(), or a bare CSS keyword. Everything else is dropped rather
// than escaped: these values land inside SVG attributes, and an allowlist is
// the only honest way to keep `fill="…"` from becoming an injection point.
const COLOUR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%/]+\)|[a-zA-Z]{3,20})$/;

function colour(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return COLOUR_PATTERN.test(value) ? value : fallback;
}

/**
 * True when `value` addresses this site — either a relative path or an
 * absolute URL on our own origin.
 */
function isOwnDestination(value: string, allowedHosts: string[]): boolean {
  try {
    // Same trick the redirect guard uses: the URL parser strips tab/CR/LF, so
    // strip them first and validate what will actually be parsed.
    const cleaned = value.replace(/[\t\r\n]/g, "");
    if (cleaned.startsWith("//") || cleaned.startsWith("/\\")) return false;
    // Resolved against the first allowed host so a bare path stays valid.
    const url = new URL(cleaned, `https://${allowedHosts[0]}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return allowedHosts.includes(url.host);
  } catch {
    return false;
  }
}

/**
 * Both the configured public origin and the host actually serving this
 * request count as "ours". Checking only the former breaks local dev and
 * preview deploys, where the admin console builds links from the request host
 * while NEXT_PUBLIC_SITE_URL still points at production.
 */
function allowedHostsFor(request: Request): string[] {
  const hosts: string[] = [];
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      hosts.push(new URL(configured).host);
    } catch {
      // A malformed env var must not take the endpoint down.
    }
  }
  hosts.push(new URL(request.url).host);
  return hosts;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const data = searchParams.get("data")?.trim();

  // Metered before any encoding work: rendering is the expensive part, and an
  // attacker varying ?data= defeats the CDN cache on every request.
  const budget = takeToken(`qr:${clientIp(request)}`, 30, 1 / 2);
  if (!budget.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(budget.retryAfter) } },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Missing ?data=" }, { status: 400 });
  }
  if (data.length > MAX_DATA_LENGTH) {
    // Beyond this the encoder needs a version so dense it stops scanning
    // reliably from a phone, so refusing is kinder than emitting a QR that
    // looks fine and never reads.
    return NextResponse.json(
      { error: `Data too long (max ${MAX_DATA_LENGTH} characters).` },
      { status: 413 },
    );
  }

  if (!isOwnDestination(data, allowedHostsFor(request))) {
    return NextResponse.json(
      { error: "This endpoint only encodes URLs on this site." },
      { status: 422 },
    );
  }

  // `Number(null)` is 0 and `Number.isFinite(0)` is true, so reading the param
  // straight into Number() made the 512 default unreachable: omitting ?size=
  // clamped to the 96px floor, and only a non-numeric value ever reached the
  // fallback. Check for the param's presence instead of its numeric value.
  const rawSize = searchParams.get("size");
  const parsedSize = rawSize === null || rawSize === "" ? NaN : Number(rawSize);
  const size = Number.isFinite(parsedSize) ? Math.min(2048, Math.max(96, parsedSize)) : 512;
  const style: QrStyle = searchParams.get("style") === "squares" ? "squares" : "dots";

  try {
    const svg = renderQrSvg(data, {
      size,
      style,
      foreground: colour(searchParams.get("fg"), "#111110"),
      background: colour(searchParams.get("bg"), "#ffffff"),
      accent: searchParams.get("accent")
        ? colour(searchParams.get("accent"), "#111110")
        : undefined,
      logoText: searchParams.get("logo")?.slice(0, 2) || undefined,
    });

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        // Immutable for a day: the same query always produces the same image.
        "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET /api/qr failed:", error);
    return NextResponse.json({ error: "Could not generate that QR code." }, { status: 500 });
  }
}
