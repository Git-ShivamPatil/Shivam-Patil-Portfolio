import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { REFERRAL_COOKIE } from "../referral";

/**
 * P8 — trackable short links.
 *
 * A link is `/r/<code>` and redirects to its destination with `?ref=<code>`
 * appended. That single detail is what makes the phase worth building: the
 * referral cookie written by components/referral-capture.tsx already flows
 * into ContactMessage, Booking and NewsletterSubscriber as `referralRef`, so
 * appending the code turns every existing conversion path into an attributed
 * one without touching any of them.
 */

/**
 * Alphabet for generated codes. No 0/O/1/l/I: these codes get read off a
 * screen, dictated over a call, and — the actual reason — scanned back out of
 * a QR that may be printed small or photographed at an angle.
 */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 7;

/** Codes we mint ourselves must not collide with a real route segment. */
const RESERVED_CODES = new Set(["new", "edit", "admin", "api", "qr", "r"]);

export function generateCode(length = CODE_LENGTH): string {
  // rejection-free mapping is unnecessary here: the alphabet is 31 chars and
  // the bias from % is negligible against a 7-char space, but randomBytes
  // (not Math.random) still matters — a guessable code lets someone inflate
  // another link's numbers.
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateCode();
    if (RESERVED_CODES.has(code)) continue;
    const clash = await prisma.referralLink.findUnique({ where: { code }, select: { id: true } });
    if (!clash) return code;
  }
  // Widen rather than fail: at 31^7 a run of six collisions means something
  // is wrong with our assumptions, and a longer code is a better outcome
  // than a 500 on the create form.
  return generateCode(CODE_LENGTH + 3);
}

/** A code is valid if it is lowercase alphanumeric and not a reserved word. */
export function isValidCode(code: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(code) && !RESERVED_CODES.has(code);
}

/**
 * Build the outbound URL for a link, carrying the referral tag.
 *
 * Relative destinations are resolved against the site origin so a link can be
 * stored as "/services" and still redirect correctly. An existing query string
 * is preserved; an existing `ref` is *not* overwritten, because a hand-written
 * destination that already carries one is a deliberate choice.
 */
export function buildDestination(destination: string, code: string, origin: string): string {
  // Strip tab/CR/LF before parsing rather than trusting the stored value.
  // lib/validations/link.ts rejects them on write, but this is the function
  // that actually performs the redirect, and it must also hold for a row
  // written before that rule existed or by any path that bypasses the schema.
  // The URL parser strips these characters itself, which is exactly what makes
  // "/\t/evil.com" read as a relative path to a `startsWith("//")` check and
  // then resolve to https://evil.com/ — so removing them here means what we
  // validate is what we parse.
  const cleaned = destination.replace(/[\t\r\n]/g, "");

  // Check for protocol-relative form AFTER stripping, not before. "/\t\t//evil.com"
  // is not protocol-relative as written, but it is once the parser has removed
  // the tabs — and the parser removes them whether we do or not. Testing the
  // raw string is exactly the mistake that made this bypassable.
  const isProtocolRelative = cleaned.startsWith("//") || cleaned.startsWith("/\\");

  let url: URL;
  try {
    url = isProtocolRelative ? new URL("/", origin) : new URL(cleaned, origin);
  } catch {
    // A destination that won't parse is a data problem, not a reason to 500
    // on a visitor — send them to the homepage with the tag intact.
    url = new URL("/", origin);
  }

  // Final gate: only http(s) ever leaves this function. A stored
  // "javascript:" or "data:" destination would otherwise be handed straight
  // to a browser by the redirect.
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    url = new URL("/", origin);
  }

  if (!url.searchParams.has("ref")) url.searchParams.set("ref", code);
  return url.toString();
}

/**
 * Per-visitor pseudonym for uniqueness counting.
 *
 * Salted with AUTH_SECRET and bucketed by UTC date, so it identifies "the same
 * visitor, today" and nothing beyond that. Yesterday's hashes cannot be joined
 * to today's, which is what keeps this a counter rather than a tracker.
 */
export function visitorHashFor(ip: string, userAgent: string, now = new Date()): string {
  const salt = process.env.AUTH_SECRET ?? "dev-salt";
  const day = now.toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${salt}|${day}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

/** Coarse device class from the UA string — enough to compare share channels. */
export function deviceFrom(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (!ua) return "unknown";
  if (/bot|crawler|spider|crawling|preview|slurp|facebookexternalhit|whatsapp/.test(ua)) {
    return "bot";
  }
  if (/ipad|tablet|playbook|silk/.test(ua)) return "tablet";
  if (/mobi|android|iphone|ipod/.test(ua)) return "mobile";
  return "desktop";
}

export interface ClickContext {
  referer: string | null;
  userAgent: string;
  country: string | null;
  ip: string;
}

/**
 * Record one click.
 *
 * Never throws: this runs on the redirect path, and a visitor must reach their
 * destination whether or not analytics can be written. Bots are counted
 * separately rather than dropped — a link preview fetched by WhatsApp is real
 * traffic worth seeing, just not a person.
 */
export async function recordClick(linkId: string, context: ClickContext): Promise<void> {
  try {
    const device = deviceFrom(context.userAgent);
    const visitorHash = visitorHashFor(context.ip, context.userAgent);

    const seen = await prisma.referralClick.findFirst({
      where: { linkId, visitorHash },
      select: { id: true },
    });
    const isUnique = !seen;

    await prisma.$transaction([
      prisma.referralClick.create({
        data: {
          linkId,
          // Bounded before insert: these are attacker-controlled headers, and
          // an unbounded write is a cheap way to bloat the table.
          referer: context.referer?.slice(0, 500) ?? null,
          userAgent: context.userAgent.slice(0, 300) || null,
          country: context.country?.slice(0, 2) ?? null,
          device,
          visitorHash,
          isUnique,
        },
      }),
      prisma.referralLink.update({
        where: { id: linkId },
        data: {
          clickCount: { increment: 1 },
          uniqueCount: isUnique ? { increment: 1 } : undefined,
        },
      }),
    ]);
  } catch (error) {
    console.error("[growth] recordClick failed:", error);
  }
}

export interface LinkAnalytics {
  code: string;
  label: string;
  clicks: number;
  uniques: number;
  conversions: number;
}

export interface GrowthAnalytics {
  totalClicks: number;
  totalUniques: number;
  totalConversions: number;
  links: LinkAnalytics[];
  daily: { date: string; clicks: number }[];
  devices: { device: string; count: number }[];
  referers: { source: string; count: number }[];
}

/** Host-only label for a referer URL — the full path is noise in a top-N list. */
function refererSource(referer: string | null): string {
  if (!referer) return "direct";
  try {
    return new URL(referer).hostname.replace(/^www\./, "");
  } catch {
    return "other";
  }
}

/**
 * Everything the growth dashboard renders, in one pass.
 *
 * Conversions are counted by matching `referralRef` across the three tables
 * that capture it. They are counted per link code rather than joined, because
 * a lead may arrive months after the click and there is no click row to hang
 * it off — the code is the only durable join key.
 */
export async function getGrowthAnalytics(days = 30): Promise<GrowthAnalytics> {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const [links, clicks, messageRefs, bookingRefs, newsletterRefs] = await Promise.all([
    prisma.referralLink.findMany({ orderBy: { clickCount: "desc" }, take: 50 }),
    prisma.referralClick.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, device: true, referer: true },
      take: 20000,
    }),
    prisma.contactMessage.groupBy({
      by: ["referralRef"],
      _count: true,
      where: { referralRef: { not: null } },
    }),
    prisma.booking.groupBy({
      by: ["referralRef"],
      _count: true,
      where: { referralRef: { not: null } },
    }),
    prisma.newsletterSubscriber.groupBy({
      by: ["referralRef"],
      _count: true,
      where: { referralRef: { not: null } },
    }),
  ]);

  const conversions = new Map<string, number>();
  for (const group of [messageRefs, bookingRefs, newsletterRefs]) {
    for (const row of group) {
      if (!row.referralRef) continue;
      conversions.set(row.referralRef, (conversions.get(row.referralRef) ?? 0) + row._count);
    }
  }

  // Pre-seed every day in range so the chart has no gaps where a quiet day
  // would otherwise collapse the x-axis.
  const daily = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    daily.set(date.toISOString().slice(0, 10), 0);
  }

  const devices = new Map<string, number>();
  const referers = new Map<string, number>();

  for (const click of clicks) {
    const day = click.createdAt.toISOString().slice(0, 10);
    if (daily.has(day)) daily.set(day, (daily.get(day) ?? 0) + 1);
    devices.set(click.device, (devices.get(click.device) ?? 0) + 1);
    const source = refererSource(click.referer);
    referers.set(source, (referers.get(source) ?? 0) + 1);
  }

  return {
    totalClicks: links.reduce((sum, link) => sum + link.clickCount, 0),
    totalUniques: links.reduce((sum, link) => sum + link.uniqueCount, 0),
    totalConversions: [...conversions.values()].reduce((sum, n) => sum + n, 0),
    links: links.map((link) => ({
      code: link.code,
      label: link.label,
      clicks: link.clickCount,
      uniques: link.uniqueCount,
      conversions: conversions.get(link.code) ?? 0,
    })),
    daily: [...daily.entries()].map(([date, count]) => ({ date, clicks: count })),
    devices: [...devices.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([d, c]) => ({
        device: d,
        count: c,
      })),
    referers: [...referers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([source, count]) => ({ source, count })),
  };
}

export { REFERRAL_COOKIE };
