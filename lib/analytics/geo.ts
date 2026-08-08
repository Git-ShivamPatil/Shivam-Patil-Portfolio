/**
 * P10 — geo attribution from edge headers.
 *
 * There is no IP geolocation call here and there must never be one: every
 * provider is metered, and resolving an address to a place is exactly the
 * operation we have promised not to perform. The CDN in front of the app has
 * already done it at the edge and hands us the answer as a header — country,
 * region and city, with the address itself left behind.
 *
 * Both Vercel's and Cloudflare's header sets are read, in that order, because
 * the blueprint puts Cloudflare in front of the origin and a request can
 * arrive through either path.
 */

export interface GeoContext {
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string | null;
  /** Provider-specific subdivision code (a US state, an Indian state, ...). */
  region: string | null;
  city: string | null;
  /** IANA zone, e.g. "Asia/Kolkata". */
  timezone: string | null;
}

const EMPTY: GeoContext = { country: null, region: null, city: null, timezone: null };

/**
 * City names arrive percent-encoded ("Navi%20Mumbai") because HTTP headers are
 * ASCII-only and plenty of city names are not. A malformed sequence must not
 * throw on the ingest path, so a failed decode falls back to the raw value.
 */
function decodeHeader(value: string | null, max: number): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the raw form.
  }
  const cleaned = decoded.replace(/\p{Cc}/gu, "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export function geoFromHeaders(headers: Headers): GeoContext {
  const country =
    headers.get("x-vercel-ip-country") ??
    headers.get("cf-ipcountry") ??
    headers.get("x-country-code");

  // "XX" and "T1" are what edges emit for "unknown" and "Tor exit node".
  // Stored verbatim they become fictional countries in the dashboard.
  const code = country?.trim().toUpperCase();
  const validCountry =
    code && /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;

  return {
    country: validCountry,
    region: decodeHeader(
      headers.get("x-vercel-ip-country-region") ?? headers.get("cf-region-code"),
      12,
    ),
    city: decodeHeader(headers.get("x-vercel-ip-city") ?? headers.get("cf-ipcity"), 60),
    timezone: decodeHeader(headers.get("x-vercel-ip-timezone") ?? headers.get("cf-timezone"), 40),
  };
}

/** Nothing resolvable — local development, or a request that bypassed the edge. */
export function emptyGeo(): GeoContext {
  return { ...EMPTY };
}

/**
 * "IN" -> "India".
 *
 * `Intl.DisplayNames` is built into V8, so this is a full, correctly localised
 * country list at zero bundle cost — versus the ~250-entry hand-maintained map
 * that would otherwise be sitting in this file going stale. Guarded because
 * the constructor throws on an invalid region code rather than returning
 * undefined.
 */
let regionNames: Intl.DisplayNames | null | undefined;

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  if (!regionNames) return code;
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * "IN" -> 🇮🇳, by mapping each letter to its regional indicator symbol.
 *
 * Returns the globe for anything unrecognised so a table cell is never blank
 * and never renders as two stray letters in a box.
 */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "🌍";
  const base = 0x1f1e6; // REGIONAL INDICATOR SYMBOL LETTER A
  const upper = code.toUpperCase();
  return String.fromCodePoint(base + (upper.charCodeAt(0) - 65), base + (upper.charCodeAt(1) - 65));
}
