/**
 * P13 — the response headers every route carries.
 *
 * Applied through `next.config.ts`'s `headers()` rather than through the proxy,
 * and that choice is load-bearing. A proxy that matches a route forces it to
 * render dynamically, so putting these in middleware would silently convert
 * every statically generated page into a per-request render — undoing P1's
 * static generation and P12's work to protect it. `headers()` applies to static
 * responses too, and costs nothing at request time.
 *
 * Nothing in this file may import from Next, React or Prisma: it is evaluated
 * by the config at build time.
 */

export interface HeaderPair {
  key: string;
  value: string;
}

/**
 * Which form of the policy to build.
 *
 * Passed in rather than read from the environment inside each function, so the
 * production policy can be asserted from a test run — which by definition is
 * not running in production. A CSP that is only ever exercised in the mode it
 * is not shipped in is a CSP nobody has checked.
 */
export type PolicyMode = "production" | "development";

function currentMode(): PolicyMode {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/**
 * Origins that are legitimately allowed to serve content into this page.
 *
 * Kept as named constants rather than inlined, because a CSP is a list of
 * things you have agreed to trust and each one should be answerable for.
 */
const IMAGE_ORIGINS = [
  // OAuth avatars — the same two hosts next.config.ts allows next/image to
  // optimise. If one list grows and the other does not, images 404 or get
  // blocked, so they must be changed together.
  "https://lh3.googleusercontent.com",
  "https://avatars.githubusercontent.com",
];

// The /reach-out map. Rendered only after a click (see components/location-map.tsx),
// but the frame has to be permitted for that click to do anything.
const FRAME_ORIGINS = ["https://www.openstreetmap.org"];

/**
 * Where P16's in-browser model fetches its weights.
 *
 * Added with some reluctance, and worth being explicit about what it costs:
 * `connect-src 'self'` was the single directive doing the most work in this
 * policy — an injected script could run, and had nowhere to send what it stole.
 * These two entries open exactly two destinations, both of them read-only model
 * repositories, and neither accepts a POST that would exfiltrate anything.
 * Every other origin is still refused.
 *
 * The alternative was proxying several hundred megabytes of model weights
 * through our own functions on a free tier, which is not an alternative.
 */
const MODEL_ORIGINS = [
  // The MLC model repository and its CDN.
  "https://huggingface.co",
  "https://cdn-lfs.huggingface.co",
  "https://cdn-lfs-us-1.hf.co",
  // Model and WASM manifests.
  "https://raw.githubusercontent.com",
];

/**
 * The Content-Security-Policy.
 *
 * **`script-src` includes `'unsafe-inline'`, deliberately, and this is the one
 * line in the file worth arguing with.** Two facts make it unavoidable here:
 *
 * 1. The App Router inlines the RSC flight payload into a `<script>` on every
 *    single page. That is not something this project does; it is how the
 *    framework streams server components to the client.
 * 2. The theme and reveal bootstraps must execute before first paint, or the
 *    page flashes the wrong theme and every `[data-reveal]` section stays at
 *    `opacity: 0`.
 *
 * The alternative is a per-request nonce, which Next can only supply from
 * middleware — and middleware that matches page routes forces them all to
 * render dynamically. Trading every statically generated page for a stricter
 * script-src is a bad trade on a site whose pages are almost all static.
 *
 * What `'unsafe-inline'` does *not* give away is worth stating, because "CSP
 * with unsafe-inline is pointless" is a common overstatement. It still blocks
 * `<script src="https://attacker.example">`, still blocks `eval`, and
 * `connect-src 'self'` still blocks exfiltration to any host but ours — so the
 * standard "inject a script that ships cookies somewhere" chain is broken at
 * two of its three links. The remaining risk is inline script injected into our
 * own HTML, which is the risk the escaping in lib/security/escape.ts and the
 * plain-text rendering of all user content address directly.
 */
export function contentSecurityPolicy(mode: PolicyMode = currentMode()): string {
  const isProduction = mode === "production";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // See the long note above.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      // P16. WebLLM compiles the model to WebAssembly and instantiates it,
      // which needs this. It is NOT 'unsafe-eval': it permits compiling
      // WebAssembly and nothing else — no eval, no Function constructor, no
      // string-to-JavaScript path at all. That distinction is the entire reason
      // the directive exists separately, and it is why enabling it here does
      // not give back what 'unsafe-eval' would.
      "'wasm-unsafe-eval'",
      // Next's dev server compiles with eval-based source maps and reloads over
      // a websocket. Neither is present in a production build.
      ...(isProduction ? [] : ["'unsafe-eval'"]),
    ],

    // Motion writes inline styles as it animates, and Next injects a `<style>`
    // element for critical CSS. A hash list would have to be regenerated on
    // every animation change, which is a guarantee it would drift.
    "style-src": ["'self'", "'unsafe-inline'"],

    // `data:` for the inline SVG placeholders, `blob:` for the client-side
    // image compression in P9, which previews a re-encoded file before upload.
    "img-src": ["'self'", "data:", "blob:", ...IMAGE_ORIGINS],

    // True since P12 vendored the fonts. It was not true before: they came from
    // fonts.gstatic.com.
    "font-src": ["'self'"],

    // Every request the browser makes on our behalf goes to our own origin —
    // the analytics beacon, the SSE streams, the API. This is the directive
    // that stops an injected script from shipping anything anywhere.
    "connect-src": [
      "'self'",
      ...MODEL_ORIGINS,
      ...(isProduction ? [] : ["ws:", "http://localhost:*"]),
    ],

    "frame-src": ["'self'", ...FRAME_ORIGINS],

    // Not 'none': /resume previews the PDF with an `<object>`, and the handoff
    // is explicit that it must keep pointing at the file directly rather than
    // going through /d/resume, which would count a download for everyone who
    // merely opened the page.
    "object-src": ["'self'"],

    // The service worker, plus P16: WebLLM runs the model in a worker it
    // creates from a blob URL, which is a distinct origin from ours.
    "worker-src": ["'self'", "blob:"],

    // Nothing may retarget relative URLs, and no form may post off-site. Both
    // are cheap and both close real injection escalations.
    "base-uri": ["'none'"],
    "form-action": ["'self'"],

    // Clickjacking, stated in the modern directive as well as the legacy header
    // below — some browsers still only honour one of the two.
    "frame-ancestors": ["'none'"],
  };

  const serialised = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");

  // Only meaningful over HTTPS, and locally it would break plain-http dev.
  return isProduction ? `${serialised}; upgrade-insecure-requests` : serialised;
}

/**
 * The header set applied to every route.
 *
 * HSTS is deliberately absent from local development: a browser that has once
 * been told to pin `localhost` to HTTPS will keep refusing plain http for the
 * max-age, and there is no way to undo that from the server side.
 */
export function securityHeaders(mode: PolicyMode = currentMode()): HeaderPair[] {
  const isProduction = mode === "production";
  const headers: HeaderPair[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(mode) },

    // Stops a browser from second-guessing a Content-Type. The pairing that
    // matters: /api/qr returns image/svg+xml, and an SVG sniffed as HTML is a
    // script execution context.
    { key: "X-Content-Type-Options", value: "nosniff" },

    // The legacy twin of frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },

    // Send the full URL to ourselves, the origin only to other HTTPS sites, and
    // nothing at all on a downgrade. Every outbound analytics record already
    // stores hostname only, so this matches what the site claims to do.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

    // Nothing on this site uses any of these. Denying them up front means a
    // future embed cannot quietly start asking for a camera.
    {
      key: "Permissions-Policy",
      value: [
        "accelerometer=()",
        "camera=()",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "payment=()",
        "usb=()",
        "interest-cohort=()",
      ].join(", "),
    },

    // Isolates the browsing context group, so a window this site opens — or one
    // that opens it — cannot reach into it.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },

    // Our own assets are ours. Deliberately not `require-corp`, which would
    // demand CORP headers from the OAuth avatar hosts we do not control.
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];

  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      // Two years, subdomains included. No `preload` token: submitting to the
      // preload list is a decision that is very hard to reverse, and the domain
      // is on third-party DNS (see HANDOFF §3).
      value: "max-age=63072000; includeSubDomains",
    });
  }

  return headers;
}
