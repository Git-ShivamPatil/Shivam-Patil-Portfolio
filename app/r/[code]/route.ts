import { NextResponse, after } from "next/server";
import { prisma } from "../../../lib/prisma";
import { clientIp } from "../../../lib/rate-limit";
import { buildDestination, recordClick } from "../../../lib/growth/links";

// Reads headers and writes click rows — never static, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P8 — the short-link redirect: `/r/<code>`.
 *
 * The click is recorded in `after()`, so the 302 is sent without waiting on
 * the database. Analytics must never sit between someone tapping a link and
 * the page they wanted — and if the write fails, the visitor should not be
 * able to tell.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

  let link: { id: string; destination: string; code: string; active: boolean } | null = null;
  try {
    link = await prisma.referralLink.findUnique({
      where: { code: code.toLowerCase() },
      select: { id: true, destination: true, code: true, active: true },
    });
  } catch (error) {
    // A database outage must not turn every shared link into an error page.
    // Home is a worse destination than the intended one, but it is a page.
    console.error("[growth] link lookup failed:", error);
    return NextResponse.redirect(new URL("/", origin), 302);
  }

  if (!link || !link.active) {
    // 302 to home rather than 404: these codes live in printed material and
    // on other people's sites, where a dead end reads as a broken site.
    return NextResponse.redirect(new URL("/?ref=expired", origin), 302);
  }

  const target = buildDestination(link.destination, link.code, origin);
  const linkId = link.id;

  const context = {
    referer: request.headers.get("referer"),
    userAgent: request.headers.get("user-agent") ?? "",
    // Set by Vercel's edge; absent locally, which is fine — it is a nullable
    // display column, not something any logic depends on.
    country: request.headers.get("x-vercel-ip-country"),
    ip: clientIp(request),
  };

  after(() => recordClick(linkId, context));

  // 302, not 301: a permanent redirect gets cached by the browser and every
  // intermediary, after which the click stops reaching us at all and the
  // destination can never be changed for people who already followed it.
  return NextResponse.redirect(target, 302);
}
