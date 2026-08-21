import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { siteUrl } from "../../../../lib/seo/site";

async function unsubscribe(token: string | null): Promise<"ok" | "invalid" | "error"> {
  if (!token) return "invalid";
  try {
    const result = await prisma.newsletterSubscriber.updateMany({
      where: { unsubToken: token },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
    });
    return result.count > 0 ? "ok" : "invalid";
  } catch (error) {
    console.error("[newsletter] unsubscribe failed:", error);
    return "error";
  }
}

/** Followed from the footer link in an email. */
export async function GET(request: Request) {
  const status = await unsubscribe(new URL(request.url).searchParams.get("token"));
  return NextResponse.redirect(`${siteUrl}/newsletter/confirmed?status=unsubscribed-${status}`);
}

/**
 * RFC 8058 one-click unsubscribe. Gmail and Yahoo POST here directly from
 * their UI with no user-visible page, so this returns a bare 200 rather than
 * a redirect.
 */
export async function POST(request: Request) {
  await unsubscribe(new URL(request.url).searchParams.get("token"));
  return new NextResponse(null, { status: 200 });
}
