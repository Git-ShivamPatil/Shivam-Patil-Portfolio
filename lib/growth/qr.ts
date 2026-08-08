import qrcode from "qrcode-generator";

/**
 * Re-express a string so the encoder writes its UTF-8 bytes.
 *
 * qrcode-generator's byte encoder is Latin-1 — it does `charCodeAt(i) & 0xff`.
 * Feed it "中" and it writes 0x2D ('-'): the QR is valid, scannable, and
 * decodes to the wrong string, with no exception and nothing visibly wrong.
 *
 * The library ships a UTF-8 encoder as `stringToBytesFuncs["UTF-8"]`, but only
 * in its CommonJS build; the ESM build this project resolves exposes just
 * `stringToBytes` and `createStringToBytes`, so patching that field throws on
 * undefined. Encoding here instead sidesteps the library's internals
 * altogether: TextEncoder produces the real UTF-8 bytes, and mapping each byte
 * to the code unit of the same value means the Latin-1 pass reproduces them
 * exactly.
 *
 * Note the matrix-fidelity test cannot catch this class of bug — it compares
 * our SVG against this same encoder, so it would agree with the corruption.
 * The byte-level test is what covers it.
 */
export function toUtf8ByteString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = "";
  // Built one char at a time rather than via spread: a long payload would
  // otherwise blow the argument limit on String.fromCharCode.
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/**
 * P8 — dynamic QR rendering.
 *
 * `qrcode-generator` does the encoding (Reed-Solomon, masking, version fit)
 * and hands back a module matrix; everything below is the drawing, because a
 * default QR is a black square and this one goes on a slide, a business card,
 * and the admin console. The matrix is untouched — styling only ever changes
 * how a module is painted, never whether it is set — so scannability is a
 * property of the encoder, not of this file.
 *
 * SVG rather than PNG: it is generated per request with no image pipeline, it
 * scales to any print size, and it costs a few KB of text.
 */

export type QrStyle = "dots" | "squares";

export interface QrOptions {
  /** Module colour. Accepts any CSS colour; a gradient is applied when `accent` is set. */
  foreground?: string;
  background?: string;
  /** Second gradient stop. Omit for a flat fill. */
  accent?: string;
  style?: QrStyle;
  /** Quiet-zone width in modules. The spec's minimum is 4 — going below breaks scanners. */
  margin?: number;
  /** Rendered edge length in px. */
  size?: number;
  /** Punch a hole in the centre for a logo. Safe: error correction level H tolerates ~30% loss. */
  logoText?: string;
}

const QUIET_ZONE_MIN = 4;

/**
 * Error correction level H (~30% recovery).
 *
 * Deliberately the highest level even though it grows the matrix: these codes
 * get printed, photographed at an angle, and shown on a projector, and level H
 * is what makes the centre logo cut-out below safe rather than a gamble.
 */
const ECC_LEVEL = "H";

export function renderQrSvg(data: string, options: QrOptions = {}): string {
  const {
    foreground = "#111110",
    background = "#ffffff",
    accent,
    style = "dots",
    margin = QUIET_ZONE_MIN,
    size = 512,
    logoText,
  } = options;

  // typeNumber 0 = "pick the smallest version that fits the data".
  const qr = qrcode(0, ECC_LEVEL);
  qr.addData(toUtf8ByteString(data));
  qr.make();

  const count = qr.getModuleCount();
  const quiet = Math.max(QUIET_ZONE_MIN, margin);
  const total = count + quiet * 2;

  const fill = accent ? "url(#qr-gradient)" : foreground;
  const parts: string[] = [];

  // The three finder patterns are drawn as rounded frames rather than as
  // individual modules. They are what a scanner locks onto first, so keeping
  // them as solid continuous shapes is both better looking and more reliable
  // than a stippled approximation.
  const finders = [
    [0, 0],
    [count - 7, 0],
    [0, count - 7],
  ];
  const inFinder = (row: number, col: number) =>
    finders.some(([fc, fr]) => col >= fc && col < fc + 7 && row >= fr && row < fr + 7);

  for (const [fc, fr] of finders) {
    const x = fc + quiet;
    const y = fr + quiet;
    parts.push(
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.9" fill="none" stroke="${fill}" stroke-width="1"/>`,
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${fill}"/>`,
    );
  }

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col) || inFinder(row, col)) continue;
      const x = col + quiet;
      const y = row + quiet;
      if (style === "dots") {
        parts.push(`<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.46" fill="${fill}"/>`);
      } else {
        parts.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
      }
    }
  }

  // Centre cut-out. Kept to ~5 modules a side (well under the ~30% budget
  // level H allows) and backed by a solid plate so the modules underneath do
  // not read as noise.
  let logo = "";
  if (logoText) {
    const box = Math.max(5, Math.round(count * 0.22));
    const origin = quiet + (count - box) / 2;
    logo =
      `<rect x="${origin}" y="${origin}" width="${box}" height="${box}" rx="${box * 0.24}" fill="${background}"/>` +
      `<rect x="${origin + 0.4}" y="${origin + 0.4}" width="${box - 0.8}" height="${box - 0.8}" rx="${box * 0.22}" fill="none" stroke="${fill}" stroke-width="0.3"/>` +
      `<text x="${origin + box / 2}" y="${origin + box / 2}" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif, system-ui, sans-serif" font-weight="700" font-size="${box * 0.42}" fill="${fill}">${escapeXml(logoText.slice(0, 2).toUpperCase())}</text>`;
  }

  const gradient = accent
    ? `<defs><linearGradient id="qr-gradient" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${foreground}"/><stop offset="100%" stop-color="${accent}"/>` +
      `</linearGradient></defs>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="geometricPrecision" role="img" ` +
    `aria-label="QR code">` +
    gradient +
    `<rect width="${total}" height="${total}" fill="${background}"/>` +
    parts.join("") +
    logo +
    `</svg>`
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
