import { renderQrSvg } from "../../lib/growth/qr";

/**
 * A scannable QR for one outbound link, rendered on the server.
 *
 * **Why not `/api/qr`.** That endpoint exists and mints prettier codes, but it
 * refuses any payload that does not point at this site, and the refusal is
 * load-bearing rather than incidental: left open, anyone could mint a QR for
 * their own payment page served from this domain and pinned in the edge cache,
 * so the image and its URL would both borrow this site's reputation. The route
 * handler says so at length. Referral links are by definition *not* this site,
 * so calling it here would mean widening exactly the hole that comment was
 * written to close.
 *
 * Calling `renderQrSvg` directly has none of that exposure. The payloads are a
 * fixed list compiled into the build, not user input, so there is nothing to
 * validate and no anonymous compute to meter — and because these are server
 * components the SVG is generated once at build time and ships as markup, with
 * no client JavaScript and no request per code.
 *
 * The colours are literals, not theme tokens, and that is a correctness
 * requirement rather than an oversight: a scanner needs a light quiet zone and
 * a dark module, and a code that inverted with the dark theme would stop being
 * readable by half the phones pointed at it. It is wrapped in a white plate so
 * it stays scannable on the near-black surface too.
 */
export function LinkQr({ url, label, size = 96 }: { url: string; label: string; size?: number }) {
  const svg = renderQrSvg(url, {
    size,
    style: "squares",
    foreground: "#111110",
    background: "#ffffff",
    margin: 4,
  });

  return (
    <span
      className="link-qr"
      style={{ width: size, height: size }}
      // The SVG is generated from a compile-time constant by our own renderer,
      // so there is no untrusted input on this path.
      // sast-ignore: dangerous-html — renderQrSvg output, built from a constant URL.
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label={`QR code linking to ${label}`}
    />
  );
}
