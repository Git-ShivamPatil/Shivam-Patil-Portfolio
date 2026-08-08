import { NextResponse } from "next/server";
import { renderQrSvg, type QrStyle } from "../../../lib/growth/qr";

export const runtime = "nodejs";

/**
 * P8 — dynamic QR endpoint: `/api/qr?data=…`.
 *
 * Public and cacheable. It encodes only what the caller passes, so there is
 * nothing to authorise — but that also means it could be used to mint a QR
 * pointing anywhere, which is why the response is `image/svg+xml` with a
 * restrictive CSP and is never rendered as HTML by anything we control.
 */
const MAX_DATA_LENGTH = 900;

// Hex, rgb()/rgba(), or a bare CSS keyword. Everything else is dropped rather
// than escaped: these values land inside SVG attributes, and an allowlist is
// the only honest way to keep `fill="…"` from becoming an injection point.
const COLOUR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%/]+\)|[a-zA-Z]{3,20})$/;

function colour(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return COLOUR_PATTERN.test(value) ? value : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const data = searchParams.get("data")?.trim();

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

  const sizeParam = Number(searchParams.get("size"));
  const size = Number.isFinite(sizeParam) ? Math.min(2048, Math.max(96, sizeParam)) : 512;
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
