import type { MetadataRoute } from "next";

/**
 * P23 — the web app manifest.
 *
 * **Its absence was the reason this site was not installable**, despite having
 * had a service worker since P6. The worker handled push notifications and
 * nothing else, and a worker without a manifest gives a browser no reason to
 * offer "Add to home screen".
 *
 * `display: "standalone"` rather than `"fullscreen"`: fullscreen takes the
 * status bar, which on a phone means hiding the clock and the battery to show
 * a portfolio. That is a trade a game can justify and a document cannot.
 *
 * `theme_color` matches the DEFAULT theme, which is dark. It used to hold the
 * light theme's paper on the reasoning that "the dark theme's is supplied at
 * runtime by the theme provider through a meta tag" — that was not true. There
 * is no such meta tag anywhere in this repo, so this static value was the only
 * one, and it painted an installed copy's splash screen and Android status bar
 * white before a dark page loaded behind it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shivam Patil — Software Engineer",
    short_name: "Shivam Patil",
    description:
      "Portfolio, live coding stats, system-design write-ups, and a set of labs that run real workloads in the browser.",
    start_url: "/",
    // `?source=pwa` is deliberately NOT appended to start_url. It would make
    // every installed launch a distinct URL from the canonical one, splitting
    // the analytics and the ISR cache entry for the busiest page on the site.
    display: "standalone",
    orientation: "any",
    // --bg from the dark block in app/globals.css. These paint the splash
    // screen and the Android status bar of an installed copy, so they have to
    // track whatever the default theme is — a mismatch here is a white flash
    // on every launch.
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/logo.jpeg",
        sizes: "512x512",
        type: "image/jpeg",
        // "any maskable" is a lie unless the icon has the safe-zone padding a
        // maskable icon needs, and a lie here means Android crops the logo.
        // Declared as `any` only, so the platform pads it itself.
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Ask the site",
        short_name: "Ask",
        description: "Retrieval-backed answers about this work",
        url: "/ask",
      },
      {
        name: "Live stats",
        short_name: "Stats",
        description: "GitHub and LeetCode activity",
        url: "/stats",
      },
      { name: "Résumé", short_name: "Résumé", description: "The PDF", url: "/resume" },
    ],
  };
}
