import { NextResponse, after } from "next/server";
import { clientIp, consume } from "../../../lib/rate-limit";
import { findDownload } from "../../../lib/analytics/downloads";
import { recordDownload } from "../../../lib/analytics/collect";
import { geoFromHeaders } from "../../../lib/analytics/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P10 — counted downloads: `/d/<slug>`.
 *
 * Deliberately shaped like P8's `/r/<code>` redirect, because it is the same
 * problem: count something without standing between a person and the thing
 * they asked for. The 302 goes out first, the counter is written in `after()`,
 * and a database failure costs a number rather than a file.
 *
 * Why a redirect rather than streaming the bytes through here: the asset lives
 * in /public and is served by Vercel's CDN. Proxying it through a function
 * would put every megabyte of every résumé download through serverless
 * compute — paid, slower, and pointless when a 302 gets the same count.
 *
 * The `download` attribute on the anchor survives this: it is honoured across
 * a redirect as long as the final URL is same-origin, and the registry only
 * ever yields site-relative paths.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

  const download = findDownload(slug);
  if (!download) {
    // These links get printed on a résumé and pasted into applications. A dead
    // one should land somewhere useful rather than on a 404.
    return NextResponse.redirect(new URL("/resume", origin), 302);
  }

  const target = new URL(download.file, origin);
  const ip = clientIp(request);

  // Meter the counter, never the file. Past the burst the visitor still gets
  // their download; we simply stop counting — the same split the referral
  // redirect makes, and for the same reason: this is an anonymous endpoint
  // that writes rows and takes a row lock on the shared counter.
  const budget = await consume(`download:${ip}`, 10, 1 / 6);
  if (budget.ok) {
    const context = {
      ip,
      userAgent: request.headers.get("user-agent") ?? "",
      geo: geoFromHeaders(request.headers),
      selfHost: request.headers.get("host"),
    };
    after(() => recordDownload(download.slug, download.label, context, `/d/${download.slug}`));
  }

  // 302 rather than 301, again matching /r/[code]: a cached permanent redirect
  // would stop reaching us entirely, and the count would silently flatline
  // while looking like nobody was downloading anything.
  return NextResponse.redirect(target, 302);
}
